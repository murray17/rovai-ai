import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ADR_TOPICS,
  applyLegacyExceptions,
  diagnosticFingerprint,
  discoverAdrFiles,
  parseAdrText,
  parseCurrentPrimary,
  renderHistory,
  sha256,
  validateAdrDiff,
  validateAdrDocument,
  validateAdrRepository,
  validateArchitectureIndex,
  validateMarkdownLinks,
  validateSupersessionGraph,
} from "./doc-adr.mjs";

function adrText({
  id = "ADR-0001",
  title = "Test Decision",
  status = "accepted",
  scope = "cross-version",
  source = "v1.0",
  supersedes = "[]",
  intended,
  successor = "null",
  newline = "\n",
  extra = "",
  sections = true,
} = {}) {
  const candidate = intended === undefined ? "" : `intended_supersedes: ${intended}\n`;
  const body = sections
    ? `# ${id}: ${title}

## Context

Context text.

## Decision

Decision text.

## Consequences

Consequences text.

## Rejected Alternatives

Rejected text.

## References

- [Version](../versions/${source}/README.md)
`
    : `# ${id}: ${title}\n`;
  return `---
document_type: adr
id: ${id}
title: ${title}
status: ${status}
date: 2026-08-09
decision_scope: ${scope}
source_version: ${source}
supersedes: ${supersedes}
${candidate}superseded_by: ${successor}
${extra}---

${body}`.replace(/\n/g, newline);
}

function parsed(text, filePath = "docs/adr/0001-test-decision.md") {
  const value = parseAdrText(text, filePath);
  value.knownVersions = new Set(["v1.0"]);
  return value;
}

function currentText(entriesByTopic) {
  return ADR_TOPICS.map((topic) => {
    const rows = (entriesByTopic[topic] ?? [])
      .map(({ id, target, title }) => `| [${id}](${target}) | ${title} |`)
      .join("\n");
    return `## ${topic}

<!-- adr-current-primary:begin topic=${topic} -->
| ADR | Decision |
| --- | --- |
${rows}
<!-- adr-current-primary:end -->`;
  }).join("\n\n");
}

async function createFixtureRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), "rovai-doc-adr-"));
  await mkdir(path.join(root, "docs", "adr"), { recursive: true });
  await mkdir(path.join(root, "docs", "architecture"), { recursive: true });
  await mkdir(path.join(root, "docs", "versions", "v1.0"), { recursive: true });
  await writeFile(path.join(root, "README.md"), "# Root\n", "utf8");
  await writeFile(path.join(root, "AGENTS.md"), "# Agents\n", "utf8");
  await writeFile(path.join(root, "docs", "README.md"), "# Docs\n", "utf8");
  await writeFile(path.join(root, "docs", "versions", "v1.0", "README.md"), "# v1.0\n", "utf8");
  await writeFile(path.join(root, "docs", "adr", "README.md"), "# ADR\n", "utf8");
  await writeFile(path.join(root, "docs", "adr", "TEMPLATE.md"), "# Template\n", "utf8");
  await writeFile(
    path.join(root, "docs", "architecture", "README.md"),
    `# Architecture

<!-- architecture-index:begin -->
| Architecture | Description |
| --- | --- |
| [Core](core.md) | Core |
<!-- architecture-index:end -->
`,
    "utf8"
  );
  await writeFile(path.join(root, "docs", "architecture", "core.md"), "# Core\n", "utf8");
  const adrPath = path.join(root, "docs", "adr", "0001-test-decision.md");
  await writeFile(adrPath, adrText(), "utf8");
  const adr = parsed(await readFile(adrPath, "utf8"));
  await writeFile(
    path.join(root, "docs", "adr", "CURRENT.md"),
    currentText({
      "core-data": [
        { id: "ADR-0001", target: "0001-test-decision.md", title: "Test Decision" },
      ],
    }),
    "utf8"
  );
  await writeFile(path.join(root, "docs", "adr", "HISTORY.md"), renderHistory([adr]), "utf8");
  await writeFile(
    path.join(root, "docs", "adr", "legacy-exceptions.json"),
    `${JSON.stringify({ schema_version: 1, exceptions: [] }, null, 2)}\n`,
    "utf8"
  );
  return root;
}

