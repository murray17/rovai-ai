import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  normalizeLegacyBody,
  sha256,
  validateDecisionRepository,
} from "./doc-decisions.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const originalFrontMatter = `document_type: adr
id: ADR-0001
title: Test Decision
status: accepted
date: 2026-08-01
decision_scope: cross-version
source_version: v1.0
supersedes: []
superseded_by: null`;

const originalBody = `
# ADR-0001: Test Decision

## Context

Context text.

## Decision

Decision text.

## Consequences

Consequences text.

## Rejected Alternatives

Rejected text.
`;

async function createFixtureRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), "rovai-doc-decisions-"));
  for (const directory of [
    "docs/adr",
    "docs/architecture",
    "docs/decisions",
    "docs/versions/v1.0",
    "skills",
  ]) {
    await mkdir(path.join(root, directory), { recursive: true });
  }
  await writeFile(path.join(root, "README.md"), "# Root\n", "utf8");
  await writeFile(path.join(root, "AGENTS.md"), "# Agents\n", "utf8");
  await writeFile(path.join(root, "docs/README.md"), "# Docs\n", "utf8");
  await writeFile(path.join(root, "docs/adr/README.md"), "# Retired ADR\n", "utf8");
  await writeFile(
    path.join(root, "docs/versions/v1.0/README.md"),
    `---
document_type: version-overview
version: v1.0
lifecycle: historical
---

# v1.0
`,
    "utf8"
  );
  await writeFile(
    path.join(root, "docs/architecture/README.md"),
    `# Architecture

<!-- architecture-index:begin -->
- [Current](current.md)
<!-- architecture-index:end -->
`,
    "utf8"
  );
  await writeFile(
    path.join(root, "docs/architecture/current.md"),
    "# Current\n\n<a id=\"test-decision\"></a>\n\n## Test decision\n\nDecision text.\n",
    "utf8"
  );

  const entry = {
    legacy_id: "ADR-0001",
    source_path: "docs/adr/0001-test-decision.md",
    title: "Test Decision",
    status: "accepted",
    decision_scope: "cross-version",
    source_version: "v1.0",
    supersedes: [],
    intended_supersedes: [],
    superseded_by: null,
    original_front_matter: originalFrontMatter,
    original_front_matter_data: {
      document_type: "adr",
      id: "ADR-0001",
      title: "Test Decision",
      status: "accepted",
      date: "2026-08-01",
      decision_scope: "cross-version",
      source_version: "v1.0",
      supersedes: [],
      superseded_by: null,
    },
    original_body: originalBody,
    source_file_sha256: sha256(`---\n${originalFrontMatter}\n---\n${originalBody}`),
    source_body_sha256: sha256(originalBody),
    target_file: "docs/versions/v1.0/decisions.md",
    target_anchor: "adr-0001",
  };
  entry.normalized_migrated_body = normalizeLegacyBody(
    originalBody,
    entry,
    new Map([[entry.source_path, entry]])
  );
  entry.normalized_migrated_body_sha256 = sha256(entry.normalized_migrated_body);

  const manifest = {
    schema_version: 1,
    migration_kind: "numbered-adr-clean-break",
    baseline_commit: "1".repeat(40),
    source_count: 1,
    entries: [entry],
  };
  await writeFile(
    path.join(root, "docs/decisions/ADR-MIGRATION-MANIFEST.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(root, "docs/versions/v1.0/decisions.md"),
    `---
document_type: version-decisions
version: v1.0
lifecycle: historical
---

# v1.0 decisions

<a id="adr-0001"></a>

## ADR-0001：Test Decision

<!-- legacy-adr-body:begin id=ADR-0001 -->
${entry.normalized_migrated_body}<!-- legacy-adr-body:end id=ADR-0001 -->

<a id="v1-0-d01"></a>

## V1.0-D01：Fixture decision

<!-- authority-resolution:begin -->

<!-- authority-resolution:end -->
`,
    "utf8"
  );
  await writeFile(
    path.join(root, "docs/decisions/LEGACY-MAP.md"),
    `# Legacy map

