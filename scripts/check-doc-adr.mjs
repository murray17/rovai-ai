import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatDiagnostics, validateAdrRepository } from "./lib/doc-adr.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const requireBase = args.has("--require-base");
const printExceptionCandidates = args.has("--print-exception-candidates");
const baseRef = process.env.DOCS_BASE_REF?.trim() || null;

const result = await validateAdrRepository(repoRoot, { baseRef, requireBase });
if (result.diffSkipped) {
  console.log("ADR diff freeze skipped: DOCS_BASE_REF was not provided.");
}
if (result.suppressedDiagnostics.length > 0) {
  console.log(
    `ADR legacy exceptions applied: ${result.suppressedDiagnostics.length} exact known diagnostic(s).`
  );
}
if (result.diagnostics.length > 0) {
  console.error(
    formatDiagnostics(result.diagnostics, { includeFingerprint: printExceptionCandidates })
  );
  process.exitCode = 1;
} else {
  const current = result.adrs.filter(
    (adr) =>
      adr.data?.status === "accepted" &&
      adr.data?.decision_scope === "cross-version" &&
      adr.data?.superseded_by === null
  );
  console.log(
    `ADR governance checks passed: ${result.adrs.length} total, ${current.length} current cross-version.`
  );
}
