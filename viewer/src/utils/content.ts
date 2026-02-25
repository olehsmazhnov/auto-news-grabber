import {
    RETELLING_PREFIX_RE,
    AUTONEWS_PROMO_RE,
    CATEGORY_FEED_PROMO_RE,
    COVERAGE_PROMO_RE,
    RELATED_RELEASES_PROMO_RE,
    TRAILING_ELLIPSIS_RE,
} from "../constants";

const SOURCE_LINE_RE = /^\s*Джерело:\s*(https?:\/\/\S+)\s*$/iu;
const TRAILING_URL_PUNCTUATION_RE = /[),.;!?]+$/g;
const GENERIC_SUBDOMAIN_RE = /^(?:www|m|news|amp)$/i;

export type SourceReference = {
    url: string;
    label: string;
};

function splitDisplayParagraphs(content: string): string[] {
    return content
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
        .filter((paragraph) => paragraph.length > 0);
}

function isPromotionalDisplayParagraph(paragraph: string): boolean {
    const normalized = paragraph.toLowerCase();
    if (!normalized) {
        return false;
    }

    const hasAutoNewsLead = AUTONEWS_PROMO_RE.test(normalized);
    const hasFeedPrompt = CATEGORY_FEED_PROMO_RE.test(normalized);
    const hasCoverage = COVERAGE_PROMO_RE.test(normalized);
    const hasRelatedReleases = RELATED_RELEASES_PROMO_RE.test(normalized);

    if (hasAutoNewsLead && (hasFeedPrompt || hasCoverage || hasRelatedReleases)) {
        return true;
    }

    if (hasFeedPrompt && hasRelatedReleases) {
        return true;
    }

    return false;
}

function normalizeDisplayParagraphForDuplicateCheck(value: string): string {
    return value
        .toLowerCase()
        .replace(/\u2026/g, "...")
        .replace(/[^\p{L}\p{N}\s.]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function isTruncatedDisplayDuplicate(previous: string, current: string): boolean {
    if (!TRAILING_ELLIPSIS_RE.test(current.trim())) {
        return false;
    }

    const normalizedCurrent = normalizeDisplayParagraphForDuplicateCheck(current)
        .replace(/\.{3}\s*$/g, "")
        .trim();
    if (normalizedCurrent.length < 80) {
        return false;
    }

    const normalizedPrevious = normalizeDisplayParagraphForDuplicateCheck(previous);
    if (!normalizedPrevious) {
        return false;
    }

    const comparePrefix = normalizedCurrent.slice(0, Math.min(normalizedCurrent.length, 160));
    return normalizedPrevious.startsWith(comparePrefix);
}

function stripDisplayArtifacts(content: string): string {
    const paragraphs = splitDisplayParagraphs(content);
    if (paragraphs.length === 0) {
        return "";
    }

    const cleaned: string[] = [];
    for (const paragraph of paragraphs) {
        if (isPromotionalDisplayParagraph(paragraph)) {
            continue;
        }

        const previous = cleaned.length > 0 ? cleaned[cleaned.length - 1] : "";
        if (previous && isTruncatedDisplayDuplicate(previous, paragraph)) {
            continue;
        }

        cleaned.push(paragraph);
    }

    return cleaned.join("\n\n").trim();
}

function normalizeSourceUrl(rawUrl: string): string {
    return rawUrl.trim().replace(TRAILING_URL_PUNCTUATION_RE, "");
}

function domainLabelFromUrl(url: string): string {
    try {
        const host = new URL(url).hostname.replace(/^www\./i, "");
        const parts = host.split(".").filter((part) => part.length > 0);
        if (parts.length === 0) {
            return host;
        }

        if (parts.length === 1) {
            return parts[0] ?? host;
        }

        const secondLevel = parts[parts.length - 2] ?? "";
        const secondLevelLooksLikeSuffix =
            secondLevel.length <= 3 && /^(co|com|org|net|gov|edu|ac)$/i.test(secondLevel);

        if (secondLevelLooksLikeSuffix && parts.length >= 3) {
            return parts[parts.length - 3] ?? secondLevel;
        }

        return secondLevel;
    } catch {
        return "source";
    }
}

function removeSourceLine(content: string): string {
    if (!content) {
        return "";
    }

    const lines = content.split("\n");
    const kept = lines.filter((line) => !SOURCE_LINE_RE.test(line.trim()));
    return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function extractSourceReference(content: string): SourceReference | null {
    if (!content) {
        return null;
    }

    const withoutPrefix = content.replace(RETELLING_PREFIX_RE, "").trim();
    if (!withoutPrefix) {
        return null;
    }

    const lines = withoutPrefix.split("\n");
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index]?.trim() ?? "";
        const match = line.match(SOURCE_LINE_RE);
        if (!match) {
            continue;
        }

        const rawUrl = match[1] ?? "";
        const normalizedUrl = normalizeSourceUrl(rawUrl);
        if (!normalizedUrl) {
            continue;
        }

        const label = domainLabelFromUrl(normalizedUrl);
        if (!label || GENERIC_SUBDOMAIN_RE.test(label)) {
            return {
                url: normalizedUrl,
                label: "source",
            };
        }

        return {
            url: normalizedUrl,
            label,
        };
    }

    return null;
}

export function sanitizeContentForDisplay(content: string): string {
    if (!content) {
        return "";
    }
    const withoutPrefix = content.replace(RETELLING_PREFIX_RE, "").trim();
    if (!withoutPrefix) {
        return "";
    }

    return stripDisplayArtifacts(removeSourceLine(withoutPrefix));
}

export function excerpt(content: string, maxChars = 360): string {
    const normalized = sanitizeContentForDisplay(content);
    if (!normalized) {
        return "";
    }
    if (normalized.length <= maxChars) {
        return normalized;
    }
    return `${normalized.slice(0, maxChars).trim()}...`;
}
