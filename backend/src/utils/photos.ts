import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import { MAX_IMAGES_PER_NEWS } from "../constants.js";
import type { PhotoAsset } from "../types.js";
import { fetchBinaryImage, fetchText, isHttpUrl } from "./http.js";

interface PhotoCandidate {
  url: string;
  provider: "feed" | "article" | "wikimedia";
  license: string;
  credit: string;
  attributionUrl: string;
}

interface ResolvePhotoOptions {
  onlyPublicDomain?: boolean;
  fallbackToGenericIfEmpty?: boolean;
  contextUrl?: string;
  contextText?: string;
  excludeUrls?: string[];
}

const WIKIMEDIA_CANDIDATE_LIMIT = MAX_IMAGES_PER_NEWS * 4;
const EXTENDED_WIKIMEDIA_CANDIDATE_LIMIT = Math.max(WIKIMEDIA_CANDIDATE_LIMIT * 3, 24);
const CONTENT_TOKEN_CHAR_LIMIT = 3_500;
const CONTENT_SIGNAL_TOKEN_LIMIT = 14;
const WIKIMEDIA_SEARCH_RETRY_ATTEMPTS = 3;
const WIKIMEDIA_SEARCH_RETRY_BASE_DELAY_MS = 350;
const GENERIC_WIKIMEDIA_FALLBACK_QUERIES = [
  "automobile",
  "car",
  "sport utility vehicle",
  "electric car",
  "pickup truck",
];

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "when",
  "your",
  "into",
  "new",
  "news",
  "day",
  "first",
  "things",
  "check",
  "car",
  "cars",
  "deal",
  "month",
  "returns",
  "interior",
  "image",
  "gallery",
  "best",
  "take",
  "takes",
  "promises",
  "levels",
  "efficiency",
  "media",
  "advisory",
  "announce",
  "results",
  "press",
  "release",
  "releases",
  "report",
  "reports",
  "reported",
  "estimated",
  "consolidated",
  "shipments",
  "units",
  "full",
  "year",
  "quarter",
  "q1",
  "q2",
  "q3",
  "q4",
  "fiscal",
  "resets",
  "business",
  "meet",
  "customer",
  "customers",
  "preference",
  "preferences",
  "support",
  "profitable",
  "growth",
  "strategy",
  "strategic",
  "operations",
  "global",
  "group",
  "company",
  "companies",
  "official",
  "statement",
  "its",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "jan",
  "feb",
  "mar",
  "apr",
  "jun",
  "jul",
  "aug",
  "sep",
  "sept",
  "oct",
  "nov",
  "dec",
]);

const AUTO_BRANDS = new Set([
  "toyota",
  "stellantis",
  "kia",
  "hyundai",
  "peugeot",
  "ram",
  "nissan",
  "ford",
  "jeep",
  "honda",
  "bmw",
  "audi",
  "mercedes",
  "volkswagen",
  "porsche",
  "mazda",
  "subaru",
  "volvo",
  "renault",
  "citroen",
  "opel",
  "fiat",
  "maserati",
  "chrysler",
  "dodge",
  "lamborghini",
  "ferrari",
  "bugatti",
  "mclaren",
  "bentley",
  "rolls",
  "royce",
  "rolls-royce",
  "aston",
  "martin",
  "koenigsegg",
  "pagani",
  "rimac",
  "lotus",
  "alfa",
  "romeo",
  "mansory",
  "tesla",
  "polestar",
]);

const AUTO_CONTEXT_TOKENS = new Set([
  "car",
  "cars",
  "engine",
  "hybrid",
  "suv",
  "truck",
  "vehicle",
  "motorcycle",
  "motorbike",
  "bike",
  "motorsport",
  "motorsports",
  "racing",
  "race",
  "museum",
  "sedan",
  "hatchback",
  "coupe",
  "wagon",
  "crossover",
  "horsepower",
  "torque",
  "diesel",
  "petrol",
  "ev",
  "electric",
  "auto",
  "automotive",
  "automobile",
  "automobiles",
  "robotaxi",
  "autonomous",
  "traffic",
  "fuel",
  "oil",
  "price",
  "avto",
  "avtomobil",
  "avtomobile",
  "avtorynok",
  "avtorynka",
  "autorynok",
  "autorynka",
  "sprit",
  "spritpreis",
  "kraftstoff",
  "benzin",
  "tankstelle",
  "verkehr",
  "авто",
  "автомобіль",
  "автомобілі",
  "авторинок",
  "авторинку",
  "пальне",
  "нафта",
  "бензин",
  "дизель",
  "supercar",
  "hypercar",
]);

const AUTO_TUNERS = new Set([
  "mansory",
  "novitec",
  "brabus",
  "abt",
  "alpina",
]);

