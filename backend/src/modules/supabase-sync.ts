import fs from "node:fs/promises";
import path from "node:path";
import type { NewsItem, PhotoAsset, RightsFlag } from "../types.js";
import { shortHash, slugify } from "../utils/slug.js";
import { log } from "../utils/log.js";
import { filterPhotosWithExistingFiles } from "../utils/photo-integrity.js";
import { normalizeArticleContent } from "../utils/text.js";
import { collectNewsKeys } from "./news-item-keys.js";
import { listSupabaseExcludedItemIds } from "./supabase-excluded-items.js";

const DEFAULT_DATA_DIR = "data";
const DEFAULT_SUPABASE_SCHEMA = "public";
const DEFAULT_SUPABASE_TABLE = "news_items";
const SUPABASE_REQUEST_TIMEOUT_MS = 30_000;
const SUPABASE_BATCH_SIZE = 100;
const MAX_ERROR_BODY_CHARS = 700;
const MAX_ERROR_DETAILS_CHARS = 220;

export type SupabaseSyncScope = "latest_run" | "snapshot";

export interface SupabaseSyncOptions {
  scope?: SupabaseSyncScope;
  dataDir?: string;
  verbose?: boolean;
}

export interface SupabaseSyncResult {
  ok: true;
  scope: SupabaseSyncScope;
  source_file: string;
  selected_items: number;
  unique_items: number;
  submitted_rows: number;
}

interface LatestRunPointer {
  run_path?: string;
}

interface SupabaseSyncConfig {
  baseUrl: string;
  schema: string;
  table: string;
  serviceRoleKey: string;
}

interface SupabaseNewsRow {
  slug: string;
  external_id: string;
  dedupe_key: string;
  source_id: string | null;
  source_name: string;
  source_url: string;
  article_path: string;
  title: string;
  excerpt: string | null;
  summary: string | null;
  content: string;
  image: string | null;
  image_url: string | null;
  photos: PhotoAsset[];
  date: string | null;
  published_at: string | null;
  published_date: string | null;
  published_time: string | null;
  scraped_at: string;
  rights_flag: RightsFlag;
  license_text: string;
  category: string | null;
  is_featured: boolean;
  is_popular: boolean;
}

interface SupabaseErrorResponse {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

function nonEmptyStringOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  return normalized;
}

function normalizeRightsFlag(value: string): RightsFlag {
  if (value === "official_press" || value === "quote_only" || value === "unknown") {
    return value;
  }
  return "unknown";
}

