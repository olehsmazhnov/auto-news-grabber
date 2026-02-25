import fs from "node:fs/promises";
import path from "node:path";
import type { NewsItem } from "../types.js";
import { log } from "../utils/log.js";
import { formatPostTranslationContent } from "../utils/post-translation-format.js";
import { repairMixedUkrainianText, translateText } from "../utils/translation.js";
import { saveArticleFileSet } from "./output-storage.js";

const DEFAULT_OUTPUT_PATH = "data/news.json";
const DEFAULT_TARGET_LANGUAGE = "uk";
const TITLE_LATIN_RATIO_THRESHOLD = 0.45;
const CONTENT_LATIN_RATIO_THRESHOLD = 0.2;

export interface BackfillTranslationsOptions {
  outputPath?: string;
  targetLanguage?: string;
  verbose?: boolean;
}

export interface BackfillTranslationsSummary {
  output_path: string;
  scanned_items: number;
  updated_items: number;
  updated_titles: number;
  updated_contents: number;
  updated_run_files: number;
  updated_article_files: number;
}

interface LetterRatios {
  totalLetters: number;
  latinRatio: number;
  cyrillicRatio: number;
}

interface RunNewsCacheEntry {
  filePath: string;
  items: NewsItem[];
  byId: Map<string, number>;
  byArticlePath: Map<string, number>;
  changed: boolean;
}

function nonEmpty(value: string | null | undefined): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function isNewsItem(value: unknown): value is NewsItem {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const raw = value as Record<string, unknown>;
  return (
    typeof raw.id === "string"
    && typeof raw.title === "string"
    && typeof raw.content === "string"
    && typeof raw.url === "string"
    && typeof raw.source === "string"
    && typeof raw.scraped_at === "string"
    && typeof raw.article_path === "string"
    && typeof raw.rights_flag === "string"
    && typeof raw.license_text === "string"
  );
}

function normalizeNewsItems(raw: unknown): NewsItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter((item): item is NewsItem => isNewsItem(item));
}

function ratio(numerator: number, denominator: number): number {
  if (!denominator) {
    return 0;
  }
  return numerator / denominator;
}

function collectLetterRatios(text: string): LetterRatios {
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
    latinRatio: ratio(latinLetters, totalLetters),
    cyrillicRatio: ratio(cyrillicLetters, totalLetters),
  };
}

function shouldTranslateTitle(title: string): boolean {
  const ratios = collectLetterRatios(title);
  if (ratios.totalLetters < 8) {
    return false;
  }
  return ratios.latinRatio >= TITLE_LATIN_RATIO_THRESHOLD;
}

function shouldRepairContent(content: string): boolean {
  const ratios = collectLetterRatios(content);
  if (ratios.totalLetters < 25) {
    return false;
  }
  return ratios.latinRatio >= CONTENT_LATIN_RATIO_THRESHOLD;
}

function isUkLanguage(targetLanguage: string): boolean {
  const normalized = targetLanguage.trim().toLowerCase();
  return normalized === "uk" || normalized.startsWith("uk-");
}

