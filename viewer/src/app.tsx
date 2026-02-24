import React from "react";
import type {
  DailyHealthReport,
  DailyHealthSnapshot,
  NewsItem,
  RunHistorySnapshot,
  RunSummary,
  ScrapeRunResponse,
  ScrapeStatusSnapshot,
  SupabaseSyncResponse,
} from "./types";
import { SCRAPE_STATUS_POLL_INTERVAL_MS } from "./constants";
import {
  fetchJsonOrNull,
  sortNewsNewestFirst,
  runTotals,
  failedRunResources,
  buildCardRenderData,
  articlePrimaryTimestamp,
  articleInterestScore,
  isSameLocalCalendarDay,
  isHttpUrl,
  parseScrapeStatusSnapshot,
  initialRunningScrapeStatus,
  safeNumber,
  clampPercent,
  isRecord,
} from "./utils";
import {
  Header,
  FeaturedCard,
  StatusGrid,
  DailyHealth,
  NewsCard,
} from "./components";

export function App(): JSX.Element {
  const [items, setItems] = React.useState<NewsItem[]>([]);
  const [latestRun, setLatestRun] = React.useState<RunSummary | null>(null);
  const [recentRuns, setRecentRuns] = React.useState<RunSummary[]>([]);
  const [dailyHealth, setDailyHealth] = React.useState<DailyHealthReport[]>([]);
  const [error, setError] = React.useState("");
  const [expandedItemIds, setExpandedItemIds] = React.useState<Set<string>>(new Set());
  const [supabaseSyncState, setSupabaseSyncState] = React.useState<"idle" | "saving" | "success" | "error">("idle");
  const [supabaseSyncMessage, setSupabaseSyncMessage] = React.useState("");
  const [scrapeRunState, setScrapeRunState] = React.useState<"idle" | "running" | "success" | "error">("idle");
  const [scrapeRunMessage, setScrapeRunMessage] = React.useState("");
  const [scrapeProgress, setScrapeProgress] = React.useState<ScrapeStatusSnapshot | null>(null);
  const scrapeStatusPollRef = React.useRef<number | null>(null);

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

  const clearScrapeStatusPolling = React.useCallback((): void => {
    if (scrapeStatusPollRef.current === null) {
      return;
    }

    window.clearInterval(scrapeStatusPollRef.current);
    scrapeStatusPollRef.current = null;
  }, []);

  const fetchScrapeStatus = React.useCallback(async (): Promise<ScrapeStatusSnapshot | null> => {
    try {
      const response = await fetch(`/api/scrape/status?t=${Date.now()}`);
      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as unknown;
      if (!isRecord(payload) || payload.ok !== true) {
        return null;
      }

      const status = parseScrapeStatusSnapshot(payload.status);
      if (!status) {
        return null;
      }

      setScrapeProgress(status);
      return status;
    } catch {
      return null;
    }
  }, []);

  const startScrapeStatusPolling = React.useCallback((): void => {
    clearScrapeStatusPolling();
    void fetchScrapeStatus();

    scrapeStatusPollRef.current = window.setInterval(() => {
      void fetchScrapeStatus();
    }, SCRAPE_STATUS_POLL_INTERVAL_MS);
  }, [clearScrapeStatusPolling, fetchScrapeStatus]);

  const loadAll = React.useCallback(async (): Promise<void> => {
    try {
      const newsResponse = await fetch(`/data/news.json?t=${Date.now()}`);
      if (!newsResponse.ok) {
        throw new Error(`HTTP ${newsResponse.status}`);
      }

      const [newsData, latestRunData, runHistoryData, dailyHealthData] = await Promise.all([
        newsResponse.json() as Promise<NewsItem[]>,
        fetchJsonOrNull<RunSummary>(`/data/latest_run.json?t=${Date.now()}`),
        fetchJsonOrNull<RunHistorySnapshot>(`/data/run_history.json?t=${Date.now()}`),
        fetchJsonOrNull<DailyHealthSnapshot>(`/data/daily_health.json?t=${Date.now()}`),
      ]);

      setItems(Array.isArray(newsData) ? sortNewsNewestFirst(newsData) : []);
      setLatestRun(latestRunData);
      setRecentRuns(Array.isArray(runHistoryData?.runs) ? runHistoryData.runs.slice(0, 10) : []);
      setDailyHealth(Array.isArray(dailyHealthData?.days) ? dailyHealthData.days.slice(0, 7) : []);
      setError("");
    } catch (err) {
      setError(`Failed to load news: ${String(err)}`);
    }
  }, []);

  const syncLatestRunToSupabase = React.useCallback(async (): Promise<void> => {
    setSupabaseSyncState("saving");
    setSupabaseSyncMessage("Saving latest run to Supabase...");

    try {
      const response = await fetch("/api/supabase/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ scope: "latest_run" }),
      });

      let payload: SupabaseSyncResponse | null = null;
      try {
        payload = (await response.json()) as SupabaseSyncResponse;
      } catch {
        payload = null;
      }

      if (!response.ok || !payload?.ok) {
        const details = payload && !payload.ok && payload.error ? `: ${payload.error}` : "";
        throw new Error(`HTTP ${response.status}${details}`);
      }

      setSupabaseSyncState("success");
      setSupabaseSyncMessage(
        `Supabase sync complete. Unique posts: ${safeNumber(payload.unique_items)}. Submitted rows: ${safeNumber(payload.submitted_rows)}.`,
      );
    } catch (syncError) {
      setSupabaseSyncState("error");
      setSupabaseSyncMessage(`Supabase sync failed: ${String(syncError)}`);
    }
  }, []);

  const runNewScrape = React.useCallback(async (): Promise<void> => {
    setScrapeRunState("running");
    setScrapeRunMessage("Running scrape and photo backfill...");
    setScrapeProgress(initialRunningScrapeStatus());
    startScrapeStatusPolling();

    try {
      const response = await fetch("/api/scrape/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({}),
      });

      let payload: ScrapeRunResponse | null = null;
      try {
        payload = (await response.json()) as ScrapeRunResponse;
      } catch {
        payload = null;
      }

      if (!response.ok || !payload?.ok) {
        if (payload && !payload.ok) {
          const status = parseScrapeStatusSnapshot(payload.status);
          if (status) {
            setScrapeProgress(status);
          }
        }
        const details = payload && !payload.ok && payload.error ? `: ${payload.error}` : "";
        throw new Error(`HTTP ${response.status}${details}`);
      }

      setScrapeRunState("success");
      setScrapeRunMessage(
        `Scrape complete. Run: ${payload.run.run_id}. Fresh: ${safeNumber(payload.run.total_items)}. Backfilled photos: ${safeNumber(payload.backfill.updated_photos)}.`,
      );
      await loadAll();
    } catch (scrapeError) {
      setScrapeRunState("error");
      setScrapeRunMessage(`Scrape failed: ${String(scrapeError)}`);
    } finally {
      clearScrapeStatusPolling();
      await fetchScrapeStatus();
    }
  }, [clearScrapeStatusPolling, fetchScrapeStatus, loadAll, startScrapeStatusPolling]);

  React.useEffect(() => {
    void loadAll();
  }, [loadAll]);

  React.useEffect(() => {
    let cancelled = false;

    const syncInitialScrapeStatus = async (): Promise<void> => {
      const status = await fetchScrapeStatus();
      if (cancelled || !status) {
        return;
      }

      if (status.state === "running") {
        startScrapeStatusPolling();
      }
    };

    void syncInitialScrapeStatus();

    return () => {
      cancelled = true;
      clearScrapeStatusPolling();
    };
  }, [clearScrapeStatusPolling, fetchScrapeStatus, startScrapeStatusPolling]);

  const latestTotals = runTotals(latestRun);
  const failedResources = failedRunResources(latestRun);

  const featuredTodayItem = React.useMemo(() => {
    const today = new Date();
    const candidates = items
      .map((item) => ({
        item,
        score: articleInterestScore(item),
        timestamp: articlePrimaryTimestamp(item),
        hasPhoto: Array.isArray(item.photos) && item.photos.length > 0,
      }))
      .filter((entry) => isSameLocalCalendarDay(entry.timestamp, today));

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((left, right) => {
      const scoreDelta = right.score - left.score;
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      const photoDelta = Number(right.hasPhoto) - Number(left.hasPhoto);
      if (photoDelta !== 0) {
        return photoDelta;
      }
      const timestampDelta = right.timestamp - left.timestamp;
      if (timestampDelta !== 0) {
        return timestampDelta;
      }
      return right.item.id.localeCompare(left.item.id);
    });

    return candidates[0]?.item ?? null;
  }, [items]);

  const nonFeaturedItems = React.useMemo(() => {
    if (!featuredTodayItem) {
      return items;
    }
    return items.filter((item) => item.id !== featuredTodayItem.id);
  }, [featuredTodayItem, items]);

  const featuredCardData = React.useMemo(() => {
    if (!featuredTodayItem) {
      return null;
    }
    return buildCardRenderData(featuredTodayItem, expandedItemIds, 520);
  }, [featuredTodayItem, expandedItemIds]);

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

  const scrapeProgressPercent = clampPercent(scrapeProgress?.progress_percent);
  const scrapeIsRunning = scrapeRunState === "running" || scrapeProgress?.state === "running";

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
      <Header
        scrapeIsRunning={scrapeIsRunning}
        scrapeProgressPercent={scrapeProgressPercent}
        scrapeRunState={scrapeRunState}
        scrapeRunMessage={scrapeRunMessage}
        scrapeProgress={scrapeProgress}
        supabaseSyncState={supabaseSyncState}
        supabaseSyncMessage={supabaseSyncMessage}
        onRunScrape={() => {
          void runNewScrape();
        }}
        onSyncToSupabase={() => {
          void syncLatestRunToSupabase();
        }}
      />

      {error ? <div className="empty">{error}</div> : null}

      {featuredTodayItem && featuredCardData ? (
        <FeaturedCard
          item={featuredTodayItem}
          cardData={featuredCardData}
          onToggleExpanded={toggleExpanded}
        />
      ) : null}

      <StatusGrid
        latestRun={latestRun}
        latestTotals={latestTotals}
        failedResources={failedResources}
        recentRuns={recentRuns}
        renderResourceRefs={renderResourceRefs}
      />

      <DailyHealth dailyHealth={dailyHealth} renderResourceRefs={renderResourceRefs} />

      {!error && items.length === 0 ? (
        <div className="empty">No items yet. Run scrape first.</div>
      ) : null}

      <section className="grid">
        {nonFeaturedItems.map((item) => (
          <NewsCard
            key={item.id}
            item={item}
            expandedItemIds={expandedItemIds}
            onToggleExpanded={toggleExpanded}
          />
        ))}
      </section>
    </main>
  );
}
