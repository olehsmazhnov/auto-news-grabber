import type {
  CollectedNewsItem,
  DailyHealthReport,
  DailyHealthSnapshot,
  DailySourceHealth,
  NewsItem,
  ResourceHealthStatus,
  ResourceRunReport,
  ResourceTotals,
  RunHistorySnapshot,
  RunSummary,
  Source,
} from "../types.js";

interface DayAggregate {
  date: string;
  run_count: number;
  items_saved: number;
  resource_checks: ResourceTotals;
  source_health: Map<string, DailySourceHealth>;
}

function emptyResourceTotals(): ResourceTotals {
  return {
    total_resources: 0,
    ok_resources: 0,
    empty_resources: 0,
    failed_resources: 0,
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toNonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  return Math.trunc(value);
}

function toResourceStatus(value: unknown): ResourceHealthStatus {
  if (value === "ok" || value === "empty" || value === "failed") {
    return value;
  }
  return "failed";
}

function countItemsBySourceId(
  items: Array<{ source_id?: string }>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = typeof item.source_id === "string" ? item.source_id.trim() : "";
    if (!key) {
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function sourceGroupKey(report: ResourceRunReport): string {
  if (report.source_id) {
    return report.source_id;
  }
  if (report.source_name) {
    return report.source_name.toLowerCase();
  }
  return report.feed_url.toLowerCase();
}

function compareSourceHealth(
  left: DailySourceHealth,
  right: DailySourceHealth,
): number {
  return left.source_name.localeCompare(right.source_name);
}

function normalizeResourceReport(value: unknown): ResourceRunReport | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  const sourceId = typeof value.source_id === "string" ? value.source_id : "";
  const sourceName = typeof value.source_name === "string" ? value.source_name : "";
  const source = typeof value.source === "string" ? value.source : sourceName;
  const sourceUrl = typeof value.source_url === "string" ? value.source_url : "";
  const feedUrl = typeof value.feed_url === "string" ? value.feed_url : "";

  if (!sourceId || !sourceName || !feedUrl) {
    return null;
  }

  return {
    source_id: sourceId,
    source_name: sourceName,
    source,
    source_url: sourceUrl,
    feed_url: feedUrl,
    status: toResourceStatus(value.status),
    error: typeof value.error === "string" ? value.error : "",
    feed_entries: toNonNegativeInteger(value.feed_entries),
    collected_items: toNonNegativeInteger(value.collected_items),
    fresh_items: toNonNegativeInteger(value.fresh_items),
  };
}

function normalizeRunSummary(value: unknown): RunSummary | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  const runId = typeof value.run_id === "string" ? value.run_id : "";
  const runPath = typeof value.run_path === "string" ? value.run_path : "";
  const generatedAt = typeof value.generated_at === "string" ? value.generated_at : "";

  if (!runId || !runPath || !generatedAt) {
    return null;
  }

  const sourceReportsRaw = Array.isArray(value.source_reports)
    ? value.source_reports
    : [];
  const sourceReports = sourceReportsRaw
    .map((report) => normalizeResourceReport(report))
    .filter((report): report is ResourceRunReport => report !== null);

  const fallbackTotals = computeResourceTotals(sourceReports);
  const resourceTotals = normalizeResourceTotals(value.resource_totals, fallbackTotals);

  return {
    run_id: runId,
    run_path: runPath,
    generated_at: generatedAt,
    total_items: toNonNegativeInteger(value.total_items),
    collected_items: toNonNegativeInteger(value.collected_items),
    skipped_seen_items: toNonNegativeInteger(value.skipped_seen_items),
    resource_totals: resourceTotals,
    source_reports: sourceReports,
  };
}

function normalizeResourceTotals(
  value: unknown,
  fallback: ResourceTotals,
): ResourceTotals {
  if (!isObjectRecord(value)) {
    return fallback;
  }

  return {
    total_resources: toNonNegativeInteger(value.total_resources),
    ok_resources: toNonNegativeInteger(value.ok_resources),
    empty_resources: toNonNegativeInteger(value.empty_resources),
    failed_resources: toNonNegativeInteger(value.failed_resources),
  };
}

function appendResourceChecks(
  target: ResourceTotals,
  addition: ResourceTotals,
): ResourceTotals {
  return {
    total_resources: target.total_resources + addition.total_resources,
    ok_resources: target.ok_resources + addition.ok_resources,
    empty_resources: target.empty_resources + addition.empty_resources,
    failed_resources: target.failed_resources + addition.failed_resources,
  };
}

function dayFromIso(isoLike: string): string {
  if (!isoLike) {
    return "";
  }
  const parsed = new Date(isoLike);
  if (Number.isNaN(parsed.getTime())) {
    return isoLike.slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
}

function mergeSourceHealth(
  current: DailySourceHealth | undefined,
  report: ResourceRunReport,
): DailySourceHealth {
  const base: DailySourceHealth = current ?? {
    source_id: report.source_id,
    source_name: report.source_name,
    source: report.source,
    ok_runs: 0,
    empty_runs: 0,
    failed_runs: 0,
  };

  if (report.status === "failed") {
    base.failed_runs += 1;
  } else if (report.status === "empty") {
    base.empty_runs += 1;
  } else {
    base.ok_runs += 1;
  }

  return base;
}

export function createResourceRunReport(source: Source): ResourceRunReport {
  return {
    source_id: source.id,
    source_name: source.name,
    source: source.source,
    source_url: source.url,
    feed_url: source.feedUrl,
    status: "empty",
    error: "",
    feed_entries: 0,
    collected_items: 0,
    fresh_items: 0,
  };
}

export function finalizeCollectedResourceReports(
  reports: ResourceRunReport[],
  dedupedItems: CollectedNewsItem[],
): ResourceRunReport[] {
  const counts = countItemsBySourceId(dedupedItems);

  return reports.map((report) => {
    if (report.status === "failed") {
      return {
        ...report,
        collected_items: 0,
      };
    }

    const collectedItems = counts.get(report.source_id) ?? 0;
    return {
      ...report,
      status: collectedItems > 0 ? "ok" : "empty",
      collected_items: collectedItems,
    };
  });
}

export function applyFreshItemCountsToReports(
  reports: ResourceRunReport[],
  freshItems: NewsItem[],
): ResourceRunReport[] {
  const counts = countItemsBySourceId(freshItems);

  return reports.map((report) => ({
    ...report,
    fresh_items: counts.get(report.source_id) ?? 0,
  }));
}

export function computeResourceTotals(reports: ResourceRunReport[]): ResourceTotals {
  const totals = emptyResourceTotals();
  totals.total_resources = reports.length;

  for (const report of reports) {
    if (report.status === "failed") {
      totals.failed_resources += 1;
      continue;
    }

    if (report.status === "empty") {
      totals.empty_resources += 1;
      continue;
    }

    totals.ok_resources += 1;
  }

  return totals;
}

export function normalizeRunHistorySnapshot(
  value: unknown,
  fallbackIso: string,
): RunHistorySnapshot {
  if (isObjectRecord(value) && Array.isArray(value.runs)) {
    const runs = value.runs
      .map((run) => normalizeRunSummary(run))
      .filter((run): run is RunSummary => run !== null);

    return {
      updated_at:
        typeof value.updated_at === "string" && value.updated_at
          ? value.updated_at
          : fallbackIso,
      runs,
    };
  }

  if (Array.isArray(value)) {
    const runs = value
      .map((run) => normalizeRunSummary(run))
      .filter((run): run is RunSummary => run !== null);

    return {
      updated_at: fallbackIso,
      runs,
    };
  }

  return {
    updated_at: fallbackIso,
    runs: [],
  };
}

export function upsertRunHistory(
  history: RunHistorySnapshot,
  summary: RunSummary,
  updatedAt: string,
): RunHistorySnapshot {
  const withoutCurrent = history.runs.filter((run) => run.run_id !== summary.run_id);
  const runs = [summary, ...withoutCurrent].sort((left, right) =>
    right.generated_at.localeCompare(left.generated_at),
  );

  return {
    updated_at: updatedAt,
    runs,
  };
}

export function buildDailyHealthSnapshot(
  runs: RunSummary[],
  generatedAt: string,
): DailyHealthSnapshot {
  const byDay = new Map<string, DayAggregate>();

  for (const run of runs) {
    const day = dayFromIso(run.generated_at);
    if (!day) {
      continue;
    }

    const aggregate = byDay.get(day) ?? {
      date: day,
      run_count: 0,
      items_saved: 0,
      resource_checks: emptyResourceTotals(),
      source_health: new Map<string, DailySourceHealth>(),
    };

    aggregate.run_count += 1;
    aggregate.items_saved += toNonNegativeInteger(run.total_items);

    const resourceChecks =
      run.source_reports.length > 0
        ? computeResourceTotals(run.source_reports)
        : run.resource_totals;
    aggregate.resource_checks = appendResourceChecks(
      aggregate.resource_checks,
      resourceChecks,
    );

    for (const report of run.source_reports) {
      const key = sourceGroupKey(report);
      const current = aggregate.source_health.get(key);
      aggregate.source_health.set(key, mergeSourceHealth(current, report));
    }

    byDay.set(day, aggregate);
  }

  const days: DailyHealthReport[] = [...byDay.values()]
    .sort((left, right) => right.date.localeCompare(left.date))
    .map((aggregate) => {
      const sourceHealthList = [...aggregate.source_health.values()].sort(
        compareSourceHealth,
      );

      const failedResources: DailySourceHealth[] = [];
      const goodResources: DailySourceHealth[] = [];
      const flakyResources: DailySourceHealth[] = [];

      for (const sourceHealth of sourceHealthList) {
        const hasFailures = sourceHealth.failed_runs > 0;
        const hasNonFailures = sourceHealth.ok_runs > 0 || sourceHealth.empty_runs > 0;

        if (hasFailures && hasNonFailures) {
          flakyResources.push(sourceHealth);
          continue;
        }

        if (hasFailures) {
          failedResources.push(sourceHealth);
          continue;
        }

        goodResources.push(sourceHealth);
      }

      return {
        date: aggregate.date,
        run_count: aggregate.run_count,
        items_saved: aggregate.items_saved,
        resource_checks: aggregate.resource_checks,
        failed_resources: failedResources,
        good_resources: goodResources,
        flaky_resources: flakyResources,
      };
    });

  return {
    generated_at: generatedAt,
    days,
  };
}
