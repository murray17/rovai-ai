import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { isAlias, isMap, isSeq, parseDocument } from "yaml";

export const ADR_CONTROL_FILES = new Set([
  "README.md",
  "CURRENT.md",
  "HISTORY.md",
  "TEMPLATE.md",
]);

export const ADR_TOPICS = [
  "core-data",
  "camp-workspace",
  "member-identity",
  "collaboration-task-message",
  "runtime-execution-security",
  "session-context-bootstrap",
  "memory",
  "skills-mcp-builtins",
  "evidence-activity",
  "qualification",
  "product-renderer",
];

export const ADR_ALLOWED_FIELDS = new Set([
  "document_type",
  "id",
  "title",
  "status",
  "date",
  "decision_scope",
  "source_version",
  "supersedes",
  "intended_supersedes",
  "superseded_by",
]);

export const ADR_REQUIRED_FIELDS = [
  "document_type",
  "id",
  "title",
  "status",
  "date",
  "decision_scope",
  "source_version",
  "supersedes",
  "superseded_by",
];

export const ADR_REQUIRED_SECTIONS = [
  "Context",
  "Decision",
  "Consequences",
  "Rejected Alternatives",
  "References",
];

const ADR_FILE_PATTERN = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const ADR_ID_PATTERN = /^ADR-(\d{4})$/;
const VERSION_PATTERN = /^v\d+\.\d+$/;
const STATUS_VALUES = new Set(["proposed", "accepted", "superseded", "rejected"]);
const markdownParser = unified().use(remarkParse).use(remarkGfm);

export function toRepoPath(repoRoot, filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedDiagnosticValue(value) {
  if (value === undefined) {
    return null;
  }
  if (value instanceof Set) {
    return [...value].sort();
  }
  return value;
}

export function diagnosticPayload(diagnostic) {
  return {
    rule: diagnostic.rule,
    path: diagnostic.path,
    field: diagnostic.field ?? null,
    actual: normalizedDiagnosticValue(diagnostic.actual),
    expected: normalizedDiagnosticValue(diagnostic.expected),
  };
}

export function diagnosticFingerprint(diagnostic) {
  return sha256(JSON.stringify(diagnosticPayload(diagnostic)));
}

export function makeDiagnostic(rule, filePath, message, details = {}) {
  return { rule, path: filePath, message, ...details };
}

function inspectYamlNode(node, filePath, diagnostics) {
  if (!node || typeof node !== "object") {
    return;
  }

  if (isAlias(node)) {
    diagnostics.push(
      makeDiagnostic("ADR_YAML_ALIAS", filePath, "YAML aliases are not allowed")
    );
    return;
  }
  if (node.anchor) {
    diagnostics.push(
      makeDiagnostic("ADR_YAML_ANCHOR", filePath, "YAML anchors are not allowed")
    );
  }
  if (node.tag) {
    diagnostics.push(
      makeDiagnostic("ADR_YAML_TAG", filePath, "Explicit YAML tags are not allowed", {
        actual: node.tag,
      })
    );
  }
  if (isMap(node)) {
    for (const pair of node.items) {
      if (pair?.key?.value === "<<") {
        diagnostics.push(
          makeDiagnostic("ADR_YAML_MERGE", filePath, "YAML merge keys are not allowed")
        );
      }
      inspectYamlNode(pair?.key, filePath, diagnostics);
      inspectYamlNode(pair?.value, filePath, diagnostics);
    }
  } else if (isSeq(node)) {
    for (const item of node.items) {
      inspectYamlNode(item, filePath, diagnostics);
    }
  }
}

export function splitFrontMatter(text, filePath) {
  const normalized = text.replace(/\r\n?/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) {
    return {
      frontMatterText: "",
      body: normalized,
      data: null,
      diagnostics: [
        makeDiagnostic("ADR_FRONT_MATTER", filePath, "Missing or unclosed YAML Front Matter"),
      ],
    };
  }

  const diagnostics = [];
  const document = parseDocument(match[1], {
    maxAliasCount: 0,
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
    version: "1.2",
  });
  for (const error of document.errors) {
    diagnostics.push(
      makeDiagnostic("ADR_YAML_PARSE", filePath, error.message.split("\n")[0])
    );
  }
  inspectYamlNode(document.contents, filePath, diagnostics);

  let data = null;
  if (document.errors.length === 0 && isMap(document.contents)) {
    try {
      data = document.toJS({ maxAliasCount: 0 });
    } catch (error) {
      diagnostics.push(
        makeDiagnostic("ADR_YAML_PARSE", filePath, `Unable to materialize YAML: ${error.message}`)
      );
    }
  } else if (document.errors.length === 0) {
    diagnostics.push(
      makeDiagnostic("ADR_YAML_ROOT", filePath, "YAML Front Matter root must be a mapping")
    );
  }

  return {
    frontMatterText: match[1],
    body: normalized.slice(match[0].length),
    data,
    diagnostics,
  };
}

function walkMarkdown(node, callback) {
  callback(node);
  if (Array.isArray(node?.children)) {
    for (const child of node.children) {
      walkMarkdown(child, callback);
    }
  }
}

function markdownText(node) {
  if (!node || typeof node !== "object") {
    return "";
  }
  if (typeof node.value === "string") {
    return node.value;
  }
  if (node.type === "image" && typeof node.alt === "string") {
    return node.alt;
  }
  return (node.children ?? []).map(markdownText).join("");
}

export function parseMarkdown(text, filePath = "<markdown>") {
  try {
    return { tree: markdownParser.parse(text), diagnostics: [] };
  } catch (error) {
    return {
      tree: null,
      diagnostics: [
        makeDiagnostic("MARKDOWN_PARSE", filePath, `Unable to parse Markdown: ${error.message}`),
      ],
    };
  }
}

export function parseAdrText(text, filePath) {
  const frontMatter = splitFrontMatter(text, filePath);
  const markdown = parseMarkdown(frontMatter.body, filePath);
  return {
    path: filePath,
    text: text.replace(/\r\n?/g, "\n"),
    body: frontMatter.body,
    frontMatterText: frontMatter.frontMatterText,
    data: frontMatter.data,
    tree: markdown.tree,
    diagnostics: [...frontMatter.diagnostics, ...markdown.diagnostics],
  };
}

async function findMarkdownInDirectory(directory) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findMarkdownInDirectory(entryPath)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      results.push(entryPath);
    }
  }
  return results;
}

