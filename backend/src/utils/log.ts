export function log(message: string, verbose: boolean): void {
  if (!verbose) {
    return;
  }
  // eslint-disable-next-line no-console
  console.log(message);
}
