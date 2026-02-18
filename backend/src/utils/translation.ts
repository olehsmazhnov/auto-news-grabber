import { REQUEST_TIMEOUT_MS, USER_AGENT } from "../constants.js";
import { splitForTranslation } from "./text.js";
import { log } from "./log.js";

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

export async function translateViaGoogleEndpoint(
  text: string,
  targetLanguage: string,
): Promise<string> {
  const params = new URLSearchParams({
    client: "gtx",
    sl: "auto",
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

  return translatedChunks.join("\n").trim();
}
