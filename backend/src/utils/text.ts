import * as cheerio from "cheerio";
import { MAX_TRANSLATION_CHARS } from "../constants.js";

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

  return input
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
