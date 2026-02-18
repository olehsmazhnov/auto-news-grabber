import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import Parser from "rss-parser";
import {
  MAX_ARTICLE_PARAGRAPHS,
  MIN_ARTICLE_CHARS,
} from "./constants.js";
import type {
  CollectItemsResult,
  CollectedNewsItem,
  NewsItem,
  RunSummary,
  RunHistorySnapshot,
  ResourceRunReport,
  Source,
  TranslateItemsOptions,
} from "./types.js";
import { renderArticleMarkdown } from "./utils/article-markdown.js";
import { createRunId, toDateOnly, toIsoOrEmpty, toTimeOnly } from "./utils/date.js";
import { fetchHtmlOrEmpty, fetchText } from "./utils/http.js";
import { log } from "./utils/log.js";
import {
  downloadPhotoCandidates,
  extractFeedImageUrls,
  extractHtmlImageUrls,
  resolvePhotoCandidates,
} from "./utils/photos.js";
import {
  applyFreshItemCountsToReports,
  buildDailyHealthSnapshot,
  computeResourceTotals,
  createResourceRunReport,
  finalizeCollectedResourceReports,
  normalizeRunHistorySnapshot,
  upsertRunHistory,
} from "./utils/run-reports.js";
import { shortHash, slugify } from "./utils/slug.js";
import {
  excerptBySentences,
  htmlToText,
  normalizeArticleContent,
  normalizeParagraph,
  normalizeText,
  trimContent,
} from "./utils/text.js";
import { translateText } from "./utils/translation.js";

type FeedItem = Parser.Item & Record<string, unknown>;

interface ArticlePagePayload {
  content: string;
  imageUrls: string[];
}

interface SeenNewsIndex {
  version: 1;
  updated_at: string;
  keys: Record<string, string>;
}

interface KeyableNewsItem {
  title: string;
  url: string;
  published_date?: string;
}

const TRACKING_QUERY_KEYS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
  "source",
  "igshid",
]);

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }

  return out;
}

function readDateFromFeedItem(entry: FeedItem): string {
  const candidates = [entry.isoDate, entry.pubDate, entry.published, entry.updated];
  for (const candidate of candidates) {
    const iso = toIsoOrEmpty(candidate);
    if (iso) {
      return iso;
    }
  }
  return "";
}

function extractEntryText(item: FeedItem): string {
  const candidates: unknown[] = [
    item.content,
    item["content:encoded"],
    item.summary,
    item.contentSnippet,
    item.description,
  ];

  for (const candidate of candidates) {
    const text = normalizeArticleContent(htmlToText(candidate));
    if (text) {
      return text;
    }
  }

  return "";
}

function collectParagraphs(
  $: cheerio.CheerioAPI,
  selectors: string[],
): string[] {
  const paragraphs: string[] = [];

  for (const selector of selectors) {
    $(selector).each((_, element) => {
      if (paragraphs.length >= MAX_ARTICLE_PARAGRAPHS) {
        return false;
      }

      const paragraph = normalizeParagraph($(element).text());
      if (paragraph.length >= 60) {
        paragraphs.push(paragraph);
      }

      return undefined;
    });

    if (paragraphs.length >= 10) {
      break;
    }
  }

  return uniqueStrings(paragraphs).slice(0, MAX_ARTICLE_PARAGRAPHS);
}

function extractLongArticleContentFromHtml(html: string): string {
  if (!html) {
    return "";
  }

  const $ = cheerio.load(html);
  $("script, style, noscript").remove();

  const paragraphs = collectParagraphs($, [
    "article p",
    "main p",
    ".article p",
    ".post p",
    ".entry-content p",
    "p",
  ]);

  if (paragraphs.length === 0) {
    return "";
  }

  return normalizeArticleContent(paragraphs.join("\n\n"));
}

async function fetchArticlePayload(url: string): Promise<ArticlePagePayload> {
  const body = await fetchHtmlOrEmpty(url);
  if (!body) {
    return {
      content: "",
      imageUrls: [],
    };
  }

  return {
    content: extractLongArticleContentFromHtml(body),
    imageUrls: extractHtmlImageUrls(body),
  };
}