const AUTOMOTIVE_VISUAL_HINTS = [
  ...AUTO_BRANDS,
  "car",
  "cars",
  "vehicle",
  "vehicles",
  "automobile",
  "automobiles",
  "suv",
  "truck",
  "pickup",
  "sedan",
  "hatchback",
  "coupe",
  "wagon",
  "crossover",
  "motorcycle",
  "motorbike",
  "bike",
  "motorsport",
  "motorsports",
  "racing",
  "race",
  "supercar",
  "hypercar",
  "fuel",
  "petrol",
  "diesel",
  "gasoline",
  "tankstelle",
  "filling_station",
  "gas_station",
  "pump",
];

const GENERIC_VEHICLE_HINTS = [
  "car",
  "cars",
  "vehicle",
  "vehicles",
  "automobile",
  "automobiles",
  "auto",
  "suv",
  "truck",
  "pickup",
  "sedan",
  "hatchback",
  "coupe",
  "wagon",
  "crossover",
  "motorcycle",
  "motorbike",
  "bike",
  "motorsport",
  "racing",
];

const NON_PHOTO_HINTS = [
  "chart",
  "graph",
  "diagram",
  "table",
  "logo",
  "icon",
  "map",
  "screenshot",
  "render",
  "illustration",
  "infographic",
  "watermark",
  "sales_of",
  "sales-of",
  "sales ",
  "figure_",
  "income",
  "net_income",
  "marketcap",
  "market_cap",
  "stock_price",
  "gare",
  "plaque",
  "inaugurale",
  "badge",
  "signature",
];

const AUTOMOTIVE_INTENT_PATTERNS: RegExp[] = [
  /(?:^|[^a-z])(auto|avto|car|cars|vehicle|vehicles|suv|truck|pickup|motor|diesel|petrol|fuel|oil|benzin|sprit|verkehr)(?:[^a-z]|$)/u,
  /(?:авто|автомоб|авторин|пальн|нафт|бензин|дизел)/u,
];

function uniqueHttpUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of urls) {
    const normalized = value.toLowerCase();
    const decorative =
      normalized.includes("logo") ||
      normalized.includes("icon") ||
      normalized.includes("avatar") ||
      normalized.includes("favicon") ||
      normalized.includes("sprite") ||
      normalized.includes("watermark");

    if (decorative) {
      continue;
    }

    if (!isHttpUrl(value)) {
      continue;
    }
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }

  return out;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === null || value === undefined) {
    return [];
  }
  return [value];
}

function readNestedString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value === "string") {
    return value;
  }
  return "";
}

function extractFromStructuredMedia(value: unknown): string[] {
  const entries = toArray(value);
  const urls: string[] = [];

  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }

    const raw = entry as Record<string, unknown>;
    const directUrl = readNestedString(raw, "url");
    if (directUrl) {
      urls.push(directUrl);
    }

    const attrs = raw.$;
    if (typeof attrs === "object" && attrs !== null) {
      const attrUrl = readNestedString(attrs as Record<string, unknown>, "url");
      if (attrUrl) {
        urls.push(attrUrl);
      }
    }
  }

  return urls;
}

export function extractFeedImageUrls(item: Record<string, unknown>): string[] {
  const urls: string[] = [];

  const enclosure = item.enclosure;
  if (typeof enclosure === "object" && enclosure !== null) {
    const enclosureUrl = readNestedString(enclosure as Record<string, unknown>, "url");
    if (enclosureUrl) {
      urls.push(enclosureUrl);
    }
  }

  for (const candidate of toArray(item.enclosures)) {
    if (typeof candidate !== "object" || candidate === null) {
      continue;
    }
    const link = readNestedString(candidate as Record<string, unknown>, "url");
    const type = readNestedString(candidate as Record<string, unknown>, "type");
    if (link && (!type || type.startsWith("image/"))) {
      urls.push(link);
    }
  }

  urls.push(...extractFromStructuredMedia(item["media:content"]));
  urls.push(...extractFromStructuredMedia(item["media:thumbnail"]));
  urls.push(...extractFromStructuredMedia(item.mediaContent));

  return uniqueHttpUrls(urls);
}

export function extractHtmlImageUrls(html: string): string[] {
  if (!html) {
    return [];
  }

  const $ = cheerio.load(html);
  const urls: string[] = [];

  const metaKeys = [
    "meta[property='og:image']",
    "meta[property='og:image:url']",
    "meta[name='twitter:image']",
    "meta[name='twitter:image:src']",
  ];

  for (const selector of metaKeys) {
    const value = $(selector).attr("content");
    if (value) {
      urls.push(value);
    }
  }

  $("article img, main img, img").each((_, element) => {
    if (urls.length >= 12) {
      return false;
    }

    const src = $(element).attr("src") || $(element).attr("data-src");
    if (src) {
      urls.push(src);
    }

    return undefined;
  });

  return uniqueHttpUrls(urls);
}

function stripMarkup(input: string): string {
  const $ = cheerio.load(input);
  return $.text().replace(/\s+/g, " ").trim();
}

