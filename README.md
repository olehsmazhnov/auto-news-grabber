# Auto News Grabber

Daily auto-news pipeline with translation to Ukrainian, long-form content, dated items, local article folders, and photo handling.

## What this project does
- Scrapes configurable automotive RSS/news sources from `backend/sources.json`
- Produces news in JSON with required fields:
  - `title`
  - `content`
  - `url`
  - `source`
- Adds operational metadata:
  - `published_at`, `published_date`, `published_time`
  - `scraped_at`
  - `rights_flag`, `license_text`
  - `article_path`, `photos[]`
- Translates title/content to Ukrainian by default
- Builds a React/TS viewer (`viewer/src/app.tsx`)
- Saves each run into its own timestamped folder for multiple runs per day

## Project structure
- `backend/src/scrape_news.ts` - scraper entrypoint
- `backend/src/scraper.ts` - collection/translation/run-save orchestration (thin orchestrator)
- `backend/src/modules/news-content.ts` - feed/article content extraction helpers
- `backend/src/modules/news-item-keys.ts` - dedupe and stable key generation
- `backend/src/modules/seen-news-index.ts` - seen-index load/filter/update helpers
- `backend/src/modules/output-storage.ts` - article/run output writing helpers
- `backend/src/utils/*.ts` - parsing, HTTP, photos, markdown, dates, etc.
- `backend/sources.json` - source list + rights policy per source
- `data/news.json` - latest snapshot
- `data/latest_run.json` - pointer to latest run
- `data/run_history.json` - history of run summaries
- `data/daily_health.json` - per-day good/failed resource status
- `data/seen_news_index.json` - persistent dedupe index (prevents repeated news across runs)
- `data/runs/<run_id>/...` - per-run folders with article files and images
- `viewer/src/app.tsx` - TypeScript viewer source
- `dist/viewer/app.js` - generated viewer bundle
- `scripts/run_daily.ps1` - daily run script

## Setup
```powershell
npm install
```

## Build
```powershell
npm run build
```

## Code organization rule
- Keep features split into small, focused, testable modules.
- Prefer pure functions for parsing/normalization/keying logic.
- Keep orchestration files (`scraper.ts`, scripts, CLI entrypoints) focused on flow wiring, not large in-file business logic.

## Run scrape once
```powershell
npm run scrape
```

## Run scrape once without translation
```powershell
npm run scrape:no-translate
```

## Daily run command
```powershell
powershell -ExecutionPolicy Bypass -File scripts/run_daily.ps1
```
This uses Ukrainian translation by default (`-TargetLanguage uk`).
The script also runs automatic photo backfill for latest-run items that still have `photos: []`.

## Daily run without translation
```powershell
powershell -ExecutionPolicy Bypass -File scripts/run_daily.ps1 -NoTranslate
```

## Daily run with explicit language
```powershell
powershell -ExecutionPolicy Bypass -File scripts/run_daily.ps1 -TargetLanguage uk
```

## Photo backfill only (latest run)
```powershell
npm run backfill:photos
```

## Viewer
```powershell
npm start
```
Open `http://localhost:8000/viewer/`

## Viewer Dev (watch + auto restart)
```powershell
npm run viewer:dev
```
This command watches backend/viewer files, rebuilds on change, and restarts the server automatically.

## Output model
Every item in `data/news.json` contains at least:
- `id`, `source_id`, `title`, `content`, `url`, `source`
- `published_at`, `published_date`, `published_time`, `scraped_at`
- `article_path`
- `rights_flag`, `license_text`
- `photos[]` with license/credit/attribution metadata

Latest run files now also include:
- `source_reports[]` with per-resource status (`ok`/`empty`/`failed`), errors, and item counts
- `resource_totals` with aggregate resource health for the run
- `collected_items` and `skipped_seen_items`

## Uniqueness policy
- The pipeline deduplicates items inside each run (canonical URL + title/date keying).
- The pipeline also skips already-seen items across runs using `data/seen_news_index.json`.
- `data/runs/<run_id>/news.json` contains only fresh unique items for that run.
- `data/news.json` is the accumulated unique snapshot (new items are prepended, repeats are skipped).

## Translation policy
- Default language for `title` and `content` is Ukrainian.
- `quote_only` items are stored as short Ukrainian retellings with a mandatory source line.
- Retellings should not include visible headers like `Короткий переказ матеріалу з ...`.
- Use `-NoTranslate` only for debug/technical checks.

## Per-run folder layout
```text
data/runs/<run_id>/
  news.json
  run_summary.json
  <article-folder>/
    article.json
    article.md
    images/
      photo-1.jpg
      photo-2.png
```

## Photo policy
- For `official_press` sources, the pipeline tries source/metadata images first and can fallback to Wikimedia Commons lookup.
- For `quote_only` sources, the pipeline uses only Wikimedia Commons (publicly licensed) candidates.
- If no image is downloaded in the first pass, the pipeline runs an additional Wikimedia fallback search using article context (title + content + URL tokens), and only then generic automotive queries.
- After each daily run, a post-step checks latest-run items with `photos: []` and retries photo search/backfill, syncing snapshot + run + article files.
- Even in generic fallback mode, candidates must pass context relevance checks against the article.
- Non-photographic assets (for example charts, diagrams, logos, icons, maps, screenshots) are filtered out.
- Watermarked assets are rejected by URL/metadata hints when detected.
- The pipeline avoids reusing the same Wikimedia fallback image across different articles in the same run when alternatives exist.
- Each saved photo has attribution metadata.
- If no relevant publicly licensed image is found, the item is saved without photos (`photos: []`).
- If license is unknown, it is explicitly marked and requires manual review before publication.

## Customize sources
Edit `backend/sources.json`:
- `enabled`
- `max_items`
- `rights_flag` (for example `official_press`, `quote_only`)
- `license_text`

## Task Scheduler (optional)
Use this command as daily action:
```text
powershell.exe -ExecutionPolicy Bypass -File C:\projects\auto-news-grabber\scripts\run_daily.ps1
```

Example: run every 6 hours (4 times/day):
```powershell
schtasks /Create /F /SC HOURLY /MO 6 /TN "AutoNewsGrabber" /TR "powershell.exe -ExecutionPolicy Bypass -File C:\projects\auto-news-grabber\scripts\run_daily.ps1"
```
