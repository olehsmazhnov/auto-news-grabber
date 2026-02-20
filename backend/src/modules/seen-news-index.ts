import fs from "node:fs/promises";
import type { CollectedNewsItem, NewsItem } from "../types.js";
import { log } from "../utils/log.js";
import { collectNewsKeys, type KeyableNewsItem } from "./news-item-keys.js";

export interface SeenNewsIndex {
  version: 1;
  updated_at: string;
  keys: Record<string, string>;
}

function emptySeenNewsIndex(scrapedAt: string): SeenNewsIndex {
  return {
    version: 1,
    updated_at: scrapedAt,
    keys: {},
  };
}

function isSeenNewsIndex(value: unknown): value is SeenNewsIndex {
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

  if (typeof raw.keys !== "object" || raw.keys === null) {
    return false;
  }

  return true;
}

export async function readJsonFileSafe<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw.replace(/^\uFEFF/, "")) as T;
  } catch {
    return null;
  }
}

function seedSeenKeysFromNewsItems(
  newsItems: KeyableNewsItem[],
  scrapedAt: string,
): Record<string, string> {
  const keys: Record<string, string> = {};

  for (const item of newsItems) {
    for (const key of collectNewsKeys(item)) {
      keys[key] = scrapedAt;
    }
  }

  return keys;
}

export async function loadSeenNewsIndex(
  indexPath: string,
  outputPath: string,
  scrapedAt: string,
  verbose: boolean,
): Promise<SeenNewsIndex> {
  const indexFromFile = await readJsonFileSafe<unknown>(indexPath);
  if (isSeenNewsIndex(indexFromFile)) {
    return indexFromFile;
  }

  const seeded = emptySeenNewsIndex(scrapedAt);
  const snapshot = await readJsonFileSafe<NewsItem[]>(outputPath);
  if (!Array.isArray(snapshot) || snapshot.length === 0) {
    return seeded;
  }

  const snapshotKeys = seedSeenKeysFromNewsItems(snapshot, scrapedAt);
  seeded.keys = snapshotKeys;
  log(
    `Initialized seen index from current snapshot (${Object.keys(snapshotKeys).length} keys)`,
    verbose,
  );

  return seeded;
}

export function filterAlreadySeenItems(
  items: CollectedNewsItem[],
  seenIndex: SeenNewsIndex,
  scrapedAt: string,
): { freshItems: CollectedNewsItem[]; skippedCount: number } {
  const freshItems: CollectedNewsItem[] = [];
  let skippedCount = 0;

  for (const item of items) {
    const keys = collectNewsKeys(item);
    const alreadySeen = keys.some((key) => typeof seenIndex.keys[key] === "string");
    if (alreadySeen) {
      skippedCount += 1;
      continue;
    }

    freshItems.push(item);
    for (const key of keys) {
      seenIndex.keys[key] = scrapedAt;
    }
  }

  return {
    freshItems,
    skippedCount,
  };
}