function firstDefinedString(values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function extractSearchTokens(title: string): string[] {
  const rawTokens = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  const seen = new Set<string>();
  const tokens: string[] = [];

  for (const token of rawTokens) {
    const hasDigit = /\d/.test(token);
    if (/^\d{4}$/.test(token)) {
      const maybeYear = Number.parseInt(token, 10);
      if (maybeYear >= 1900 && maybeYear <= 2100) {
        continue;
      }
    }
    if (/^\d+$/.test(token) && token.length < 4) {
      continue;
    }
    if (!hasDigit && token.length < 3) {
      continue;
    }
    if (STOP_WORDS.has(token)) {
      continue;
    }
    if (seen.has(token)) {
      continue;
    }

    seen.add(token);
    tokens.push(token);

    if (tokens.length >= 20) {
      break;
    }
  }

  return tokens;
}

function extractSearchTokensFromUrl(contextUrl: string): string[] {
  if (!isHttpUrl(contextUrl)) {
    return [];
  }

  try {
    const parsed = new URL(contextUrl);
    const pathText = decodeURIComponent(parsed.pathname).replace(/[-_/]+/g, " ");
    return extractSearchTokens(pathText);
  } catch {
    return [];
  }
}

function extractSearchTokensFromContent(contextText: string): string[] {
  if (!contextText) {
    return [];
  }

  const normalized = contextText.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  const truncated = normalized.slice(0, CONTENT_TOKEN_CHAR_LIMIT);
  const rawTokens = extractSearchTokens(truncated);
  const prioritized = prioritizeSearchTokens(rawTokens);

  return uniqueStrings(
    prioritized.filter((token) =>
      AUTO_BRANDS.has(token)
      || AUTO_CONTEXT_TOKENS.has(token)
      || isLikelyModelToken(token)
      || /[a-z0-9]/i.test(token)
    ),
  ).slice(0, CONTENT_SIGNAL_TOKEN_LIMIT);
}

function expandSearchTokenVariants(token: string): string[] {
  const variants = new Set<string>([token]);

  if (token.length >= 6 && token.endsWith("ogo")) {
    const stem = token.slice(0, -3);
    variants.add(`${stem}yi`);
    variants.add(`${stem}yy`);
    variants.add(`${stem}y`);
  }

  if (token.length >= 6 && (token.endsWith("yi") || token.endsWith("yy"))) {
    const stem = token.slice(0, -2);
    variants.add(`${stem}ogo`);
  }

  return [...variants].filter((value) => value.length >= 3);
}

function expandSearchTokens(tokens: string[]): string[] {
  const expanded: string[] = [];
  for (const token of tokens) {
    expanded.push(token, ...expandSearchTokenVariants(token));
  }
  return uniqueStrings(expanded);
}

function isLikelyYearToken(token: string): boolean {
  if (!/^\d{4}$/.test(token)) {
    return false;
  }
  const maybeYear = Number.parseInt(token, 10);
  return maybeYear >= 1900 && maybeYear <= 2100;
}

function isLikelyModelToken(token: string): boolean {
  if (!token || AUTO_BRANDS.has(token) || AUTO_CONTEXT_TOKENS.has(token)) {
    return false;
  }

  if (STOP_WORDS.has(token)) {
    return false;
  }

  const hasDigit = /\d/.test(token);
  const hasLetter = /[\p{L}]/u.test(token);
  if (hasDigit) {
    if (isLikelyYearToken(token)) {
      return false;
    }
    if (/^\d+$/.test(token)) {
      return token.length <= 4;
    }
    return true;
  }

  // Model names like revuelto/mustang/cullinan should be treated as model tokens.
  // Keep this latin-only to avoid matching translated function words.
  if (hasLetter && /[a-z]/i.test(token) && token.length >= 4) {
    return true;
  }

  return false;
}

function prioritizeSearchTokens(tokens: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const buckets: string[][] = [
    tokens.filter((token) => AUTO_BRANDS.has(token)),
    tokens.filter(
      (token) =>
        isLikelyModelToken(token) &&
        !AUTO_BRANDS.has(token),
    ),
    tokens.filter((token) => AUTO_CONTEXT_TOKENS.has(token)),
    tokens,
  ];

  for (const bucket of buckets) {
    for (const token of bucket) {
      if (!token || seen.has(token)) {
        continue;
      }
      seen.add(token);
      ordered.push(token);
    }
  }

  return ordered;
}

function selectSignalTokens(tokens: string[], maxTokens: number): string[] {
  return uniqueStrings(
    [...tokens]
      .filter(
        (token) =>
          token.length >= 4 &&
          !STOP_WORDS.has(token) &&
          !AUTO_CONTEXT_TOKENS.has(token),
      )
      .sort((a, b) => b.length - a.length),
  ).slice(0, maxTokens);
}

function hasAutomotiveIntent(
  title: string,
  contextUrl: string,
  contextText: string,
  searchTokens: string[],
): boolean {
  if (searchTokens.some((token) => AUTO_BRANDS.has(token) || AUTO_CONTEXT_TOKENS.has(token))) {
    return true;
  }

  let decodedPath = "";
  if (isHttpUrl(contextUrl)) {
    try {
      decodedPath = decodeURIComponent(new URL(contextUrl).pathname);
    } catch {
      decodedPath = "";
    }
  }

  const normalizedContextText = contextText
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, CONTENT_TOKEN_CHAR_LIMIT);
  const rawContext = `${title} ${contextUrl} ${decodedPath} ${normalizedContextText}`.toLowerCase();
  return AUTOMOTIVE_INTENT_PATTERNS.some((pattern) => pattern.test(rawContext));
}