function workspacePathFromInput(inputPath: string): string {
  const workspace = path.resolve(process.cwd());
  const resolved = path.resolve(workspace, inputPath);
  const relative = path.relative(workspace, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workspace: ${inputPath}`);
  }
  return resolved;
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw.replace(/^\uFEFF/, "")) as T;
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function buildRunNewsIndexes(items: NewsItem[]): {
  byId: Map<string, number>;
  byArticlePath: Map<string, number>;
} {
  const byId = new Map<string, number>();
  const byArticlePath = new Map<string, number>();

  items.forEach((item, index) => {
    if (item.id) {
      byId.set(item.id, index);
    }
    if (item.article_path) {
      byArticlePath.set(item.article_path, index);
    }
  });

  return { byId, byArticlePath };
}

async function loadRunNewsCache(
  runNewsPath: string,
  cache: Map<string, RunNewsCacheEntry>,
): Promise<RunNewsCacheEntry | null> {
  const cached = cache.get(runNewsPath);
  if (cached) {
    return cached;
  }

  try {
    const raw = await readJsonFile<unknown>(runNewsPath);
    const items = normalizeNewsItems(raw);
    const indexes = buildRunNewsIndexes(items);

    const entry: RunNewsCacheEntry = {
      filePath: runNewsPath,
      items,
      byId: indexes.byId,
      byArticlePath: indexes.byArticlePath,
      changed: false,
    };

    cache.set(runNewsPath, entry);
    return entry;
  } catch {
    return null;
  }
}

function updateRunNewsItem(cache: RunNewsCacheEntry, item: NewsItem): boolean {
  const id = nonEmpty(item.id);
  if (id && cache.byId.has(id)) {
    const index = cache.byId.get(id);
    if (typeof index === "number") {
      cache.items[index] = {
        ...cache.items[index],
        title: item.title,
        content: item.content,
      };
      cache.changed = true;
      return true;
    }
  }

  const articlePath = nonEmpty(item.article_path);
  if (articlePath && cache.byArticlePath.has(articlePath)) {
    const index = cache.byArticlePath.get(articlePath);
    if (typeof index === "number") {
      cache.items[index] = {
        ...cache.items[index],
        title: item.title,
        content: item.content,
      };
      cache.changed = true;
      return true;
    }
  }

  return false;
}

function toRelativePath(absolutePath: string): string {
  return path.relative(process.cwd(), absolutePath).replace(/\\/g, "/");
}

export async function backfillSnapshotTranslations(
  options: BackfillTranslationsOptions = {},
): Promise<BackfillTranslationsSummary> {
  const outputPathInput = options.outputPath ?? DEFAULT_OUTPUT_PATH;
  const targetLanguage = options.targetLanguage ?? DEFAULT_TARGET_LANGUAGE;
  const verbose = options.verbose === true;

  const outputPathAbs = workspacePathFromInput(outputPathInput);
  const snapshotRaw = await readJsonFile<unknown>(outputPathAbs);
  const snapshotItems = normalizeNewsItems(snapshotRaw);

  const runCache = new Map<string, RunNewsCacheEntry>();

  let updatedItems = 0;
  let updatedTitles = 0;
  let updatedContents = 0;
  let updatedArticleFiles = 0;

  for (const item of snapshotItems) {
    let changed = false;
    let contentChanged = false;
    const originalTitle = item.title;
    const originalContent = item.content;

    const applyContentUpdate = (candidate: string): void => {
      const next = nonEmpty(candidate);
      if (!next || next === item.content) {
        return;
      }

      item.content = next;
      changed = true;

      if (!contentChanged) {
        contentChanged = true;
        updatedContents += 1;
      }
    };

    if (shouldTranslateTitle(item.title)) {
      const translatedTitle = await translateText(
        item.title,
        targetLanguage,
        true,
        verbose,
      );
      if (nonEmpty(translatedTitle) && translatedTitle !== item.title) {
        item.title = translatedTitle;
        changed = true;
        updatedTitles += 1;
      }
    }

    if (isUkLanguage(targetLanguage)) {
      if (shouldRepairContent(item.content)) {
        const repaired = await repairMixedUkrainianText(item.content, verbose);
        applyContentUpdate(repaired);
      }
    } else if (shouldRepairContent(item.content)) {
      const translatedContent = await translateText(
        item.content,
        targetLanguage,
        true,
        verbose,
      );
      applyContentUpdate(translatedContent);
    }

    if (contentChanged) {
      applyContentUpdate(formatPostTranslationContent(item.content));
    }

    if (!changed) {
      continue;
    }

    updatedItems += 1;
    log(`Backfilled translation for: ${item.title.slice(0, 90)}`, verbose);

    const articleDir = workspacePathFromInput(item.article_path);
    await saveArticleFileSet(item, articleDir);
    updatedArticleFiles += 1;

    const runNewsPath = path.join(path.dirname(articleDir), "news.json");
    const runNews = await loadRunNewsCache(runNewsPath, runCache);
    if (runNews) {
      updateRunNewsItem(runNews, item);
    }

    if (!nonEmpty(item.title)) {
      item.title = originalTitle;
    }
    if (!nonEmpty(item.content)) {
      item.content = originalContent;
    }
  }

  if (updatedItems > 0) {
    await writeJsonFile(outputPathAbs, snapshotItems);
  }

  let updatedRunFiles = 0;
  for (const entry of runCache.values()) {
    if (!entry.changed) {
      continue;
    }
    await writeJsonFile(entry.filePath, entry.items);
    updatedRunFiles += 1;
  }

  return {
    output_path: toRelativePath(outputPathAbs),
    scanned_items: snapshotItems.length,
    updated_items: updatedItems,
    updated_titles: updatedTitles,
    updated_contents: updatedContents,
    updated_run_files: updatedRunFiles,
    updated_article_files: updatedArticleFiles,
  };
}
