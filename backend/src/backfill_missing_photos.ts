import { backfillMissingPhotosForRun } from "./modules/photo-backfill.js";

interface BackfillPhotoCliOptions {
  output: string;
  latestRun: string;
  runPath: string;
  verbose: boolean;
}

function parseArgs(argv: string[]): BackfillPhotoCliOptions {
  const options: BackfillPhotoCliOptions = {
    output: "data/news.json",
    latestRun: "data/latest_run.json",
    runPath: "",
    verbose: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];

    if (key === "--output" && next) {
      options.output = next;
      i += 1;
      continue;
    }

    if (key === "--latest-run" && next) {
      options.latestRun = next;
      i += 1;
      continue;
    }

    if (key === "--run-path" && next) {
      options.runPath = next;
      i += 1;
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
  const summary = await backfillMissingPhotosForRun({
    outputPath: options.output,
    latestRunPath: options.latestRun,
    runPath: options.runPath,
    verbose: options.verbose,
  });

  // eslint-disable-next-line no-console
  console.log(
    [
      "Photo backfill finished:",
      `run=${summary.run_path};`,
      `missing_before=${summary.missing_before};`,
      `cleaned_items=${summary.cleaned_items};`,
      `removed_broken_photo_refs=${summary.removed_broken_photo_refs};`,
      `updated_items=${summary.updated_items};`,
      `updated_photos=${summary.updated_photos};`,
      `remaining_missing=${summary.remaining_missing};`,
      `synced_snapshot_items=${summary.synced_snapshot_items}`,
    ].join(" "),
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(`Photo backfill failed: ${String(error)}`);
  process.exitCode = 1;
});
