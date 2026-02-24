import type { InterestLabel, InterestSignal, NewsItem } from "../types";
import { POSITIVE_INTEREST_SIGNALS, NEGATIVE_INTEREST_SIGNALS } from "../constants";
import { sanitizeContentForDisplay } from "./content";

function normalizeInterestText(value: string): string {
    if (!value) {
        return "";
    }
    return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function interestScore(text: string, signals: InterestSignal[]): number {
    if (!text) {
        return 0;
    }

    let score = 0;
    for (const signal of signals) {
        if (signal.pattern.test(text)) {
            score += signal.weight;
        }
    }

    return score;
}

export function articleInterestScore(item: NewsItem): number {
    const title = normalizeInterestText(item.title);
    const content = normalizeInterestText(sanitizeContentForDisplay(item.content)).slice(0, 3200);
    const combined = `${title} ${content}`;

    let score = 0;
    score += interestScore(combined, POSITIVE_INTEREST_SIGNALS);
    score += interestScore(combined, NEGATIVE_INTEREST_SIGNALS);

    if (content.length < 180) {
        score -= 1;
    }
    if (item.rights_flag === "quote_only") {
        score += 1;
    }
    if (Array.isArray(item.photos) && item.photos.length > 0) {
        score += 1;
    }

    return score;
}

export function classifyArticleInterest(item: NewsItem): InterestLabel {
    const score = articleInterestScore(item);
    return score >= 2 ? "interesting" : "not_interesting";
}
