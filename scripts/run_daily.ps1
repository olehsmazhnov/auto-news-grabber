param(
    [string]$Config = "backend/sources.json",
    [string]$Output = "data/news.json",
    [string]$TargetLanguage = "uk",
    [int]$MaxItemsPerSource = 4,
    [switch]$NoTranslate
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

if (-not (Test-Path "node_modules")) {
    npm install
}

npm run build:backend --silent
if ($LASTEXITCODE -ne 0) {
    throw "TypeScript backend build failed with exit code $LASTEXITCODE"
}

$cmd = @(
    "dist/scrape_news.js",
    "--config", $Config,
    "--output", $Output,
    "--target-language", $TargetLanguage,
    "--max-items-per-source", $MaxItemsPerSource,
    "--verbose"
)

if ($NoTranslate) {
    $cmd += "--disable-translation"
}

node @cmd
if ($LASTEXITCODE -ne 0) {
    throw "Daily run failed with exit code $LASTEXITCODE"
}

Write-Host "News saved to $Output"
Write-Host "Translation target: $TargetLanguage"
if (Test-Path "data/latest_run.json") {
    $latest = Get-Content "data/latest_run.json" -Raw | ConvertFrom-Json
    $failedResources = 0
    if ($null -ne $latest.resource_totals) {
        $failedResources = [int]$latest.resource_totals.failed_resources
    }
    Write-Host ("Latest run: {0}; items: {1}; failed resources: {2}" -f $latest.run_id, $latest.total_items, $failedResources)
}
Write-Host "Run history: data/run_history.json"
Write-Host "Daily health: data/daily_health.json"
Write-Host "To view results, run: npm start"
Write-Host "Then open: http://localhost:8000/viewer/"