export async function discoverAdrFiles(repoRoot) {
  const adrRoot = path.join(repoRoot, "docs", "adr");
  const diagnostics = [];
  const files = [];
  for (const entry of await readdir(adrRoot, { withFileTypes: true })) {
    const entryPath = path.join(adrRoot, entry.name);
    const repoFile = toRepoPath(repoRoot, entryPath);
    if (entry.isSymbolicLink()) {
      diagnostics.push(
        makeDiagnostic("ADR_SYMLINK", repoFile, "ADR directory entries may not be symbolic links")
      );
      continue;
    }
    if (entry.isDirectory()) {
      const nestedMarkdown = await findMarkdownInDirectory(entryPath);
      for (const nested of nestedMarkdown) {
        diagnostics.push(
          makeDiagnostic(
            "ADR_SUBDIRECTORY",
            toRepoPath(repoRoot, nested),
            "ADR Markdown files must be direct children of docs/adr"
          )
        );
      }
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
      continue;
    }
    if (ADR_CONTROL_FILES.has(entry.name)) {
      continue;
    }
    if (!ADR_FILE_PATTERN.test(entry.name)) {
      diagnostics.push(
        makeDiagnostic(
          "ADR_FILENAME",
          repoFile,
          "ADR filename must match NNNN-short-kebab-title.md"
        )
      );
      continue;
    }
    files.push(entryPath);
  }
  files.sort((left, right) => path.basename(left).localeCompare(path.basename(right)));
  return { files, diagnostics };
}

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function validateArrayOfAdrIds(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && ADR_ID_PATTERN.test(item));
}

function sectionHeadings(adr) {
  if (!adr.tree) {
    return [];
  }
  return adr.tree.children
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => node.type === "heading" && node.depth === 2)
    .map(({ node, index }) => ({ title: markdownText(node).trim(), node, index }));
}

function normalizedSectionTitle(value) {
  return value.trim().toLowerCase();
}

function sectionHasContent(adr, section) {
  const children = adr.tree?.children ?? [];
  for (let index = section.index + 1; index < children.length; index += 1) {
    const node = children[index];
    if (node.type === "heading" && node.depth <= 2) {
      return false;
    }
    if (markdownText(node).trim() || !["html", "thematicBreak"].includes(node.type)) {
      return true;
    }
  }
  return false;
}

