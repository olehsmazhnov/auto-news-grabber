import React from "react";
import { createRoot } from "react-dom/client";

type PhotoAsset = {
  source_url: string;
  local_path: string;
  provider: "feed" | "article" | "wikimedia";
  license: string;
  credit: string;
  attribution_url: string;
};

type ResourceStatus = "ok" | "empty" | "failed";

type ResourceTotals = {
  total_resources: number;
  ok_resources: number;
  empty_resources: number;
  failed_resources: number;
};

type ResourceReport = {
  source_id: string;
  source_name: string;
  source: string;
  source_url: string;
  feed_url: string;
  status: ResourceStatus;
  error: string;
  feed_entries: number;
  collected_items: number;
  fresh_items: number;
};

type RunSummary = {
  run_id: string;
  run_path: string;
  generated_at: string;
  total_items: number;
  collected_items: number;
  skipped_seen_items: number;
  resource_totals: ResourceTotals;
  source_reports: ResourceReport[];
};

type RunHistorySnapshot = {
  updated_at: string;
  runs: RunSummary[];
};

type DailySourceHealth = {
  source_id: string;
  source_name: string;
  source: string;
  ok_runs: number;
  empty_runs: number;
  failed_runs: number;
};

type DailyHealthReport = {
  date: string;
  run_count: number;
  items_saved: number;
  resource_checks: ResourceTotals;
  failed_resources: DailySourceHealth[];
  good_resources: DailySourceHealth[];
  flaky_resources: DailySourceHealth[];
};

type DailyHealthSnapshot = {
  generated_at: string;
  days: DailyHealthReport[];
};

type NewsItem = {
  id: string;
  source_id?: string;
  title: string;
  content: string;
  url: string;
  source: string;
  published_at: string;
  published_date: string;
  published_time: string;
  scraped_at: string;
  article_path: string;
  rights_flag: "official_press" | "quote_only" | "unknown";
  license_text: string;
  photos: PhotoAsset[];
};

const RETELLING_PREFIX_RE = /^Короткий переказ матеріалу з [^:\n]+:\s*/iu;

function safeNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  return Math.trunc(value);
}

function sanitizeContentForDisplay(content: string): string {
  if (!content) {
    return "";
  }
  return content.replace(RETELLING_PREFIX_RE, "").trim();
}

