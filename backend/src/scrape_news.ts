import { parseArgs } from "./utils/cli.js";
import { log } from "./utils/log.js";
import { collectItems, saveOutput, translateItems } from "./scraper.js";
import { loadSources } from "./utils/sources.js";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const sources = await loadSources(options.config, options.maxItemsPerSource);
  log(`Loaded ${sources.length} sources`, options.verbose);

  const scrapedAt = new Date().toISOString();
  const collected = await collectItems(sources, scrapedAt, options.verbose);
  log(`Collected ${collected.items.length} unique items`, options.verbose);

  const translated = await translateItems(collected.items, {
    translationEnabled: !options.disableTranslation,
    targetLanguage: options.targetLanguage,
    maxContentChars: options.maxContentChars,
    verbose: options.verbose,
  });

  const run = await saveOutput(
    translated,
    options.output,
    scrapedAt,
    collected.source_reports,
    options.verbose,
  );

  // eslint-disable-next-line no-console
  console.log(
    [
      `Saved ${run.total_items} unique new items to ${options.output}`,
      `(run: ${run.run_path}; collected: ${translated.length}; failed resources: ${run.resource_totals.failed_resources})`,
    ].join(" "),
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(`Scrape failed: ${String(error)}`);
  process.exitCode = 1;
});