function selectBestContent(feedText: string, pageText: string): string {
  if (pageText.length > feedText.length) {
    return pageText;
  }
  return feedText;
}

function normalizeTitleForKey(title: string): string {
  return normalizeText(title)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalizeUrlForKey(rawUrl: string): string {
  const normalized = normalizeText(rawUrl);
  if (!normalized) {
    return "";
  }

  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.replace(/\/+$/g, "") || "/";
    const entries = [...parsed.searchParams.entries()]
      .filter(([key]) => !TRACKING_QUERY_KEYS.has(key.toLowerCase()))
      .sort(([aKey, aValue], [bKey, bValue]) => {
        if (aKey === bKey) {
          return aValue.localeCompare(bValue);
        }
        return aKey.localeCompare(bKey);
      });

    const cleanedParams = new URLSearchParams();
    for (const [key, value] of entries) {
      cleanedParams.append(key, value);
    }

    const query = cleanedParams.toString();
    return `${host}${pathname}${query ? `?${query}` : ""}`;
  } catch {
    return normalized.toLowerCase().replace(/\/+$/g, "");
  }
}

function collectNewsKeys(item: KeyableNewsItem): string[] {
  const keys: string[] = [];
  const canonicalUrl = canonicalizeUrlForKey(item.url);
  if (canonicalUrl) {
    keys.push(`u:${canonicalUrl}`);
  }

  const titleKey = normalizeTitleForKey(item.title);
  if (titleKey.length >= 16) {
    // Keep a title-only key to avoid cross-run repeats when a source does not
    // provide a stable publish timestamp and date shifts between scrapes.
    keys.push(`t:${titleKey}`);

    const dateKey = normalizeText(item.published_date ?? "");
    if (dateKey) {
      keys.push(`td:${titleKey}|${dateKey}`);
    }
  }

  return uniqueStrings(keys);
}

function itemQualityScore(item: CollectedNewsItem): number {
  const contentWeight = item.content.length;
  const imageWeight =
    (item.feed_image_candidates.length + item.article_image_candidates.length) * 100;
  const dateWeight = item.published_at ? 10 : 0;
  return contentWeight + imageWeight + dateWeight;
}

function pickBestDuplicate(
  current: CollectedNewsItem,
  candidate: CollectedNewsItem,
): CollectedNewsItem {
  if (itemQualityScore(candidate) > itemQualityScore(current)) {
    return candidate;
  }
  return current;
}

function dedupeItems(items: CollectedNewsItem[]): CollectedNewsItem[] {
  const deduped: CollectedNewsItem[] = [];
  const keyToIndex = new Map<string, number>();

  for (const item of items) {
    const keys = collectNewsKeys(item);
    let existingIndex = -1;

    for (const key of keys) {
      const index = keyToIndex.get(key);
      if (index !== undefined) {
        existingIndex = index;
        break;
      }
    }

    if (existingIndex === -1) {
      const nextIndex = deduped.push(item) - 1;
      for (const key of keys) {
        keyToIndex.set(key, nextIndex);
      }
      continue;
    }

    deduped[existingIndex] = pickBestDuplicate(deduped[existingIndex], item);
    for (const key of keys) {
      keyToIndex.set(key, existingIndex);
    }
  }

  return deduped;
}

function buildQuoteOnlyUkrainianRetelling(
  url: string,
  translatedContent: string,
): string {
  const normalized = normalizeArticleContent(translatedContent);
  const body = excerptBySentences(normalized, 6, 1400) || normalized;

  return [
    body,
    "",
    `Джерело: ${url}`,
  ].join("\n");
}

function shortErrorMessage(error: unknown): string {
  const value = normalizeText(String(error ?? ""));
  if (!value) {
    return "Unknown error";
  }
  return value.slice(0, 400);
}