function createFallbackWikimediaQueries(searchTokens: string[]): string[] {
  const brandTokens = searchTokens.filter((token) => AUTO_BRANDS.has(token));
  const modelTokens = searchTokens.filter((token) => isLikelyModelToken(token));
  const contextTokens = searchTokens.filter((token) => AUTO_CONTEXT_TOKENS.has(token));
  const neutralTokens = searchTokens.filter(
    (token) =>
      !AUTO_BRANDS.has(token) &&
      !AUTO_CONTEXT_TOKENS.has(token) &&
      token.length >= 4 &&
      !/^\d+$/.test(token),
  );

  const primaryBrand = brandTokens.find((token) => !AUTO_TUNERS.has(token))
    ?? brandTokens[0]
    ?? "";
  const secondaryBrand = brandTokens.find((token) => token !== primaryBrand) ?? "";
  const primaryModel = modelTokens[0] ?? "";
  const primaryContext = contextTokens[0] ?? "vehicle";
  const secondaryContext = contextTokens[1] ?? "car";
  const contextPair = contextTokens.slice(0, 2).join(" ");
  const neutralPair = neutralTokens.slice(0, 2).join(" ");
  const topTokens = searchTokens.slice(0, 3).join(" ");

  return uniqueStrings([
    primaryContext,
    contextPair,
    `${primaryContext} ${neutralTokens[0] ?? ""}`,
    `${secondaryContext} ${neutralTokens[0] ?? ""}`,
    `${primaryBrand} ${primaryModel} ${primaryContext}`,
    `${secondaryBrand} ${primaryModel} ${primaryContext}`,
    `${primaryBrand} ${primaryContext}`,
    `${secondaryBrand} ${primaryContext}`,
    `${primaryModel} ${primaryContext}`,
    neutralPair,
    `${neutralPair} ${primaryContext}`,
    topTokens,
    `${topTokens} ${secondaryContext}`,
  ])
    .map((query) => query.replace(/\s+/g, " ").trim())
    .filter((query) => query.length >= 3 && /[\p{L}]/u.test(query));
}

function createBrandFallbackQueries(searchTokens: string[]): string[] {
  const brandTokens = uniqueStrings(
    searchTokens.filter((token) => AUTO_BRANDS.has(token)),
  ).slice(0, 3);
  const contextToken = searchTokens.find((token) => AUTO_CONTEXT_TOKENS.has(token)) ?? "car";
  const primaryModel = searchTokens.find((token) => isLikelyModelToken(token)) ?? "";

  return uniqueStrings([
    ...brandTokens,
    ...brandTokens.map((brand) => `${brand} ${contextToken}`),
    ...brandTokens.map((brand) => `${brand} vehicle`),
    ...brandTokens.map((brand) => `${brand} ${primaryModel}`.trim()),
  ])
    .map((query) => query.replace(/\s+/g, " ").trim())
    .filter((query) => query.length >= 3 && /[\p{L}]/u.test(query));
}

function createTopicFallbackQueries(title: string, searchTokens: string[]): string[] {
  const signalTokens = selectSignalTokens(searchTokens, 8);
  const tokenPairs = signalTokens
    .slice(0, 4)
    .map((token, index) => `${token} ${signalTokens[index + 1] ?? ""}`.trim());
  const normalizedTitle = title
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  return uniqueStrings([
    ...signalTokens,
    ...tokenPairs,
    normalizedTitle,
    normalizedTitle.split(" ").slice(0, 4).join(" "),
    normalizedTitle.split(" ").slice(0, 3).join(" "),
  ])
    .map((query) => query.replace(/\s+/g, " ").trim())
    .filter((query) => query.length >= 3 && /[\p{L}]/u.test(query));
}

function rotateBySeed(values: string[], seedText: string): string[] {
  if (values.length <= 1) {
    return values;
  }

  let seed = 0;
  for (const char of seedText) {
    seed = (seed * 31 + char.charCodeAt(0)) % 2_147_483_647;
  }

  const offset = Math.abs(seed) % values.length;
  return [...values.slice(offset), ...values.slice(0, offset)];
}

