import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const versionsRoot = path.join(repoRoot, "docs", "versions");
const errors = [];

function check(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

function repoPath(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

function parseFrontMatter(text, filePath) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    errors.push(repoPath(filePath) + " is missing YAML Front Matter");
    return {};
  }

  const values = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*?)\s*$/);
    if (field) {
      values[field[1]] = field[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  }
  return values;
}

async function listMarkdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(entryPath);
    }
  }
  return files;
}

const versionIndexPath = path.join(versionsRoot, "README.md");
const versionIndexText = await readFile(versionIndexPath, "utf8");
const versionIndexFrontMatter = parseFrontMatter(versionIndexText, versionIndexPath);
const currentVersion = versionIndexFrontMatter.current_version;

check(
  typeof currentVersion === "string" && /^v\d+\.\d+$/.test(currentVersion),
  "docs/versions/README.md must declare a valid current_version"
);

const versionEntries = await readdir(versionsRoot, { withFileTypes: true });
const versionDirectories = versionEntries
  .filter((entry) => entry.isDirectory() && /^v\d+\.\d+$/.test(entry.name))
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

const versionDocuments = new Map();
for (const version of versionDirectories) {
  const readmePath = path.join(versionsRoot, version, "README.md");
  let text;
  try {
    text = await readFile(readmePath, "utf8");
  } catch {
    errors.push("Missing version overview: docs/versions/" + version + "/README.md");
    continue;
  }

  const frontMatter = parseFrontMatter(text, readmePath);
  check(
    frontMatter.version === version,
    repoPath(readmePath) + " must declare version: " + version
  );
  check(
    frontMatter.lifecycle === "current" || frontMatter.lifecycle === "historical",
    repoPath(readmePath) + " must declare lifecycle: current or historical"
  );
  const implementationPlanPath = path.join(
    versionsRoot,
    version,
    "implementation-plan.md"
  );
  let implementationPlanText = null;
  try {
    implementationPlanText = await readFile(implementationPlanPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      errors.push("Unable to read " + repoPath(implementationPlanPath) + ": " + error.message);
    }
  }
  if (implementationPlanText !== null) {
    const implementationPlanFrontMatter = parseFrontMatter(
      implementationPlanText,
      implementationPlanPath
    );
    check(
      implementationPlanFrontMatter.document_type === "implementation-plan",
      repoPath(implementationPlanPath) + " must declare document_type: implementation-plan"
    );
    check(
      implementationPlanFrontMatter.version === version,
      repoPath(implementationPlanPath) + " must declare version: " + version
    );
    if (frontMatter.implementation_status) {
      const implementationPlanStatus =
        implementationPlanFrontMatter.status ??
        implementationPlanFrontMatter.implementation_status;
      check(
        implementationPlanStatus === frontMatter.implementation_status,
        repoPath(implementationPlanPath) +
          " status must match " +
          repoPath(readmePath) +
          " implementation_status: expected " +
          frontMatter.implementation_status +
          ", found " +
          (implementationPlanStatus || "missing")
      );
    }
  }

  if (version === currentVersion) {
    check(
      frontMatter.lifecycle === "current",
      repoPath(readmePath) + " must be the current version overview"
    );
  } else {
    check(
      frontMatter.lifecycle === "historical",
      repoPath(readmePath) + " must be historical because it is not current_version"
    );
  }

  versionDocuments.set(version, { text, frontMatter, readmePath });
}

const currentOverviews = [...versionDocuments.entries()].filter(
  ([, document]) => document.frontMatter.lifecycle === "current"
);
check(
  currentOverviews.length === 1,
  "Exactly one version overview must declare lifecycle: current; found " +
    currentOverviews.length
);
if (currentOverviews.length === 1) {
  check(
    currentOverviews[0][0] === currentVersion,
    "The current version overview must match current_version: " + currentVersion
  );
}