export async function collectItems(
  sources: Source[],
  scrapedAt: string,
  verbose: boolean,
): Promise<CollectItemsResult> {
  const parser = new Parser();
  const allItems: CollectedNewsItem[] = [];
  const sourceReports: ResourceRunReport[] = [];

  for (const source of sources) {
    log(`Scraping ${source.id} - ${source.name}`, verbose);
    const sourceReport = createResourceRunReport(source);
    sourceReports.push(sourceReport);

    let feed: Parser.Output<FeedItem>;
    try {
      const xml = await fetchText(source.feedUrl);
      feed = (await parser.parseString(xml)) as Parser.Output<FeedItem>;
    } catch (error) {
      sourceReport.status = "failed";
      sourceReport.error = shortErrorMessage(error);
      log(`Failed to parse feed ${source.feedUrl}: ${sourceReport.error}`, verbose);
      continue;
    }

    const entries = Array.isArray(feed.items)
      ? feed.items.slice(0, source.maxItems)
      : [];
    sourceReport.feed_entries = entries.length;

    for (const entry of entries) {
      const title = normalizeText(entry.title ?? "");
      const url = normalizeText(entry.link ?? source.url);

      if (!title || !url) {
        continue;
      }

      const feedContent = extractEntryText(entry);
      const feedImageUrls = extractFeedImageUrls(entry as Record<string, unknown>);

      let articleContent = "";
      let articleImageUrls: string[] = [];

      const shouldFetchArticle =
        feedContent.length < MIN_ARTICLE_CHARS || feedImageUrls.length === 0;

      if (shouldFetchArticle) {
        const payload = await fetchArticlePayload(url);
        articleContent = payload.content;
        articleImageUrls = payload.imageUrls;
      }

      let content = selectBestContent(feedContent, articleContent);
      if (source.rightsFlag === "quote_only") {
        content = excerptBySentences(content, 10, 2200);
      }

      if (!content) {
        continue;
      }

      const publishedAt = readDateFromFeedItem(entry);

      allItems.push({
        source_id: source.id,
        title,
        content,
        url,
        source: source.source || source.name,
        published_at: publishedAt,
        published_date: toDateOnly(publishedAt, scrapedAt),
        published_time: toTimeOnly(publishedAt, scrapedAt),
        rights_flag: source.rightsFlag,
        license_text: source.licenseText,
        feed_image_candidates: feedImageUrls,
        article_image_candidates: articleImageUrls,
      });
    }
  }

  const dedupedItems = dedupeItems(allItems);
  const reports = finalizeCollectedResourceReports(sourceReports, dedupedItems);

  return {
    items: dedupedItems,
    source_reports: reports,
  };
}

export async function translateItems(
  items: CollectedNewsItem[],
  options: TranslateItemsOptions,
): Promise<CollectedNewsItem[]> {
  const {
    translationEnabled,
    targetLanguage,
    maxContentChars,
    verbose,
  } = options;

  if (!translationEnabled) {
    return items.map((item) => ({
      ...item,
      title: normalizeText(item.title),
      content: trimContent(normalizeArticleContent(item.content), maxContentChars),
    }));
  }

  const translated: CollectedNewsItem[] = [];
  for (const item of items) {
    log(`Translating: ${item.title.slice(0, 80)}`, verbose);

    const translatedTitle = await translateText(
      item.title,
      targetLanguage,
      true,
      verbose,
    );

    const translatedContent = await translateText(
      item.content,
      targetLanguage,
      true,
      verbose,
    );

    let content = normalizeArticleContent(translatedContent);
    if (targetLanguage.toLowerCase() === "uk" && item.rights_flag === "quote_only") {
      content = buildQuoteOnlyUkrainianRetelling(item.url, content);
    }

    translated.push({
      ...item,
      title: normalizeText(translatedTitle),
      content: trimContent(content, maxContentChars),
    });
  }

  return translated;
}

function toRelativePath(targetPath: string): string {
  return path.relative(process.cwd(), targetPath).replace(/\\/g, "/");
}

function emptySeenNewsIndex(scrapedAt: string): SeenNewsIndex {
  return {
    version: 1,
    updated_at: scrapedAt,
    keys: {},
  };
}

function isSeenNewsIndex(value: unknown): value is SeenNewsIndex {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) {
    return false;
  }

  if (typeof raw.updated_at !== "string") {
    return false;
  }

  if (typeof raw.keys !== "object" || raw.keys === null) {
    return false;
  }

  return true;
}

async function readJsonFileSafe<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw.replace(/^\uFEFF/, "")) as T;
  } catch {
    return null;
  }
}

