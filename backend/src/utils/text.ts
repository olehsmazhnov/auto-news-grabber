import * as cheerio from "cheerio";
import { MAX_TRANSLATION_CHARS } from "../constants.js";

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const CONTACT_LABEL_RE = /^(?:media|press)\s+contacts?\b[:\s-]*$/i;
const PHONE_PREFIX_RE = /^(?:tel|phone|mobile|contact|tel\.?|telephone)[:\s-]*/i;

function isLikelyPhoneLine(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) {
    return false;
  }

  const withoutPrefix = trimmed.replace(PHONE_PREFIX_RE, "").trim();
  if (!withoutPrefix) {
    return false;
  }

  if (EMAIL_RE.test(withoutPrefix)) {
    return false;
  }

  if (/[\p{L}]/u.test(withoutPrefix)) {
    return false;
  }

  const digits = withoutPrefix.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 18) {
    return false;
  }

  return /[+\-().\s]/.test(withoutPrefix) || withoutPrefix.startsWith("+");
}

function isLikelyContactNameLine(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed.length < 3 || trimmed.length > 80) {
    return false;
  }

  if (EMAIL_RE.test(trimmed) || /\d/.test(trimmed) || /https?:\/\//i.test(trimmed)) {
    return false;
  }

  if (CONTACT_LABEL_RE.test(trimmed)) {
    return false;
  }

  const words = trimmed.split(/\s+/).filter((word) => word.length > 0);
  if (words.length < 2 || words.length > 4) {
    return false;
  }

  let uppercaseInitialWords = 0;
  for (const word of words) {
    if (!/^[\p{L}'-]{2,}$/u.test(word)) {
      return false;
    }
    if (/^\p{Lu}/u.test(word)) {
      uppercaseInitialWords += 1;
    }
  }

  return uppercaseInitialWords >= 2;
}

function isContactInfoLine(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) {
    return false;
  }

  if (CONTACT_LABEL_RE.test(trimmed)) {
    return true;
  }

  if (EMAIL_RE.test(trimmed)) {
    return true;
  }

  return isLikelyPhoneLine(trimmed);
}

function stripMediaContacts(content: string): string {
  if (!content) {
    return "";
  }

  const lines = content.split("\n");
  if (lines.length === 0) {
    return content;
  }

  const drop = new Array<boolean>(lines.length).fill(false);

  const markNameNear = (index: number): void => {
    if (index >= 0 && index < lines.length && isLikelyContactNameLine(lines[index])) {
      drop[index] = true;
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    if (!isContactInfoLine(lines[index])) {
      continue;
    }

    drop[index] = true;

    markNameNear(index - 1);
    if (index >= 2 && lines[index - 1].trim() === "") {
      markNameNear(index - 2);
    }

    if (index + 1 < lines.length && isContactInfoLine(lines[index + 1])) {
      drop[index + 1] = true;
    }

    if (index + 2 < lines.length && lines[index + 1].trim() === "" && isContactInfoLine(lines[index + 2])) {
      drop[index + 2] = true;
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    if (drop[index] || !isLikelyContactNameLine(lines[index])) {
      continue;
    }

    const prevDropped = index > 0 && drop[index - 1];
    const nextDropped = index + 1 < lines.length && drop[index + 1];
    const prevGapDropped = index >= 2 && lines[index - 1].trim() === "" && drop[index - 2];
    const nextGapDropped =
      index + 2 < lines.length &&
      lines[index + 1].trim() === "" &&
      drop[index + 2];

    if (prevDropped || nextDropped || prevGapDropped || nextGapDropped) {
      drop[index] = true;
    }
  }

  const cleaned = lines.filter((_, index) => !drop[index]).join("\n");
  return cleaned.replace(/\n{3,}/g, "\n\n").trim();
}

export function normalizeText(input: unknown): string {
  if (typeof input !== "string") {
    return "";
  }

  return input
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeParagraph(input: unknown): string {
  if (typeof input !== "string") {
    return "";
  }

  return input
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeArticleContent(input: unknown): string {
  if (typeof input !== "string") {
    return "";
  }

  const normalized = input
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return stripMediaContacts(normalized);
}

export function trimContent(content: string, maxChars: number): string {
  if (!content) {
    return "";
  }

  if (content.length <= maxChars) {
    return content;
  }

  const trimmed = content.slice(0, maxChars).trim();
  return `${trimmed}...`;
}

export function htmlToText(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) {
    return "";
  }

  const $ = cheerio.load(input);
  $("script, style, noscript").remove();

  const paragraphs: string[] = [];
  $("p").each((_, element) => {
    const text = normalizeParagraph($(element).text());
    if (text) {
      paragraphs.push(text);
    }
  });

  if (paragraphs.length > 0) {
    return normalizeArticleContent(paragraphs.join("\n\n"));
  }

  return normalizeArticleContent($.text());
}

export function splitForTranslation(text: string): string[] {
  if (!text) {
    return [];
  }

  if (text.length <= MAX_TRANSLATION_CHARS) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + MAX_TRANSLATION_CHARS, text.length);

    if (end < text.length) {
      const boundary = text.lastIndexOf("\n", end);
      if (boundary > start + Math.floor(MAX_TRANSLATION_CHARS * 0.5)) {
        end = boundary;
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }

    start = end;
  }

  return chunks;
}

export function excerptBySentences(
  content: string,
  maxSentences: number,
  maxChars: number,
): string {
  const normalized = normalizeArticleContent(content);
  if (!normalized) {
    return "";
  }

  const sentences = normalized.match(/[^.!?]+[.!?]*/g) ?? [normalized];
  const out: string[] = [];

  for (const sentence of sentences) {
    if (out.length >= maxSentences) {
      break;
    }

    const candidate = normalizeText(sentence);
    if (!candidate) {
      continue;
    }

    const next = [...out, candidate].join(" ");
    if (next.length > maxChars) {
      break;
    }

    out.push(candidate);
  }

  const result = out.join(" ").trim();
  if (!result) {
    return trimContent(normalized, maxChars);
  }

  return result;
}
