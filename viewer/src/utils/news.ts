import type { CardRenderData, NewsItem, ResourceReport, ResourceTotals, RunSummary } from "../types";
import { publishedTimestamp, parseIsoTimestampOrZero } from "./date";
import { sanitizeContentForDisplay, excerpt, extractSourceReference } from "./content";
import { classifyArticleInterest } from "./interest";
import { safeNumber } from "./scrape-status";

export function cardImage(item: NewsItem): string | null {
    if (!Array.isArray(item.photos) || item.photos.length === 0) {
        return null;
    }

    const first = item.photos[0];
    if (!first?.local_path) {
        return null;
    }

    return `/${first.local_path}`;
}

export function isHttpUrl(value: string | undefined): boolean {
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

export function runTotals(run: RunSummary | null): ResourceTotals {
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

export function failedRunResources(run: RunSummary | null): ResourceReport[] {
    if (!run || !Array.isArray(run.source_reports)) {
        return [];
    }

    return run.source_reports.filter((report) => report.status === "failed");
}

export function sortNewsNewestFirst(items: NewsItem[]): NewsItem[] {
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

export function articlePrimaryTimestamp(item: NewsItem): number {
    const published = publishedTimestamp(item);
    if (published > 0) {
        return published;
    }
    return parseIsoTimestampOrZero(item.scraped_at);
}

export function buildCardRenderData(
    item: NewsItem,
    expandedItemIds: Set<string>,
    excerptMaxChars = 360,
): CardRenderData {
    const sourceReference = extractSourceReference(item.content);
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
        sourceReference,
    };
}