function seedSeenKeysFromNewsItems(
  newsItems: KeyableNewsItem[],
  scrapedAt: string,
): Record<string, string> {
  const keys: Record<string, string> = {};

  for (const item of newsItems) {
    for (const key of collectNewsKeys(item)) {
      keys[key] = scrapedAt;
    }
  }

  return keys;
}

async function loadSeenNewsIndex(
  indexPath: string,
  outputPath: string,
  scrapedAt: string,
  verbose: boolean,
): Promise<SeenNewsIndex> {
  const indexFromFile = await readJsonFileSafe<unknown>(indexPath);
  if (isSeenNewsIndex(indexFromFile)) {
    return indexFromFile;
  }

  const seeded = emptySeenNewsIndex(scrapedAt);
  const snapshot = await readJsonFileSafe<NewsItem[]>(outputPath);
  if (!Array.isArray(snapshot) || snapshot.length === 0) {
    return seeded;
  }

  const snapshotKeys = seedSeenKeysFromNewsItems(snapshot, scrapedAt);
  seeded.keys = snapshotKeys;
  log(
    `Initialized seen index from current snapshot (${Object.keys(snapshotKeys).length} keys)`,
    verbose,
  );

  return seeded;
}

function filterAlreadySeenItems(
  items: CollectedNewsItem[],
  seenIndex: SeenNewsIndex,
  scrapedAt: string,
): { freshItems: CollectedNewsItem[]; skippedCount: number } {
  const freshItems: CollectedNewsItem[] = [];
  let skippedCount = 0;

  for (const item of items) {
    const keys = collectNewsKeys(item);
    const alreadySeen = keys.some((key) => typeof seenIndex.keys[key] === "string");
    if (alreadySeen) {
      skippedCount += 1;
      continue;
    }

    freshItems.push(item);
    for (const key of keys) {
      seenIndex.keys[key] = scrapedAt;
    }
  }

  return {
    freshItems,
    skippedCount,
  };
}

function mergeUniqueNewsItems(
  existingItems: NewsItem[],
  newItems: NewsItem[],
): NewsItem[] {
  const merged: NewsItem[] = [];
  const seenKeys = new Set<string>();

  for (const item of [...newItems, ...existingItems]) {
    const keys = collectNewsKeys(item);
    if (keys.some((key) => seenKeys.has(key))) {
      continue;
    }

    merged.push(item);
    for (const key of keys) {
      seenKeys.add(key);
    }
  }

  return merged;
}

async function saveArticleFileSet(item: NewsItem, articleDir: string): Promise<void> {
  await fs.writeFile(
    path.join(articleDir, "article.json"),
    `${JSON.stringify(item, null, 2)}\n`,
    "utf8",
  );

  await fs.writeFile(
    path.join(articleDir, "article.md"),
    renderArticleMarkdown(item),
    "utf8",
  );
}

