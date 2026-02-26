import fs from "node:fs/promises";
import path from "node:path";

const EXCLUDED_IDS_FILE_NAME = "supabase_excluded_ids.json";
const MAX_ITEM_ID_LENGTH = 200;
const NEWS_ITEM_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

interface SupabaseExcludedIdsFile {
  version: 1;
  updated_at: string;
  excluded_ids: string[];
}

function defaultExcludedIdsPath(): string {
  return path.resolve(process.cwd(), "data", EXCLUDED_IDS_FILE_NAME);
}

function nonEmptyStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  return normalized;
}

function toUniqueSortedIds(ids: string[]): string[] {
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

function isSupabaseExcludedIdsFile(value: unknown): value is SupabaseExcludedIdsFile {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) {
    return false;
  }
  if (typeof raw.updated_at !== "string") {
    return false;
  }
  if (!Array.isArray(raw.excluded_ids)) {
    return false;
  }

  return raw.excluded_ids.every((id) => typeof id === "string");
}

function normalizeExcludedIds(value: unknown): string[] {
  if (!isSupabaseExcludedIdsFile(value)) {
    return [];
  }

  const normalized = value.excluded_ids
    .map((id) => nonEmptyStringOrNull(id))
    .filter((id): id is string => typeof id === "string");

  return toUniqueSortedIds(normalized);
}

async function readExcludedIdsFile(filePath: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, "")) as unknown;
    return normalizeExcludedIds(parsed);
  } catch {
    return [];
  }
}

async function writeExcludedIdsFile(filePath: string, ids: string[]): Promise<void> {
  const filePayload: SupabaseExcludedIdsFile = {
    version: 1,
    updated_at: new Date().toISOString(),
    excluded_ids: toUniqueSortedIds(ids),
  };

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(filePayload, null, 2)}\n`, "utf8");
}

export function assertValidNewsItemId(value: unknown): string {
  const normalized = nonEmptyStringOrNull(value);
  if (!normalized) {
    throw new Error("id must be a non-empty string");
  }
  if (normalized.length > MAX_ITEM_ID_LENGTH) {
    throw new Error(`id is too long (max ${MAX_ITEM_ID_LENGTH} characters)`);
  }
  if (!NEWS_ITEM_ID_PATTERN.test(normalized)) {
    throw new Error("id contains unsupported characters");
  }

  return normalized;
}

export async function listSupabaseExcludedItemIds(filePath?: string): Promise<string[]> {
  const targetPath = filePath ? path.resolve(filePath) : defaultExcludedIdsPath();
  return readExcludedIdsFile(targetPath);
}

export async function addSupabaseExcludedItemId(
  itemId: string,
  filePath?: string,
): Promise<{ added: boolean; ids: string[] }> {
  const targetPath = filePath ? path.resolve(filePath) : defaultExcludedIdsPath();
  const existing = await readExcludedIdsFile(targetPath);
  const existingSet = new Set(existing);
  const wasPresent = existingSet.has(itemId);

  if (!wasPresent) {
    existingSet.add(itemId);
    await writeExcludedIdsFile(targetPath, [...existingSet]);
  }

  return {
    added: !wasPresent,
    ids: toUniqueSortedIds([...existingSet]),
  };
}
