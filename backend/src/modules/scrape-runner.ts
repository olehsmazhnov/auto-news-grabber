import { DEFAULT_MAX_CONTENT_CHARS } from "../constants.js";
import { collectItems, saveOutput, translateItems } from "../scraper.js";
import type {
  CollectItemsProgress,
  RunSummary,
  TranslateItemsProgress,
} from "../types.js";
import { loadSources } from "../utils/sources.js";
import {
  backfillMissingPhotosForRun,
  type BackfillSummary,
} from "./photo-backfill.js";

const DEFAULT_CONFIG_PATH = "backend/sources.json";
const DEFAULT_OUTPUT_PATH = "data/news.json";
const DEFAULT_TARGET_LANGUAGE = "uk";
const COLLECT_PROGRESS_START = 10;
const COLLECT_PROGRESS_END = 45;
const TRANSLATE_PROGRESS_START = 50;
const TRANSLATE_PROGRESS_END = 75;

export type ScrapePipelineStage =
  | "initializing"
  | "loading_sources"
  | "collecting"
  | "translating"
  | "saving"
  | "backfilling"
  | "completed"
  | "failed";

export interface ScrapePipelineProgress {
  stage: ScrapePipelineStage;
  progress_percent: number;
  message: string;
}

export type ScrapePipelineProgressHandler = (
  progress: ScrapePipelineProgress,
) => void;

export interface RunScrapePipelineOptions {
  configPath?: string;
  outputPath?: string;
  targetLanguage?: string;
  disableTranslation?: boolean;
  maxItemsPerSource?: number | null;
  maxContentChars?: number;
  verbose?: boolean;
  onProgress?: ScrapePipelineProgressHandler;
}

export interface RunScrapePipelineResult {
  run: RunSummary;
  backfill: BackfillSummary;
  collected_items: number;
  translated_items: number;
}

interface NormalizedRunScrapePipelineOptions {
  configPath: string;
  outputPath: string;
  targetLanguage: string;
  disableTranslation: boolean;
  maxItemsPerSource: number | null;
  maxContentChars: number;
  verbose: boolean;
}

function normalizePositiveIntegerOrNull(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const rounded = Math.floor(value);
  if (rounded <= 0) {
    return null;
  }
  return rounded;
}

function normalizeMaxContentChars(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_CONTENT_CHARS;
  }

  const rounded = Math.floor(value);
  if (rounded <= 0) {
    return DEFAULT_MAX_CONTENT_CHARS;
  }

  return rounded;
}

function normalizeRunOptions(
  options: RunScrapePipelineOptions,
): NormalizedRunScrapePipelineOptions {
  return {
    configPath: options.configPath ?? DEFAULT_CONFIG_PATH,
    outputPath: options.outputPath ?? DEFAULT_OUTPUT_PATH,
    targetLanguage: options.targetLanguage ?? DEFAULT_TARGET_LANGUAGE,
    disableTranslation: options.disableTranslation === true,
    maxItemsPerSource: normalizePositiveIntegerOrNull(options.maxItemsPerSource),
    maxContentChars: normalizeMaxContentChars(options.maxContentChars),
    verbose: options.verbose === true,
  };
}

function clampProgressPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 100) {
    return 100;
  }
  return Math.round(value);
}

function emitProgress(
  onProgress: ScrapePipelineProgressHandler | undefined,
  progress: ScrapePipelineProgress,
): void {
  if (!onProgress) {
    return;
  }

  try {
    onProgress({
      ...progress,
      progress_percent: clampProgressPercent(progress.progress_percent),
    });
  } catch {
    // Ignore progress callback errors to avoid interrupting scraping.
  }
}

function stageProgressFromTotals(
  done: number,
  total: number,
  stageStart: number,
  stageEnd: number,
): number {
  const safeTotal = total > 0 ? total : 1;
  const ratio = Math.max(0, Math.min(1, done / safeTotal));
  return stageStart + (stageEnd - stageStart) * ratio;
}