export function validateAdrDocument(adr, repoRoot, { strictSections = false } = {}) {
  const diagnostics = [...adr.diagnostics];
  if (!adr.data || !adr.tree) {
    return diagnostics;
  }
  const data = adr.data;
  const fileName = path.basename(adr.path);
  const fileMatch = fileName.match(ADR_FILE_PATTERN);
  const repoFile = adr.path;

  for (const key of Object.keys(data)) {
    if (!ADR_ALLOWED_FIELDS.has(key)) {
      diagnostics.push(
        makeDiagnostic("ADR_UNKNOWN_FIELD", repoFile, `Unknown ADR Front Matter field: ${key}`, {
          field: key,
          actual: data[key],
        })
      );
    }
  }
  for (const key of ADR_REQUIRED_FIELDS) {
    if (!(key in data)) {
      diagnostics.push(
        makeDiagnostic("ADR_REQUIRED_FIELD", repoFile, `Missing required Front Matter field: ${key}`, {
          field: key,
        })
      );
    }
  }

  if (data.document_type !== "adr") {
    diagnostics.push(
      makeDiagnostic("ADR_DOCUMENT_TYPE", repoFile, "document_type must equal adr", {
        field: "document_type",
        actual: data.document_type,
        expected: "adr",
      })
    );
  }
  if (typeof data.id !== "string" || !ADR_ID_PATTERN.test(data.id)) {
    diagnostics.push(
      makeDiagnostic("ADR_ID", repoFile, "id must match ADR-NNNN", {
        field: "id",
        actual: data.id,
      })
    );
  }
  if (fileMatch && ADR_ID_PATTERN.test(data.id ?? "") && fileMatch[1] !== data.id.slice(4)) {
    diagnostics.push(
      makeDiagnostic("ADR_FILENAME_ID", repoFile, "Filename number and ADR id must match", {
        actual: fileMatch[1],
        expected: data.id.slice(4),
      })
    );
  }
  if (typeof data.title !== "string" || data.title.trim() === "" || /[\r\n]/.test(data.title)) {
    diagnostics.push(
      makeDiagnostic("ADR_TITLE", repoFile, "title must be a non-empty single-line string", {
        field: "title",
        actual: data.title,
      })
    );
  }
  if (!STATUS_VALUES.has(data.status)) {
    diagnostics.push(
      makeDiagnostic("ADR_STATUS", repoFile, "status is not a supported lifecycle value", {
        field: "status",
        actual: data.status,
      })
    );
  }
  if (!isValidDate(data.date)) {
    diagnostics.push(
      makeDiagnostic("ADR_DATE", repoFile, "date must be a real YYYY-MM-DD calendar date", {
        field: "date",
        actual: data.date,
      })
    );
  }
  if (data.decision_scope !== "cross-version") {
    diagnostics.push(
      makeDiagnostic("ADR_SCOPE_CROSS_VERSION", repoFile, "decision_scope must be cross-version", {
        field: "decision_scope",
        actual: data.decision_scope,
        expected: "cross-version",
      })
    );
  }
  if (typeof data.source_version !== "string" || !VERSION_PATTERN.test(data.source_version)) {
    diagnostics.push(
      makeDiagnostic("ADR_SOURCE_VERSION", repoFile, "source_version must match vN.N", {
        field: "source_version",
        actual: data.source_version,
      })
    );
  } else {
    const overview = path.join(repoRoot, "docs", "versions", data.source_version, "README.md");
    if (adr.knownVersions && !adr.knownVersions.has(data.source_version)) {
      diagnostics.push(
        makeDiagnostic("ADR_SOURCE_VERSION_MISSING", repoFile, "source_version overview does not exist", {
          field: "source_version",
          actual: data.source_version,
          expected: toRepoPath(repoRoot, overview),
        })
      );
    }
  }

  if (!validateArrayOfAdrIds(data.supersedes)) {
    diagnostics.push(
      makeDiagnostic("ADR_SUPERSEDES_TYPE", repoFile, "supersedes must be an array of ADR IDs", {
        field: "supersedes",
        actual: data.supersedes,
      })
    );
  } else if (new Set(data.supersedes).size !== data.supersedes.length) {
    diagnostics.push(
      makeDiagnostic("ADR_SUPERSEDES_DUPLICATE", repoFile, "supersedes must not contain duplicates", {
        field: "supersedes",
        actual: data.supersedes,
      })
    );
  }
  const intended = data.intended_supersedes ?? [];
  if (!validateArrayOfAdrIds(intended)) {
    diagnostics.push(
      makeDiagnostic(
        "ADR_INTENDED_SUPERSEDES_TYPE",
        repoFile,
        "intended_supersedes must be an array of ADR IDs when present",
        { field: "intended_supersedes", actual: intended }
      )
    );
  } else if (new Set(intended).size !== intended.length) {
    diagnostics.push(
      makeDiagnostic(
        "ADR_INTENDED_SUPERSEDES_DUPLICATE",
        repoFile,
        "intended_supersedes must not contain duplicates",
        { field: "intended_supersedes", actual: intended }
      )
    );
  }
  if (data.superseded_by !== null && (typeof data.superseded_by !== "string" || !ADR_ID_PATTERN.test(data.superseded_by))) {
    diagnostics.push(
      makeDiagnostic(
        "ADR_SUPERSEDED_BY_TYPE",
        repoFile,
        "superseded_by must be an ADR ID or YAML null",
        { field: "superseded_by", actual: data.superseded_by }
      )
    );
  }

  if (data.status === "proposed") {
    if (data.superseded_by !== null || (Array.isArray(data.supersedes) && data.supersedes.length > 0)) {
      diagnostics.push(
        makeDiagnostic(
          "ADR_PROPOSED_STATE",
          repoFile,
          "proposed ADRs must have empty supersedes and null superseded_by"
        )
      );
    }
  } else if (Array.isArray(intended) && intended.length > 0) {
    diagnostics.push(
      makeDiagnostic(
        "ADR_INTENDED_STATE",
        repoFile,
        "Only proposed ADRs may retain non-empty intended_supersedes",
        { field: "intended_supersedes", actual: intended }
      )
    );
  }
  if (data.status === "accepted" && data.superseded_by !== null) {
    diagnostics.push(
      makeDiagnostic("ADR_ACCEPTED_SUCCESSOR", repoFile, "accepted ADRs must have null superseded_by")
    );
  }
  if (data.status === "superseded" && data.superseded_by === null) {
    diagnostics.push(
      makeDiagnostic("ADR_SUPERSEDED_SUCCESSOR", repoFile, "superseded ADRs must name a direct successor")
    );
  }
  if (data.status === "rejected") {
    if (data.superseded_by !== null || (Array.isArray(data.supersedes) && data.supersedes.length > 0)) {
      diagnostics.push(
        makeDiagnostic(
          "ADR_REJECTED_STATE",
          repoFile,
          "rejected ADRs must have empty supersedes and null superseded_by"
        )
      );
    }
  }

  const h1 = [];
  walkMarkdown(adr.tree, (node) => {
    if (node.type === "heading" && node.depth === 1) {
      h1.push(markdownText(node).trim());
    }
  });
  if (h1.length !== 1) {
    diagnostics.push(
      makeDiagnostic("ADR_H1_COUNT", repoFile, `ADR must contain exactly one H1; found ${h1.length}`)
    );
  } else if (typeof data.id === "string") {
    const h1Id = h1[0].match(/^(ADR-\d{4})(?=\D|$)/)?.[1] ?? null;
    if (h1Id !== data.id) {
      diagnostics.push(
        makeDiagnostic("ADR_H1_ID", repoFile, "H1 must start with the Front Matter ADR id", {
          actual: h1Id,
          expected: data.id,
        })
      );
    }
  }

  const headings = sectionHeadings(adr);
  const required = ADR_REQUIRED_SECTIONS.map((title) => {
    const matches = headings.filter(
      (heading) => normalizedSectionTitle(heading.title) === normalizedSectionTitle(title)
    );
    if (matches.length !== 1) {
      diagnostics.push(
        makeDiagnostic(
          "ADR_SECTION_COUNT",
          repoFile,
          `ADR must contain exactly one ## ${title}; found ${matches.length}`,
          { field: title, actual: matches.length, expected: 1 }
        )
      );
    } else {
      if (strictSections && matches[0].title !== title) {
        diagnostics.push(
          makeDiagnostic("ADR_SECTION_CASE", repoFile, `New ADR heading must be exactly ## ${title}`, {
            field: title,
            actual: matches[0].title,
            expected: title,
          })
        );
      }
      if (!sectionHasContent(adr, matches[0])) {
        diagnostics.push(
          makeDiagnostic("ADR_SECTION_EMPTY", repoFile, `Section ## ${title} must not be empty`, {
            field: title,
          })
        );
      }
    }
    return matches[0] ?? null;
  });
  const positions = required.filter(Boolean).map((heading) => heading.index);
  if (positions.length === ADR_REQUIRED_SECTIONS.length) {
    const sorted = [...positions].sort((left, right) => left - right);
    if (!positions.every((position, index) => position === sorted[index])) {
      diagnostics.push(
        makeDiagnostic(
          "ADR_SECTION_ORDER",
          repoFile,
          "Required ADR sections must follow Context, Decision, Consequences, Rejected Alternatives, References"
        )
      );
    }
    if (required.at(-1).index !== headings.at(-1).index) {
      diagnostics.push(
        makeDiagnostic(
          "ADR_REFERENCES_LAST",
          repoFile,
          "References must be the final level-two section"
        )
      );
    }
  }

  return diagnostics;
}

export async function loadAdrRepository(repoRoot, { strictNewPaths = new Set() } = {}) {
  const discovered = await discoverAdrFiles(repoRoot);
  const diagnostics = [...discovered.diagnostics];
  const versionEntries = await readdir(path.join(repoRoot, "docs", "versions"), {
    withFileTypes: true,
  });
  const knownVersions = new Set();
  await Promise.all(
    versionEntries
      .filter((entry) => entry.isDirectory() && VERSION_PATTERN.test(entry.name))
      .map(async (entry) => {
        const children = await readdir(path.join(repoRoot, "docs", "versions", entry.name), {
          withFileTypes: true,
        });
        if (children.some((child) => child.name === "README.md" && child.isFile())) {
          knownVersions.add(entry.name);
        }
      })
  );
  const adrs = [];
  for (const filePath of discovered.files) {
    const repoFile = toRepoPath(repoRoot, filePath);
    const text = await readFile(filePath, "utf8");
    const adr = parseAdrText(text, repoFile);
    adr.absolutePath = filePath;
    adr.knownVersions = knownVersions;
    diagnostics.push(
      ...validateAdrDocument(adr, repoRoot, { strictSections: strictNewPaths.has(repoFile) })
    );
    adrs.push(adr);
  }
  return { adrs, diagnostics, knownVersions };
}

