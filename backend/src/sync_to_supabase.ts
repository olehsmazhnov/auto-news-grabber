import {
  parseSupabaseSyncScope,
  syncNewsToSupabase,
  type SupabaseSyncScope,
} from "./modules/supabase-sync.js";

interface CliOptions {
  scope: SupabaseSyncScope;
  dataDir: string;
  verbose: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    scope: "latest_run",
    dataDir: "data",
    verbose: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const next = argv[index + 1];

    if (key === "--scope" && next) {
      options.scope = parseSupabaseSyncScope(next);
      index += 1;
      continue;
    }

    if (key === "--data-dir" && next) {
      options.dataDir = next;
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
  const result = await syncNewsToSupabase({
    scope: options.scope,
    dataDir: options.dataDir,
    verbose: options.verbose,
  });

  // eslint-disable-next-line no-console
  console.log(
    [
      "Supabase sync finished:",
      `scope=${result.scope};`,
      `source=${result.source_file};`,
      `selected=${result.selected_items};`,
      `unique=${result.unique_items};`,
      `submitted=${result.submitted_rows}`,
    ].join(" "),
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(`Supabase sync failed: ${String(error)}`);
  process.exitCode = 1;
});