function collectProgressPercent(progress: CollectItemsProgress): number {
  return stageProgressFromTotals(
    progress.completed_sources,
    progress.total_sources,
    COLLECT_PROGRESS_START,
    COLLECT_PROGRESS_END,
  );
}

function translateProgressPercent(progress: TranslateItemsProgress): number {
  return stageProgressFromTotals(
    progress.completed_items,
    progress.total_items,
    TRANSLATE_PROGRESS_START,
    TRANSLATE_PROGRESS_END,
  );
}

export async function runScrapePipeline(
  options: RunScrapePipelineOptions = {},
): Promise<RunScrapePipelineResult> {
  const normalizedOptions = normalizeRunOptions(options);
  const onProgress = options.onProgress;

  emitProgress(onProgress, {
    stage: "initializing",
    progress_percent: 2,
    message: "Preparing scrape pipeline...",
  });

  const scrapedAt = new Date().toISOString();
  emitProgress(onProgress, {
    stage: "loading_sources",
    progress_percent: 6,
    message: "Loading source configuration...",
  });

  const sources = await loadSources(
    normalizedOptions.configPath,
    normalizedOptions.maxItemsPerSource,
  );
  emitProgress(onProgress, {
    stage: "collecting",
    progress_percent: COLLECT_PROGRESS_START,
    message: `Collecting items from ${sources.length} source(s)...`,
  });

  const collected = await collectItems(
    sources,
    scrapedAt,
    normalizedOptions.verbose,
    (progress) => {
      const sourceName = progress.current_source_name || progress.current_source_id;
      emitProgress(onProgress, {
        stage: "collecting",
        progress_percent: collectProgressPercent(progress),
        message: `Collecting source ${progress.completed_sources}/${Math.max(
          progress.total_sources,
          1,
        )}: ${sourceName}`,
      });
    },
  );

  emitProgress(onProgress, {
    stage: "collecting",
    progress_percent: COLLECT_PROGRESS_END,
    message: `Collected ${collected.items.length} item(s).`,
  });

  emitProgress(onProgress, {
    stage: "translating",
    progress_percent: TRANSLATE_PROGRESS_START,
    message: "Translating and sanitizing content...",
  });

  const translated = await translateItems(collected.items, {
    translationEnabled: !normalizedOptions.disableTranslation,
    targetLanguage: normalizedOptions.targetLanguage,
    maxContentChars: normalizedOptions.maxContentChars,
    verbose: normalizedOptions.verbose,
    onProgress: (progress) => {
      const currentTitle = progress.current_item_title.trim();
      const suffix = currentTitle
        ? `: ${currentTitle.slice(0, 72)}${currentTitle.length > 72 ? "..." : ""}`
        : "";
      emitProgress(onProgress, {
        stage: "translating",
        progress_percent: translateProgressPercent(progress),
        message: `Translating item ${progress.completed_items}/${Math.max(
          progress.total_items,
          1,
        )}${suffix}`,
      });
    },
  });

  emitProgress(onProgress, {
    stage: "saving",
    progress_percent: 80,
    message: "Saving run outputs...",
  });

  const run = await saveOutput(
    translated,
    normalizedOptions.outputPath,
    scrapedAt,
    collected.source_reports,
    normalizedOptions.verbose,
  );

  emitProgress(onProgress, {
    stage: "backfilling",
    progress_percent: 92,
    message: "Backfilling missing photos for latest run items...",
  });

  const backfill = await backfillMissingPhotosForRun({
    outputPath: normalizedOptions.outputPath,
    runPath: run.run_path,
    verbose: normalizedOptions.verbose,
  });

  emitProgress(onProgress, {
    stage: "completed",
    progress_percent: 100,
    message: `Scrape complete. Run ${run.run_id}, backfilled ${backfill.updated_photos} photo(s).`,
  });

  return {
    run,
    backfill,
    collected_items: collected.items.length,
    translated_items: translated.length,
  };
}
