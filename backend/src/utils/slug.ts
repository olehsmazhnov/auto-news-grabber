import crypto from "node:crypto";

export function slugify(value: string, maxLength = 80): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  if (!slug) {
    return "news";
  }

  return slug.slice(0, maxLength).replace(/-+$/g, "") || "news";
}

export function shortHash(value: string, length = 10): string {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, length);
}
