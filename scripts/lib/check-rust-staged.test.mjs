import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  classifyStagedRustChanges,
  parseDestructivePathChanges,
  parseNulSeparatedPaths,
  parseTopLevelModules,
  runStagedRustCheck,
} from "./check-rust-staged.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mainSource = "mod core_only;\nmod shared;\n";
const libSource = "pub mod library;\npub mod shared;\n";

function classify(paths) {
  return classifyStagedRustChanges({ paths, mainSource, libSource });
}

test("NUL-delimited Git output preserves spaces and rejects incomplete output", () => {
  assert.deepEqual(parseNulSeparatedPaths(Buffer.from("docs/a file.md\0src/x.rs\0")), [
    "docs/a file.md",
    "src/x.rs",
  ]);
  assert.throws(() => parseNulSeparatedPaths(Buffer.from("src/x.rs\n")), /NUL terminated/);
});

test("delete and rename records expose every old and new path", () => {
  assert.deepEqual(
    parseDestructivePathChanges(
      Buffer.from("D\0old.rs\0R100\0crates/old.rs\0crates/new.rs\0")
    ),
    ["old.rs", "crates/old.rs", "crates/new.rs"]
  );
});

test("module parsing ignores comments, literals, and nested inline modules", () => {
  const modules = parseTopLevelModules(`
mod real;
// mod line_comment;
/* mod block_comment; */
const TEXT: &str = r#"mod raw_string;"#;
mod inline { mod nested; }
fn lifetimes<'a, 'b>(left: &'a str, right: &'b str) { let _ = '{'; let _ = right; }
pub(crate) mod visible;
`);
  assert.deepEqual([...modules], ["real", "visible"]);
});

test("Markdown-only changes skip Rust validation", () => {
  assert.deepEqual(classify(["docs/development/testing.md"]), {
    route: "skip",
    reason: "no staged Rust changes",
    scripts: [],
  });
});

test("the rovai CLI source runs check and only CLI tests", () => {
  assert.deepEqual(classify(["crates/rovai-core/src/bin/rovai.rs"]).scripts, [
    "check:rust",
    "test:rust:cli",
  ]);
});

test("a library module runs check and only library tests", () => {
  assert.deepEqual(classify(["crates/rovai-core/src/library.rs"]).scripts, [
    "check:rust",
    "test:rust:lib",
  ]);
});

test("a Main-only module runs check and only rovai-core binary tests", () => {
  assert.deepEqual(classify(["crates/rovai-core/src/core_only.rs"]).scripts, [
    "check:rust",
    "test:rust:core",
  ]);
});

test("Cargo, lib root, unknown Rust, shared, and multi-target changes run full tests", () => {
  const scenarios = [
    ["Cargo.toml"],
    ["crates/rovai-core/Cargo.toml"],
    ["Cargo.lock"],
    ["crates/rovai-core/src/lib.rs"],
    ["crates/rovai-core/tests/unknown.rs"],
    ["crates/rovai-core/src/shared.rs"],
    ["crates/rovai-core/src/library.rs", "crates/rovai-core/src/bin/rovai.rs"],
  ];
  for (const paths of scenarios) {
    assert.deepEqual(classify(paths).scripts, ["test:rust:full"], paths.join(", "));
  }
});

test("current main.rs and lib.rs declarations classify real modules", async () => {
  const [currentMain, currentLib] = await Promise.all([
    readFile(path.join(repoRoot, "crates/rovai-core/src/main.rs"), "utf8"),
    readFile(path.join(repoRoot, "crates/rovai-core/src/lib.rs"), "utf8"),
  ]);
  assert.deepEqual(
    classifyStagedRustChanges({
      paths: ["crates/rovai-core/src/acp.rs"],
      mainSource: currentMain,
      libSource: currentLib,
    }).scripts,
    ["check:rust", "test:rust:core"]
  );
  assert.deepEqual(
    classifyStagedRustChanges({
      paths: ["crates/rovai-core/src/action.rs"],
      mainSource: currentMain,
      libSource: currentLib,
    }).scripts,
    ["check:rust", "test:rust:lib"]
  );
});

async function runScenario({
  paths = [],
  destructivePaths = [],
  listError,
  readError,
} = {}) {
  const scripts = [];
  const logs = [];
  const warnings = [];
  const plan = await runStagedRustCheck({
    listStagedPaths: async () => {
      if (listError) {
        throw listError;
      }
      return paths;
    },
    listDestructivePaths: async () => destructivePaths,
    readStagedFile: async (filePath) => {
      if (readError) {
        throw readError;
      }
      return filePath.endsWith("main.rs") ? mainSource : libSource;
    },
    runPnpmScript: async (script) => scripts.push(script),
    log: (message) => logs.push(message),
    warn: (message) => warnings.push(message),
  });
  return { plan, scripts, logs, warnings };
}

test("the staged runner invokes exactly the selected fast route", async () => {
  const scenarios = [
    [["crates/rovai-core/src/bin/rovai.rs"], ["check:rust", "test:rust:cli"]],
    [["crates/rovai-core/src/library.rs"], ["check:rust", "test:rust:lib"]],
    [["crates/rovai-core/src/core_only.rs"], ["check:rust", "test:rust:core"]],
  ];
  for (const [paths, expectedScripts] of scenarios) {
    const result = await runScenario({ paths });
    assert.deepEqual(result.scripts, expectedScripts, paths[0]);
  }
});

test("the staged runner prints the required skip message and invokes no pnpm script", async () => {
  const result = await runScenario({ paths: ["README.md"] });
  assert.deepEqual(result.scripts, []);
  assert.deepEqual(result.logs, ["No staged Rust changes; skipping Rust tests."]);
});

test("staged inspection and module classification failures fall back to full tests", async () => {
  const inspectionFailure = await runScenario({ listError: new Error("git failed") });
  assert.deepEqual(inspectionFailure.scripts, ["test:rust:full"]);
  assert.equal(inspectionFailure.plan.route, "full");

  const classificationFailure = await runScenario({
    paths: ["crates/rovai-core/src/core_only.rs"],
    readError: new Error("index read failed"),
  });
  assert.deepEqual(classificationFailure.scripts, ["test:rust:full"]);
  assert.equal(classificationFailure.plan.route, "full");
});

test("Rust deletes and renames fall back to full tests", async () => {
  const result = await runScenario({ destructivePaths: ["crates/rovai-core/src/action.rs"] });
  assert.deepEqual(result.scripts, ["test:rust:full"]);
  assert.equal(result.plan.route, "full");
});