const indexRows = [];
for (const line of versionIndexText.split(/\r?\n/)) {
  const row = line.match(
    /^\|\s*(v\d+\.\d+)\s*\|\s*\x60(current|historical)\x60\s*\|/
  );
  if (!row) {
    continue;
  }

  const link = line.match(/\]\((v\d+\.\d+)\/README\.md(?:#[^)]+)?\)/);
  check(Boolean(link), "Version index row for " + row[1] + " must link to its README");
  if (link) {
    check(link[1] === row[1], "Version index row and README link disagree for " + row[1]);
  }
  indexRows.push({ version: row[1], lifecycle: row[2] });
}

const indexedVersions = new Set(indexRows.map((row) => row.version));
check(
  indexedVersions.size === indexRows.length,
  "docs/versions/README.md contains duplicate version index rows"
);
for (const version of versionDirectories) {
  check(indexedVersions.has(version), "Version directory missing from index: " + version);
}
for (const version of indexedVersions) {
  check(versionDirectories.includes(version), "Version index points to a missing directory: " + version);
}

const currentIndexRows = indexRows.filter((row) => row.lifecycle === "current");
check(
  currentIndexRows.length === 1,
  "Exactly one version index row must be current; found " + currentIndexRows.length
);
if (currentIndexRows.length === 1) {
  check(
    currentIndexRows[0].version === currentVersion,
    "The current version index row must match current_version: " + currentVersion
  );
}
for (const row of indexRows) {
  const expectedLifecycle = row.version === currentVersion ? "current" : "historical";
  check(
    row.lifecycle === expectedLifecycle,
    "Version index lifecycle mismatch for " + row.version + ": expected " + expectedLifecycle
  );
}

const markdownFiles = [
  path.join(repoRoot, "README.md"),
  path.join(repoRoot, "AGENTS.md"),
  ...(await listMarkdownFiles(path.join(repoRoot, "docs"))),
];
const pointerLocations = [];
for (const filePath of markdownFiles) {
  const text = await readFile(filePath, "utf8");
  text.split(/\r?\n/).forEach((line, index) => {
    if (/^current_version:\s*/.test(line)) {
      pointerLocations.push(repoPath(filePath) + ":" + (index + 1));
    }
  });
}
check(
  pointerLocations.length === 1 && pointerLocations[0].startsWith("docs/versions/README.md:"),
  "current_version must have exactly one writable pointer in docs/versions/README.md; found " +
    (pointerLocations.join(", ") || "none")
);

const docsRouterPath = path.join(repoRoot, "docs", "README.md");
const docsRouterText = await readFile(docsRouterPath, "utf8");
const currentRoute = docsRouterText
  .split(/\r?\n/)
  .find((line) => line.includes("| 判断当前版本目标"));
check(Boolean(currentRoute), "docs/README.md must route current-version questions");
if (currentRoute) {
  check(
    currentRoute.includes("](versions/README.md)"),
    "docs/README.md must route current-version questions through the version index"
  );
  check(
    !/versions\/v\d+\.\d+\//.test(currentRoute),
    "docs/README.md must not hard-code a current version path"
  );
}

const rootReadmePath = path.join(repoRoot, "README.md");
const rootReadmeText = await readFile(rootReadmePath, "utf8");
check(!/##\s+当前状态/.test(rootReadmeText), "README.md must not contain a current-status ledger");
check(
  !/(?:唯一的?)?当前版本\s*(?:是|为|[:：])/.test(rootReadmeText),
  "README.md must not assert a current version"
);
check(
  !/docs\/versions\/v\d+\.\d+\//.test(rootReadmeText),
  "README.md must not link directly to a version directory"
);

const requiredImpactScopes = [
  "Version lifecycle",
  "ADR",
  "Contracts",
  "Architecture",
  "UI",
  "Runtime Activity",
  "Runtime compatibility",
  "Documentation routing",
  "Root README",
];
const currentDocument = versionDocuments.get(currentVersion);
if (currentDocument) {
  const modelContextChange = currentDocument.frontMatter.model_context_change;
  check(
    modelContextChange === "true" || modelContextChange === "false",
    repoPath(currentDocument.readmePath) +
      " must declare model_context_change: true or false"
  );

  const currentVersionDirectory = path.dirname(currentDocument.readmePath);
  const contextChangeFiles = (await readdir(currentVersionDirectory, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isFile() &&
        /^model-context-change(?:-[a-z0-9-]+)?\.md$/.test(entry.name)
    )
    .map((entry) => path.join(currentVersionDirectory, entry.name))
    .sort();

  if (modelContextChange === "true") {
    check(
      contextChangeFiles.length > 0,
      repoPath(currentDocument.readmePath) +
        " declares a core model-context change but has no separate model-context-change*.md statement"
    );
  } else if (modelContextChange === "false") {
    check(
      contextChangeFiles.length === 0,
      repoPath(currentDocument.readmePath) +
        " declares no core model-context change but contains a model-context-change*.md statement"
    );
  }

  for (const changeFile of contextChangeFiles) {
    const changeText = await readFile(changeFile, "utf8");
    const changeFrontMatter = parseFrontMatter(changeText, changeFile);
    const changePath = repoPath(changeFile);
    check(
      changeFrontMatter.document_type === "model-context-change",
      changePath + " must declare document_type: model-context-change"
    );
    check(
      changeFrontMatter.version === currentVersion,
      changePath + " must declare version: " + currentVersion
    );
    check(
      /^\d+$/.test(changeFrontMatter.revision ?? ""),
      changePath + " must declare a numeric revision"
    );
    check(
      changeFrontMatter.confirmed_revision === changeFrontMatter.revision,
      changePath + " confirmed_revision must equal revision"
    );
    check(
      changeFrontMatter.confirmation_status === "confirmed",
      changePath + " must declare confirmation_status: confirmed before implementation"
    );
    check(
      Boolean(changeFrontMatter.confirmed_by) &&
        !/^(?:tbd|todo|unknown|none)$/i.test(changeFrontMatter.confirmed_by ?? ""),
      changePath + " must identify the developer who explicitly reconfirmed the change"
    );
    check(
      /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(
        changeFrontMatter.confirmed_at ?? ""
      ),
      changePath + " must declare confirmed_at as an ISO date or timestamp"
    );
    for (const heading of [
      "## 变更前",
      "## 变更后",
      "## 明确不变",
      "## 二次确认",
      "## 验证",
    ]) {
      check(changeText.includes(heading), changePath + " must contain " + heading);
    }
  }

  const impactHeading = "## 跨版本文档影响";
  const impactStart = currentDocument.text.indexOf(impactHeading);
  check(
    impactStart >= 0,
    repoPath(currentDocument.readmePath) + " must contain " + impactHeading
  );

  if (impactStart >= 0) {
    const remaining = currentDocument.text.slice(impactStart + impactHeading.length);
    const nextHeading = remaining.search(/\n##\s+/);
    const impactSection = nextHeading >= 0 ? remaining.slice(0, nextHeading) : remaining;
    const impactLines = impactSection.split(/\r?\n/);

    for (const scope of requiredImpactScopes) {
      const row = impactLines.find((line) => line.startsWith("| " + scope + " |"));
      check(Boolean(row), "Missing cross-version documentation impact row: " + scope);
      if (!row) {
        continue;
      }

      const cells = row
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      check(cells.length >= 3, "Malformed documentation impact row: " + scope);
      check(
        cells[1] === "已更新" || cells[1] === "确认无需更新",
        "Invalid documentation impact conclusion for " + scope
      );
      check(
        Boolean(cells[2]) && cells[2] !== "—" && cells[2] !== "-",
        "Documentation impact evidence or reason is required for " + scope
      );
    }
  }
}

if (errors.length > 0) {
  console.error("Documentation version checks failed:");
  for (const error of errors) {
    console.error("- " + error);
  }
  process.exitCode = 1;
} else {
  console.log(
    "Documentation version checks passed for " +
      currentVersion +
      " across " +
      versionDirectories.length +
      " version directories."
  );
}
