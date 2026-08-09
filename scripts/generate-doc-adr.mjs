import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyLegacyExceptions,
  formatDiagnostics,
  loadAdrRepository,
  renderHistory,
} from "./lib/doc-adr.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");
const historyPath = path.join(repoRoot, "docs", "adr", "HISTORY.md");

const repository = await loadAdrRepository(repoRoot);
const exceptions = await applyLegacyExceptions(repoRoot, repository.diagnostics);
if (exceptions.diagnostics.length > 0) {
  console.error(formatDiagnostics(exceptions.diagnostics));
  process.exitCode = 1;
} else {
  const expected = renderHistory(repository.adrs);
  if (checkOnly) {
    let actual = "";
    try {
      actual = (await readFile(historyPath, "utf8")).replace(/\r\n?/g, "\n");
    } catch {
      // Missing output is reported as stale below.
    }
    if (actual !== expected) {
      console.error("docs/adr/HISTORY.md is stale; run pnpm docs:adr:generate");
      process.exitCode = 1;
    } else {
      console.log("ADR HISTORY is up to date.");
    }
  } else {
    await writeFile(historyPath, expected, "utf8");
    console.log(`Generated docs/adr/HISTORY.md from ${repository.adrs.length} ADR files.`);
  }
}