function validateUniqueAdrIdentity(adrs) {
  const diagnostics = [];
  for (const key of ["id", "number", "path"]) {
    const seen = new Map();
    for (const adr of adrs) {
      let value;
      if (key === "id") value = adr.data?.id;
      if (key === "number") value = adr.data?.id?.slice(4);
      if (key === "path") value = adr.path.toLowerCase();
      if (!value) continue;
      if (seen.has(value)) {
        diagnostics.push(
          makeDiagnostic(
            `ADR_DUPLICATE_${key.toUpperCase()}`,
            adr.path,
            `ADR ${key} duplicates ${seen.get(value)}`,
            { actual: value }
          )
        );
      } else {
        seen.set(value, adr.path);
      }
    }
  }
  return diagnostics;
}

export function isCurrentAdr(adr) {
  return (
    adr.data?.document_type === "adr" &&
    adr.data?.decision_scope === "cross-version" &&
    adr.data?.status === "accepted" &&
    adr.data?.superseded_by === null
  );
}

export function validateSupersessionGraph(adrs) {
  const diagnostics = [];
  const byId = new Map(adrs.filter((adr) => ADR_ID_PATTERN.test(adr.data?.id ?? "")).map((adr) => [adr.data.id, adr]));

  for (const adr of adrs) {
    const id = adr.data?.id;
    if (!id) continue;
    for (const predecessorId of Array.isArray(adr.data?.supersedes) ? adr.data.supersedes : []) {
      const predecessor = byId.get(predecessorId);
      if (!predecessor) {
        diagnostics.push(
          makeDiagnostic("ADR_SUPERSEDES_MISSING", adr.path, `supersedes target does not exist: ${predecessorId}`, {
            actual: predecessorId,
          })
        );
        continue;
      }
      if (predecessorId === id) {
        diagnostics.push(makeDiagnostic("ADR_SUPERSEDES_SELF", adr.path, "ADR cannot supersede itself"));
      }
      if (Number(id.slice(4)) <= Number(predecessorId.slice(4))) {
        diagnostics.push(
          makeDiagnostic(
            "ADR_SUPERSEDES_ORDER",
            adr.path,
            `Direct successor ${id} must have a larger number than ${predecessorId}`,
            { actual: id, expected: `>${predecessorId}` }
          )
        );
      }
      if (predecessor.data?.status !== "superseded" || predecessor.data?.superseded_by !== id) {
        diagnostics.push(
          makeDiagnostic(
            "ADR_SUPERSESSION_RECIPROCAL",
            adr.path,
            `${id}.supersedes ${predecessorId} must be reciprocated by superseded status and direct pointer`,
            {
              actual: {
                status: predecessor.data?.status,
                superseded_by: predecessor.data?.superseded_by,
              },
              expected: { status: "superseded", superseded_by: id },
            }
          )
        );
      }
    }
    if (typeof adr.data?.superseded_by === "string") {
      const successor = byId.get(adr.data.superseded_by);
      if (!successor) {
        diagnostics.push(
          makeDiagnostic(
            "ADR_SUCCESSOR_MISSING",
            adr.path,
            `superseded_by target does not exist: ${adr.data.superseded_by}`,
            { actual: adr.data.superseded_by }
          )
        );
      } else if (!Array.isArray(successor.data?.supersedes) || !successor.data.supersedes.includes(id)) {
        diagnostics.push(
          makeDiagnostic(
            "ADR_SUCCESSOR_RECIPROCAL",
            adr.path,
            `${id}.superseded_by must be reciprocated by ${successor.data.id}.supersedes`,
            { actual: successor.data?.supersedes, expected: id }
          )
        );
      }
    }
  }

  for (const adr of adrs) {
    const startId = adr.data?.id;
    if (!startId || adr.data?.status !== "superseded") continue;
    const visited = new Set([startId]);
    let current = adr;
    while (typeof current.data?.superseded_by === "string") {
      const nextId = current.data.superseded_by;
      if (visited.has(nextId)) {
        diagnostics.push(
          makeDiagnostic("ADR_SUPERSESSION_CYCLE", adr.path, `Supersession cycle detected from ${startId}`, {
            actual: [...visited, nextId],
          })
        );
        current = null;
        break;
      }
      visited.add(nextId);
      current = byId.get(nextId);
      if (!current) break;
    }
    if (current && !isCurrentAdr(current)) {
      diagnostics.push(
        makeDiagnostic(
          "ADR_SUPERSESSION_TERMINAL",
          adr.path,
          `Supersession chain from ${startId} must end at a current cross-version ADR`,
          {
            actual: current.data
              ? {
                  id: current.data.id,
                  status: current.data.status,
                  decision_scope: current.data.decision_scope,
                  superseded_by: current.data.superseded_by,
                }
              : null,
          }
        )
      );
    }
  }
  return diagnostics;
}

