import { REQUEST_TIMEOUT_MS, USER_AGENT } from "../constants.js";
import { splitForTranslation } from "./text.js";
import { log } from "./log.js";

const TRANSLATION_RETRY_ATTEMPTS = 3;
const TRANSLATION_RETRY_BASE_DELAY_MS = 350;
const MAX_SEGMENT_RESCUES_PER_TEXT = 40;
const MIN_SEGMENT_LETTERS = 20;

type SourceLanguage = "auto" | "en";

interface ScriptLetterStats {
  totalLetters: number;
  latinLetters: number;
  cyrillicLetters: number;
}

function isUkLanguage(targetLanguage: string): boolean {
  const normalized = targetLanguage.trim().toLowerCase();
  return normalized === "uk" || normalized.startsWith("uk-");
}

function isRetriableStatus(statusCode: number): boolean {
  return statusCode === 408
    || statusCode === 425
    || statusCode === 429
    || statusCode === 500
    || statusCode === 502
    || statusCode === 503
    || statusCode === 504;
}

function isRetriableError(error: unknown): boolean {
  const message = String(error ?? "").toLowerCase();
  return message.includes("timed out")
    || message.includes("timeout")
    || message.includes("network")
    || message.includes("fetch")
    || message.includes("econn")
    || message.includes("socket")
    || message.includes("reset")
    || message.includes("abort");
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function extractTranslatedPayload(payload: unknown): string {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) {
    return "";
  }

  const lines = payload[0]
    .map((entry) => {
      if (Array.isArray(entry) && typeof entry[0] === "string") {
        return entry[0];
      }
      return "";
    })
    .filter((entry) => entry.length > 0);

  return lines.join("").trim();
}

function collectScriptLetterStats(text: string): ScriptLetterStats {
  let totalLetters = 0;
  let latinLetters = 0;
  let cyrillicLetters = 0;

  for (const char of text) {
    if (!/\p{L}/u.test(char)) {
      continue;
    }

    totalLetters += 1;
    if (/[A-Za-z]/.test(char)) {
      latinLetters += 1;
    }
    if (/[\u0400-\u04FF]/u.test(char)) {
      cyrillicLetters += 1;
    }
  }

  return {
    totalLetters,
    latinLetters,
    cyrillicLetters,
  };
}

function ratio(numerator: number, denominator: number): number {
  if (!denominator) {
    return 0;
  }
  return numerator / denominator;
}

function splitIntoSegments(text: string): string[] {
  const segments = text.match(/[^.!?\n]+[.!?]*["')\]»”]*\s*|\n+/gu);
  if (!segments || segments.length === 0) {
    return [text];
  }
  return segments;
}

function hasOnlyNewlines(segment: string): boolean {
  return /^\n+$/u.test(segment);
}

function isLikelyNonUkrainianSegment(segment: string): boolean {
  const trimmed = segment.trim();
  if (!trimmed) {
    return false;
  }

  const stats = collectScriptLetterStats(trimmed);
  if (stats.totalLetters < MIN_SEGMENT_LETTERS) {
    return false;
  }

  const latinRatio = ratio(stats.latinLetters, stats.totalLetters);
  const cyrillicRatio = ratio(stats.cyrillicLetters, stats.totalLetters);
  return latinRatio >= 0.45 && cyrillicRatio <= 0.45;
}

function isTranslationImprovement(original: string, translated: string): boolean {
  if (!translated || translated === original) {
    return false;
  }

  const before = collectScriptLetterStats(original);
  const after = collectScriptLetterStats(translated);

  const beforeLatinRatio = ratio(before.latinLetters, before.totalLetters);
  const afterLatinRatio = ratio(after.latinLetters, after.totalLetters);

  const beforeCyrillicRatio = ratio(before.cyrillicLetters, before.totalLetters);
  const afterCyrillicRatio = ratio(after.cyrillicLetters, after.totalLetters);

  return afterLatinRatio < beforeLatinRatio - 0.05
    || afterCyrillicRatio > beforeCyrillicRatio + 0.05;
}

function keepSurroundingWhitespace(original: string, translated: string): string {
  const prefix = original.match(/^\s*/u)?.[0] ?? "";
  const suffix = original.match(/\s*$/u)?.[0] ?? "";
  return `${prefix}${translated}${suffix}`;
}

async function translateViaGoogleEndpointInternal(
  text: string,
  targetLanguage: string,
  sourceLanguage: SourceLanguage,
): Promise<string> {
  for (let attempt = 0; attempt < TRANSLATION_RETRY_ATTEMPTS; attempt += 1) {
    const isLastAttempt = attempt >= TRANSLATION_RETRY_ATTEMPTS - 1;
    try {
      const params = new URLSearchParams({
        client: "gtx",
        sl: sourceLanguage,
        tl: targetLanguage,
        dt: "t",
        q: text,
      });

      const url = `https://translate.googleapis.com/translate_a/single?${params.toString()}`;
      const response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        if (!isLastAttempt && isRetriableStatus(response.status)) {
          await sleep(TRANSLATION_RETRY_BASE_DELAY_MS * (attempt + 1));
          continue;
        }
        return text;
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return text;
      }

      const translated = extractTranslatedPayload(payload);
      return translated || text;
    } catch (error) {
      if (!isLastAttempt && isRetriableError(error)) {
        await sleep(TRANSLATION_RETRY_BASE_DELAY_MS * (attempt + 1));
        continue;
      }
      return text;
    }
  }

  return text;
}

export async function translateViaGoogleEndpoint(
  text: string,
  targetLanguage: string,
): Promise<string> {
  return translateViaGoogleEndpointInternal(text, targetLanguage, "auto");
}

export async function repairMixedUkrainianText(
  text: string,
  verbose: boolean,
): Promise<string> {
  const segments = splitIntoSegments(text);
  if (segments.length === 0) {
    return text;
  }

  const output: string[] = [];
  let rescuesApplied = 0;

  for (const segment of segments) {
    if (hasOnlyNewlines(segment) || !isLikelyNonUkrainianSegment(segment)) {
      output.push(segment);
      continue;
    }

    if (rescuesApplied >= MAX_SEGMENT_RESCUES_PER_TEXT) {
      output.push(segment);
      continue;
    }

    const trimmed = segment.trim();
    let translated = await translateViaGoogleEndpointInternal(trimmed, "uk", "en");
    if (!isTranslationImprovement(trimmed, translated)) {
      translated = await translateViaGoogleEndpointInternal(trimmed, "uk", "auto");
    }

    if (isTranslationImprovement(trimmed, translated)) {
      output.push(keepSurroundingWhitespace(segment, translated));
      rescuesApplied += 1;
      continue;
    }

    output.push(segment);
  }

  if (rescuesApplied > 0) {
    log(`Translation rescue applied to ${rescuesApplied} segment(s)`, verbose);
  }

  return output.join("");
}

export async function translateText(
  text: string,
  targetLanguage: string,
  enabled: boolean,
  verbose: boolean,
): Promise<string> {
  if (!enabled || !text) {
    return text;
  }

  const chunks = splitForTranslation(text);
  const translatedChunks: string[] = [];

  for (const chunk of chunks) {
    try {
      translatedChunks.push(
        await translateViaGoogleEndpoint(chunk, targetLanguage),
      );
    } catch (error) {
      log(`Translation failed, keeping original text: ${String(error)}`, verbose);
      translatedChunks.push(chunk);
    }
  }

  const translatedText = translatedChunks.join("\n").trim();
  if (!isUkLanguage(targetLanguage)) {
    return translatedText;
  }

  return repairMixedUkrainianText(translatedText, verbose);
}
