import { normalizeArticleContent } from "./text.js";

const URL_RE = /https?:\/\/\S+/gi;
const PIPE_RE = /\|/g;
const BULLET_RE = /•/g;
const COLON_RE = /:/g;
const PIPE_SEPARATOR_RE = /\s*\|\s*/g;
const BULLET_SEPARATOR_RE = /\s*•\s*/g;
const VALUE_TO_LABEL_BREAK_RE =
  /([0-9$€£¥₴])\s+((?:\d+\.\s*)?[A-ZА-ЯІЇЄҐ][A-Za-zА-Яа-яІіЇїЄєҐґ0-9+/%()'’\- ]{1,42}:)/gu;
const INLINE_PLUS_SEPARATOR_RE = /\s\+\s/g;
const STAT_LABEL_PATTERN =
  "((?:\\d+\\.\\s*)?[A-ZА-ЯІЇЄҐ][A-Za-zА-Яа-яІіЇїЄєҐґ0-9+/%()'’\\- ]{1,42}:)";

function countMatches(value: string, pattern: RegExp): number {
  const matches = value.match(pattern);
  return matches ? matches.length : 0;
}

function stripUrls(input: string): string {
  return input.replace(URL_RE, " ");
}

function isLikelyStatLabel(labelWithColon: string): boolean {
  const label = labelWithColon.slice(0, -1).trim();
  if (label.length < 3 || label.length > 44) {
    return false;
  }

  if (/[.!?]$/.test(label)) {
    return false;
  }

  const words = label.split(/\s+/).filter((word) => word.length > 0);
  return words.length >= 1 && words.length <= 8;
}

function collectStatLabelIndexes(input: string): number[] {
  const regex = new RegExp(STAT_LABEL_PATTERN, "gu");
  const indexes: number[] = [];
  for (const match of input.matchAll(regex)) {
    if (typeof match.index !== "number") {
      continue;
    }

    const label = match[1] ?? "";
    if (!isLikelyStatLabel(label)) {
      continue;
    }

    indexes.push(match.index);
  }
  return indexes;
}

function shouldFormatDenseContent(content: string): boolean {
  const signal = stripUrls(content);
  const labels = collectStatLabelIndexes(signal).length;
  const pipes = countMatches(signal, PIPE_RE);
  const bullets = countMatches(signal, BULLET_RE);
  const colons = countMatches(signal, COLON_RE);
  const hasLineBreaks = signal.includes("\n");

  if (labels >= 3 && (pipes >= 1 || bullets >= 1)) {
    return true;
  }

  if (!hasLineBreaks && labels >= 3 && colons >= 4) {
    return true;
  }

  return !hasLineBreaks && colons >= 5 && (pipes >= 2 || bullets >= 2);
}

function splitDenseLineByLabels(line: string): string[] {
  const splitPoints = collectStatLabelIndexes(line).filter((index) => index > 0);
  if (splitPoints.length === 0) {
    return [line];
  }

  const chunks: string[] = [];
  let start = 0;

  for (const point of splitPoints) {
    const chunk = line.slice(start, point).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    start = point;
  }

  const tail = line.slice(start).trim();
  if (tail) {
    chunks.push(tail);
  }

  return chunks.length >= 2 ? chunks : [line];
}

function splitDenseLineByBullets(line: string): string[] {
  if (countMatches(line, BULLET_RE) < 2) {
    return [line];
  }

  const parts = line
    .split(BULLET_SEPARATOR_RE)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length < 2) {
    return [line];
  }

  return parts.map((part, index) => (index === 0 ? part : `- ${part}`));
}

function applyPrimarySeparators(content: string): string {
  let out = content;

  if (countMatches(out, PIPE_RE) >= 2) {
    out = out.replace(PIPE_SEPARATOR_RE, "\n");
  }

  if (countMatches(out, BULLET_RE) >= 2) {
    out = out.replace(BULLET_SEPARATOR_RE, "\n• ");
  }

  out = out.replace(VALUE_TO_LABEL_BREAK_RE, "$1\n$2");

  if (out.length > 220 && out.includes(" + ")) {
    out = out.replace(INLINE_PLUS_SEPARATOR_RE, "\n\n+ ");
  }

  return out;
}

function formatDenseLines(content: string): string {
  const formattedLines: string[] = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      formattedLines.push("");
      continue;
    }

    const byLabels = splitDenseLineByLabels(line);
    for (const labelLine of byLabels) {
      const byBullets = splitDenseLineByBullets(labelLine);
      formattedLines.push(...byBullets);
    }
  }

  return formattedLines.join("\n");
}

export function formatPostTranslationContent(content: string): string {
  const normalized = normalizeArticleContent(content);
  if (!normalized) {
    return "";
  }

  if (!shouldFormatDenseContent(normalized)) {
    return normalized;
  }

  const withSeparators = applyPrimarySeparators(normalized);
  const structured = formatDenseLines(withSeparators);
  return normalizeArticleContent(structured);
}
