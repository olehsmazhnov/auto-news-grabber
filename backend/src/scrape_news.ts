import { runScrapePipeline } from "./modules/scrape-runner.js";
import { parseArgs } from "./utils/cli.js";
import { log } from "./utils/log.js";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const result = await runScrapePipeline({
    configPath: options.config,
    outputPath: options.output,
    targetLanguage: options.targetLanguage,
    disableTranslation: options.disableTranslation,
    maxItemsPerSource: options.maxItemsPerSource,
    maxContentChars: options.maxContentChars,
    verbose: options.verbose,
  });

  log(
    [
      "Photo backfill finished:",
      `missing_before=${result.backfill.missing_before};`,
      `updated_items=${result.backfill.updated_items};`,
      `updated_photos=${result.backfill.updated_photos};`,
      `remaining_missing=${result.backfill.remaining_missing};`,
    ].join(" "),
    options.verbose,
  );

  // eslint-disable-next-line no-console
  console.log(
    [
      `Saved ${result.run.total_items} unique new items to ${options.output}`,
      `(run: ${result.run.run_path}; collected: ${result.translated_items}; failed resources: ${result.run.resource_totals.failed_resources})`,
    ].join(" "),
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(`Scrape failed: ${String(error)}`);
  process.exitCode = 1;
});

