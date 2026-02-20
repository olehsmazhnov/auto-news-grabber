# Codex Daily Instruction

Run this command every time you need a fresh scrape (you can run it multiple times per day):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run_daily.ps1
```
By default this run translates content to Ukrainian (`uk`).
`scripts/run_daily.ps1` automatically runs photo backfill right after scrape.

Operational rules to enforce every run:
- Mixed feeds must pass automotive relevance gate (title + URL context). Skip non-auto items.
- Photo fallback order: source/feed images -> context-aware Wikimedia (title + content + URL tokens) -> brand/model fallback -> generic automotive Wikimedia.
- After scrape, if any item still has `photos: []`, run photo backfill for the latest run.
- For backfill operations, keep outputs synchronized: `data/news.json`, `data/runs/<run_id>/news.json`, `article.json`, `article.md`.
- Keep backend logic split into small modules/functions. Prefer pure/testable functions under `backend/src/modules/` and keep orchestration thin in entry files.

After completion:
1. Check `data/latest_run.json` for the latest run id/path.
2. Verify `data/news.json` was updated.
3. Verify `data/seen_news_index.json` exists (dedupe index).
4. Open viewer:
```powershell
npm start
```
5. Go to `http://localhost:8000/viewer/`.
6. Spot-check a few `article.json` files to confirm `photos[]` is filled; when source images are missing, Wikimedia fallback should be used in the required order.
7. Verify fallback internet photos are context-relevant and not repeated across multiple articles in the same run.
8. Quick duplicate photo check (latest run):
```powershell
$run = (Get-Content data/latest_run.json -Raw | ConvertFrom-Json).run_path
$items = Get-Content "$run/news.json" -Raw | ConvertFrom-Json
$dups = $items | ForEach-Object { $_.photos } | Group-Object source_url | Where-Object { $_.Count -gt 1 }
"duplicate_photo_urls=" + $dups.Count
```
9. Quick photo-text mismatch check (latest run):
```powershell
$run = (Get-Content data/latest_run.json -Raw | ConvertFrom-Json).run_path
$items = Get-Content "$run/news.json" -Raw | ConvertFrom-Json
function Tokens([string]$text) {
  return (($text.ToLower() -replace '[^\p{L}\p{N}\s-]', ' ') -split '\s+') | Where-Object { $_.Length -ge 4 } | Select-Object -Unique
}
$mismatch = 0
foreach ($item in $items) {
  if (-not $item.photos -or $item.photos.Count -eq 0) { continue }
  $ctx = Tokens("$($item.title) $($item.content) $($item.url)")
  $ok = $false
  foreach ($photo in $item.photos) {
    $meta = ("$($photo.source_url) $($photo.attribution_url) $($photo.credit)").ToLower()
    if ($ctx | Where-Object { $meta.Contains($_) }) { $ok = $true; break }
  }
  if (-not $ok) { $mismatch++ }
}
"photo_text_mismatch_items=" + $mismatch
```
10. Quick contact-leak check (latest run content must not contain direct emails/phones):
```powershell
$run = (Get-Content data/latest_run.json -Raw | ConvertFrom-Json).run_path
$items = Get-Content "$run/news.json" -Raw | ConvertFrom-Json
$leaks = $items | Where-Object {
  $c = "$($_.content)"
  $c -match '[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}' -or $c -match '(\\+?\\d[\\d\\s().-]{6,}\\d)'
}
"contact_leak_items=" + @($leaks).Count
$leaks | Select-Object source_id,title,url
```
11. Quick mixed-source relevance check (heuristic, latest run):
```powershell
$run = (Get-Content data/latest_run.json -Raw | ConvertFrom-Json).run_path
$items = Get-Content "$run/news.json" -Raw | ConvertFrom-Json
$mixed = $items | Where-Object { $_.source -in @('Focus','ITC.ua') }
$suspect = $mixed | Where-Object {
  $t = "$($_.title) $($_.url)".ToLower()
  $t -notmatch 'auto|car|cars|vehicle|suv|truck|ev|fuel|oil|motor|авто|автомоб|авторин|пальн|нафт|бензин|дизел'
}
"mixed_source_suspect_items=" + @($suspect).Count
$suspect | Select-Object source_id,title,url
```
12. Snapshot sync check after backfill:
```powershell
$run = (Get-Content data/latest_run.json -Raw | ConvertFrom-Json).run_path
$latest = Get-Content data/news.json -Raw | ConvertFrom-Json
$runItems = Get-Content "$run/news.json" -Raw | ConvertFrom-Json
$runById = @{}
foreach ($x in $runItems) { $runById[$x.id] = $x }
$mismatch = 0
foreach ($x in $latest) {
  if (-not $runById.ContainsKey($x.id)) { $mismatch++; continue }
  $a = @($x.photos).Count
  $b = @($runById[$x.id].photos).Count
  if ($a -ne $b) { $mismatch++ }
}
"snapshot_sync_mismatch_items=" + $mismatch
```
13. Optional watermark hint check (latest run):
```powershell
$run = (Get-Content data/latest_run.json -Raw | ConvertFrom-Json).run_path
$items = Get-Content "$run/news.json" -Raw | ConvertFrom-Json
$wm = $items | ForEach-Object { $_.photos } | Where-Object { $_.source_url -match 'watermark' -or $_.attribution_url -match 'watermark' }
"watermark_hints=" + @($wm).Count
```
14. If duplicates/context/relevance/sync issues appear, rerun scrape after source tuning:
```powershell
powershell -ExecutionPolicy Bypass -File scripts/run_daily.ps1
```

If you need a faster run without translation:
```powershell
powershell -ExecutionPolicy Bypass -File scripts/run_daily.ps1 -NoTranslate
```

If you want to set language explicitly:
```powershell
powershell -ExecutionPolicy Bypass -File scripts/run_daily.ps1 -TargetLanguage uk
```

Manual photo-backfill only (latest run):
```powershell
npm run backfill:photos
```

Optional Windows scheduler (every 6 hours):
```powershell
schtasks /Create /F /SC HOURLY /MO 6 /TN "AutoNewsGrabber" /TR "powershell.exe -ExecutionPolicy Bypass -File C:\projects\auto-news-grabber\scripts\run_daily.ps1"
```