function createWikimediaQueries(title: string, searchTokens: string[]): string[] {
  const trimmed = title.trim();
  if (!trimmed) {
    return [];
  }

  const normalized = trimmed
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = normalized.split(" ").filter((word) => word.length > 0);
  const compactKeywordQuery = searchTokens.slice(0, 2).join(" ");
  const keywordQuery = searchTokens.slice(0, 3).join(" ");
  const brandTokens = searchTokens.filter((token) => AUTO_BRANDS.has(token)).slice(0, 3);
  const preferredBrand = brandTokens.find((token) => !AUTO_TUNERS.has(token))
    ?? brandTokens[0]
    ?? "";
  const secondaryBrand = brandTokens.find((token) => token !== preferredBrand) ?? "";
  const modelToken = searchTokens.find((token) => isLikelyModelToken(token)) ?? "";
  const brandModelQuery = `${preferredBrand} ${modelToken}`.trim();
  const secondaryBrandModelQuery = `${secondaryBrand} ${modelToken}`.trim();
  const preferredBrandQuery = preferredBrand;
  const secondaryBrandQuery = secondaryBrand;
  const modelQuery = searchTokens
    .filter((token) => isLikelyModelToken(token))
    .slice(0, 3)
    .join(" ");
  const signalTokenQueries = selectSignalTokens(searchTokens, 6);

  const queries = [
    brandModelQuery,
    secondaryBrandModelQuery,
    preferredBrandQuery,
    secondaryBrandQuery,
    compactKeywordQuery,
    keywordQuery,
    modelQuery,
    ...signalTokenQueries,
    trimmed,
    normalized,
    words.slice(0, 4).join(" "),
    words.slice(0, 3).join(" "),
  ];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const query of queries) {
    const value = query.trim();
    if (!value || value.length < 3 || seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }

  return out;
}

type RelevanceMode = "strict" | "brand_fallback" | "visual_only";

function buildTokenVariants(token: string): string[] {
  const variants = new Set<string>([token]);
  if (token.length >= 5 && token.endsWith("s")) {
    variants.add(token.slice(0, -1));
  } else if (token.length >= 5) {
    variants.add(`${token}s`);
  }
  if (token.length >= 5 && token.endsWith("i")) {
    variants.add(`${token.slice(0, -1)}y`);
  } else if (token.length >= 5 && token.endsWith("y")) {
    variants.add(`${token.slice(0, -1)}i`);
  }
  if (token.length >= 6 && token.endsWith("ogo")) {
    const stem = token.slice(0, -3);
    variants.add(`${stem}yi`);
    variants.add(`${stem}yy`);
    variants.add(`${stem}y`);
  }
  if (token.length >= 6 && (token.endsWith("yi") || token.endsWith("yy"))) {
    variants.add(`${token.slice(0, -2)}ogo`);
  }
  return [...variants];
}

function scoreCandidateContext(
  candidate: PhotoCandidate,
  searchTokens: string[],
  automotiveIntent: boolean,
): number {
  const candidateText = `${candidate.url} ${candidate.attributionUrl}`.toLowerCase();
  if (candidateLooksNonPhotographic(candidateText)) {
    return -1000;
  }

  let score = 0;
  for (const token of searchTokens) {
    if (token.length < 4) {
      continue;
    }
    const variants = buildTokenVariants(token);
    if (variants.some((variant) => candidateText.includes(variant))) {
      score += Math.min(token.length, 10);
      if (AUTO_BRANDS.has(token)) {
        score += 6;
      } else if (AUTO_CONTEXT_TOKENS.has(token)) {
        score += 3;
      }
    }
  }

  if (automotiveIntent && candidateLooksAutomotiveVisual(candidateText)) {
    score += 4;
  }

  return score;
}

