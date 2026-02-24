import type { ScrapeProgressStage, ScrapeRunStateValue, ScrapeStatusSnapshot } from "../types";
import { SCRAPE_STAGE_LABELS } from "../constants";

export function safeNumber(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return 0;
    }
    if (value < 0) {
        return 0;
    }
    return Math.trunc(value);
}

export function clampPercent(value: unknown): number {
    const numeric = safeNumber(value);
    if (numeric <= 0) {
        return 0;
    }
    if (numeric >= 100) {
        return 100;
    }
    return numeric;
}

export function stageLabel(stage: ScrapeProgressStage): string {
    return SCRAPE_STAGE_LABELS[stage] ?? SCRAPE_STAGE_LABELS.idle;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

export function isScrapeStage(value: unknown): value is ScrapeProgressStage {
    return (
        value === "idle" ||
        value === "initializing" ||
        value === "loading_sources" ||
        value === "collecting" ||
        value === "translating" ||
        value === "saving" ||
        value === "backfilling" ||
        value === "completed" ||
        value === "failed"
    );
}

export function isScrapeRunState(value: unknown): value is ScrapeRunStateValue {
    return value === "idle" || value === "running" || value === "success" || value === "error";
}

function toSafeText(value: unknown): string {
    if (typeof value !== "string") {
        return "";
    }
    return value.replace(/\s+/g, " ").trim();
}

export function parseScrapeStatusSnapshot(value: unknown): ScrapeStatusSnapshot | null {
    if (!isRecord(value)) {
        return null;
    }

    if (!isScrapeRunState(value.state) || !isScrapeStage(value.stage)) {
        return null;
    }

    return {
        state: value.state,
        stage: value.stage,
        progress_percent: clampPercent(value.progress_percent),
        message: toSafeText(value.message),
        started_at: toSafeText(value.started_at),
        updated_at: toSafeText(value.updated_at),
        finished_at: toSafeText(value.finished_at),
        run_id: toSafeText(value.run_id),
        error: toSafeText(value.error),
        collected_items: safeNumber(value.collected_items),
        translated_items: safeNumber(value.translated_items),
        backfilled_photos: safeNumber(value.backfilled_photos),
    };
}

export function initialRunningScrapeStatus(): ScrapeStatusSnapshot {
    const now = new Date().toISOString();
    return {
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
