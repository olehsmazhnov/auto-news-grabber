import type {
  RunScrapePipelineResult,
  ScrapePipelineProgress,
  ScrapePipelineStage,
} from "./scrape-runner.js";

export type ScrapeRunState = "idle" | "running" | "success" | "error";

export interface ScrapeProgressSnapshot {
  state: ScrapeRunState;
  stage: ScrapePipelineStage | "idle";
  progress_percent: number;
  message: string;
  started_at: string;
  updated_at: string;
  finished_at: string;
  run_id: string;
  error: string;
  collected_items: number;
  translated_items: number;
  backfilled_photos: number;
}

const MAX_STATUS_TEXT_LEN = 240;

function nowIso(): string {
  return new Date().toISOString();
}

function clampPercent(value: number): number {
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

function normalizeStatusText(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= MAX_STATUS_TEXT_LEN) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_STATUS_TEXT_LEN - 3)}...`;
}

function initialSnapshot(): ScrapeProgressSnapshot {
  const now = nowIso();
  return {
    state: "idle",
    stage: "idle",
    progress_percent: 0,
    message: "",
    started_at: "",
    updated_at: now,
    finished_at: "",
    run_id: "",
    error: "",
    collected_items: 0,
    translated_items: 0,
    backfilled_photos: 0,
  };
}

export class ScrapeProgressTracker {
  private state: ScrapeProgressSnapshot = initialSnapshot();

  snapshot(): ScrapeProgressSnapshot {
    return { ...this.state };
  }

  isRunning(): boolean {
    return this.state.state === "running";
  }

  start(): void {
    const now = nowIso();
    this.state = {
      state: "running",
      stage: "initializing",
      progress_percent: 0,
      message: "Starting scrape...",
      started_at: now,
      updated_at: now,
      finished_at: "",
      run_id: "",
      error: "",
      collected_items: 0,
      translated_items: 0,
      backfilled_photos: 0,
    };
  }

  update(progress: ScrapePipelineProgress): void {
    if (this.state.state !== "running") {
      return;
    }

    const message = normalizeStatusText(progress.message);
    this.state = {
      ...this.state,
      stage: progress.stage,
      progress_percent: clampPercent(progress.progress_percent),
      message: message || this.state.message,
      updated_at: nowIso(),
    };
  }

  complete(result: RunScrapePipelineResult): void {
    const now = nowIso();
    this.state = {
      ...this.state,
      state: "success",
      stage: "completed",
      progress_percent: 100,
      message: normalizeStatusText(
        `Scrape complete. Run ${result.run.run_id}. Backfilled ${result.backfill.updated_photos} photo(s).`,
      ),
      updated_at: now,
      finished_at: now,
      run_id: result.run.run_id,
      error: "",
      collected_items: result.collected_items,
      translated_items: result.translated_items,
      backfilled_photos: result.backfill.updated_photos,
    };
  }

  fail(errorMessage: string): void {
    const now = nowIso();
    const normalizedError = normalizeStatusText(errorMessage);
    const currentProgress = this.state.progress_percent;
    this.state = {
      ...this.state,
      state: "error",
      stage: "failed",
      progress_percent: currentProgress > 0 ? currentProgress : 1,
      message: "Scrape failed.",
      updated_at: now,
      finished_at: now,
      error: normalizedError,
    };
  }
}