function candidateLooksRelevant(
  candidateText: string,
  searchTokens: string[],
  mode: RelevanceMode = "strict",
): boolean {
  if (mode === "visual_only") {
    return true;
  }

  if (searchTokens.length === 0) {
    return false;
  }

  const hasAny = (tokens: string[]): boolean =>
    tokens.some((token) =>
      buildTokenVariants(token).some((variant) => candidateText.includes(variant))
    );

  const brandTokens = searchTokens.filter((token) => AUTO_BRANDS.has(token));
  const modelTokens = searchTokens.filter((token) => isLikelyModelToken(token));
  const contextTokens = searchTokens.filter((token) => AUTO_CONTEXT_TOKENS.has(token));
  const fallbackTokens = searchTokens.filter(
    (token) =>
      !AUTO_BRANDS.has(token) &&
      !AUTO_CONTEXT_TOKENS.has(token) &&
      !/^\d+$/.test(token) &&
      token.length >= 4,
  );

  if (brandTokens.length > 0) {
    if (!hasAny(brandTokens)) {
      return false;
    }

    if (mode === "brand_fallback") {
      if (modelTokens.length > 0 && hasAny(modelTokens)) {
        return true;
      }
      if (contextTokens.length > 0 && hasAny(contextTokens)) {
        return true;
      }
      if (fallbackTokens.length > 0 && hasAny(fallbackTokens.slice(0, 3))) {
        return true;
      }
      return GENERIC_VEHICLE_HINTS.some((hint) => candidateText.includes(hint));
    }

    if (modelTokens.length > 0) {
      if (hasAny(modelTokens)) {
        return true;
      }

      const strongModelTokens = modelTokens.filter(
        (token) => /\d/.test(token) || token.length >= 8,
      );
      if (strongModelTokens.length > 0) {
        if (contextTokens.length > 0 && hasAny(contextTokens)) {
          return true;
        }
        return false;
      }
    }

    if (contextTokens.length > 0) {
      if (hasAny(contextTokens)) {
        return true;
      }
    }

    if (fallbackTokens.length > 0 && hasAny(fallbackTokens.slice(0, 3))) {
      return true;
    }

    return true;
  }

  if (modelTokens.length > 0) {
    if (hasAny(modelTokens)) {
      return true;
    }

    const strongModelTokens = modelTokens.filter(
      (token) => /\d/.test(token) || token.length >= 8,
    );
    if (strongModelTokens.length === 0) {
      if (contextTokens.length > 0 && hasAny(contextTokens)) {
        return true;
      }
      if (fallbackTokens.length > 0 && hasAny(fallbackTokens.slice(0, 3))) {
        return true;
      }
      return GENERIC_VEHICLE_HINTS.some((hint) => candidateText.includes(hint));
    }

    return false;
  }

  if (contextTokens.length > 0) {
    return hasAny(contextTokens);
  }

  if (fallbackTokens.length > 0) {
    return hasAny(fallbackTokens.slice(0, 3));
  }

  return false;
}

function candidateLooksNonPhotographic(candidateText: string): boolean {
  return NON_PHOTO_HINTS.some((hint) => candidateText.includes(hint));
}

function candidateLooksAutomotiveVisual(candidateText: string): boolean {
  return AUTOMOTIVE_VISUAL_HINTS.some((hint) => candidateText.includes(hint));
}

function isRetriableWikimediaError(error: unknown): boolean {
  const message = String(error ?? "").toLowerCase();
  return message.includes("http 429")
    || message.includes("http 500")
    || message.includes("http 502")
    || message.includes("http 503")
    || message.includes("http 504")
    || message.includes("fetch")
    || message.includes("timeout")
    || message.includes("timed out")
    || message.includes("econn");
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function fetchWikimediaPayload(endpoint: string): Promise<unknown | null> {
  for (let attempt = 0; attempt < WIKIMEDIA_SEARCH_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return JSON.parse(await fetchText(endpoint)) as unknown;
    } catch (error) {
      const isLastAttempt = attempt >= WIKIMEDIA_SEARCH_RETRY_ATTEMPTS - 1;
      if (isLastAttempt || !isRetriableWikimediaError(error)) {
        return null;
      }

      const delayMs = WIKIMEDIA_SEARCH_RETRY_BASE_DELAY_MS * (attempt + 1);
      await sleep(delayMs);
    }
  }

  return null;
}

async function searchWikimediaCandidates(
  query: string,
  limit: number,
  searchTokens: string[],
  relevanceMode: RelevanceMode = "strict",
  requireAutomotiveVisual = true,
): Promise<PhotoCandidate[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: `${trimmed} filetype:bitmap`,
    gsrnamespace: "6",
    gsrlimit: String(Math.max(limit, 1)),
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "1280",
    format: "json",
    origin: "*",
  });

  const endpoint = `https://commons.wikimedia.org/w/api.php?${params.toString()}`;

  const payload = await fetchWikimediaPayload(endpoint);
  if (!payload) {
    return [];
  }

  if (typeof payload !== "object" || payload === null) {
    return [];
  }

  const queryObj = (payload as Record<string, unknown>).query;
  if (typeof queryObj !== "object" || queryObj === null) {
    return [];
  }

  const pages = (queryObj as Record<string, unknown>).pages;
  if (typeof pages !== "object" || pages === null) {
    return [];
  }

  const candidates: PhotoCandidate[] = [];

  for (const value of Object.values(pages as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) {
      continue;
    }

    const page = value as Record<string, unknown>;
    const pageTitle = firstDefinedString([page.title]);
    const infos = toArray(page.imageinfo);
    if (infos.length === 0) {
      continue;
    }

    const info = infos[0];
    if (typeof info !== "object" || info === null) {
      continue;
    }

    const rawInfo = info as Record<string, unknown>;
    const imageUrl = firstDefinedString([rawInfo.thumburl, rawInfo.url]);
    const descriptionUrl = firstDefinedString([rawInfo.descriptionurl, imageUrl]);
    if (!isHttpUrl(imageUrl)) {
      continue;
    }

    const candidateText = `${pageTitle} ${imageUrl} ${descriptionUrl}`.toLowerCase();
    if (candidateLooksNonPhotographic(candidateText)) {
      continue;
    }
    if (requireAutomotiveVisual && !candidateLooksAutomotiveVisual(candidateText)) {
      continue;
    }
    if (!candidateLooksRelevant(candidateText, searchTokens, relevanceMode)) {
      continue;
    }

    const extMetadata = rawInfo.extmetadata;
    const ext = typeof extMetadata === "object" && extMetadata !== null
      ? (extMetadata as Record<string, unknown>)
      : {};

    const license = stripMarkup(
      firstDefinedString([
        (ext.LicenseShortName as Record<string, unknown> | undefined)?.value,
        (ext.License as Record<string, unknown> | undefined)?.value,
      ]),
    ) || "Wikimedia Commons (license in attribution URL)";

    const credit = stripMarkup(
      firstDefinedString([
        (ext.Artist as Record<string, unknown> | undefined)?.value,
        (ext.Credit as Record<string, unknown> | undefined)?.value,
      ]),
    ) || "Wikimedia Commons";

    candidates.push({
      url: imageUrl,
      provider: "wikimedia",
      license,
      credit,
      attributionUrl: descriptionUrl,
    });

    if (candidates.length >= limit) {
      break;
    }
  }

  return candidates;
}

