import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatDiagnostics, validateDecisionRepository } from "./lib/doc-decisions.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const requireBase = args.has("--require-base");
const baseRef = process.env.DOCS_BASE_REF?.trim() || null;

const result = await validateDecisionRepository(repoRoot, { baseRef, requireBase });
if (result.diagnostics.length > 0) {
  console.error(formatDiagnostics(result.diagnostics));
  process.exitCode = 1;
} else {
  const actionCounts = result.coverageRows.reduce(
    (counts, row) => ({ ...counts, [row.action]: (counts[row.action] ?? 0) + 1 }),
    {}
  );
  console.log(
    `Decision governance checks passed: ${result.manifest.entries.length} archived ADRs, ${result.currentLegacyCount} source ADRs audited, ${result.coverageRows.length} normative kernels (${actionCounts.migrated ?? 0} migrated, ${actionCounts.replaced ?? 0} replaced, ${actionCounts.retired ?? 0} retired), ${result.decisionFiles.length} version decision files.`
  );
}
