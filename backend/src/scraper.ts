import fs from "node:fs/promises";
import path from "node:path";
import Parser from "rss-parser";
import {
  MIN_ARTICLE_CHARS,
} from "./constants.js";
import type {
  CollectItemsProgressHandler,
  CollectItemsResult,
  CollectedNewsItem,
  NewsItem,
  RunSummary,
  RunHistorySnapshot,
  ResourceRunReport,
  Source,
  TranslateItemsProgressHandler,
  TranslateItemsOptions,
} from "./types.js";
import { createRunId, toDateOnly, toTimeOnly } from "./utils/date.js";
import { fetchText } from "./utils/http.js";
import { log } from "./utils/log.js";
import {
  downloadPhotoCandidates,
  extractFeedImageUrls,
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
import { shortHash } from "./utils/slug.js";
import {
  excerptBySentences,
  normalizeArticleContent,
  normalizeText,
  trimContent,
} from "./utils/text.js";
import { formatPostTranslationContent } from "./utils/post-translation-format.js";
import { translateText } from "./utils/translation.js";
import {
  createUniqueArticleFolderName,
  saveArticleFileSet,
  toRelativePath,
} from "./modules/output-storage.js";
import {
  buildQuoteOnlyUkrainianRetelling,
  extractEntryText,
  fetchArticlePayload,
  readDateFromFeedItem,
  selectBestContent,
  shortErrorMessage,
  type FeedItem,
} from "./modules/news-content.js";
import {
  dedupeItems,
  mergeUniqueNewsItems,
} from "./modules/news-item-keys.js";
import {
  filterAlreadySeenItems,
  loadSeenNewsIndex,
  readJsonFileSafe,
} from "./modules/seen-news-index.js";

function reportCollectProgress(
  handler: CollectItemsProgressHandler | undefined,
  totalSources: number,
  completedSources: number,
  currentSourceId: string,
  currentSourceName: string,
): void {
  if (!handler) {
    return;
  }

  handler({
    total_sources: totalSources,
    completed_sources: completedSources,
    current_source_id: currentSourceId,
    current_source_name: currentSourceName,
  });
}

function reportTranslateProgress(
  handler: TranslateItemsProgressHandler | undefined,
  totalItems: number,
  completedItems: number,
  currentItemTitle: string,
): void {
  if (!handler) {
    return;
  }

  handler({
    total_items: totalItems,
    completed_items: completedItems,
    current_item_title: currentItemTitle,
  });
}

export async function collectItems(
  sources: Source[],
  scrapedAt: string,
  verbose: boolean,
  onProgress?: CollectItemsProgressHandler,
): Promise<CollectItemsResult> {
  const parser = new Parser();
  const allItems: CollectedNewsItem[] = [];
  const sourceReports: ResourceRunReport[] = [];
  const totalSources = sources.length;
  let completedSources = 0;

  for (const source of sources) {
    reportCollectProgress(
      onProgress,
      totalSources,
      completedSources,
      source.id,
      source.name,
    );

    log(`Scraping ${source.id} - ${source.name}`, verbose);
    const sourceReport = createResourceRunReport(source);
    sourceReports.push(sourceReport);

    try {
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
    } finally {
      completedSources += 1;
      reportCollectProgress(
        onProgress,
        totalSources,
        completedSources,
        source.id,
        source.name,
      );
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
    onProgress,
  } = options;
  const totalItems = items.length;
  let completedItems = 0;

  if (!translationEnabled) {
    reportTranslateProgress(onProgress, totalItems, totalItems, "");
    return items.map((item) => ({
      ...item,
      title: normalizeText(item.title),
      content: trimContent(normalizeArticleContent(item.content), maxContentChars),
    }));
  }

  const translated: CollectedNewsItem[] = [];
  reportTranslateProgress(onProgress, totalItems, 0, "");
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

    let content = formatPostTranslationContent(
      normalizeArticleContent(translatedContent),
    );
    if (targetLanguage.toLowerCase() === "uk" && item.rights_flag === "quote_only") {
      content = buildQuoteOnlyUkrainianRetelling(item.url, content);
    }

    translated.push({
      ...item,
      title: normalizeText(translatedTitle),
      content: trimContent(content, maxContentChars),
    });

    completedItems += 1;
    reportTranslateProgress(onProgress, totalItems, completedItems, item.title);
  }

  return translated;
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
    const itemId = shortHash(item.url);
    const folderName = createUniqueArticleFolderName(item.title, item.url, usedFolderNames);
    const articleDir = path.join(runDir, folderName);
    await fs.mkdir(articleDir, { recursive: true });

    const photoCandidates = await resolvePhotoCandidates(
      item.title,
      item.feed_image_candidates,
      item.article_image_candidates,
      {
        onlyPublicDomain: item.rights_flag === "quote_only",
        contextUrl: item.url,
        contextText: item.content,
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
          contextText: item.content,
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
      id: itemId,
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
