export type PhotoAsset = {
    source_url: string;
    local_path: string;
    provider: "feed" | "article" | "wikimedia";
    license: string;
    credit: string;
    attribution_url: string;
};

export type ResourceStatus = "ok" | "empty" | "failed";

export type ResourceTotals = {
    total_resources: number;
    ok_resources: number;
    empty_resources: number;
    failed_resources: number;
};

export type ResourceReport = {
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

export type RunSummary = {
    run_id: string;
    run_path: string;
    generated_at: string;
    total_items: number;
    collected_items: number;
    skipped_seen_items: number;
    resource_totals: ResourceTotals;
    source_reports: ResourceReport[];
};

export type RunHistorySnapshot = {
    updated_at: string;
    runs: RunSummary[];
};

export type DailySourceHealth = {
    source_id: string;
    source_name: string;
    source: string;
    ok_runs: number;
    empty_runs: number;
    failed_runs: number;
};

export type DailyHealthReport = {
    date: string;
    run_count: number;
    items_saved: number;
    resource_checks: ResourceTotals;
    failed_resources: DailySourceHealth[];
    good_resources: DailySourceHealth[];
    flaky_resources: DailySourceHealth[];
};

export type DailyHealthSnapshot = {
    generated_at: string;
    days: DailyHealthReport[];
};

export type NewsItem = {
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

export type SupabaseSyncResponse =
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

export type SupabaseExcludedItemsResponse =
    | {
        ok: true;
        ids: string[];
    }
    | {
        ok: false;
        error?: string;
    };

export type SupabaseExcludeItemResponse =
    | {
        ok: true;
        id: string;
        added: boolean;
        ids: string[];
    }
    | {
        ok: false;
        error?: string;
    };

export type ScrapeRunResponse =
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

export type ScrapeRunStateValue = "idle" | "running" | "success" | "error";

export type ScrapeProgressStage =
    | "idle"
    | "initializing"
    | "loading_sources"
    | "collecting"
    | "translating"
    | "saving"
    | "backfilling"
    | "completed"
    | "failed";

export type ScrapeStatusSnapshot = {
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

export type ScrapeStatusResponse =
    | {
        ok: true;
        status: ScrapeStatusSnapshot;
    }
    | {
        ok: false;
        error?: string;
    };

export type InterestLabel = "interesting" | "not_interesting";

export type InterestSignal = {
    pattern: RegExp;
    weight: number;
};

export type CardRenderData = {
    image: string | null;
    articleLink: string;
    interest: InterestLabel;
    isExpanded: boolean;
    hasMoreContent: boolean;
    contentToShow: string;
    sourceReference: {
        url: string;
        label: string;
    } | null;
};
