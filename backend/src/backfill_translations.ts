import { backfillSnapshotTranslations } from "./modules/translation-backfill.js";

interface CliOptions {
  output: string;
  targetLanguage: string;
  verbose: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    output: "data/news.json",
    targetLanguage: "uk",
    verbose: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const next = argv[index + 1];

    if (key === "--output" && next) {
      options.output = next;
      index += 1;
      continue;
    }

    if (key === "--target-language" && next) {
      options.targetLanguage = next;
      index += 1;
      continue;
    }

    if (key === "--verbose") {
      options.verbose = true;
    }
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await backfillSnapshotTranslations({
    outputPath: options.output,
    targetLanguage: options.targetLanguage,
    verbose: options.verbose,
  });

  // eslint-disable-next-line no-console
  console.log(
    [
      "Translation backfill finished:",
      `output=${result.output_path};`,
      `scanned=${result.scanned_items};`,
      `updated=${result.updated_items};`,
      `titles=${result.updated_titles};`,
      `contents=${result.updated_contents};`,
      `run_files=${result.updated_run_files};`,
      `article_files=${result.updated_article_files}`,
    ].join(" "),
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(`Translation backfill failed: ${String(error)}`);
  process.exitCode = 1;
});
