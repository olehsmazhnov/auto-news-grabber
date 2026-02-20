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

export async function fetchArticlePayload(url: string): Promise<ArticlePagePayload> {
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