function escapeMarkdownCell(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function unescapeMarkdownCell(value) {
  return value.replace(/\\([\\|])/g, "$1");
}

export function renderHistory(adrs) {
  const sorted = [...adrs].sort((left, right) => left.data.id.localeCompare(right.data.id));
  const byId = new Map(sorted.map((adr) => [adr.data.id, adr]));
  const rows = sorted.map((adr) => {
    const successor = adr.data.superseded_by ? byId.get(adr.data.superseded_by) : null;
    const successorCell = successor
      ? `[${successor.data.id}](${path.basename(successor.path)})`
      : "—";
    return `| [${adr.data.id}](${path.basename(adr.path)}) | ${escapeMarkdownCell(adr.data.title)} | \`${adr.data.status}\` | \`${adr.data.decision_scope}\` | [${adr.data.source_version}](../versions/${adr.data.source_version}/README.md) | ${successorCell} |`;
  });
  return `---
document_type: adr-history
authority: generated-adr-history
generated_from: docs/adr-front-matter
---

# ADR 完整历史

本文件由 \`pnpm docs:adr:generate\` 根据全部 ADR Front Matter 确定性生成。请勿手工编辑表格；
当前有效决策请从 [CURRENT.md](CURRENT.md) 进入。

<!-- adr-history:begin -->
| ADR | Decision | Status | Scope | Source version | Direct successor |
| --- | --- | --- | --- | --- | --- |
${rows.join("\n")}
<!-- adr-history:end -->
`;
}

export function parseCurrentPrimary(text, filePath = "docs/adr/CURRENT.md") {
  const diagnostics = [];
  const entries = [];
  let lastPosition = -1;
  for (const topic of ADR_TOPICS) {
    const begin = `<!-- adr-current-primary:begin topic=${topic} -->`;
    const end = "<!-- adr-current-primary:end -->";
    const occurrences = text.split(begin).length - 1;
    if (occurrences !== 1) {
      diagnostics.push(
        makeDiagnostic(
          "ADR_CURRENT_MARKER",
          filePath,
          `CURRENT must contain exactly one primary marker for ${topic}; found ${occurrences}`,
          { field: topic, actual: occurrences, expected: 1 }
        )
      );
      continue;
    }
    const start = text.indexOf(begin);
    if (start < lastPosition) {
      diagnostics.push(
        makeDiagnostic("ADR_CURRENT_TOPIC_ORDER", filePath, `CURRENT topic is out of order: ${topic}`)
      );
    }
    lastPosition = start;
    const blockStart = start + begin.length;
    const blockEnd = text.indexOf(end, blockStart);
    if (blockEnd < 0) {
      diagnostics.push(
        makeDiagnostic("ADR_CURRENT_MARKER", filePath, `CURRENT marker is not closed for ${topic}`)
      );
      continue;
    }
    const block = text.slice(blockStart, blockEnd);
    const rows = block.split(/\r?\n/).filter((line) => /^\|\s*\[ADR-\d{4}\]/.test(line));
    for (const row of rows) {
      const match = row.match(
        /^\|\s*\[(ADR-\d{4})\]\(([^)]+\.md)\)\s*\|\s*(.*?)\s*\|\s*$/
      );
      if (!match) {
        diagnostics.push(
          makeDiagnostic("ADR_CURRENT_ROW", filePath, `Malformed CURRENT primary row in ${topic}: ${row}`)
        );
        continue;
      }
      entries.push({
        topic,
        id: match[1],
        target: match[2],
        title: unescapeMarkdownCell(match[3]),
      });
    }
  }
  return { entries, diagnostics };
}

function validateCurrent(text, adrs) {
  const filePath = "docs/adr/CURRENT.md";
  const parsed = parseCurrentPrimary(text, filePath);
  const diagnostics = [...parsed.diagnostics];
  const byId = new Map(adrs.map((adr) => [adr.data?.id, adr]));
  const seen = new Map();
  for (const entry of parsed.entries) {
    const adr = byId.get(entry.id);
    if (!adr) {
      diagnostics.push(
        makeDiagnostic("ADR_CURRENT_UNKNOWN", filePath, `CURRENT references missing ${entry.id}`)
      );
      continue;
    }
    if (seen.has(entry.id)) {
      diagnostics.push(
        makeDiagnostic(
          "ADR_CURRENT_DUPLICATE",
          filePath,
          `${entry.id} appears in multiple primary topics: ${seen.get(entry.id)}, ${entry.topic}`
        )
      );
    }
    seen.set(entry.id, entry.topic);
    if (entry.target !== path.basename(adr.path)) {
      diagnostics.push(
        makeDiagnostic("ADR_CURRENT_TARGET", filePath, `${entry.id} has the wrong CURRENT target`, {
          actual: entry.target,
          expected: path.basename(adr.path),
        })
      );
    }
    if (entry.title !== adr.data.title) {
      diagnostics.push(
        makeDiagnostic("ADR_CURRENT_TITLE", filePath, `${entry.id} has a stale CURRENT title`, {
          actual: entry.title,
          expected: adr.data.title,
        })
      );
    }
    if (!isCurrentAdr(adr)) {
      diagnostics.push(
        makeDiagnostic("ADR_CURRENT_INACTIVE", filePath, `${entry.id} is not a current cross-version ADR`)
      );
    }
  }
  const actual = new Set(parsed.entries.map((entry) => entry.id));
  const expected = new Set(adrs.filter(isCurrentAdr).map((adr) => adr.data.id));
  for (const id of expected) {
    if (!actual.has(id)) {
      diagnostics.push(makeDiagnostic("ADR_CURRENT_MISSING", filePath, `CURRENT is missing ${id}`));
    }
  }
  for (const id of actual) {
    if (!expected.has(id)) {
      diagnostics.push(makeDiagnostic("ADR_CURRENT_EXTRA", filePath, `CURRENT contains non-current ${id}`));
    }
  }
  for (const topic of ADR_TOPICS) {
    const ids = parsed.entries.filter((entry) => entry.topic === topic).map((entry) => entry.id);
    const sorted = [...ids].sort();
    if (!ids.every((id, index) => id === sorted[index])) {
      diagnostics.push(
        makeDiagnostic("ADR_CURRENT_SORT", filePath, `CURRENT primary rows are not sorted in ${topic}`)
      );
    }
  }
  return diagnostics;
}

function architectureDocumentsFromDisk(paths) {
  return paths
    .filter((repoFile) => repoFile.startsWith("docs/architecture/"))
    .filter((repoFile) => repoFile !== "docs/architecture/README.md")
    .sort();
}

export function validateArchitectureIndex(text, architectureFiles) {
  const diagnostics = [];
  const filePath = "docs/architecture/README.md";
  const begin = "<!-- architecture-index:begin -->";
  const end = "<!-- architecture-index:end -->";
  const beginCount = text.split(begin).length - 1;
  const endCount = text.split(end).length - 1;
  const start = text.indexOf(begin);
  const finish = text.indexOf(end, start + begin.length);
  if (beginCount !== 1 || endCount !== 1 || start < 0 || finish < start) {
    return [
      makeDiagnostic(
        "ARCHITECTURE_INDEX_MARKER",
        filePath,
        "Architecture README must contain one closed machine index region"
      ),
    ];
  }
  const block = text.slice(start + begin.length, finish);
  const targets = [...block.matchAll(/\]\(([^)]+\.md)\)/g)].map((match) =>
    path.posix.normalize(`docs/architecture/${match[1]}`)
  );
  const expected = architectureDocumentsFromDisk(architectureFiles);
  const actual = [...new Set(targets)].sort();
  if (targets.length !== actual.length) {
    diagnostics.push(
      makeDiagnostic("ARCHITECTURE_INDEX_DUPLICATE", filePath, "Architecture machine index contains duplicates")
    );
  }
  for (const target of expected) {
    if (!actual.includes(target)) {
      diagnostics.push(
        makeDiagnostic("ARCHITECTURE_INDEX_MISSING", filePath, `Architecture index is missing ${target}`)
      );
    }
  }
  for (const target of actual) {
    if (!expected.includes(target)) {
      diagnostics.push(
        makeDiagnostic("ARCHITECTURE_INDEX_EXTRA", filePath, `Architecture index has an invalid target ${target}`)
      );
    }
  }
  return diagnostics;
}

