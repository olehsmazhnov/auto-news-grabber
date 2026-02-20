import type { CollectedNewsItem, NewsItem } from "../types.js";
import { normalizeText } from "../utils/text.js";

export interface KeyableNewsItem {
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

export function collectNewsKeys(item: KeyableNewsItem): string[] {
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

export function dedupeItems(items: CollectedNewsItem[]): CollectedNewsItem[] {
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

export function mergeUniqueNewsItems(
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
