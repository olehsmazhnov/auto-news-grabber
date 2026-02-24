export type RightsFlag = "official_press" | "quote_only" | "unknown";
export type ResourceHealthStatus = "ok" | "empty" | "failed";

export interface SourceConfig {
  id: string;
  name: string;
  source?: string;
  url: string;
  feed_url: string;
  enabled?: boolean;
  max_items?: number;
  rights_flag?: RightsFlag;
  license_text?: string;
}

export interface Source {
  id: string;
  name: string;
  source: string;
  url: string;
  feedUrl: string;
  enabled: boolean;
  maxItems: number;
  rightsFlag: RightsFlag;
  licenseText: string;
}

export interface SourcesFile {
  sources: SourceConfig[];
}

export interface CliOptions {
  config: string;
  output: string;
  targetLanguage: string;
  disableTranslation: boolean;
  maxItemsPerSource: number | null;
  maxContentChars: number;
  verbose: boolean;
}

export interface TranslateItemsOptions {
  translationEnabled: boolean;
  targetLanguage: string;
  maxContentChars: number;
  verbose: boolean;
  onProgress?: TranslateItemsProgressHandler;
}

export interface CollectItemsProgress {
  total_sources: number;
  completed_sources: number;
  current_source_id: string;
  current_source_name: string;
}

export type CollectItemsProgressHandler = (
  progress: CollectItemsProgress,
) => void;

export interface TranslateItemsProgress {
  total_items: number;
  completed_items: number;
  current_item_title: string;
}

export type TranslateItemsProgressHandler = (
  progress: TranslateItemsProgress,
) => void;

export interface ResourceRunReport {
  source_id: string;
  source_name: string;
  source: string;
  source_url: string;
  feed_url: string;
  status: ResourceHealthStatus;
  error: string;
  feed_entries: number;
  collected_items: number;
  fresh_items: number;
}

export interface ResourceTotals {
  total_resources: number;
  ok_resources: number;
  empty_resources: number;
  failed_resources: number;
}

export interface PhotoAsset {
  source_url: string;
  local_path: string;
  provider: "feed" | "article" | "wikimedia";
  license: string;
  credit: string;
  attribution_url: string;
}

export interface CollectedNewsItem {
  source_id: string;
  title: string;
  content: string;
  url: string;
  source: string;
  published_at: string;
  published_date: string;
  published_time: string;
  rights_flag: RightsFlag;
  license_text: string;
  feed_image_candidates: string[];
  article_image_candidates: string[];
}

export interface NewsItem {
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
  rights_flag: RightsFlag;
  license_text: string;
  photos: PhotoAsset[];
}

export interface RunSummary {
  run_id: string;
  run_path: string;
  generated_at: string;
  total_items: number;
  collected_items: number;
  skipped_seen_items: number;
  resource_totals: ResourceTotals;
  source_reports: ResourceRunReport[];
}

export interface RunHistorySnapshot {
  updated_at: string;
  runs: RunSummary[];
}

export interface DailySourceHealth {
  source_id: string;
  source_name: string;
  source: string;
  ok_runs: number;
  empty_runs: number;
  failed_runs: number;
}

export interface DailyHealthReport {
  date: string;
  run_count: number;
  items_saved: number;
  resource_checks: ResourceTotals;
  failed_resources: DailySourceHealth[];
  good_resources: DailySourceHealth[];
  flaky_resources: DailySourceHealth[];
}

export interface DailyHealthSnapshot {
  generated_at: string;
  days: DailyHealthReport[];
}

export interface CollectItemsResult {
  items: CollectedNewsItem[];
  source_reports: ResourceRunReport[];
}