function normalizeIsoTimestampOrNull(value: string | null | undefined): string | null {
  const normalized = nonEmptyStringOrNull(value);
  if (!normalized) {
    return null;
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function normalizePublishedTime(value: string | null | undefined): string {
  const normalized = nonEmptyStringOrNull(value);
  if (!normalized) {
    return "00:00:00";
  }

  if (/^\d{2}:\d{2}:\d{2}$/.test(normalized)) {
    return normalized;
  }
  if (/^\d{2}:\d{2}$/.test(normalized)) {
    return `${normalized}:00`;
  }

  return "00:00:00";
}

function resolvePublishedAt(item: NewsItem): string | null {
  const publishedAt = normalizeIsoTimestampOrNull(item.published_at);
  if (publishedAt) {
    return publishedAt;
  }

  const publishedDate = nonEmptyStringOrNull(item.published_date);
  if (!publishedDate) {
    return null;
  }

  return normalizeIsoTimestampOrNull(`${publishedDate}T${normalizePublishedTime(item.published_time)}Z`);
}

function normalizePhotoAsset(photo: unknown): PhotoAsset | null {
  if (typeof photo !== "object" || photo === null) {
    return null;
  }

  const raw = photo as Record<string, unknown>;
  const sourceUrl = nonEmptyStringOrNull(typeof raw.source_url === "string" ? raw.source_url : null);
  const localPath = nonEmptyStringOrNull(typeof raw.local_path === "string" ? raw.local_path : null);
  const provider = raw.provider;
  const license = nonEmptyStringOrNull(typeof raw.license === "string" ? raw.license : null);
  const credit = nonEmptyStringOrNull(typeof raw.credit === "string" ? raw.credit : null);
  const attributionUrl = nonEmptyStringOrNull(
    typeof raw.attribution_url === "string" ? raw.attribution_url : null,
  );

  if (!sourceUrl || !localPath || !license || !credit || !attributionUrl) {
    return null;
  }
  if (provider !== "feed" && provider !== "article" && provider !== "wikimedia") {
    return null;
  }

  return {
    source_url: sourceUrl,
    local_path: localPath,
    provider,
    license,
    credit,
    attribution_url: attributionUrl,
  };
}

function normalizePhotos(item: NewsItem): PhotoAsset[] {
  if (!Array.isArray(item.photos)) {
    return [];
  }

  const normalized: PhotoAsset[] = [];
  for (const photo of item.photos) {
    const validPhoto = normalizePhotoAsset(photo);
    if (validPhoto) {
      normalized.push(validPhoto);
    }
  }
  return normalized;
}

function buildExcerpt(content: string, maxChars = 320): string | null {
  const normalized = nonEmptyStringOrNull(content);
  if (!normalized) {
    return null;
  }

  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars).trim()}...`;
}

function pickPrimaryPhoto(photos: PhotoAsset[]): PhotoAsset | null {
  if (!Array.isArray(photos) || photos.length === 0) {
    return null;
  }
  return photos[0] ?? null;
}

function fallbackDedupeToken(item: NewsItem): string {
  const source = nonEmptyStringOrNull(item.source) ?? "";
  const title = nonEmptyStringOrNull(item.title) ?? "";
  const publishedDate = nonEmptyStringOrNull(item.published_date) ?? "";
  return `fallback:${source}|${title}|${publishedDate}`;
}

function createDedupeKey(item: NewsItem): string {
  const keys = collectNewsKeys(item);
  const primaryKey = keys[0] ?? fallbackDedupeToken(item);
  return shortHash(primaryKey, 40);
}

function buildSupabaseSlug(item: NewsItem): string {
  const normalizedTitle = nonEmptyStringOrNull(item.title) ?? "news";
  const titleSlug = slugify(normalizedTitle, 64);
  const stableSuffix = shortHash(item.id, 8);
  return `${titleSlug}-${stableSuffix}`;
}

function parseTimestampOrZero(value: string): number {
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return parsed;
}

function scoreItemQuality(item: NewsItem): number {
  const photosCount = Array.isArray(item.photos) ? item.photos.length : 0;
  const contentLength = nonEmptyStringOrNull(item.content)?.length ?? 0;
  const publishedScore = parseTimestampOrZero(item.published_at);
  const scrapedScore = parseTimestampOrZero(item.scraped_at);

  return photosCount * 1_000_000 + contentLength * 1000 + publishedScore + scrapedScore;
}

function dedupeNewsItems(items: NewsItem[]): NewsItem[] {
  const byDedupeKey = new Map<string, NewsItem>();

  for (const item of items) {
    const dedupeKey = createDedupeKey(item);
    const existing = byDedupeKey.get(dedupeKey);
    if (!existing) {
      byDedupeKey.set(dedupeKey, item);
      continue;
    }

    if (scoreItemQuality(item) > scoreItemQuality(existing)) {
      byDedupeKey.set(dedupeKey, item);
    }
  }

  return [...byDedupeKey.values()];
}

function isNewsItem(value: unknown): value is NewsItem {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const raw = value as Record<string, unknown>;
  return (
    typeof raw.id === "string" &&
    typeof raw.title === "string" &&
    typeof raw.content === "string" &&
    typeof raw.url === "string" &&
    typeof raw.source === "string" &&
    typeof raw.scraped_at === "string" &&
    typeof raw.article_path === "string" &&
    typeof raw.rights_flag === "string" &&
    typeof raw.license_text === "string"
  );
}

function parseNewsItems(raw: unknown): NewsItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter((item): item is NewsItem => isNewsItem(item));
}

function mapNewsItemToRow(item: NewsItem, photos: PhotoAsset[]): SupabaseNewsRow {
  const primaryPhoto = pickPrimaryPhoto(photos);
  const publishedAt = resolvePublishedAt(item);
  const scrapedAt = normalizeIsoTimestampOrNull(item.scraped_at) ?? new Date().toISOString();
  const normalizedContent = normalizeArticleContent(item.content);
  const summary =
    nonEmptyStringOrNull(normalizedContent) ??
    nonEmptyStringOrNull(item.content);

  return {
    slug: buildSupabaseSlug(item),
    external_id: item.id,
    dedupe_key: createDedupeKey(item),
    source_id: nonEmptyStringOrNull(item.source_id),
    source_name: item.source,
    source_url: item.url,
    article_path: item.article_path,
    title: item.title,
    excerpt: summary ? buildExcerpt(summary) : null,
    summary,
    content: summary ?? "",
    image: primaryPhoto?.local_path ?? null,
    image_url: primaryPhoto?.source_url ?? null,
    photos,
    date: nonEmptyStringOrNull(item.published_date),
    published_at: publishedAt,
    published_date: nonEmptyStringOrNull(item.published_date),
    published_time: nonEmptyStringOrNull(item.published_time),
    scraped_at: scrapedAt,
    rights_flag: normalizeRightsFlag(item.rights_flag),
    license_text: item.license_text,
    category: nonEmptyStringOrNull(item.source),
    is_featured: false,
    is_popular: false,
  };
}

function toWorkspaceRelativePath(absolutePath: string): string {
  return path.relative(process.cwd(), absolutePath).replace(/\\/g, "/");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw.replace(/^\uFEFF/, "")) as T;
}

async function readJsonFileOrNull<T>(filePath: string): Promise<T | null> {
  try {
    return await readJsonFile<T>(filePath);
  } catch {
    return null;
  }
}

function assertInsidePath(baseDir: string, maybeInsidePath: string): string {
  const resolvedBase = path.resolve(baseDir);
  const resolvedCandidate = path.resolve(maybeInsidePath);
  const relative = path.relative(resolvedBase, resolvedCandidate);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes base directory: ${maybeInsidePath}`);
  }

  return resolvedCandidate;
}

