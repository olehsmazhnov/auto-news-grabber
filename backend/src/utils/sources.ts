import fs from "node:fs/promises";
import type { Source, SourcesFile } from "../types.js";

const DEFAULT_LICENSE_TEXT =
  "Use factual information with attribution. Check media asset usage terms before publishing photos.";

export async function loadSources(
  configPath: string,
  maxItemsOverride: number | null,
): Promise<Source[]> {
  const raw = await fs.readFile(configPath, "utf8");
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, "")) as SourcesFile;
  const list = Array.isArray(parsed.sources) ? parsed.sources : [];

  const out: Source[] = [];

  for (const item of list) {
    const enabled = item.enabled !== false;
    if (!enabled) {
      continue;
    }

    const maxItems =
      maxItemsOverride && maxItemsOverride > 0
        ? maxItemsOverride
        : Math.max(1, item.max_items ?? 4);

    const rightsFlag = item.rights_flag ?? "official_press";
    const licenseText = item.license_text ?? DEFAULT_LICENSE_TEXT;

    out.push({
      id: item.id,
      name: item.name,
      source: item.source ?? item.name,
      url: item.url,
      feedUrl: item.feed_url,
      enabled,
      maxItems,
      rightsFlag,
      licenseText,
    });
  }

  return out;
}