| 原 ADR | 原路径 | 来源版本 | 原状态 | 新位置 |
| --- | --- | --- | --- | --- |
| ADR-0001 | \`docs/adr/0001-test-decision.md\` | \`v1.0\` | \`accepted\` | [target](../versions/v1.0/decisions.md#adr-0001) |
`,
    "utf8"
  );
  await writeFile(
    path.join(root, "docs/decisions/AUTHORITY-COVERAGE.md"),
    `---
document_type: decision-authority-coverage
authority: adr-clean-break-current-authority
baseline_commit: ${"1".repeat(40)}
resolution_source: docs/versions/v1.0/decisions.md#v1-0-d01
---

# Coverage

| 原 ADR | 主题 | 规范内核 | 当前有效 | 权威类型 | 当前权威 | 处理方式 |
| --- | --- | --- | --- | --- | --- | --- |
| ADR-0001 | \`core-data\` | Test Decision | 是 | Architecture | [current](../architecture/current.md#test-decision) | \`migrated\` |
`,
    "utf8"
  );
  return root;
}

async function validate(root) {
  return validateDecisionRepository(root, { includeLinks: false });
}

async function withFixture(callback) {
  const root = await createFixtureRepo();
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("a complete clean-break fixture passes", async () => {
  await withFixture(async (root) => {
    assert.deepEqual((await validate(root)).diagnostics, []);
  });
});

test("manifest and migrated-body tampering are rejected", async () => {
  await withFixture(async (root) => {
    const manifestPath = path.join(root, "docs/decisions/ADR-MIGRATION-MANIFEST.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.entries[0].original_body += "tampered\n";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    assert.ok(
      (await validate(root)).diagnostics.some((item) => item.rule === "DECISION_MANIFEST_BODY_HASH")
    );
  });

  await withFixture(async (root) => {
    const decisionPath = path.join(root, "docs/versions/v1.0/decisions.md");
    const text = await readFile(decisionPath, "utf8");
    await writeFile(decisionPath, text.replace("Decision text.", "Changed decision text."), "utf8");
    assert.ok(
      (await validate(root)).diagnostics.some((item) => item.rule === "DECISION_LEGACY_BODY")
    );
  });
});

test("missing and duplicate migration targets are rejected", async () => {
  await withFixture(async (root) => {
    await unlink(path.join(root, "docs/versions/v1.0/decisions.md"));
    assert.ok(
      (await validate(root)).diagnostics.some((item) => item.rule === "DECISION_TARGET_MISSING")
    );
  });

  await withFixture(async (root) => {
    const manifestPath = path.join(root, "docs/decisions/ADR-MIGRATION-MANIFEST.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.entries.push({ ...manifest.entries[0], legacy_id: "ADR-0002" });
    manifest.source_count = manifest.entries.length;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    assert.ok(
      (await validate(root)).diagnostics.some(
        (item) => item.rule === "DECISION_MANIFEST_DUPLICATE_TARGET"
      )
    );
  });
});

test("missing current-authority coverage is rejected", async () => {
  await withFixture(async (root) => {
    const coveragePath = path.join(root, "docs/decisions/AUTHORITY-COVERAGE.md");
    await writeFile(coveragePath, "# Coverage\n", "utf8");
    assert.ok(
      (await validate(root)).diagnostics.some((item) => item.rule === "DECISION_COVERAGE_MISSING")
    );
  });
});

test("coverage actions, authority anchors, and migration resolutions are enforced", async () => {
  await withFixture(async (root) => {
    const coveragePath = path.join(root, "docs/decisions/AUTHORITY-COVERAGE.md");
    const coverage = await readFile(coveragePath, "utf8");
    await writeFile(coveragePath, coverage.replace("| 是 | Architecture", "| 否 | Architecture"), "utf8");
    assert.ok(
      (await validate(root)).diagnostics.some((item) => item.rule === "DECISION_COVERAGE_CURRENT")
    );
  });

  await withFixture(async (root) => {
    const coveragePath = path.join(root, "docs/decisions/AUTHORITY-COVERAGE.md");
    const coverage = await readFile(coveragePath, "utf8");
    await writeFile(
      coveragePath,
      coverage.replace("#test-decision", "#missing-authority-fragment"),
      "utf8"
    );
    assert.ok(
      (await validate(root)).diagnostics.some((item) => item.rule === "DECISION_COVERAGE_TARGET")
    );
  });

  await withFixture(async (root) => {
    const coveragePath = path.join(root, "docs/decisions/AUTHORITY-COVERAGE.md");
    const coverage = await readFile(coveragePath, "utf8");
    await writeFile(
      coveragePath,
      coverage.replace("| 是 | Architecture", "| 否 | Architecture").replace("`migrated`", "`replaced`"),
      "utf8"
    );
    assert.ok(
      (await validate(root)).diagnostics.some((item) => item.rule === "DECISION_RESOLUTION_MISSING")
    );
  });

  await withFixture(async (root) => {
    const coveragePath = path.join(root, "docs/decisions/AUTHORITY-COVERAGE.md");
    const coverage = await readFile(coveragePath, "utf8");
    await writeFile(coveragePath, coverage.replace("#v1-0-d01", "#adr-0001"), "utf8");
    assert.ok(
      (await validate(root)).diagnostics.some((item) => item.rule === "DECISION_RESOLUTION_SOURCE")
    );
  });
});

test("migration resolutions remain valid after their source version becomes historical", async () => {
  await withFixture(async (root) => {
    const coveragePath = path.join(root, "docs/decisions/AUTHORITY-COVERAGE.md");
    const coverage = await readFile(coveragePath, "utf8");
    await writeFile(
      coveragePath,
      coverage.replace("| 是 | Architecture", "| 否 | Architecture").replace("`migrated`", "`replaced`"),
      "utf8"
    );
    const decisionPath = path.join(root, "docs/versions/v1.0/decisions.md");
    const decision = await readFile(decisionPath, "utf8");
    await writeFile(
      decisionPath,
      decision.replace(
        "<!-- authority-resolution:begin -->\n\n<!-- authority-resolution:end -->",
        `<!-- authority-resolution:begin -->

| 原 ADR | 受影响内核 | 裁决 | 理由 |
| --- | --- | --- | --- |
| ADR-0001 | Test Decision | \`replaced\` | test |

<!-- authority-resolution:end -->`
      ),
      "utf8"
    );
    await mkdir(path.join(root, "docs/versions/v1.1"), { recursive: true });
    await writeFile(
      path.join(root, "docs/versions/v1.1/README.md"),
      `---
document_type: version-overview
version: v1.1
lifecycle: current
---

# v1.1
`,
      "utf8"
    );

    assert.deepEqual((await validate(root)).diagnostics, []);
  });
});

test("PR gate runs one diff-aware documentation check without a main push trigger", async () => {
  const workflow = await readFile(
    path.join(repositoryRoot, ".github/workflows/ci.yml"),
    "utf8"
  );
  assert.doesNotMatch(workflow, /docs:adr:generate/);
  assert.ok(workflow.includes("DOCS_BASE_REF: ${{ github.event.pull_request.base.sha }}"));
  assert.doesNotMatch(workflow, /^\s+push:/m);
  assert.equal(workflow.match(/pnpm docs:check:ci/g)?.length, 1);
});

test("numbered ADR files and unmanifested ADR headings are rejected", async () => {
  await withFixture(async (root) => {
    await writeFile(path.join(root, "docs/adr/0002-new.md"), "# ADR-0002\n", "utf8");
    assert.ok(
      (await validate(root)).diagnostics.some((item) => item.rule === "DECISION_NUMBERED_ADR")
    );
  });

  await withFixture(async (root) => {
    const decisionPath = path.join(root, "docs/versions/v1.0/decisions.md");
    await writeFile(decisionPath, `${await readFile(decisionPath, "utf8")}\n## ADR-0002：New\n`, "utf8");
    assert.ok(
      (await validate(root)).diagnostics.some((item) => item.rule === "DECISION_NEW_LEGACY_ID")
    );
  });
});

test("version decision IDs require matching versions and explicit anchors", async () => {
  await withFixture(async (root) => {
    const decisionPath = path.join(root, "docs/versions/v1.0/decisions.md");
    const text = await readFile(decisionPath, "utf8");
    await writeFile(decisionPath, text.replace('<a id="v1-0-d01"></a>\n\n', ""), "utf8");
    assert.ok(
      (await validate(root)).diagnostics.some((item) => item.rule === "DECISION_ID_ANCHOR")
    );
  });

  await withFixture(async (root) => {
    const decisionPath = path.join(root, "docs/versions/v1.0/decisions.md");
    const text = await readFile(decisionPath, "utf8");
    await writeFile(
      decisionPath,
      text.replaceAll("v1-0-d01", "v2-0-d01").replaceAll("V1.0-D01", "V2.0-D01"),
      "utf8"
    );
    assert.ok(
      (await validate(root)).diagnostics.some((item) => item.rule === "DECISION_ID_VERSION")
    );
  });
});
