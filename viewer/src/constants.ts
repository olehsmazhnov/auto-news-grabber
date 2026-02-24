import type { InterestSignal, ScrapeProgressStage } from "./types";

export const SCRAPE_STATUS_POLL_INTERVAL_MS = 1000;

export const SCRAPE_STAGE_LABELS: Record<ScrapeProgressStage, string> = {
    idle: "Idle",
    initializing: "Initializing",
    loading_sources: "Loading sources",
    collecting: "Collecting feed items",
    translating: "Translating content",
    saving: "Saving output",
    backfilling: "Backfilling photos",
    completed: "Completed",
    failed: "Failed",
};

export const RETELLING_PREFIX_RE = /^Короткий переказ матеріалу з [^:\n]+:\s*/iu;
export const AUTONEWS_PROMO_RE = /\bautonews\s+tracks\s+this\s+story\b/i;
export const CATEGORY_FEED_PROMO_RE = /\bfollow\s+the\s+category\s+feed\b/i;
export const COVERAGE_PROMO_RE = /\bongoing\s+automotive\s+coverage\b/i;
export const RELATED_RELEASES_PROMO_RE = /\bupdates\s+and\s+related\s+releases\b/i;
export const TRAILING_ELLIPSIS_RE = /(?:\.\.\.|\u2026)\s*$/u;

export const POSITIVE_INTEREST_SIGNALS: InterestSignal[] = [
    { pattern: /\b(new|launch|launched|debut|debuted|reveal|revealed|first look|prototype|concept|facelift|recall)\b/u, weight: 2 },
    { pattern: /(нов(ий|а|е|і)|дебют|прем['']?єр|запуск|запуска(є|ють|єтьс)|відклик|концепт|прототип)/u, weight: 2 },
    { pattern: /\b(cybertruck|cybercab|model\s?3|model\s?y|eqb|amg|polestar|mustang|f-150)\b/u, weight: 1 },
    { pattern: /\b(usd|\$|долар|євро|million|мільйон)\b/u, weight: 1 },
];

export const NEGATIVE_INTEREST_SIGNALS: InterestSignal[] = [
    { pattern: /\b(investor|investors|earnings|results|shipments|guidance|conference call|media advisory|statement)\b/u, weight: -2 },
    { pattern: /(інвестор|результат|поставк|звіт|конференц|медіа|прес-реліз|оголош(ує|ення))/u, weight: -2 },
];
