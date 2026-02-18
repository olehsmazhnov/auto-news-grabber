import { DEFAULT_MAX_CONTENT_CHARS } from "../constants.js";
import type { CliOptions } from "../types.js";

function parseInteger(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
}

function getPositiveOrDefault(value: number | null, fallback: number): number {
  if (value === null || value <= 0) {
    return fallback;
  }
  return value;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    config: "backend/sources.json",
    output: "data/news.json",
    targetLanguage: "uk",
    disableTranslation: false,
    maxItemsPerSource: null,
    maxContentChars: DEFAULT_MAX_CONTENT_CHARS,
    verbose: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];

    if (key === "--config" && next) {
      options.config = next;
      i += 1;
      continue;
    }

    if (key === "--output" && next) {
      options.output = next;
      i += 1;
      continue;
    }

    if (key === "--target-language" && next) {
      options.targetLanguage = next;
      i += 1;
      continue;
    }

    if (key === "--max-items-per-source" && next) {
      const parsed = parseInteger(next);
      options.maxItemsPerSource = parsed !== null && parsed > 0 ? parsed : null;
      i += 1;
      continue;
    }

    if (key === "--max-content-chars" && next) {
      options.maxContentChars = getPositiveOrDefault(
        parseInteger(next),
        DEFAULT_MAX_CONTENT_CHARS,
      );
      i += 1;
      continue;
    }

    if (key === "--disable-translation") {
      options.disableTranslation = true;
      continue;
    }

    if (key === "--verbose") {
      options.verbose = true;
    }
  }

  return options;
}
