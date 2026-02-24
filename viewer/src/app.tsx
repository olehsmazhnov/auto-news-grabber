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

type SupabaseSyncResponse =
  | {
      ok: true;
      scope: "latest_run" | "snapshot";
      source_file: string;
      selected_items: number;
      unique_items: number;
      submitted_rows: number;
    }
  | {
      ok: false;
      error?: string;
    };

type ScrapeRunResponse =
  | {
      ok: true;
      run: RunSummary;
      backfill: {
        run_path: string;
        scanned_items: number;
        missing_before: number;
        updated_items: number;
        updated_photos: number;
        synced_snapshot_items: number;
        remaining_missing: number;
      };
      collected_items: number;
      translated_items: number;
    }
  | {
      ok: false;
      error?: string;
      status?: ScrapeStatusSnapshot;
    };

type ScrapeRunStateValue = "idle" | "running" | "success" | "error";

type ScrapeProgressStage =
  | "idle"
  | "initializing"
  | "loading_sources"
  | "collecting"
  | "translating"
  | "saving"
  | "backfilling"
  | "completed"
  | "failed";

type ScrapeStatusSnapshot = {
  state: ScrapeRunStateValue;
  stage: ScrapeProgressStage;
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
};

type ScrapeStatusResponse =
  | {
      ok: true;
      status: ScrapeStatusSnapshot;
    }
  | {
      ok: false;
      error?: string;
    };

const SCRAPE_STATUS_POLL_INTERVAL_MS = 1000;

const SCRAPE_STAGE_LABELS: Record<ScrapeProgressStage, string> = {
  idle: "Idle",
  initializing: "Initializing",
  loading_sources: "Loading sources",
  collecting: "Collecting feed items",
  translating: "Translating content",
  saving: "Saving output",
  backfilling: "Backfilling photos",
  completed: "Completed",
  failed: "Failed",
};

const RETELLING_PREFIX_RE = /^Короткий переказ матеріалу з [^:\n]+:\s*/iu;
const AUTONEWS_PROMO_RE = /\bautonews\s+tracks\s+this\s+story\b/i;
const CATEGORY_FEED_PROMO_RE = /\bfollow\s+the\s+category\s+feed\b/i;
const COVERAGE_PROMO_RE = /\bongoing\s+automotive\s+coverage\b/i;
const RELATED_RELEASES_PROMO_RE = /\bupdates\s+and\s+related\s+releases\b/i;
const TRAILING_ELLIPSIS_RE = /(?:\.\.\.|\u2026)\s*$/u;

type InterestLabel = "interesting" | "not_interesting";

type InterestSignal = {
  pattern: RegExp;
  weight: number;
};

