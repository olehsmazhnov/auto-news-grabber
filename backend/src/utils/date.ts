export function toIsoOrEmpty(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString();
}

export function toDateOnly(isoOrRaw: string, fallbackIso: string): string {
  const iso = toIsoOrEmpty(isoOrRaw) || toIsoOrEmpty(fallbackIso);
  if (!iso) {
    return "";
  }
  return iso.slice(0, 10);
}

export function toTimeOnly(isoOrRaw: string, fallbackIso: string): string {
  const iso = toIsoOrEmpty(isoOrRaw) || toIsoOrEmpty(fallbackIso);
  if (!iso) {
    return "";
  }
  return iso.slice(11, 19);
}

export function createRunId(isoTimestamp: string): string {
  return isoTimestamp.replace(/[:.]/g, "-");
}
