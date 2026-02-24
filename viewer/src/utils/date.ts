export function formatDateTime(dateOnly: string, timeOnly: string, iso: string): string {
    if (iso) {
        const date = new Date(iso);
        if (!Number.isNaN(date.getTime())) {
            return date.toLocaleString("uk-UA", {
                year: "numeric",
                month: "short",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
            });
        }
    }

    if (dateOnly && timeOnly) {
        return `${dateOnly} ${timeOnly}`;
    }
    if (dateOnly) {
        return dateOnly;
    }
    if (timeOnly) {
        return timeOnly;
    }
    return "n/a";
}

export function formatRunTimestamp(isoLike: string): string {
    if (!isoLike) {
        return "n/a";
    }

    const date = new Date(isoLike);
    if (Number.isNaN(date.getTime())) {
        return isoLike;
    }

    return date.toLocaleString("uk-UA", {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });
}

export function parseIsoTimestampOrZero(value: string): number {
    if (!value) {
        return 0;
    }

    const parsed = new Date(value).getTime();
    if (Number.isNaN(parsed)) {
        return 0;
    }

    return parsed;
}

function parsePublishedPartsOrZero(dateOnly: string, timeOnly: string): number {
    if (!dateOnly) {
        return 0;
    }

    const normalizedTime = /^\d{2}:\d{2}:\d{2}$/.test(timeOnly)
        ? timeOnly
        : /^\d{2}:\d{2}$/.test(timeOnly)
            ? `${timeOnly}:00`
            : "00:00:00";
    return parseIsoTimestampOrZero(`${dateOnly}T${normalizedTime}Z`);
}

export function publishedTimestamp(item: { published_at: string; published_date: string; published_time: string }): number {
    const byIso = parseIsoTimestampOrZero(item.published_at);
    if (byIso > 0) {
        return byIso;
    }
    return parsePublishedPartsOrZero(item.published_date, item.published_time);
}

export function isSameLocalCalendarDay(timestamp: number, reference: Date): boolean {
    if (timestamp <= 0) {
        return false;
    }
    const date = new Date(timestamp);
    return (
        date.getFullYear() === reference.getFullYear() &&
        date.getMonth() === reference.getMonth() &&
        date.getDate() === reference.getDate()
    );
}