async function resolveNewsInputFile(
  scope: SupabaseSyncScope,
  dataDirAbs: string,
): Promise<string> {
  const snapshotPath = path.join(dataDirAbs, "news.json");
  if (scope === "snapshot") {
    return snapshotPath;
  }

  const latestRunPath = path.join(dataDirAbs, "latest_run.json");
  const latestRun = await readJsonFileOrNull<LatestRunPointer>(latestRunPath);
  const runPath = nonEmptyStringOrNull(latestRun?.run_path ?? null);
  if (!runPath) {
    return snapshotPath;
  }

  const runDirAbs = assertInsidePath(process.cwd(), path.resolve(process.cwd(), runPath));
  const runNewsPath = path.join(runDirAbs, "news.json");
  if (!(await fileExists(runNewsPath))) {
    return snapshotPath;
  }

  return runNewsPath;
}

function readRequiredEnv(name: string): string {
  const value = nonEmptyStringOrNull(process.env[name]);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("SUPABASE_URL is not a valid URL");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("SUPABASE_URL must use http or https");
  }

  return parsed.origin;
}

function sanitizeIdentifier(value: string, envName: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
    throw new Error(`Invalid ${envName}: ${value}`);
  }
  return normalized;
}

function loadSupabaseSyncConfig(): SupabaseSyncConfig {
  const serviceRoleKey =
    nonEmptyStringOrNull(process.env.SUPABASE_SERVICE_ROLE_KEY) ??
    nonEmptyStringOrNull(process.env.SUPABASE_KEY);

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY)");
  }

  return {
    baseUrl: normalizeBaseUrl(readRequiredEnv("SUPABASE_URL")),
    schema: sanitizeIdentifier(
      process.env.SUPABASE_SCHEMA ?? DEFAULT_SUPABASE_SCHEMA,
      "SUPABASE_SCHEMA",
    ),
    table: sanitizeIdentifier(
      process.env.SUPABASE_TABLE ?? DEFAULT_SUPABASE_TABLE,
      "SUPABASE_TABLE",
    ),
    serviceRoleKey,
  };
}

function buildUpsertUrl(config: SupabaseSyncConfig): string {
  const url = new URL(`/rest/v1/${config.table}`, `${config.baseUrl}/`);
  url.searchParams.set("on_conflict", "dedupe_key");
  return url.toString();
}

