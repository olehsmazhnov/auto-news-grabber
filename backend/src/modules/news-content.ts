import * as cheerio from "cheerio";
import Parser from "rss-parser";
import {
  MAX_ARTICLE_PARAGRAPHS,
} from "../constants.js";
import { fetchHtmlOrEmpty } from "../utils/http.js";
import { extractHtmlImageUrls } from "../utils/photos.js";
import {
  excerptBySentences,
  htmlToText,
  normalizeArticleContent,
  normalizeParagraph,
  normalizeText,
} from "../utils/text.js";
import { toIsoOrEmpty } from "../utils/date.js";

export type FeedItem = Parser.Item & Record<string, unknown>;

export interface ArticlePagePayload {
  title: string;
  content: string;
  imageUrls: string[];
}

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

function toAbsoluteHttpUrl(url: string, baseUrl: string): string {
  const normalized = normalizeText(url);
  if (!normalized || normalized.startsWith("#")) {
    return "";
  }
  if (normalized.startsWith("javascript:") || normalized.startsWith("mailto:")) {
    return "";
  }

  try {
    return new URL(normalized, baseUrl).toString();
  } catch {
    return "";
  }
}

function looksLikeArticleUrl(url: string): boolean {
  const normalized = url.toLowerCase();
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    return false;
  }

  if (normalized.includes("/newsroom/pressrelease/")) {
    return true;
  }
  if (normalized.includes("/newsroom/stories/")) {
    return true;
  }
  if (normalized.includes("/news/")) {
    return true;
  }
  if (normalized.includes("/press-release") || normalized.includes("/pressrelease")) {
    return true;
  }

  if (/[_-]\d{5,}\.html?$/u.test(normalized)) {
    return true;
  }
  if (/\/\d{4}\/\d{2}\//u.test(normalized)) {
    return true;
  }

  return false;
}

function normalizeListingTitle(rawTitle: string): string {
  const normalized = normalizeText(rawTitle);
  if (!normalized) {
    return "";
  }

  const lowValueTitles = new Set([
    "more",
    "read more",
    "details",
    "weiter",
    "mehr",
    "learn more",
  ]);
  if (lowValueTitles.has(normalized.toLowerCase())) {
    return "";
  }

  if (normalized.length < 14) {
    return "";
  }

  return normalized;
}

export function extractFeedLikeItemsFromHtmlListing(
  html: string,
  baseUrl: string,
  maxItems: number,
): FeedItem[] {
  if (!html) {
    return [];
  }

  const $ = cheerio.load(html);
  const seenUrls = new Set<string>();
  const items: FeedItem[] = [];
  const safeMaxItems = Math.max(1, maxItems);

  $("a[href]").each((_, element) => {
    if (items.length >= safeMaxItems) {
      return false;
    }

    const href = $(element).attr("href") ?? "";
    const url = toAbsoluteHttpUrl(href, baseUrl);
    if (!url || !looksLikeArticleUrl(url)) {
      return undefined;
    }

    if (seenUrls.has(url)) {
      return undefined;
    }
    seenUrls.add(url);

    const title = normalizeListingTitle($(element).text());
    items.push({
      title,
      link: url,
    } as FeedItem);

    return undefined;
  });

  return items;
}

export function readDateFromFeedItem(entry: FeedItem): string {
  const candidates = [entry.isoDate, entry.pubDate, entry.published, entry.updated];
  for (const candidate of candidates) {
    const iso = toIsoOrEmpty(candidate);
    if (iso) {
      return iso;
    }
  }
  return "";
}

export function extractEntryText(item: FeedItem): string {
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

function extractArticleTitleFromHtml(html: string): string {
  if (!html) {
    return "";
  }

  const $ = cheerio.load(html);
  const rawTitle = normalizeText(
    $("meta[property='og:title']").attr("content")
    || $("meta[name='twitter:title']").attr("content")
    || $("article h1").first().text()
    || $("main h1").first().text()
    || $("h1").first().text()
    || $("title").first().text()
    || "",
  );
  if (!rawTitle) {
    return "";
  }

  return normalizeText(
    rawTitle
      .replace(/\s+[|–-]\s+[^|–-]{2,60}$/u, "")
      .trim(),
  );
}

export async function fetchArticlePayload(url: string): Promise<ArticlePagePayload> {
  const body = await fetchHtmlOrEmpty(url);
  if (!body) {
    return {
      title: "",
      content: "",
      imageUrls: [],
    };
  }

  return {
    title: extractArticleTitleFromHtml(body),
    content: extractLongArticleContentFromHtml(body),
    imageUrls: extractHtmlImageUrls(body),
  };
}

export function selectBestContent(feedText: string, pageText: string): string {
  if (pageText.length > feedText.length) {
    return pageText;
  }
  return feedText;
}

export function buildQuoteOnlyUkrainianRetelling(
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

export function shortErrorMessage(error: unknown): string {
  const value = normalizeText(String(error ?? ""));
  if (!value) {
    return "Unknown error";
  }
  return value.slice(0, 400);
}
