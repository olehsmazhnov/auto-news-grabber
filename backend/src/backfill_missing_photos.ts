import fs from "node:fs/promises";
import path from "node:path";
import { renderArticleMarkdown } from "./utils/article-markdown.js";
import { log } from "./utils/log.js";
import { downloadPhotoCandidates, resolvePhotoCandidates } from "./utils/photos.js";
import type { NewsItem } from "./types.js";

interface BackfillPhotoCliOptions {
  output: string;
  latestRun: string;
  runPath: string;
  verbose: boolean;
}

interface LatestRunPointer {
  run_id?: string;
  run_path?: string;
}

interface BackfillSummary {
  run_path: string;
  scanned_items: number;
  missing_before: number;
  updated_items: number;
  updated_photos: number;
  synced_snapshot_items: number;
  remaining_missing: number;
}

function parseArgs(argv: string[]): BackfillPhotoCliOptions {
  const options: BackfillPhotoCliOptions = {
    output: "data/news.json",
    latestRun: "data/latest_run.json",
    runPath: "",
    verbose: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];

    if (key === "--output" && next) {
      options.output = next;
      i += 1;
      continue;
    }

    if (key === "--latest-run" && next) {
      options.latestRun = next;
      i += 1;
      continue;
    }

    if (key === "--run-path" && next) {
      options.runPath = next;
      i += 1;
      continue;
    }

    if (key === "--verbose") {
      options.verbose = true;
    }
  }

  return options;
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

function indexSnapshot(items: NewsItem[]): {
  byId: Map<string, NewsItem>;
  byArticlePath: Map<string, NewsItem>;
} {
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

function findSnapshotItem(
  item: NewsItem,
  snapshotIndex: { byId: Map<string, NewsItem>; byArticlePath: Map<string, NewsItem> },
): NewsItem | null {
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

async function saveArticleFileSet(item: NewsItem, articleDir: string): Promise<void> {
  await fs.writeFile(path.join(articleDir, "article.json"), `${JSON.stringify(item, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(articleDir, "article.md"), renderArticleMarkdown(item), "utf8");
}

async function resolveRunPath(options: BackfillPhotoCliOptions): Promise<string> {
  if (options.runPath) {
    return path.resolve(options.runPath);
  }

  const latest = await readJsonFile<LatestRunPointer>(path.resolve(options.latestRun));
  if (!latest.run_path) {
    throw new Error(`latest_run.json has no run_path: ${options.latestRun}`);
  }

  return path.resolve(latest.run_path);
}

async function backfillMissingPhotos(options: BackfillPhotoCliOptions): Promise<BackfillSummary> {
  const runPathAbs = await resolveRunPath(options);
  const runNewsPath = path.join(runPathAbs, "news.json");
  const outputPathAbs = path.resolve(options.output);

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

    const articleDir = path.resolve(item.article_path);
    const candidates = await resolvePhotoCandidates(item.title, [], [], {
      onlyPublicDomain: item.rights_flag === "quote_only",
      fallbackToGenericIfEmpty: true,
      contextUrl: item.url,
      contextText: item.content,
      excludeUrls: [...usedWikimediaUrls],
    });
    const photos = await downloadPhotoCandidates(candidates, articleDir);
    if (photos.length === 0) {
      continue;
    }

    item.photos = photos;
    await saveArticleFileSet(item, articleDir);

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
    run_path: path.relative(process.cwd(), runPathAbs).replace(/\\/g, "/"),
    scanned_items: runItems.length,
    missing_before: missingBefore,
    updated_items: updatedItems,
    updated_photos: updatedPhotos,
    synced_snapshot_items: syncedSnapshotItems,
    remaining_missing: remainingMissing,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const summary = await backfillMissingPhotos(options);

  // eslint-disable-next-line no-console
  console.log(
    [
      "Photo backfill finished:",
      `run=${summary.run_path};`,
      `missing_before=${summary.missing_before};`,
      `updated_items=${summary.updated_items};`,
      `updated_photos=${summary.updated_photos};`,
      `remaining_missing=${summary.remaining_missing};`,
      `synced_snapshot_items=${summary.synced_snapshot_items}`,
    ].join(" "),
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(`Photo backfill failed: ${String(error)}`);
  process.exitCode = 1;
});