function buildUpsertHeaders(config: SupabaseSyncConfig): Record<string, string> {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    Prefer: "resolution=merge-duplicates,return=minimal,missing=default",
    "Content-Profile": config.schema,
  };
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}...`;
}

function formatSupabaseErrorResponse(error: SupabaseErrorResponse): string {
  const parts: string[] = [];

  const code = nonEmptyStringOrNull(error.code);
  if (code) {
    parts.push(`code=${code}`);
  }

  const message = nonEmptyStringOrNull(error.message);
  if (message) {
    parts.push(message);
  }

  const details = nonEmptyStringOrNull(error.details);
  if (details) {
    parts.push(`details=${truncateText(details, MAX_ERROR_DETAILS_CHARS)}`);
  }

  const hint = nonEmptyStringOrNull(error.hint);
  if (hint) {
    parts.push(`hint=${truncateText(hint, MAX_ERROR_DETAILS_CHARS)}`);
  }

  return parts.join("; ");
}

async function responseBodyPreview(response: Response): Promise<string> {
  const body = await response.text();
  if (!body) {
    return "";
  }

  try {
    const parsed = JSON.parse(body) as SupabaseErrorResponse;
    const formatted = formatSupabaseErrorResponse(parsed);
    if (formatted) {
      return formatted;
    }
  } catch {
    // Keep raw body fallback below when the error payload is not JSON.
  }

  return truncateText(body, MAX_ERROR_BODY_CHARS);
}

function splitIntoBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += batchSize) {
    batches.push(items.slice(index, index + batchSize));
  }
  return batches;
}

async function upsertRows(
  rows: SupabaseNewsRow[],
  config: SupabaseSyncConfig,
  verbose: boolean,
): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }

  let submitted = 0;
  const endpoint = buildUpsertUrl(config);
  const headers = buildUpsertHeaders(config);
  const batches = splitIntoBatches(rows, SUPABASE_BATCH_SIZE);

  for (const [index, batch] of batches.entries()) {
    log(`Supabase sync batch ${index + 1}/${batches.length} (${batch.length} rows)`, verbose);
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(SUPABASE_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await responseBodyPreview(response);
      throw new Error(`Supabase upsert failed (${response.status}): ${body || response.statusText}`);
    }

    submitted += batch.length;
  }

  return submitted;
}

export function parseSupabaseSyncScope(value: unknown): SupabaseSyncScope {
  if (value === "snapshot") {
    return "snapshot";
  }
  if (value === "latest-run" || value === "latest_run") {
    return "latest_run";
  }
  return "latest_run";
}

export async function syncNewsToSupabase(
  options: SupabaseSyncOptions = {},
): Promise<SupabaseSyncResult> {
  const scope = options.scope ?? "latest_run";
  const verbose = options.verbose ?? false;
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;

  const dataDirAbs = assertInsidePath(process.cwd(), path.resolve(process.cwd(), dataDir));
  const sourceFileAbs = await resolveNewsInputFile(scope, dataDirAbs);
  const rawItems = await readJsonFile<unknown>(sourceFileAbs);
  const selectedItems = parseNewsItems(rawItems);
  const excludedIdsPath = path.join(dataDirAbs, "supabase_excluded_ids.json");
  const excludedIds = new Set(await listSupabaseExcludedItemIds(excludedIdsPath));
  const filteredItems =
    excludedIds.size > 0
      ? selectedItems.filter((item) => !excludedIds.has(item.id))
      : selectedItems;
  const removedByExclusion = Math.max(selectedItems.length - filteredItems.length, 0);
  const uniqueItems = dedupeNewsItems(filteredItems);
  const rows: SupabaseNewsRow[] = [];
  let removedBrokenPhotoRefs = 0;
  for (const item of uniqueItems) {
    const normalizedPhotos = normalizePhotos(item);
    const availablePhotos = await filterPhotosWithExistingFiles(normalizedPhotos);
    removedBrokenPhotoRefs += Math.max(normalizedPhotos.length - availablePhotos.length, 0);
    rows.push(mapNewsItemToRow(item, availablePhotos));
  }

  if (removedBrokenPhotoRefs > 0) {
    log(
      `Supabase sync skipped ${removedBrokenPhotoRefs} unavailable/policy-filtered photo reference(s)`,
      verbose,
    );
  }

  if (removedByExclusion > 0) {
    log(
      `Supabase sync skipped ${removedByExclusion} excluded item(s) from ${toWorkspaceRelativePath(excludedIdsPath)}`,
      verbose,
    );
  }

  log(
    `Preparing Supabase sync: selected=${filteredItems.length}, unique=${rows.length}, scope=${scope}`,
    verbose,
  );

  const config = loadSupabaseSyncConfig();
  const submittedRows = await upsertRows(rows, config, verbose);

  return {
    ok: true,
    scope,
    source_file: toWorkspaceRelativePath(sourceFileAbs),
    selected_items: filteredItems.length,
    unique_items: uniqueItems.length,
    submitted_rows: submittedRows,
  };
}
