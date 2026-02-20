Always write secure code.
Split logic into small functions, utils, and types.

AI Rules for this project:
1. Legal first:
- For `quote_only` sources, never generate a full translation/republication.
- Publish an original fact-based retelling with source link and minimal quoting.
- Keep and propagate `rights_flag` and `license_text` in outputs.

2. Data requirements per news item:
- Include source publication date and time when available (`published_at`, `published_date`, `published_time`).
- Include scrape timestamp (`scraped_at`).
- Keep source URL and attribution metadata.
- Keep stable article linkage fields (`id`, `source_id`, `article_path`) across re-runs/backfills.

3. Daily operations:
- Support multiple runs per day.
- Every run must create a separate timestamped folder under `data/runs/<run_id>/`.
- Keep `data/news.json` as latest snapshot and `data/latest_run.json` as run pointer.
- Enforce uniqueness: skip already-seen news across runs (no repeated items in fresh output).
- After each scrape run, execute a post-step for latest-run items with `photos: []` to retry photo search/backfill.
- If photos/content are backfilled after a run, sync all affected outputs:
  `data/news.json`, `data/runs/<run_id>/news.json`, and per-article `article.json`/`article.md`.

4. Photos and licensing:
- Prefer official press/media assets and clearly licensed public assets (for example Wikimedia Commons).
- For `quote_only` sources, use only clearly licensed public photos (prefer Wikimedia Commons).
- If an item has no downloadable source image, run fallback search in free/public sources (Wikimedia Commons) and try to save at least 1 image.
- Fallback order must be:
  source/feed images -> context-aware Wikimedia queries (title + content + URL tokens) ->
  brand/model fallback queries -> generic automotive Wikimedia queries.
- Fallback internet photos must match article context (brand/model/topic from title/content/URL), not random generic images.
- For broad/mixed sources where some non-auto topics can appear, only use topic-matching fallback images when automotive intent is absent; do not force random car photos.
- Apply a photo-text consistency gate before saving: if no token overlap between article context and image metadata (`source_url`/`attribution_url`/title), reject the image.
- Prefer real vehicle/event photos over generic charts, diagrams, logos, signatures, maps, office/building/plaque assets, or decorative assets.
- Do not use watermarked photos unless explicit license terms permit that exact asset for redistribution.
- Avoid reusing the same fallback internet photo across different articles in the same run when alternatives exist.
- Enforce run-level fallback uniqueness by image `source_url` when alternatives exist.
- Use retry logic for Wikimedia fallback (transient failures/rate limits) before concluding no image exists.
- Rank fallback candidates by context relevance before download and prefer top-scored matches.
- If context match fails after all attempts, keep `photos: []` (do not attach random images).
- Save local copies under each article folder (`images/`).
- Store attribution (`source_url`, `attribution_url`, `credit`, `license`) for every image.
- If license is unknown, mark it explicitly and require manual review before publishing.

5. Output structure:
- Each article has its own folder with `article.json`, `article.md`, and `images/`.
- Viewer must read from latest snapshot and show date + links + photo when available.
- Keep persistent dedupe index in `data/seen_news_index.json`.

6. Ukrainian translation policy:
- Default output language for `title` and `content` is Ukrainian (`uk`).
- Keep `--disable-translation` only for debug/technical runs.
- For `quote_only` sources, produce a short Ukrainian fact-based retelling (not full republishing).
- Do not prepend retelling headers like `Короткий переказ матеріалу з ...` in visible `content`.
- For `quote_only` content, always include the source URL in the text body (`Джерело: ...`).

7. Prompt/source-of-truth alignment:
- If a user references `example.docs`/`exmp.docs`, treat it as the rule source for style and legal limits.
- If that document is missing locally, continue with these AGENTS rules and ask the user to provide the file path when available.

8. Source relevance gate:
- For mixed feeds (for example general news portals), ingest only automotive-relevant items.
- Run a title+URL relevance check before translation/publication.
- If an item is not automotive-relevant, skip it (do not publish and do not backfill photos for it).

9. Contact data sanitization:
- Remove personal media-contact details from visible article `content` before saving/publishing.
- Strip direct emails, direct phone numbers, and adjacent contact person name lines (for example press contact blocks).
- Keep company/public info URLs when they are part of factual article content.