const POSITIVE_INTEREST_SIGNALS: InterestSignal[] = [
  { pattern: /\b(new|launch|launched|debut|debuted|reveal|revealed|first look|prototype|concept|facelift|recall)\b/u, weight: 2 },
  { pattern: /(нов(ий|а|е|і)|дебют|прем[’']?єр|запуск|запуска(є|ють|єтьс)|відклик|концепт|прототип)/u, weight: 2 },
  { pattern: /\b(cybertruck|cybercab|model\s?3|model\s?y|eqb|amg|polestar|mustang|f-150)\b/u, weight: 1 },
  { pattern: /\b(usd|\$|долар|євро|million|мільйон)\b/u, weight: 1 },
];

const NEGATIVE_INTEREST_SIGNALS: InterestSignal[] = [
  { pattern: /\b(investor|investors|earnings|results|shipments|guidance|conference call|media advisory|statement)\b/u, weight: -2 },
  { pattern: /(інвестор|результат|поставк|звіт|конференц|медіа|прес-реліз|оголош(ує|ення))/u, weight: -2 },
];

function safeNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  return Math.trunc(value);
}

function clampPercent(value: unknown): number {
  const numeric = safeNumber(value);
  if (numeric <= 0) {
    return 0;
  }
  if (numeric >= 100) {
    return 100;
  }
  return numeric;
}

function stageLabel(stage: ScrapeProgressStage): string {
  return SCRAPE_STAGE_LABELS[stage] ?? SCRAPE_STAGE_LABELS.idle;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isScrapeStage(value: unknown): value is ScrapeProgressStage {
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

function isScrapeRunState(value: unknown): value is ScrapeRunStateValue {
  return value === "idle" || value === "running" || value === "success" || value === "error";
}

function toSafeText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim();
}

function parseScrapeStatusSnapshot(value: unknown): ScrapeStatusSnapshot | null {
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

function initialRunningScrapeStatus(): ScrapeStatusSnapshot {
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

function sanitizeContentForDisplay(content: string): string {
  if (!content) {
    return "";
  }
  const withoutPrefix = content.replace(RETELLING_PREFIX_RE, "").trim();
  if (!withoutPrefix) {
    return "";
  }

  return stripDisplayArtifacts(withoutPrefix);
}

function splitDisplayParagraphs(content: string): string[] {
  return content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph.length > 0);
}

function isPromotionalDisplayParagraph(paragraph: string): boolean {
  const normalized = paragraph.toLowerCase();
  if (!normalized) {
    return false;
  }

  const hasAutoNewsLead = AUTONEWS_PROMO_RE.test(normalized);
  const hasFeedPrompt = CATEGORY_FEED_PROMO_RE.test(normalized);
  const hasCoverage = COVERAGE_PROMO_RE.test(normalized);
  const hasRelatedReleases = RELATED_RELEASES_PROMO_RE.test(normalized);

  if (hasAutoNewsLead && (hasFeedPrompt || hasCoverage || hasRelatedReleases)) {
    return true;
  }

  if (hasFeedPrompt && hasRelatedReleases) {
    return true;
  }

  return false;
}

function normalizeDisplayParagraphForDuplicateCheck(value: string): string {
  return value
    .toLowerCase()
    .replace(/\u2026/g, "...")
    .replace(/[^\p{L}\p{N}\s.]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isTruncatedDisplayDuplicate(previous: string, current: string): boolean {
  if (!TRAILING_ELLIPSIS_RE.test(current.trim())) {
    return false;
  }

  const normalizedCurrent = normalizeDisplayParagraphForDuplicateCheck(current)
    .replace(/\.{3}\s*$/g, "")
    .trim();
  if (normalizedCurrent.length < 80) {
    return false;
  }

  const normalizedPrevious = normalizeDisplayParagraphForDuplicateCheck(previous);
  if (!normalizedPrevious) {
    return false;
  }

  const comparePrefix = normalizedCurrent.slice(0, Math.min(normalizedCurrent.length, 160));
  return normalizedPrevious.startsWith(comparePrefix);
}

function stripDisplayArtifacts(content: string): string {
  const paragraphs = splitDisplayParagraphs(content);
  if (paragraphs.length === 0) {
    return "";
  }

  const cleaned: string[] = [];
  for (const paragraph of paragraphs) {
    if (isPromotionalDisplayParagraph(paragraph)) {
      continue;
    }

    const previous = cleaned.length > 0 ? cleaned[cleaned.length - 1] : "";
    if (previous && isTruncatedDisplayDuplicate(previous, paragraph)) {
      continue;
    }

    cleaned.push(paragraph);
  }

  return cleaned.join("\n\n").trim();
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

function normalizeInterestText(value: string): string {
  if (!value) {
    return "";
  }
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function interestScore(text: string, signals: InterestSignal[]): number {
  if (!text) {
    return 0;
  }

  let score = 0;
  for (const signal of signals) {
    if (signal.pattern.test(text)) {
      score += signal.weight;
    }
  }

  return score;
}

function articleInterestScore(item: NewsItem): number {
  const title = normalizeInterestText(item.title);
  const content = normalizeInterestText(sanitizeContentForDisplay(item.content)).slice(0, 3200);
  const combined = `${title} ${content}`;

  let score = 0;
  score += interestScore(combined, POSITIVE_INTEREST_SIGNALS);
  score += interestScore(combined, NEGATIVE_INTEREST_SIGNALS);

  if (content.length < 180) {
    score -= 1;
  }
  if (item.rights_flag === "quote_only") {
    score += 1;
  }
  if (Array.isArray(item.photos) && item.photos.length > 0) {
    score += 1;
  }

  return score;
}

function classifyArticleInterest(item: NewsItem): InterestLabel {
  const score = articleInterestScore(item);
  return score >= 2 ? "interesting" : "not_interesting";
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

function parseIsoTimestampOrZero(value: string): number {
  if (!value) {
    return 0;
  }

  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) {
    return 0;
  }

  return parsed;
}

function parsePublishedPartsOrZero(dateOnly: string, timeOnly: string): number {
  if (!dateOnly) {
    return 0;
  }

  const normalizedTime = /^\d{2}:\d{2}:\d{2}$/.test(timeOnly)
    ? timeOnly
    : /^\d{2}:\d{2}$/.test(timeOnly)
      ? `${timeOnly}:00`
      : "00:00:00";
  return parseIsoTimestampOrZero(`${dateOnly}T${normalizedTime}Z`);
}

function publishedTimestamp(item: NewsItem): number {
  const byIso = parseIsoTimestampOrZero(item.published_at);
  if (byIso > 0) {
    return byIso;
  }
  return parsePublishedPartsOrZero(item.published_date, item.published_time);
}

function sortNewsNewestFirst(items: NewsItem[]): NewsItem[] {
  return [...items].sort((left, right) => {
    const publishedDelta = publishedTimestamp(right) - publishedTimestamp(left);
    if (publishedDelta !== 0) {
      return publishedDelta;
    }

    const scrapedDelta =
      parseIsoTimestampOrZero(right.scraped_at) - parseIsoTimestampOrZero(left.scraped_at);
    if (scrapedDelta !== 0) {
      return scrapedDelta;
    }

    return right.id.localeCompare(left.id);
  });
}

function articlePrimaryTimestamp(item: NewsItem): number {
  const published = publishedTimestamp(item);
  if (published > 0) {
    return published;
  }
  return parseIsoTimestampOrZero(item.scraped_at);
}

function isSameLocalCalendarDay(timestamp: number, reference: Date): boolean {
  if (timestamp <= 0) {
    return false;
  }
  const date = new Date(timestamp);
  return (
    date.getFullYear() === reference.getFullYear() &&
    date.getMonth() === reference.getMonth() &&
    date.getDate() === reference.getDate()
  );
}

type CardRenderData = {
  image: string | null;
  articleLink: string;
  interest: InterestLabel;
  isExpanded: boolean;
  hasMoreContent: boolean;
  contentToShow: string;
};

function buildCardRenderData(
  item: NewsItem,
  expandedItemIds: Set<string>,
  excerptMaxChars = 360,
): CardRenderData {
  const image = cardImage(item);
  const articleLink = `/${item.article_path}/article.md`;
  const shortContent = excerpt(item.content, excerptMaxChars);
  const fullContent = sanitizeContentForDisplay(item.content);
  const interest = classifyArticleInterest(item);
  const isExpanded = expandedItemIds.has(item.id);
  const hasMoreContent = fullContent.length > shortContent.length;
  const contentToShow = isExpanded ? fullContent : shortContent;

  return {
    image,
    articleLink,
    interest,
    isExpanded,
    hasMoreContent,
    contentToShow,
  };
}

function App(): JSX.Element {
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
  const scrapeProgressStage = stageLabel(scrapeProgress?.stage ?? "initializing");
  const scrapeProgressMessage = scrapeProgress?.message || "Scrape is running...";
  const scrapeProgressError = scrapeProgress?.error || "";
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
      <header className="header">
        <h1>Auto News Viewer</h1>
        <p>Latest snapshot with run diagnostics and daily resource health.</p>
        <div className="header-actions">
          <button
            type="button"
            className="scrape-run-button"
            disabled={scrapeIsRunning || supabaseSyncState === "saving"}
            onClick={() => {
              void runNewScrape();
            }}
          >
            {scrapeIsRunning
              ? `Scraping ${scrapeProgressPercent}%`
              : "Run new unique scrape"}
          </button>
          <button
            type="button"
            className="supabase-sync-button"
            disabled={supabaseSyncState === "saving" || scrapeIsRunning}
            onClick={() => {
              void syncLatestRunToSupabase();
            }}
          >
            {supabaseSyncState === "saving" ? "Saving..." : "Save latest run to Supabase"}
          </button>
          {scrapeRunMessage ? (
            <p
              className={`scrape-run-status ${
                scrapeRunState === "error"
                  ? "scrape-run-status-error"
                  : scrapeRunState === "success"
                    ? "scrape-run-status-success"
                    : ""
              }`}
            >
              {scrapeRunMessage}
            </p>
          ) : null}
          {scrapeIsRunning ? (
            <div className="scrape-loader" role="status" aria-live="polite" aria-atomic="true">
              <div className="scrape-loader-head">
                <span className="scrape-loader-spinner" aria-hidden="true" />
                <span className="scrape-loader-message">{scrapeProgressMessage}</span>
                <strong className="scrape-loader-percent">{scrapeProgressPercent}%</strong>
              </div>
              <div className="scrape-loader-track" aria-hidden="true">
                <span className="scrape-loader-fill" style={{ width: `${scrapeProgressPercent}%` }} />
              </div>
              <p className="scrape-loader-stage">
                Stage: {scrapeProgressStage}
                {scrapeProgressError ? ` | ${scrapeProgressError}` : ""}
              </p>
            </div>
          ) : null}
          {supabaseSyncMessage ? (
            <p
              className={`supabase-sync-status ${
                supabaseSyncState === "error"
                  ? "supabase-sync-status-error"
                  : supabaseSyncState === "success"
                    ? "supabase-sync-status-success"
                    : ""
              }`}
            >
              {supabaseSyncMessage}
            </p>
          ) : null}
        </div>
      </header>

      {error ? <div className="empty">{error}</div> : null}

      {featuredTodayItem && featuredCardData ? (
        <section className="featured-section">
          <p className="featured-label">Top pick for today</p>
          <article className="card featured-card">
            {featuredCardData.image ? (
              <img className="card-image" src={featuredCardData.image} alt={featuredTodayItem.title} loading="lazy" />
            ) : null}
            <div className="card-body">
              <div className="meta">
                <span>
                  {formatDateTime(
                    featuredTodayItem.published_date,
                    featuredTodayItem.published_time,
                    featuredTodayItem.published_at,
                  )}
                </span>
                <span>{featuredTodayItem.source}</span>
                <span className="flag">{featuredTodayItem.rights_flag}</span>
                <span
                  className={`interest-pill ${featuredCardData.interest === "interesting" ? "interest-good" : "interest-bad"}`}
                  title={featuredCardData.interest === "interesting" ? "Article looks interesting" : "Article looks less interesting"}
                >
                  {featuredCardData.interest === "interesting" ? "Interesting" : "Not interesting"}
                </span>
              </div>
              <h3>{featuredTodayItem.title}</h3>
              <p className="excerpt">{featuredCardData.contentToShow}</p>
              {featuredCardData.hasMoreContent ? (
                <button
                  type="button"
                  className="content-toggle"
                  onClick={() => toggleExpanded(featuredTodayItem.id)}
                  aria-expanded={featuredCardData.isExpanded}
                >
                  {featuredCardData.isExpanded ? "Show less" : "Show more"}
                </button>
              ) : null}
              <div className="links">
                <a href={featuredTodayItem.url} target="_blank" rel="noreferrer">
                  Source
                </a>
                <a href={featuredCardData.articleLink} target="_blank" rel="noreferrer">
                  Local article
                </a>
              </div>
            </div>
          </article>
        </section>
      ) : null}

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
        {nonFeaturedItems.map((item) => {
          const cardData = buildCardRenderData(item, expandedItemIds);

          return (
            <article key={item.id} className="card">
              {cardData.image ? <img className="card-image" src={cardData.image} alt={item.title} loading="lazy" /> : null}
              <div className="card-body">
                <div className="meta">
                  <span>{formatDateTime(item.published_date, item.published_time, item.published_at)}</span>
                  <span>{item.source}</span>
                  <span className="flag">{item.rights_flag}</span>
                  <span
                    className={`interest-pill ${cardData.interest === "interesting" ? "interest-good" : "interest-bad"}`}
                    title={cardData.interest === "interesting" ? "Article looks interesting" : "Article looks less interesting"}
                  >
                    {cardData.interest === "interesting" ? "Interesting" : "Not interesting"}
                  </span>
                </div>
                <h3>{item.title}</h3>
                <p className="excerpt">{cardData.contentToShow}</p>
                {cardData.hasMoreContent ? (
                  <button
                    type="button"
                    className="content-toggle"
                    onClick={() => toggleExpanded(item.id)}
                    aria-expanded={cardData.isExpanded}
                  >
                    {cardData.isExpanded ? "Show less" : "Show more"}
                  </button>
                ) : null}
                <div className="links">
                  <a href={item.url} target="_blank" rel="noreferrer">
                    Source
                  </a>
                  <a href={cardData.articleLink} target="_blank" rel="noreferrer">
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
