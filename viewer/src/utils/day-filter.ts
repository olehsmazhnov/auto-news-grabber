import type { NewsItem } from "../types";
import { articlePrimaryTimestamp } from "./news";

export interface DayFilterOption {
    dayKey: string;
    label: string;
    count: number;
    newestTimestamp: number;
}

function pad2(value: number): string {
    return String(value).padStart(2, "0");
}

function localDayKey(timestamp: number): string {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseDayKey(dayKey: string): Date | null {
    const match = dayKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        return null;
    }

    const year = Number.parseInt(match[1] ?? "", 10);
    const month = Number.parseInt(match[2] ?? "", 10);
    const day = Number.parseInt(match[3] ?? "", 10);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
        return null;
    }

    return new Date(year, month - 1, day);
}

function dayLabel(dayKey: string): string {
    const date = parseDayKey(dayKey);
    if (!date || Number.isNaN(date.getTime())) {
        return dayKey;
    }

    return date.toLocaleDateString("uk-UA", {
        year: "numeric",
        month: "short",
        day: "2-digit",
    });
}

function dayKeyFromItem(item: NewsItem): string {
    const timestamp = articlePrimaryTimestamp(item);
    if (timestamp <= 0) {
        return "unknown";
    }
    return localDayKey(timestamp);
}

export function buildDayFilterOptions(items: NewsItem[]): DayFilterOption[] {
    const byDay = new Map<string, { count: number; newestTimestamp: number }>();

    for (const item of items) {
        const key = dayKeyFromItem(item);
        const timestamp = articlePrimaryTimestamp(item);
        const existing = byDay.get(key);
        if (!existing) {
            byDay.set(key, {
                count: 1,
                newestTimestamp: timestamp,
            });
            continue;
        }

        existing.count += 1;
        if (timestamp > existing.newestTimestamp) {
            existing.newestTimestamp = timestamp;
        }
    }

    return [...byDay.entries()]
        .map(([dayKey, value]) => ({
            dayKey,
            label: dayKey === "unknown" ? "Unknown date" : dayLabel(dayKey),
            count: value.count,
            newestTimestamp: value.newestTimestamp,
        }))
        .sort((left, right) => {
            const byTimestamp = right.newestTimestamp - left.newestTimestamp;
            if (byTimestamp !== 0) {
                return byTimestamp;
            }
            return right.dayKey.localeCompare(left.dayKey);
        });
}

export function filterNewsItemsByDay(
    items: NewsItem[],
    selectedDayKey: string | null,
): NewsItem[] {
    if (!selectedDayKey) {
        return items;
    }

    return items.filter((item) => dayKeyFromItem(item) === selectedDayKey);
}