function excerpt(content: string, maxChars = 360): string {
  const normalized = sanitizeContentForDisplay(content);
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars).trim()}...`;
}

function formatDateTime(dateOnly: string, timeOnly: string, iso: string): string {
  if (iso) {
    const date = new Date(iso);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString("uk-UA", {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    }
  }

  if (dateOnly && timeOnly) {
    return `${dateOnly} ${timeOnly}`;
  }
  if (dateOnly) {
    return dateOnly;
  }
  if (timeOnly) {
    return timeOnly;
  }
  return "n/a";
}

function formatRunTimestamp(isoLike: string): string {
  if (!isoLike) {
    return "n/a";
  }

  const date = new Date(isoLike);
  if (Number.isNaN(date.getTime())) {
    return isoLike;
  }

  return date.toLocaleString("uk-UA", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function cardImage(item: NewsItem): string | null {
  if (!Array.isArray(item.photos) || item.photos.length === 0) {
    return null;
  }

  const first = item.photos[0];
  if (!first?.local_path) {
    return null;
  }

  return `/${first.local_path}`;
}

function isHttpUrl(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function fetchJsonOrNull<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function runTotals(run: RunSummary | null): ResourceTotals {
  if (!run) {
    return {
      total_resources: 0,
      ok_resources: 0,
      empty_resources: 0,
      failed_resources: 0,
    };
  }

  const totals = run.resource_totals;
  const reports = Array.isArray(run.source_reports) ? run.source_reports : [];
  if (
    totals &&
    typeof totals.total_resources === "number" &&
    typeof totals.ok_resources === "number" &&
    typeof totals.empty_resources === "number" &&
    typeof totals.failed_resources === "number"
  ) {
    return {
      total_resources: safeNumber(totals.total_resources),
      ok_resources: safeNumber(totals.ok_resources),
      empty_resources: safeNumber(totals.empty_resources),
      failed_resources: safeNumber(totals.failed_resources),
    };
  }

  let ok = 0;
  let empty = 0;
  let failed = 0;
  for (const report of reports) {
    if (report.status === "failed") {
      failed += 1;
    } else if (report.status === "empty") {
      empty += 1;
    } else {
      ok += 1;
    }
  }

  return {
    total_resources: reports.length,
    ok_resources: ok,
    empty_resources: empty,
    failed_resources: failed,
  };
}

function failedRunResources(run: RunSummary | null): ResourceReport[] {
  if (!run || !Array.isArray(run.source_reports)) {
    return [];
  }

  return run.source_reports.filter((report) => report.status === "failed");
}

function App(): JSX.Element {
  const [items, setItems] = React.useState<NewsItem[]>([]);
  const [latestRun, setLatestRun] = React.useState<RunSummary | null>(null);
  const [recentRuns, setRecentRuns] = React.useState<RunSummary[]>([]);
  const [dailyHealth, setDailyHealth] = React.useState<DailyHealthReport[]>([]);
  const [error, setError] = React.useState("");
  const [expandedItemIds, setExpandedItemIds] = React.useState<Set<string>>(new Set());

  const toggleExpanded = React.useCallback((itemId: string): void => {
    setExpandedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  React.useEffect(() => {
    let mounted = true;

    async function loadAll(): Promise<void> {
      try {
        const newsResponse = await fetch(`/data/news.json?t=${Date.now()}`);
        if (!newsResponse.ok) {
          throw new Error(`HTTP ${newsResponse.status}`);
        }

        const [
          newsData,
          latestRunData,
          runHistoryData,
          dailyHealthData,
        ] = await Promise.all([
          newsResponse.json() as Promise<NewsItem[]>,
          fetchJsonOrNull<RunSummary>(`/data/latest_run.json?t=${Date.now()}`),
          fetchJsonOrNull<RunHistorySnapshot>(`/data/run_history.json?t=${Date.now()}`),
          fetchJsonOrNull<DailyHealthSnapshot>(`/data/daily_health.json?t=${Date.now()}`),
        ]);

        if (!mounted) {
          return;
        }

        setItems(Array.isArray(newsData) ? newsData : []);
        setLatestRun(latestRunData);
        setRecentRuns(Array.isArray(runHistoryData?.runs) ? runHistoryData.runs.slice(0, 10) : []);
        setDailyHealth(Array.isArray(dailyHealthData?.days) ? dailyHealthData.days.slice(0, 7) : []);
        setError("");
      } catch (err) {
        if (mounted) {
          setError(`Failed to load news: ${String(err)}`);
        }
      }
    }

    void loadAll();
    return () => {
      mounted = false;
    };
  }, []);

  const latestTotals = runTotals(latestRun);
  const failedResources = failedRunResources(latestRun);
  const sourceUrlLookup = React.useMemo(() => {
    const byId = new Map<string, string>();
    const byName = new Map<string, string>();
    const runs = [latestRun, ...recentRuns];

    for (const run of runs) {
      if (!run || !Array.isArray(run.source_reports)) {
        continue;
      }
      for (const report of run.source_reports) {
        const url = isHttpUrl(report.source_url)
          ? report.source_url
          : isHttpUrl(report.feed_url)
            ? report.feed_url
            : "";
        if (!url) {
          continue;
        }
        if (report.source_id && !byId.has(report.source_id)) {
          byId.set(report.source_id, url);
        }
        if (report.source_name && !byName.has(report.source_name)) {
          byName.set(report.source_name, url);
        }
      }
    }

    return { byId, byName };
  }, [latestRun, recentRuns]);

  const renderResourceRefs = React.useCallback(
    (
      sources: Array<{
        source_id?: string;
        source_name: string;
        source_url?: string;
        feed_url?: string;
      }>,
    ): React.ReactNode => {
      if (!Array.isArray(sources) || sources.length === 0) {
        return "none";
      }

      return sources.map((source, index) => {
        const directUrl = isHttpUrl(source.source_url)
          ? source.source_url
          : isHttpUrl(source.feed_url)
            ? source.feed_url
            : "";
        const fallbackUrl = source.source_id
          ? sourceUrlLookup.byId.get(source.source_id) ?? ""
          : sourceUrlLookup.byName.get(source.source_name) ?? "";
        const refUrl = directUrl || fallbackUrl;
        const key = `${source.source_id ?? source.source_name}-${index}`;

        return (
          <React.Fragment key={key}>
            {index > 0 ? ", " : null}
            {refUrl ? (
              <a href={refUrl} target="ref" rel="noopener noreferrer">
                {source.source_name}
              </a>
            ) : (
              source.source_name
            )}
          </React.Fragment>
        );
      });
    },
    [sourceUrlLookup],
  );

  return (
    <main className="page">
      <header className="header">
        <h1>Auto News Viewer</h1>
        <p>Latest snapshot with run diagnostics and daily resource health.</p>
      </header>

      {error ? <div className="empty">{error}</div> : null}

      <section className="status-grid">
        <article className="status-card">
          <h2>Latest run</h2>
          {latestRun ? (
            <div className="status-body">
              <p className="status-row">
                <strong>{formatRunTimestamp(latestRun.generated_at)}</strong>
              </p>
              <p className="status-row">Run ID: {latestRun.run_id}</p>
              <p className="status-row">
                Items saved: {safeNumber(latestRun.total_items)} / collected:{" "}
                {safeNumber(latestRun.collected_items)} / skipped:{" "}
                {safeNumber(latestRun.skipped_seen_items)}
              </p>
              <div className="pill-row">
                <span className="pill pill-ok">ok {latestTotals.ok_resources}</span>
                <span className="pill pill-empty">empty {latestTotals.empty_resources}</span>
                <span className="pill pill-fail">failed {latestTotals.failed_resources}</span>
              </div>
              <p className="status-row">
                Failed resources:{" "}
                {renderResourceRefs(failedResources)}
              </p>
              <p className="status-row">
                <a href={`/${latestRun.run_path}/run_summary.json`} target="_blank" rel="noreferrer">
                  Open run summary JSON
                </a>
              </p>
            </div>
          ) : (
            <p className="status-row muted">No run summary yet.</p>
          )}
        </article>

        <article className="status-card">
          <h2>Recent runs</h2>
          {recentRuns.length > 0 ? (
            <ul className="run-list">
              {recentRuns.map((run) => {
                const totals = runTotals(run);
                return (
                  <li key={run.run_id} className="run-item">
                    <a href={`/${run.run_path}/run_summary.json`} target="_blank" rel="noreferrer">
                      {formatRunTimestamp(run.generated_at)}
                    </a>
                    <span>{safeNumber(run.total_items)} saved</span>
                    <span className={totals.failed_resources > 0 ? "pill pill-fail" : "pill pill-ok"}>
                      {totals.failed_resources > 0
                        ? `${totals.failed_resources} failed`
                        : "all good"}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="status-row muted">Run history not found yet.</p>
          )}
        </article>
      </section>

      <section className="status-card daily-card">
        <h2>Per-day resources</h2>
        {dailyHealth.length > 0 ? (
          <div className="daily-list">
            {dailyHealth.map((day) => (
              <article key={day.date} className="daily-item">
                <div className="daily-head">
                  <strong>{day.date}</strong>
                  <span>
                    runs: {safeNumber(day.run_count)} / items: {safeNumber(day.items_saved)}
                  </span>
                  <span>
                    checks: ok {safeNumber(day.resource_checks?.ok_resources)} / empty{" "}
                    {safeNumber(day.resource_checks?.empty_resources)} / failed{" "}
                    {safeNumber(day.resource_checks?.failed_resources)}
                  </span>
                </div>
                <p className="status-row">Failed: {renderResourceRefs(day.failed_resources)}</p>
                <p className="status-row">Flaky: {renderResourceRefs(day.flaky_resources)}</p>
                <p className="status-row">Good: {renderResourceRefs(day.good_resources)}</p>
              </article>
            ))}
          </div>
        ) : (
          <p className="status-row muted">Daily health summary not found yet.</p>
        )}
      </section>

      {!error && items.length === 0 ? (
        <div className="empty">No items yet. Run scrape first.</div>
      ) : null}

      <section className="grid">
        {items.map((item) => {
          const image = cardImage(item);
          const articleLink = `/${item.article_path}/article.md`;
          const shortContent = excerpt(item.content);
          const fullContent = sanitizeContentForDisplay(item.content);
          const isExpanded = expandedItemIds.has(item.id);
          const hasMoreContent = fullContent.length > shortContent.length;
          const contentToShow = isExpanded ? fullContent : shortContent;

          return (
            <article key={item.id} className="card">
              {image ? <img className="card-image" src={image} alt={item.title} loading="lazy" /> : null}
              <div className="card-body">
                <div className="meta">
                  <span>{formatDateTime(item.published_date, item.published_time, item.published_at)}</span>
                  <span>{item.source}</span>
                  <span className="flag">{item.rights_flag}</span>
                </div>
                <h3>{item.title}</h3>
                <p className="excerpt">{contentToShow}</p>
                {hasMoreContent ? (
                  <button
                    type="button"
                    className="content-toggle"
                    onClick={() => toggleExpanded(item.id)}
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? "Show less" : "Show more"}
                  </button>
                ) : null}
                <div className="links">
                  <a href={item.url} target="_blank" rel="noreferrer">
                    Source
                  </a>
                  <a href={articleLink} target="_blank" rel="noreferrer">
                    Local article
                  </a>
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}

const container = document.getElementById("app");
if (!container) {
  throw new Error("Root container not found");
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
