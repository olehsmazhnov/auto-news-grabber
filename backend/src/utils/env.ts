import fs from "node:fs";
import path from "node:path";

interface LoadEnvFromFileOptions {
  filePath?: string;
  overrideExisting?: boolean;
}

const ENV_LINE_PATTERN = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

function decodeDoubleQuotedValue(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\");
}

function stripInlineComment(value: string): string {
  const commentIndex = value.search(/\s+#/);
  if (commentIndex < 0) {
    return value.trim();
  }
  return value.slice(0, commentIndex).trim();
}

function parseEnvValue(rawValue: string): string {
  const normalized = rawValue.trim();
  if (!normalized) {
    return "";
  }

  if (normalized.startsWith("\"") && normalized.endsWith("\"") && normalized.length >= 2) {
    return decodeDoubleQuotedValue(normalized.slice(1, -1));
  }

  if (normalized.startsWith("'") && normalized.endsWith("'") && normalized.length >= 2) {
    return normalized.slice(1, -1);
  }

  return stripInlineComment(normalized);
}

function shouldSkipExistingValue(
  envName: string,
  overrideExisting: boolean,
): boolean {
  if (overrideExisting) {
    return false;
  }
  return typeof process.env[envName] === "string";
}

function parseLineToEntry(
  line: string,
): { name: string; value: string } | null {
  const trimmedLine = line.trim();
  if (!trimmedLine || trimmedLine.startsWith("#")) {
    return null;
  }

  const match = trimmedLine.match(ENV_LINE_PATTERN);
  if (!match) {
    return null;
  }

  const [, name, rawValue] = match;
  return {
    name,
    value: parseEnvValue(rawValue),
  };
}

function resolveEnvFilePath(filePath: string | undefined): string {
  return path.resolve(process.cwd(), filePath ?? ".env");
}

function readEnvFileOrEmpty(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return "";
    }
    throw error;
  }
}

export function loadEnvFromFile(options: LoadEnvFromFileOptions = {}): void {
  const envFilePath = resolveEnvFilePath(options.filePath);
  const rawContent = readEnvFileOrEmpty(envFilePath).replace(/^\uFEFF/, "");
  if (!rawContent) {
    return;
  }

  const overrideExisting = options.overrideExisting === true;
  const lines = rawContent.split(/\r?\n/);
  for (const line of lines) {
    const entry = parseLineToEntry(line);
    if (!entry) {
      continue;
    }

    if (shouldSkipExistingValue(entry.name, overrideExisting)) {
      continue;
    }
    process.env[entry.name] = entry.value;
  }
}