export async function saveOutput(
  items: CollectedNewsItem[],
  outputPath: string,
  scrapedAt: string,
  sourceReports: ResourceRunReport[],
  verbose: boolean,
): Promise<RunSummary> {
  const outputDir = path.dirname(outputPath);
  const runId = createRunId(scrapedAt);
  const runDir = path.join(outputDir, "runs", runId);
  const seenIndexPath = path.join(outputDir, "seen_news_index.json");
  await fs.mkdir(runDir, { recursive: true });

  const seenIndex = await loadSeenNewsIndex(
    seenIndexPath,
    outputPath,
    scrapedAt,
    verbose,
  );
  const { freshItems, skippedCount } = filterAlreadySeenItems(
    items,
    seenIndex,
    scrapedAt,
  );
  if (skippedCount > 0) {
    log(`Skipped ${skippedCount} duplicate/already-seen items`, verbose);
  }

  const savedItems: NewsItem[] = [];
  const usedFolderNames = new Set<string>();
  const usedWikimediaPhotoUrls = new Set<string>();

  for (const item of freshItems) {
    const id = shortHash(item.url);
    const baseFolderName = `${slugify(item.title, 56)}-${id}`;

    let folderName = baseFolderName;
    let suffix = 1;
    while (usedFolderNames.has(folderName)) {
      folderName = `${baseFolderName}-${suffix}`;
      suffix += 1;
    }
    usedFolderNames.add(folderName);

    const articleDir = path.join(runDir, folderName);
    await fs.mkdir(articleDir, { recursive: true });

    const photoCandidates = await resolvePhotoCandidates(
      item.title,
      item.feed_image_candidates,
      item.article_image_candidates,
      {
        onlyPublicDomain: item.rights_flag === "quote_only",
        contextUrl: item.url,
        excludeUrls: [...usedWikimediaPhotoUrls],
      },
    );

    let photos = await downloadPhotoCandidates(photoCandidates, articleDir);
    if (photos.length === 0) {
      const fallbackPublicCandidates = await resolvePhotoCandidates(
        item.title,
        [],
        [],
        {
          onlyPublicDomain: true,
          fallbackToGenericIfEmpty: true,
          contextUrl: item.url,
          excludeUrls: [...usedWikimediaPhotoUrls],
        },
      );
      photos = await downloadPhotoCandidates(fallbackPublicCandidates, articleDir);
      if (photos.length > 0) {
        log(`Found fallback free image for: ${item.title.slice(0, 80)}`, verbose);
      }
    }

    for (const photo of photos) {
      if (photo.provider === "wikimedia") {
        usedWikimediaPhotoUrls.add(photo.source_url);
      }
    }

    const saved: NewsItem = {
      id,
      source_id: item.source_id,
      title: item.title,
      content: item.content,
      url: item.url,
      source: item.source,
      published_at: item.published_at,
      published_date: item.published_date,
      published_time: item.published_time,
      scraped_at: scrapedAt,
      article_path: toRelativePath(articleDir),
      rights_flag: item.rights_flag,
      license_text: item.license_text,
      photos,
    };

    await saveArticleFileSet(saved, articleDir);
    savedItems.push(saved);
  }

  const previousSnapshot = await readJsonFileSafe<NewsItem[]>(outputPath);
  const mergedSnapshot = mergeUniqueNewsItems(
    Array.isArray(previousSnapshot) ? previousSnapshot : [],
    savedItems,
  );

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(mergedSnapshot, null, 2)}\n`, "utf8");
  await fs.writeFile(
    path.join(runDir, "news.json"),
    `${JSON.stringify(savedItems, null, 2)}\n`,
    "utf8",
  );

  const sourceReportsWithFreshItems = applyFreshItemCountsToReports(
    sourceReports,
    savedItems,
  );
  const resourceTotals = computeResourceTotals(sourceReportsWithFreshItems);

  const summary: RunSummary = {
    run_id: runId,
    run_path: toRelativePath(runDir),
    generated_at: scrapedAt,
    total_items: savedItems.length,
    collected_items: items.length,
    skipped_seen_items: skippedCount,
    resource_totals: resourceTotals,
    source_reports: sourceReportsWithFreshItems,
  };

  await fs.writeFile(
    path.join(runDir, "run_summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(outputDir, "latest_run.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );

  const runHistoryPath = path.join(outputDir, "run_history.json");
  const runHistoryRaw = await readJsonFileSafe<unknown>(runHistoryPath);
  const runHistory: RunHistorySnapshot = normalizeRunHistorySnapshot(
    runHistoryRaw,
    scrapedAt,
  );
  const updatedRunHistory = upsertRunHistory(runHistory, summary, scrapedAt);
  await fs.writeFile(
    runHistoryPath,
    `${JSON.stringify(updatedRunHistory, null, 2)}\n`,
    "utf8",
  );

  const dailyHealth = buildDailyHealthSnapshot(updatedRunHistory.runs, scrapedAt);
  await fs.writeFile(
    path.join(outputDir, "daily_health.json"),
    `${JSON.stringify(dailyHealth, null, 2)}\n`,
    "utf8",
  );

  seenIndex.updated_at = scrapedAt;
  await fs.writeFile(
    seenIndexPath,
    `${JSON.stringify(seenIndex, null, 2)}\n`,
    "utf8",
  );

  if (resourceTotals.failed_resources > 0) {
    log(`Resources failed in run: ${resourceTotals.failed_resources}`, verbose);
  }
  log(`Run saved to ${summary.run_path}`, verbose);
  return summary;
}