async function listMarkdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(entryPath)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(entryPath);
    }
  }
  return files;
}

function gfmSlug(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\-\s]/gu, "")
    .replace(/\s/g, "-");
}

function headingSlugs(tree) {
  const counts = new Map();
  const slugs = new Set();
  walkMarkdown(tree, (node) => {
    if (node.type !== "heading") return;
    const base = gfmSlug(markdownText(node));
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    slugs.add(count === 0 ? base : `${base}-${count}`);
  });
  return slugs;
}

async function exactPathExists(repoRoot, absolutePath, directoryCache) {
  const relative = path.relative(repoRoot, absolutePath);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return relative === "";
  }
  let cursor = repoRoot;
  for (const component of relative.split(path.sep)) {
    let entries = directoryCache.get(cursor);
    if (!entries) {
      try {
        entries = new Set(await readdir(cursor));
      } catch {
        return false;
      }
      directoryCache.set(cursor, entries);
    }
    if (!entries.has(component)) {
      return false;
    }
    cursor = path.join(cursor, component);
  }
  try {
    await lstat(cursor);
    return true;
  } catch {
    return false;
  }
}

function markdownDestinations(tree) {
  const destinations = [];
  walkMarkdown(tree, (node) => {
    if (["link", "image", "definition"].includes(node.type) && typeof node.url === "string") {
      destinations.push({ url: node.url, line: node.position?.start?.line ?? null });
    }
  });
  return destinations;
}

export async function validateMarkdownLinks(repoRoot) {
  const diagnostics = [];
  const markdownFiles = [
    path.join(repoRoot, "README.md"),
    path.join(repoRoot, "AGENTS.md"),
    ...(await listMarkdownFiles(path.join(repoRoot, "docs"))),
  ];
  const directoryCache = new Map();
  const markdownCache = new Map();

  async function parsedMarkdown(filePath) {
    if (!markdownCache.has(filePath)) {
      const text = await readFile(filePath, "utf8");
      markdownCache.set(filePath, parseMarkdown(text, toRepoPath(repoRoot, filePath)));
    }
    return markdownCache.get(filePath);
  }

  for (const sourcePath of markdownFiles) {
    const sourceRepoPath = toRepoPath(repoRoot, sourcePath);
    const parsed = await parsedMarkdown(sourcePath);
    diagnostics.push(...parsed.diagnostics);
    if (!parsed.tree) continue;
    for (const destination of markdownDestinations(parsed.tree)) {
      const raw = destination.url.trim();
      const scheme = raw.match(/^([A-Za-z][A-Za-z0-9+.-]*):/);
      if (scheme) {
        const protocol = scheme[1].toLowerCase();
        if (["javascript", "data", "file"].includes(protocol)) {
          diagnostics.push(
            makeDiagnostic("MARKDOWN_LINK_PROTOCOL", sourceRepoPath, `Forbidden link protocol: ${protocol}`, {
              actual: raw,
            })
          );
        } else if (!["http", "https", "mailto"].includes(protocol)) {
          diagnostics.push(
            makeDiagnostic("MARKDOWN_LINK_PROTOCOL", sourceRepoPath, `Unsupported link protocol: ${protocol}`, {
              actual: raw,
            })
          );
        }
        continue;
      }

      const hashIndex = raw.indexOf("#");
      const queryIndex = raw.indexOf("?");
      const pathEndCandidates = [hashIndex, queryIndex].filter((index) => index >= 0);
      const pathEnd = pathEndCandidates.length ? Math.min(...pathEndCandidates) : raw.length;
      let targetText = raw.slice(0, pathEnd);
      const fragmentText = hashIndex >= 0 ? raw.slice(hashIndex + 1) : "";
      try {
        targetText = decodeURIComponent(targetText);
      } catch {
        diagnostics.push(
          makeDiagnostic("MARKDOWN_LINK_ENCODING", sourceRepoPath, `Invalid URL encoding: ${raw}`)
        );
        continue;
      }
      const targetPath = targetText
        ? path.resolve(path.dirname(sourcePath), targetText)
        : sourcePath;
      const relativeTarget = path.relative(repoRoot, targetPath);
      if (relativeTarget.startsWith(`..${path.sep}`) || path.isAbsolute(relativeTarget)) {
        diagnostics.push(
          makeDiagnostic("MARKDOWN_LINK_ESCAPE", sourceRepoPath, `Relative link escapes the repository: ${raw}`, {
            actual: raw,
          })
        );
        continue;
      }
      if (!(await exactPathExists(repoRoot, targetPath, directoryCache))) {
        diagnostics.push(
          makeDiagnostic("MARKDOWN_LINK_MISSING", sourceRepoPath, `Local link target does not exist: ${raw}`, {
            actual: raw,
            expected: relativeTarget.split(path.sep).join("/"),
          })
        );
        continue;
      }
      if (fragmentText && targetPath.toLowerCase().endsWith(".md")) {
        let fragment;
        try {
          fragment = decodeURIComponent(fragmentText).toLowerCase();
        } catch {
          diagnostics.push(
            makeDiagnostic("MARKDOWN_LINK_ENCODING", sourceRepoPath, `Invalid fragment encoding: ${raw}`)
          );
          continue;
        }
        const targetParsed = await parsedMarkdown(targetPath);
        if (targetParsed.tree && !headingSlugs(targetParsed.tree).has(fragment)) {
          diagnostics.push(
            makeDiagnostic("MARKDOWN_FRAGMENT_MISSING", sourceRepoPath, `Markdown fragment does not exist: ${raw}`, {
              actual: fragment,
              expected: toRepoPath(repoRoot, targetPath),
            })
          );
        }
      }
    }
  }
  return { diagnostics, markdownFiles: markdownFiles.map((file) => toRepoPath(repoRoot, file)) };
}

