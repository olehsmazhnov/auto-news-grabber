import fs from "node:fs/promises";
import path from "node:path";
import type { NewsItem, PhotoAsset } from "../types.js";
import { log } from "../utils/log.js";
import { downloadPhotoCandidates, resolvePhotoCandidates } from "../utils/photos.js";
import { saveArticleFileSet, toRelativePath } from "./output-storage.js";

const BACKFILL_ATTEMPTS_PER_ITEM = 2;
const BACKFILL_RETRY_DELAY_MS = 450;

export interface BackfillLatestRunOptions {
  outputPath: string;
  latestRunPath?: string;
  runPath?: string;
  verbose: boolean;
}

export interface BackfillSummary {
  run_path: string;
  scanned_items: number;
  missing_before: number;
  updated_items: number;
  updated_photos: number;
  synced_snapshot_items: number;
  remaining_missing: number;
}

interface LatestRunPointer {
  run_path?: string;
}

interface SnapshotIndex {
  byId: Map<string, NewsItem>;
  byArticlePath: Map<string, NewsItem>;
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw.replace(/^\uFEFF/, "")) as T;
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function hasPhotos(item: NewsItem): boolean {
  return Array.isArray(item.photos) && item.photos.length > 0;
}

function collectUsedWikimediaUrls(items: NewsItem[]): Set<string> {
  const used = new Set<string>();
  for (const item of items) {
    for (const photo of item.photos ?? []) {
      if (photo.provider === "wikimedia" && photo.source_url) {
        used.add(photo.source_url);
      }
    }
  }
  return used;
}

function indexSnapshot(items: NewsItem[]): SnapshotIndex {
  const byId = new Map<string, NewsItem>();
  const byArticlePath = new Map<string, NewsItem>();

  for (const item of items) {
    if (item.id) {
      byId.set(item.id, item);
    }
    if (item.article_path) {
      byArticlePath.set(item.article_path, item);
    }
  }

  return { byId, byArticlePath };
}

function findSnapshotItem(item: NewsItem, snapshotIndex: SnapshotIndex): NewsItem | null {
  if (item.id) {
    const byId = snapshotIndex.byId.get(item.id);
    if (byId) {
      return byId;
    }
  }
  if (item.article_path) {
    const byPath = snapshotIndex.byArticlePath.get(item.article_path);
    if (byPath) {
      return byPath;
    }
  }
  return null;
}

function absolutePath(filePath: string): string {
  return path.resolve(filePath);
}

async function resolveRunPath(options: BackfillLatestRunOptions): Promise<string> {
  if (options.runPath) {
    return absolutePath(options.runPath);
  }

  const latestRunPath = options.latestRunPath ?? "data/latest_run.json";
  const latest = await readJsonFile<LatestRunPointer>(absolutePath(latestRunPath));
  if (!latest.run_path) {
    throw new Error(`latest_run.json has no run_path: ${latestRunPath}`);
  }

  return absolutePath(latest.run_path);
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function resolveAndDownloadPhotos(
  item: NewsItem,
  usedWikimediaUrls: Set<string>,
): Promise<PhotoAsset[]> {
  const articleDir = absolutePath(item.article_path);
  const candidates = await resolvePhotoCandidates(item.title, [], [], {
    onlyPublicDomain: item.rights_flag === "quote_only",
    fallbackToGenericIfEmpty: true,
    contextUrl: item.url,
    contextText: item.content,
    excludeUrls: [...usedWikimediaUrls],
  });
  return downloadPhotoCandidates(candidates, articleDir);
}

async function backfillSingleItemPhotos(
  item: NewsItem,
  usedWikimediaUrls: Set<string>,
  verbose: boolean,
): Promise<PhotoAsset[]> {
  for (let attempt = 0; attempt < BACKFILL_ATTEMPTS_PER_ITEM; attempt += 1) {
    const photos = await resolveAndDownloadPhotos(item, usedWikimediaUrls);
    if (photos.length > 0) {
      return photos;
    }

    const isLastAttempt = attempt >= BACKFILL_ATTEMPTS_PER_ITEM - 1;
    if (!isLastAttempt) {
      log(`Retrying photo backfill for: ${item.title.slice(0, 90)}`, verbose);
      await sleep(BACKFILL_RETRY_DELAY_MS * (attempt + 1));
    }
  }

  return [];
}

export async function backfillMissingPhotosForRun(
  options: BackfillLatestRunOptions,
): Promise<BackfillSummary> {
  const runPathAbs = await resolveRunPath(options);
  const runNewsPath = path.join(runPathAbs, "news.json");
  const outputPathAbs = absolutePath(options.outputPath);

  const runItems = await readJsonFile<NewsItem[]>(runNewsPath);
  const snapshotItems = await readJsonFile<NewsItem[]>(outputPathAbs);
  const snapshotIndex = indexSnapshot(snapshotItems);

  const usedWikimediaUrls = collectUsedWikimediaUrls(runItems);
  const missingBefore = runItems.filter((item) => !hasPhotos(item)).length;

  let updatedItems = 0;
  let updatedPhotos = 0;
  let syncedSnapshotItems = 0;

  for (const item of runItems) {
    if (hasPhotos(item)) {
      continue;
    }

    const photos = await backfillSingleItemPhotos(item, usedWikimediaUrls, options.verbose);
    if (photos.length === 0) {
      continue;
    }

    item.photos = photos;
    await saveArticleFileSet(item, absolutePath(item.article_path));

    const snapshotItem = findSnapshotItem(item, snapshotIndex);
    if (snapshotItem) {
      snapshotItem.photos = photos;
      syncedSnapshotItems += 1;
    }

    for (const photo of photos) {
      if (photo.provider === "wikimedia" && photo.source_url) {
        usedWikimediaUrls.add(photo.source_url);
      }
    }

    updatedItems += 1;
    updatedPhotos += photos.length;
    log(`Backfilled photos for: ${item.title.slice(0, 90)}`, options.verbose);
  }

  if (updatedItems > 0) {
    await writeJsonFile(runNewsPath, runItems);
    await writeJsonFile(outputPathAbs, snapshotItems);
  }

  const remainingMissing = runItems.filter((item) => !hasPhotos(item)).length;

  return {
    run_path: toRelativePath(runPathAbs),
    scanned_items: runItems.length,
    missing_before: missingBefore,
    updated_items: updatedItems,
    updated_photos: updatedPhotos,
    synced_snapshot_items: syncedSnapshotItems,
    remaining_missing: remainingMissing,
  };
}