function extensionFromContentType(contentType: string): string {
  const normalized = contentType.split(";")[0].trim().toLowerCase();

  if (normalized === "image/jpeg") return ".jpg";
  if (normalized === "image/png") return ".png";
  if (normalized === "image/webp") return ".webp";
  if (normalized === "image/gif") return ".gif";
  if (normalized === "image/svg+xml") return ".svg";

  return ".img";
}

function makeDefaultCandidates(urls: string[], provider: "feed" | "article"): PhotoCandidate[] {
  return urls.map((url) => ({
    url,
    provider,
    license: "License unknown. Check original source terms before publication.",
    credit: "Source website",
    attributionUrl: url,
  }));
}

export async function resolvePhotoCandidates(
  title: string,
  feedImageUrls: string[],
  articleImageUrls: string[],
  options: ResolvePhotoOptions = {},
): Promise<PhotoCandidate[]> {
  const {
    onlyPublicDomain = false,
    fallbackToGenericIfEmpty = false,
    contextUrl = "",
    contextText = "",
    excludeUrls = [],
  } = options;
  const candidates: PhotoCandidate[] = [];

  if (!onlyPublicDomain) {
    candidates.push(...makeDefaultCandidates(uniqueHttpUrls(feedImageUrls), "feed"));
    candidates.push(...makeDefaultCandidates(uniqueHttpUrls(articleImageUrls), "article"));
  }

  if (candidates.length >= MAX_IMAGES_PER_NEWS) {
    return candidates;
  }

  const urlSearchTokens = extractSearchTokensFromUrl(contextUrl);
  const titleSearchTokens = extractSearchTokens(title);
  const contentSearchTokens = extractSearchTokensFromContent(contextText);
  const normalizedTitleTokens = urlSearchTokens.length > 0
    ? titleSearchTokens.filter((token) => /[a-z0-9]/i.test(token))
    : titleSearchTokens;
  const rawSearchTokens = uniqueStrings([
    // Prefer URL tokens (usually canonical latin brand/model slug).
    ...urlSearchTokens,
    // Keep title tokens only when they carry latin/digit model context
    // to avoid translated noise blocking relevance checks.
    ...normalizedTitleTokens,
    // Use article text as additional context when title/URL tokens are sparse.
    ...contentSearchTokens,
  ]).slice(0, 28);
  const searchTokens = prioritizeSearchTokens(expandSearchTokens(rawSearchTokens)).slice(0, 24);
  const automotiveIntent = hasAutomotiveIntent(title, contextUrl, contextText, searchTokens);
  const wikimediaQueries = createWikimediaQueries(title, searchTokens);
  for (const query of wikimediaQueries) {
    const wikimediaCandidates = await searchWikimediaCandidates(
      query,
      WIKIMEDIA_CANDIDATE_LIMIT,
      searchTokens,
      "strict",
      automotiveIntent,
    );
    candidates.push(...wikimediaCandidates);

    if (candidates.length >= WIKIMEDIA_CANDIDATE_LIMIT) {
      break;
    }
  }

  if (candidates.length === 0 && fallbackToGenericIfEmpty) {
    const brandFallbackQueries = createBrandFallbackQueries(searchTokens);
    for (const query of brandFallbackQueries) {
      const brandFallbackCandidates = await searchWikimediaCandidates(
        query,
        WIKIMEDIA_CANDIDATE_LIMIT,
        searchTokens,
        "brand_fallback",
        automotiveIntent,
      );
      candidates.push(...brandFallbackCandidates);

      if (candidates.length >= WIKIMEDIA_CANDIDATE_LIMIT) {
        break;
      }
    }
  }

  if (candidates.length === 0 && fallbackToGenericIfEmpty) {
    const contextualFallbackQueries = createFallbackWikimediaQueries(searchTokens);
    for (const query of contextualFallbackQueries) {
      const fallbackCandidates = await searchWikimediaCandidates(
        query,
        WIKIMEDIA_CANDIDATE_LIMIT,
        searchTokens,
        "strict",
        automotiveIntent,
      );
      candidates.push(...fallbackCandidates);

      if (candidates.length >= WIKIMEDIA_CANDIDATE_LIMIT) {
        break;
      }
    }
  }

  if (candidates.length === 0 && fallbackToGenericIfEmpty && automotiveIntent) {
    const relevanceTokens = searchTokens.filter(
      (token) => AUTO_BRANDS.has(token) || AUTO_CONTEXT_TOKENS.has(token),
    );
    const fallbackTokens = relevanceTokens.length > 0
      ? relevanceTokens
      : ["car", "automobile", "vehicle", "auto"];
    const rotatedGenericQueries = rotateBySeed(GENERIC_WIKIMEDIA_FALLBACK_QUERIES, title);
    for (const query of rotatedGenericQueries) {
      const fallbackCandidates = await searchWikimediaCandidates(
        query,
        EXTENDED_WIKIMEDIA_CANDIDATE_LIMIT,
        fallbackTokens,
        "visual_only",
        true,
      );
      candidates.push(...fallbackCandidates);

      if (candidates.length >= EXTENDED_WIKIMEDIA_CANDIDATE_LIMIT) {
        break;
      }
    }
  }

  if (candidates.length === 0 && fallbackToGenericIfEmpty && !automotiveIntent) {
    const topicFallbackQueries = createTopicFallbackQueries(title, searchTokens);
    for (const query of topicFallbackQueries) {
      const fallbackCandidates = await searchWikimediaCandidates(
        query,
        EXTENDED_WIKIMEDIA_CANDIDATE_LIMIT,
        searchTokens,
        "strict",
        false,
      );
      candidates.push(...fallbackCandidates);

      if (candidates.length >= EXTENDED_WIKIMEDIA_CANDIDATE_LIMIT) {
        break;
      }
    }
  }

  const excludedUrls = new Set(excludeUrls.map((value) => value.trim()).filter((value) => value.length > 0));
  const seen = new Set<string>();
  const deduped = candidates.filter((candidate) => {
    const candidateMetaText = `${candidate.url} ${candidate.attributionUrl}`.toLowerCase();
    if (candidateLooksNonPhotographic(candidateMetaText)) {
      return false;
    }
    if (seen.has(candidate.url)) {
      return false;
    }
    seen.add(candidate.url);
    return true;
  });

  const sortByRelevance = (items: PhotoCandidate[]): PhotoCandidate[] => [...items].sort(
    (left, right) =>
      scoreCandidateContext(right, searchTokens, automotiveIntent)
      - scoreCandidateContext(left, searchTokens, automotiveIntent),
  );

  const uniqueCandidates = deduped.filter((candidate) => !excludedUrls.has(candidate.url));
  if (uniqueCandidates.length > 0 || excludedUrls.size === 0) {
    return sortByRelevance(uniqueCandidates);
  }

  // If all matching candidates were already used in the run, allow reuse
  // instead of returning no photos.
  return sortByRelevance(deduped);
}

export async function downloadPhotoCandidates(
  candidates: PhotoCandidate[],
  articleDir: string,
): Promise<PhotoAsset[]> {
  if (candidates.length === 0) {
    return [];
  }

  const imageDir = path.join(articleDir, "images");
  await fs.mkdir(imageDir, { recursive: true });

  const out: PhotoAsset[] = [];
  const seenUrls = new Set<string>();

  for (const candidate of candidates) {
    if (out.length >= MAX_IMAGES_PER_NEWS) {
      break;
    }

    if (seenUrls.has(candidate.url)) {
      continue;
    }
    seenUrls.add(candidate.url);

    const downloaded = await fetchBinaryImage(candidate.url);
    if (!downloaded) {
      continue;
    }

    const ext = extensionFromContentType(downloaded.contentType);
    const fileName = `photo-${out.length + 1}${ext}`;
    const absolutePath = path.join(imageDir, fileName);
    await fs.writeFile(absolutePath, downloaded.buffer);

    out.push({
      source_url: candidate.url,
      local_path: path.relative(process.cwd(), absolutePath).replace(/\\/g, "/"),
      provider: candidate.provider,
      license: candidate.license,
      credit: candidate.credit,
      attribution_url: candidate.attributionUrl,
    });
  }

  return out;
}