async function loadJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function applyLegacyExceptions(repoRoot, diagnostics) {
  const registryPath = path.join(repoRoot, "docs", "adr", "legacy-exceptions.json");
  const repoFile = toRepoPath(repoRoot, registryPath);
  const registry = await loadJson(registryPath, { schema_version: 1, exceptions: [] });
  const registryDiagnostics = [];
  if (registry.schema_version !== 1 || !Array.isArray(registry.exceptions)) {
    return {
      diagnostics: [
        ...diagnostics,
        makeDiagnostic("LEGACY_EXCEPTION_SCHEMA", repoFile, "Invalid legacy exception registry schema"),
      ],
      suppressed: [],
    };
  }
  const used = new Set();
  const kept = [];
  const suppressed = [];
  for (const diagnostic of diagnostics) {
    const fingerprint = diagnosticFingerprint(diagnostic);
    const index = registry.exceptions.findIndex(
      (entry) =>
        entry.rule === diagnostic.rule &&
        entry.path === diagnostic.path &&
        entry.diagnostic_sha256 === fingerprint
    );
    if (index >= 0) {
      used.add(index);
      suppressed.push(diagnostic);
    } else {
      kept.push(diagnostic);
    }
  }
  registry.exceptions.forEach((entry, index) => {
    if (
      typeof entry.rule !== "string" ||
      typeof entry.path !== "string" ||
      typeof entry.diagnostic_sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.diagnostic_sha256) ||
      typeof entry.reason !== "string" ||
      !entry.reason.trim() ||
      typeof entry.disposition !== "string" ||
      !entry.disposition.trim() ||
      typeof entry.audited_at_commit !== "string" ||
      !/^[a-f0-9]{40}$/.test(entry.audited_at_commit)
    ) {
      registryDiagnostics.push(
        makeDiagnostic("LEGACY_EXCEPTION_SCHEMA", repoFile, `Malformed legacy exception at index ${index}`)
      );
    } else if (
      entry.rule !== "ADR_SCOPE_CROSS_VERSION" ||
      entry.path !== "docs/adr/0118-v041-local-data-clean-break-and-managed-reset-boundary.md" ||
      entry.field !== "decision_scope"
    ) {
      registryDiagnostics.push(
        makeDiagnostic(
          "LEGACY_EXCEPTION_LOCKED",
          repoFile,
          "ADR-0118 decision_scope is the only permitted legacy exception; new exceptions are forbidden"
        )
      );
    } else if (!used.has(index)) {
      registryDiagnostics.push(
        makeDiagnostic(
          "LEGACY_EXCEPTION_STALE",
          repoFile,
          `Legacy exception no longer matches an active diagnostic: ${entry.rule} ${entry.path}`
        )
      );
    }
  });
  return { diagnostics: [...kept, ...registryDiagnostics], suppressed };
}

function git(repoRoot, args, options = {}) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: options.encoding ?? "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitFileAt(repoRoot, ref, repoFile) {
  return git(repoRoot, ["show", `${ref}:${repoFile}`]);
}

function frozenBody(body) {
  const match = body.match(/^(.*?)(?=^## References\s*$)/ms);
  return (match ? match[1] : body).replace(/\s+$/, "");
}

async function loadAmendments(repoRoot) {
  const directory = path.join(repoRoot, "docs", "adr", "amendments");
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return { amendments: [], diagnostics: [] };
    throw error;
  }
  const diagnostics = [];
  const amendments = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = path.join(directory, entry.name);
    const repoFile = toRepoPath(repoRoot, filePath);
    let value;
    try {
      value = JSON.parse(await readFile(filePath, "utf8"));
    } catch (error) {
      diagnostics.push(
        makeDiagnostic("ADR_AMENDMENT_SCHEMA", repoFile, `Invalid amendment JSON: ${error.message}`)
      );
      continue;
    }
    if (value.schema_version !== 1 || !Array.isArray(value.amendments)) {
      diagnostics.push(
        makeDiagnostic("ADR_AMENDMENT_SCHEMA", repoFile, "Invalid amendment document schema")
      );
      continue;
    }
    value.amendments.forEach((amendment, index) => {
      if (
        typeof amendment.path !== "string" ||
        !/^docs\/adr\/\d{4}-[a-z0-9-]+\.md$/.test(amendment.path) ||
        !/^[a-f0-9]{64}$/.test(amendment.from_sha256 ?? "") ||
        !/^[a-f0-9]{64}$/.test(amendment.to_sha256 ?? "") ||
        typeof amendment.category !== "string" ||
        !amendment.category.trim() ||
        typeof amendment.reason !== "string" ||
        !amendment.reason.trim()
      ) {
        diagnostics.push(
          makeDiagnostic("ADR_AMENDMENT_SCHEMA", repoFile, `Malformed amendment at index ${index}`)
        );
      } else {
        amendments.push({ ...amendment, source: repoFile });
      }
    });
  }
  return { amendments, diagnostics };
}