test("YAML parser accepts quoted scalars, block arrays, null, and CRLF", () => {
  const text = adrText({
    title: '"Quoted: title"',
    status: "superseded",
    supersedes: "\n  - ADR-0000",
    successor: "ADR-0002",
    newline: "\r\n",
  });
  const adr = parsed(text);
  assert.equal(adr.data.title, "Quoted: title");
  assert.deepEqual(adr.data.supersedes, ["ADR-0000"]);
  assert.equal(adr.data.superseded_by, "ADR-0002");
  assert.equal(adr.diagnostics.length, 0);
});

test("YAML parser rejects duplicate keys, anchors, aliases, merge keys, and tags", () => {
  const cases = [
    ["title: Duplicate\n", "ADR_YAML_PARSE"],
    ["extra: &value test\n", "ADR_YAML_ANCHOR"],
    ["extra: *value\n", "ADR_YAML_ALIAS"],
    ["<<: {extra: value}\n", "ADR_YAML_MERGE"],
    ["extra: !custom value\n", "ADR_YAML_TAG"],
  ];
  for (const [extra, expectedRule] of cases) {
    const text = adrText({ extra });
    if (expectedRule === "ADR_YAML_PARSE") {
      const duplicate = text.replace("title: Test Decision\n", "title: Test Decision\ntitle: Duplicate\n");
      assert.ok(parsed(duplicate).diagnostics.some((diagnostic) => diagnostic.rule === expectedRule));
    } else {
      assert.ok(parsed(text).diagnostics.some((diagnostic) => diagnostic.rule === expectedRule));
    }
  }
});

test("ADR snapshot rejects unknown fields and string null", () => {
  const unknown = parsed(adrText({ extra: "implementation_status: complete\n" }));
  const unknownDiagnostics = validateAdrDocument(unknown, "/tmp");
  assert.ok(unknownDiagnostics.some((diagnostic) => diagnostic.rule === "ADR_UNKNOWN_FIELD"));

  const stringNull = parsed(adrText({ successor: '"null"' }));
  const nullDiagnostics = validateAdrDocument(stringNull, "/tmp");
  assert.ok(nullDiagnostics.some((diagnostic) => diagnostic.rule === "ADR_SUPERSEDED_BY_TYPE"));
});

test("ADR source_version must resolve to a real version overview", () => {
  const adr = parsed(adrText({ source: "v2.0" }));
  const diagnostics = validateAdrDocument(adr, "/tmp");
  assert.ok(
    diagnostics.some((diagnostic) => diagnostic.rule === "ADR_SOURCE_VERSION_MISSING")
  );
});