export async function validateAdrDiff(repoRoot, baseRef, currentRepository) {
  const diagnostics = [];
  try {
    git(repoRoot, ["cat-file", "-e", `${baseRef}^{commit}`]);
  } catch {
    return [
      makeDiagnostic("ADR_DIFF_BASE", "docs/adr", `DOCS_BASE_REF is not an available commit: ${baseRef}`),
    ];
  }
  const basePaths = git(repoRoot, ["ls-tree", "-r", "--name-only", baseRef, "docs/adr"])
    .split(/\r?\n/)
    .filter((repoFile) => /^docs\/adr\/\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(repoFile));
  const currentByPath = new Map(currentRepository.adrs.map((adr) => [adr.path, adr]));
  const baseSet = new Set(basePaths);
  const currentSet = new Set(currentByPath.keys());
  const amendmentsResult = await loadAmendments(repoRoot);
  diagnostics.push(...amendmentsResult.diagnostics);

  for (const repoFile of basePaths) {
    if (!currentSet.has(repoFile)) {
      diagnostics.push(
        makeDiagnostic("ADR_DIFF_DELETE", repoFile, "Existing ADR files may not be deleted, moved, or renamed")
      );
    }
  }

  const baseIds = new Map();
  for (const repoFile of basePaths) {
    const baseText = gitFileAt(repoRoot, baseRef, repoFile);
    const baseAdr = parseAdrText(baseText, repoFile);
    if (baseAdr.data?.id) baseIds.set(baseAdr.data.id, repoFile);
  }

  for (const adr of currentRepository.adrs) {
    if (baseSet.has(adr.path)) continue;
    if (baseIds.has(adr.data?.id)) {
      diagnostics.push(
        makeDiagnostic("ADR_DIFF_REUSE", adr.path, `New path reuses existing ${adr.data.id}`, {
          expected: baseIds.get(adr.data.id),
        })
      );
    }
    diagnostics.push(...validateAdrDocument(adr, repoRoot, { strictSections: true }));
  }

  const byId = new Map(currentRepository.adrs.map((adr) => [adr.data?.id, adr]));
  for (const repoFile of basePaths) {
    const current = currentByPath.get(repoFile);
    if (!current) continue;
    const baseText = gitFileAt(repoRoot, baseRef, repoFile).replace(/\r\n?/g, "\n");
    if (baseText === current.text) continue;
    const currentHash = sha256(current.text);
    const baseHash = sha256(baseText);
    const amendment = amendmentsResult.amendments.find(
      (entry) =>
        entry.path === repoFile &&
        entry.from_sha256 === baseHash &&
        entry.to_sha256 === currentHash
    );
    if (amendment) continue;

    const base = parseAdrText(baseText, repoFile);
    const baseStatus = base.data?.status;
    if (baseStatus === "proposed") {
      if (!["proposed", "accepted", "rejected"].includes(current.data?.status)) {
        diagnostics.push(
          makeDiagnostic(
            "ADR_DIFF_TRANSITION",
            repoFile,
            `proposed ADR may only remain proposed or become accepted/rejected; got ${current.data?.status}`
          )
        );
      }
      continue;
    }

    const frozenFields = new Set([
      "document_type",
      "id",
      "title",
      "date",
      "decision_scope",
      "source_version",
      "supersedes",
      "intended_supersedes",
      ...Object.keys(base.data ?? {}),
      ...Object.keys(current.data ?? {}),
    ]);
    frozenFields.delete("status");
    frozenFields.delete("superseded_by");
    for (const field of frozenFields) {
      if (JSON.stringify(base.data?.[field]) !== JSON.stringify(current.data?.[field])) {
        diagnostics.push(
          makeDiagnostic("ADR_DIFF_FROZEN_METADATA", repoFile, `Frozen ADR metadata changed: ${field}`, {
            field,
            actual: current.data?.[field],
            expected: base.data?.[field],
          })
        );
      }
    }
    if (frozenBody(base.body) !== frozenBody(current.body)) {
      diagnostics.push(
        makeDiagnostic(
          "ADR_DIFF_FROZEN_BODY",
          repoFile,
          "Accepted/superseded/rejected ADR body changed outside References without an exact amendment"
        )
      );
    }

    const isLifecycleTransition =
      baseStatus === "accepted" &&
      current.data?.status === "superseded" &&
      base.data?.superseded_by === null &&
      typeof current.data?.superseded_by === "string";
    if (isLifecycleTransition) {
      const successor = byId.get(current.data.superseded_by);
      if (
        successor?.data?.status !== "accepted" ||
        !successor.data.supersedes?.includes(current.data.id)
      ) {
        diagnostics.push(
          makeDiagnostic(
            "ADR_DIFF_TRANSITION_ATOMIC",
            repoFile,
            "accepted → superseded requires an accepted reciprocal direct successor in the same snapshot"
          )
        );
      }
    } else if (
      baseStatus !== current.data?.status ||
      base.data?.superseded_by !== current.data?.superseded_by
    ) {
      diagnostics.push(
        makeDiagnostic(
          "ADR_DIFF_TRANSITION",
          repoFile,
          `Illegal lifecycle change ${baseStatus}/${base.data?.superseded_by} → ${current.data?.status}/${current.data?.superseded_by}`
        )
      );
    }
  }
  return diagnostics;
}

export async function validateAdrRepository(
  repoRoot,
  { baseRef = null, requireBase = false, includeLinks = true } = {}
) {
  const repository = await loadAdrRepository(repoRoot);
  let diagnostics = [...repository.diagnostics];
  diagnostics.push(...validateUniqueAdrIdentity(repository.adrs));
  diagnostics.push(...validateSupersessionGraph(repository.adrs));

  const currentPath = path.join(repoRoot, "docs", "adr", "CURRENT.md");
  const historyPath = path.join(repoRoot, "docs", "adr", "HISTORY.md");
  try {
    diagnostics.push(...validateCurrent(await readFile(currentPath, "utf8"), repository.adrs));
  } catch (error) {
    diagnostics.push(
      makeDiagnostic("ADR_CURRENT_MISSING_FILE", "docs/adr/CURRENT.md", `Unable to read CURRENT: ${error.message}`)
    );
  }
  try {
    const actualHistory = (await readFile(historyPath, "utf8")).replace(/\r\n?/g, "\n");
    const expectedHistory = renderHistory(repository.adrs);
    if (actualHistory !== expectedHistory) {
      diagnostics.push(
        makeDiagnostic(
          "ADR_HISTORY_STALE",
          "docs/adr/HISTORY.md",
          "HISTORY differs from deterministic Front Matter output; run pnpm docs:adr:generate"
        )
      );
    }
  } catch (error) {
    diagnostics.push(
      makeDiagnostic("ADR_HISTORY_MISSING_FILE", "docs/adr/HISTORY.md", `Unable to read HISTORY: ${error.message}`)
    );
  }

  const allMarkdown = await listMarkdownFiles(path.join(repoRoot, "docs", "architecture"));
  const architectureRepoPaths = allMarkdown.map((file) => toRepoPath(repoRoot, file));
  try {
    const indexText = await readFile(path.join(repoRoot, "docs", "architecture", "README.md"), "utf8");
    diagnostics.push(...validateArchitectureIndex(indexText, architectureRepoPaths));
  } catch (error) {
    diagnostics.push(
      makeDiagnostic(
        "ARCHITECTURE_INDEX_MISSING_FILE",
        "docs/architecture/README.md",
        `Unable to read Architecture index: ${error.message}`
      )
    );
  }

  if (includeLinks) {
    const links = await validateMarkdownLinks(repoRoot);
    diagnostics.push(...links.diagnostics);
  }
  if (baseRef) {
    diagnostics.push(...(await validateAdrDiff(repoRoot, baseRef, repository)));
  } else if (requireBase) {
    diagnostics.push(
      makeDiagnostic(
        "ADR_DIFF_BASE_REQUIRED",
        "docs/adr",
        "DOCS_BASE_REF is required for diff-aware ADR checks"
      )
    );
  }

  const exceptions = await applyLegacyExceptions(repoRoot, diagnostics);
  return {
    ...repository,
    diagnostics: exceptions.diagnostics,
    suppressedDiagnostics: exceptions.suppressed,
    diffSkipped: !baseRef,
  };
}

export function formatDiagnostics(diagnostics, { includeFingerprint = false } = {}) {
  return diagnostics
    .map((diagnostic) => {
      const suffix = includeFingerprint
        ? `\n  fingerprint: ${diagnosticFingerprint(diagnostic)}\n  payload: ${JSON.stringify(diagnosticPayload(diagnostic))}`
        : "";
      return `[${diagnostic.rule}] ${diagnostic.path}: ${diagnostic.message}${suffix}`;
    })
    .join("\n");
}