test("a version directory without an exact README overview is not a valid ADR source", async () => {
  const root = await createFixtureRepo();
  try {
    await mkdir(path.join(root, "docs", "versions", "v2.0"));
    const adrPath = path.join(root, "docs", "adr", "0001-test-decision.md");
    await writeFile(adrPath, adrText({ source: "v2.0" }), "utf8");
    const result = await validateAdrRepository(root, { includeLinks: false });
    assert.ok(
      result.diagnostics.some((diagnostic) => diagnostic.rule === "ADR_SOURCE_VERSION_MISSING")
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("intended_supersedes is optional and only non-empty for proposed ADRs", () => {
  const accepted = parsed(adrText());
  assert.equal(validateAdrDocument(accepted, "/tmp").length, 0);

  const proposed = parsed(
    adrText({ status: "proposed", intended: "[ADR-0000]", successor: "null" })
  );
  assert.equal(validateAdrDocument(proposed, "/tmp").length, 0);

  const invalid = parsed(adrText({ intended: "[ADR-0000]" }));
  assert.ok(
    validateAdrDocument(invalid, "/tmp").some(
      (diagnostic) => diagnostic.rule === "ADR_INTENDED_STATE"
    )
  );
});

test("new ADR sections require canonical spelling, order, and content", () => {
  const wrongCase = parsed(adrText().replace("## Rejected Alternatives", "## Rejected alternatives"));
  assert.ok(
    validateAdrDocument(wrongCase, "/tmp", { strictSections: true }).some(
      (diagnostic) => diagnostic.rule === "ADR_SECTION_CASE"
    )
  );
  const missing = parsed(adrText().replace("## Context\n\nContext text.\n\n", ""));
  assert.ok(
    validateAdrDocument(missing, "/tmp", { strictSections: true }).some(
      (diagnostic) => diagnostic.rule === "ADR_SECTION_COUNT"
    )
  );
  const wrongH1 = parsed(adrText().replace("# ADR-0001:", "# ADR-0002:"));
  assert.ok(
    validateAdrDocument(wrongH1, "/tmp", { strictSections: true }).some(
      (diagnostic) => diagnostic.rule === "ADR_H1_ID"
    )
  );
  const sectionAfterReferences = parsed(`${adrText()}\n## Addendum\n\nChanged decision.\n`);
  assert.ok(
    validateAdrDocument(sectionAfterReferences, "/tmp", { strictSections: true }).some(
      (diagnostic) => diagnostic.rule === "ADR_REFERENCES_LAST"
    )
  );
});

test("direct supersession chain is reciprocal and terminates at a current ADR", () => {
  const first = parsed(
    adrText({ id: "ADR-0001", status: "superseded", successor: "ADR-0002" }),
    "docs/adr/0001-first.md"
  );
  const second = parsed(
    adrText({
      id: "ADR-0002",
      status: "superseded",
      supersedes: "[ADR-0001]",
      successor: "ADR-0003",
    }),
    "docs/adr/0002-second.md"
  );
  const third = parsed(
    adrText({ id: "ADR-0003", supersedes: "[ADR-0002]" }),
    "docs/adr/0003-third.md"
  );
  assert.deepEqual(validateSupersessionGraph([first, second, third]), []);

  first.data.superseded_by = "ADR-0003";
  assert.ok(
    validateSupersessionGraph([first, second, third]).some(
      (diagnostic) => diagnostic.rule === "ADR_SUPERSESSION_RECIPROCAL"
    )
  );
});

test("supersession graph rejects cycles and missing terminal states", () => {
  const first = parsed(
    adrText({
      id: "ADR-0001",
      status: "superseded",
      supersedes: "[ADR-0002]",
      successor: "ADR-0002",
    }),
    "docs/adr/0001-first.md"
  );
  const second = parsed(
    adrText({
      id: "ADR-0002",
      status: "superseded",
      supersedes: "[ADR-0001]",
      successor: "ADR-0001",
    }),
    "docs/adr/0002-second.md"
  );
  const diagnostics = validateSupersessionGraph([first, second]);
  assert.ok(diagnostics.some((diagnostic) => diagnostic.rule === "ADR_SUPERSESSION_CYCLE"));
});

test("CURRENT parser counts only explicit primary blocks", () => {
  const text = `${currentText({
    memory: [{ id: "ADR-0001", target: "0001-test-decision.md", title: "Test \\| Decision" }],
  })}\n\nRelated: [ADR-0001](0001-test-decision.md) and ADR-0001.`;
  const parsedCurrent = parseCurrentPrimary(text);
  assert.equal(parsedCurrent.entries.length, 1);
  assert.equal(parsedCurrent.entries[0].topic, "memory");
  assert.equal(parsedCurrent.entries[0].title, "Test | Decision");
  assert.deepEqual(parsedCurrent.diagnostics, []);
});

test("HISTORY rendering is deterministic and uses direct successor only", () => {
  const first = parsed(
    adrText({ id: "ADR-0001", status: "superseded", successor: "ADR-0002" }),
    "docs/adr/0001-first.md"
  );
  const second = parsed(
    adrText({ id: "ADR-0002", supersedes: "[ADR-0001]" }),
    "docs/adr/0002-second.md"
  );
  const one = renderHistory([second, first]);
  const two = renderHistory([first, second]);
  assert.equal(one, two);
  assert.match(one, /\[ADR-0002\]\(0002-second\.md\)/);
  assert.ok(one.endsWith("\n"));
});

test("ADR discovery reports invalid names instead of hiding them behind a valid glob", async () => {
  const root = await createFixtureRepo();
  try {
    await writeFile(path.join(root, "docs", "adr", "0149-Bad_Name.md"), "# bad\n", "utf8");
    const result = await discoverAdrFiles(root);
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.rule === "ADR_FILENAME"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ADR discovery rejects nested Markdown even inside the amendment registry", async () => {
  const root = await createFixtureRepo();
  try {
    const amendmentDirectory = path.join(root, "docs", "adr", "amendments");
    await mkdir(amendmentDirectory);
    await writeFile(path.join(amendmentDirectory, "0002-hidden.md"), adrText(), "utf8");
    const result = await discoverAdrFiles(root);
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.rule === "ADR_SUBDIRECTORY" &&
          diagnostic.path === "docs/adr/amendments/0002-hidden.md"
      )
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Architecture index dynamically covers every architecture Markdown file", () => {
  const index = `# Architecture

<!-- architecture-index:begin -->
| Architecture | Description |
| --- | --- |
| [Core](core.md) | Core |
<!-- architecture-index:end -->
`;
  const paths = [
    "docs/architecture/README.md",
    "docs/architecture/core.md",
    "docs/architecture/future-topic.md",
    "docs/architecture/nested/README.md",
  ];
  assert.ok(
    validateArchitectureIndex(index, paths).some(
      (diagnostic) => diagnostic.rule === "ARCHITECTURE_INDEX_MISSING"
    )
  );
  assert.ok(
    validateArchitectureIndex(`${index}<!-- architecture-index:end -->\n`, paths).some(
      (diagnostic) => diagnostic.rule === "ARCHITECTURE_INDEX_MARKER"
    )
  );
});

test("Markdown link check ignores code fences and validates GFM fragments", async () => {
  const root = await createFixtureRepo();
  try {
    await writeFile(
      path.join(root, "docs", "README.md"),
      `# Docs

[Valid](target.md#重复标题-1)

\`[inline](missing-inline.md)\`

\`\`\`markdown
[fenced](missing-fenced.md)
\`\`\`
`,
      "utf8"
    );
    await writeFile(
      path.join(root, "docs", "target.md"),
      "# Target\n\n## 重复标题\n\n## 重复标题\n",
      "utf8"
    );
    const valid = await validateMarkdownLinks(root);
    assert.deepEqual(valid.diagnostics, []);

    await writeFile(path.join(root, "docs", "README.md"), "# Docs\n\n[Bad](target.md#missing)\n", "utf8");
    const invalid = await validateMarkdownLinks(root);
    assert.ok(
      invalid.diagnostics.some((diagnostic) => diagnostic.rule === "MARKDOWN_FRAGMENT_MISSING")
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repository integration snapshot passes without hard-coded ADR totals", async () => {
  const root = await createFixtureRepo();
  try {
    const result = await validateAdrRepository(root, { includeLinks: true });
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.adrs.length, 1);
    assert.equal(result.diffSkipped, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a future version ADR is governed by discovery rather than a known ID list", async () => {
  const root = await createFixtureRepo();
  try {
    await mkdir(path.join(root, "docs", "versions", "v1.1"));
    await writeFile(path.join(root, "docs", "versions", "v1.1", "README.md"), "# v1.1\n", "utf8");
    const secondPath = path.join(root, "docs", "adr", "0002-future-decision.md");
    const secondText = adrText({
      id: "ADR-0002",
      title: "Future Decision",
      source: "v1.1",
    });
    await writeFile(secondPath, secondText, "utf8");
    const firstPath = path.join(root, "docs", "adr", "0001-test-decision.md");
    const first = parseAdrText(await readFile(firstPath, "utf8"), "docs/adr/0001-test-decision.md");
    const second = parseAdrText(secondText, "docs/adr/0002-future-decision.md");
    await writeFile(path.join(root, "docs", "adr", "HISTORY.md"), renderHistory([first, second]), "utf8");

    let result = await validateAdrRepository(root, { includeLinks: true });
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.rule === "ADR_CURRENT_MISSING" && diagnostic.message.includes("ADR-0002")
      )
    );

    await writeFile(
      path.join(root, "docs", "adr", "CURRENT.md"),
      currentText({
        "core-data": [
          { id: "ADR-0001", target: "0001-test-decision.md", title: "Test Decision" },
          { id: "ADR-0002", target: "0002-future-decision.md", title: "Future Decision" },
        ],
      }),
      "utf8"
    );
    result = await validateAdrRepository(root, { includeLinks: true });
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.adrs.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("diff-aware CI fails closed when its base ref is absent", async () => {
  const root = await createFixtureRepo();
  try {
    const result = await validateAdrRepository(root, {
      includeLinks: false,
      requireBase: true,
    });
    assert.ok(
      result.diagnostics.some((diagnostic) => diagnostic.rule === "ADR_DIFF_BASE_REQUIRED")
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy exception fingerprints are exact and stale entries fail", async () => {
  const root = await createFixtureRepo();
  try {
    const diagnostic = {
      rule: "ADR_SCOPE_CROSS_VERSION",
      path: "docs/adr/0118-v041-local-data-clean-break-and-managed-reset-boundary.md",
      message: "scope",
      field: "decision_scope",
      actual: "version-scope",
      expected: "cross-version",
    };
    const entry = {
      rule: diagnostic.rule,
      path: diagnostic.path,
      field: "decision_scope",
      diagnostic_sha256: diagnosticFingerprint(diagnostic),
      reason: "Historical clean break",
      disposition: "HISTORY only",
      audited_at_commit: "a".repeat(40),
    };
    await writeFile(
      path.join(root, "docs", "adr", "legacy-exceptions.json"),
      `${JSON.stringify({ schema_version: 1, exceptions: [entry] }, null, 2)}\n`,
      "utf8"
    );
    const applied = await applyLegacyExceptions(root, [diagnostic]);
    assert.deepEqual(applied.diagnostics, []);
    assert.equal(applied.suppressed.length, 1);

    const stale = await applyLegacyExceptions(root, []);
    assert.ok(
      stale.diagnostics.some((item) => item.rule === "LEGACY_EXCEPTION_STALE")
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("diff-aware check freezes accepted ADR body but permits References-only edits", async () => {
  const root = await createFixtureRepo();
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-qm", "base"], { cwd: root });
    const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const adrPath = path.join(root, "docs", "adr", "0001-test-decision.md");

    const original = await readFile(adrPath, "utf8");
    await writeFile(adrPath, original.replace("Context text.", "Changed context."), "utf8");
    let repository = await validateAdrRepository(root, { includeLinks: false });
    let diagnostics = await validateAdrDiff(root, base, repository);
    assert.ok(diagnostics.some((diagnostic) => diagnostic.rule === "ADR_DIFF_FROZEN_BODY"));

    await writeFile(
      adrPath,
      original.replace("- [Version]", "- Reference note.\n- [Version]"),
      "utf8"
    );
    repository = await validateAdrRepository(root, { includeLinks: false });
    diagnostics = await validateAdrDiff(root, base, repository);
    assert.deepEqual(diagnostics, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exact amendments authorize only one base/head content pair", async () => {
  const root = await createFixtureRepo();
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-qm", "base"], { cwd: root });
    const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const repoFile = "docs/adr/0001-test-decision.md";
    const adrPath = path.join(root, repoFile);
    const before = await readFile(adrPath, "utf8");
    const after = before.replace("Context text.", "Approved correction.");
    await writeFile(adrPath, after, "utf8");
    await mkdir(path.join(root, "docs", "adr", "amendments"));
    await writeFile(
      path.join(root, "docs", "adr", "amendments", "baseline.json"),
      `${JSON.stringify(
        {
          schema_version: 1,
          amendments: [
            {
              path: repoFile,
              from_sha256: sha256(before),
              to_sha256: sha256(after),
              category: "baseline-normalization",
              reason: "Approved exact fixture correction",
            },
          ],
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    const repository = await validateAdrRepository(root, { includeLinks: false });
    assert.deepEqual(await validateAdrDiff(root, base, repository), []);

    await writeFile(adrPath, `${after}\nextra\n`, "utf8");
    const changed = await validateAdrRepository(root, { includeLinks: false });
    assert.ok(
      (await validateAdrDiff(root, base, changed)).some(
        (diagnostic) => diagnostic.rule === "ADR_DIFF_FROZEN_BODY"
      )
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
