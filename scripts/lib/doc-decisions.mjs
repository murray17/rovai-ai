import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { isMap, parseDocument } from "yaml";

const markdownParser = unified().use(remarkParse).use(remarkGfm);
const VERSION_PATTERN = /^v\d+\.\d+$/;
const LEGACY_ID_PATTERN = /^ADR-\d{4}$/;
const VERSION_DECISION_ID_PATTERN = /^V(\d+)\.(\d+)-D(\d{2,})$/;

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function toRepoPath(repoRoot, filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

function diagnostic(rule, filePath, message, details = {}) {
  return { rule, path: filePath, message, ...details };
}

export function splitFrontMatter(text, filePath) {
  const normalized = text.replace(/\r\n?/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) {
    return {
      data: null,
      body: normalized,
      frontMatterText: "",
      diagnostics: [diagnostic("DOC_FRONT_MATTER", filePath, "Missing YAML Front Matter")],
    };
  }
  const document = parseDocument(match[1], {
    maxAliasCount: 0,
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
    version: "1.2",
  });
  const diagnostics = document.errors.map((error) =>
    diagnostic("DOC_YAML_PARSE", filePath, error.message.split("\n")[0])
  );
  let data = null;
  if (document.errors.length === 0 && isMap(document.contents)) {
    data = document.toJS({ maxAliasCount: 0 });
  } else if (document.errors.length === 0) {
    diagnostics.push(diagnostic("DOC_YAML_ROOT", filePath, "Front Matter must be a mapping"));
  }
  return {
    data,
    body: normalized.slice(match[0].length),
    frontMatterText: match[1],
    diagnostics,
  };
}

export function parseMarkdown(text, filePath = "<markdown>") {
  try {
    return { tree: markdownParser.parse(text), diagnostics: [] };
  } catch (error) {
    return {
      tree: null,
      diagnostics: [diagnostic("MARKDOWN_PARSE", filePath, error.message)],
    };
  }
}

function walkMarkdown(node, callback) {
  callback(node);
  for (const child of node?.children ?? []) walkMarkdown(child, callback);
}

function markdownText(node) {
  if (!node || typeof node !== "object") return "";
  if (typeof node.value === "string") return valueWithoutHtml(node.value, node.type);
  if (node.type === "image" && typeof node.alt === "string") return node.alt;
  return (node.children ?? []).map(markdownText).join("");
}

function valueWithoutHtml(value, type) {
  return type === "html" ? "" : value;
}

function gfmSlug(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\-\s]/gu, "")
    .replace(/\s/g, "-");
}

function documentAnchors(tree) {
  const counts = new Map();
  const anchors = new Set();
  walkMarkdown(tree, (node) => {
    if (node.type === "heading") {
      const base = gfmSlug(markdownText(node));
      const count = counts.get(base) ?? 0;
      counts.set(base, count + 1);
      anchors.add(count === 0 ? base : `${base}-${count}`);
    }
    if (node.type === "html" && typeof node.value === "string") {
      for (const match of node.value.matchAll(/\bid=["']([^"']+)["']/gi)) {
        anchors.add(match[1].toLowerCase());
      }
      for (const match of node.value.matchAll(/<a\s+name=["']([^"']+)["']/gi)) {
        anchors.add(match[1].toLowerCase());
      }
    }
  });
  return anchors;
}

function explicitLevelTwoSection(text, tree, fragment) {
  const escaped = fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const anchorPattern = new RegExp(`\\bid=["']${escaped}["']`, "gi");
  const anchorIndexes = [];
  for (const [index, node] of (tree?.children ?? []).entries()) {
    walkMarkdown(node, (child) => {
      if (child.type !== "html" || typeof child.value !== "string") return;
      for (const _match of child.value.matchAll(anchorPattern)) anchorIndexes.push(index);
    });
  }
  if (anchorIndexes.length !== 1) return null;
  const anchorIndex = anchorIndexes[0];
  const headingIndex = tree.children.findIndex(
    (node, index) => index > anchorIndex && node.type === "heading" && node.depth === 2
  );
  if (headingIndex < 0) return null;
  const nextHeadingIndex = tree.children.findIndex(
    (node, index) => index > headingIndex && node.type === "heading" && node.depth === 2
  );
  const start = tree.children[anchorIndex].position?.start?.offset;
  const end = nextHeadingIndex < 0
    ? text.length
    : tree.children[nextHeadingIndex].position?.start?.offset;
  if (start === undefined || end === undefined) return null;
  return text.slice(start, end);
}

async function listFiles(directory, predicate) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist", "out", ".codex-worktrees"].includes(entry.name)) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(entryPath, predicate)));
    else if (entry.isFile() && predicate(entryPath)) files.push(entryPath);
  }
  return files;
}

async function exactPathExists(repoRoot, absolutePath, cache) {
  const relative = path.relative(repoRoot, absolutePath);
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
  let cursor = repoRoot;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    let entries = cache.get(cursor);
    if (!entries) {
      try {
        entries = new Set(await readdir(cursor));
      } catch {
        return false;
      }
      cache.set(cursor, entries);
    }
    if (!entries.has(component)) return false;
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
  const roots = ["README.md", "AGENTS.md", "CONTEXT.md"]
    .map((item) => path.join(repoRoot, item))
    .filter(Boolean);
  const markdownFiles = [
    ...roots,
    ...(await listFiles(path.join(repoRoot, "docs"), (file) => file.endsWith(".md"))),
    ...(await listFiles(path.join(repoRoot, "skills"), (file) => file.endsWith(".md"))),
  ];
  const cache = new Map();
  const directoryCache = new Map();

  async function parsed(filePath) {
    if (!cache.has(filePath)) {
      cache.set(filePath, parseMarkdown(await readFile(filePath, "utf8"), toRepoPath(repoRoot, filePath)));
    }
    return cache.get(filePath);
  }

  for (const sourcePath of markdownFiles) {
    const sourceRepoPath = toRepoPath(repoRoot, sourcePath);
    const source = await parsed(sourcePath);
    diagnostics.push(...source.diagnostics);
    if (!source.tree) continue;
    for (const destination of markdownDestinations(source.tree)) {
      const raw = destination.url.trim();
      const scheme = raw.match(/^([A-Za-z][A-Za-z0-9+.-]*):/);
      if (scheme) {
        const protocol = scheme[1].toLowerCase();
        if (!["http", "https", "mailto"].includes(protocol)) {
          diagnostics.push(
            diagnostic("MARKDOWN_LINK_PROTOCOL", sourceRepoPath, `Unsupported link protocol: ${protocol}`, {
              line: destination.line,
              actual: raw,
            })
          );
        }
        continue;
      }
      const hashIndex = raw.indexOf("#");
      const queryIndex = raw.indexOf("?");
      const cut = [hashIndex, queryIndex].filter((index) => index >= 0);
      const pathEnd = cut.length ? Math.min(...cut) : raw.length;
      let targetText = raw.slice(0, pathEnd);
      const fragmentText = hashIndex >= 0 ? raw.slice(hashIndex + 1) : "";
      try {
        targetText = decodeURIComponent(targetText);
      } catch {
        diagnostics.push(diagnostic("MARKDOWN_LINK_ENCODING", sourceRepoPath, `Invalid URL: ${raw}`));
        continue;
      }
      const targetPath = targetText ? path.resolve(path.dirname(sourcePath), targetText) : sourcePath;
      const relative = path.relative(repoRoot, targetPath);
      if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        diagnostics.push(diagnostic("MARKDOWN_LINK_ESCAPE", sourceRepoPath, `Link escapes repository: ${raw}`));
        continue;
      }
      if (!(await exactPathExists(repoRoot, targetPath, directoryCache))) {
        diagnostics.push(
          diagnostic("MARKDOWN_LINK_MISSING", sourceRepoPath, `Local link target does not exist: ${raw}`, {
            line: destination.line,
          })
        );
        continue;
      }
      if (fragmentText && targetPath.toLowerCase().endsWith(".md")) {
        let fragment;
        try {
          fragment = decodeURIComponent(fragmentText).toLowerCase();
        } catch {
          diagnostics.push(diagnostic("MARKDOWN_LINK_ENCODING", sourceRepoPath, `Invalid fragment: ${raw}`));
          continue;
        }
        const target = await parsed(targetPath);
        if (target.tree && !documentAnchors(target.tree).has(fragment)) {
          diagnostics.push(
            diagnostic("MARKDOWN_FRAGMENT_MISSING", sourceRepoPath, `Fragment does not exist: ${raw}`, {
              line: destination.line,
            })
          );
        }
      }
    }
  }
  return { diagnostics, markdownFiles };
}

function markdownUrlSpan(raw, nodeType) {
  if (nodeType === "definition") {
    const marker = raw.indexOf(":");
    if (marker < 0) return null;
    let start = marker + 1;
    while (/\s/.test(raw[start] ?? "")) start += 1;
    const angled = raw[start] === "<";
    if (angled) start += 1;
    let end = start;
    while (end < raw.length && (angled ? raw[end] !== ">" : !/\s/.test(raw[end]))) end += 1;
    return { start, end };
  }
  const marker = raw.indexOf("](");
  if (marker < 0) return null;
  let start = marker + 2;
  while (/\s/.test(raw[start] ?? "")) start += 1;
  const angled = raw[start] === "<";
  if (angled) start += 1;
  let end = start;
  while (end < raw.length && (angled ? raw[end] !== ">" : !/[\s)]/.test(raw[end]))) end += 1;
  return { start, end };
}

function relativeMarkdownPath(fromFile, toFile) {
  const relative = path.posix.relative(path.posix.dirname(fromFile), toFile);
  return relative || path.posix.basename(toFile);
}

function splitLocalUrl(rawUrl) {
  const hashIndex = rawUrl.indexOf("#");
  const queryIndex = rawUrl.indexOf("?");
  const positions = [hashIndex, queryIndex].filter((value) => value >= 0);
  const end = positions.length ? Math.min(...positions) : rawUrl.length;
  return {
    pathname: rawUrl.slice(0, end),
    suffix: rawUrl.slice(end),
    fragment: hashIndex >= 0 ? rawUrl.slice(hashIndex + 1) : "",
  };
}

function rewriteLegacyUrl(rawUrl, entry, bySourcePath) {
  if (rawUrl === "" || rawUrl.startsWith("//") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(rawUrl)) {
    return rawUrl;
  }
  if (rawUrl.startsWith("#")) {
    const fragment = rawUrl.slice(1);
    return fragment ? `#${entry.legacy_id.toLowerCase()}-${fragment.toLowerCase()}` : rawUrl;
  }
  const { pathname, suffix, fragment } = splitLocalUrl(rawUrl);
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Preserve invalid legacy spelling; the link checker will report it.
  }
  const sourceTarget = path.posix.normalize(path.posix.join(path.posix.dirname(entry.source_path), decoded));
  const legacyTarget = bySourcePath.get(sourceTarget);
  if (legacyTarget) {
    const relative = relativeMarkdownPath(entry.target_file, legacyTarget.target_file);
    const targetFragment = fragment
      ? `${legacyTarget.legacy_id.toLowerCase()}-${fragment.toLowerCase()}`
      : legacyTarget.target_anchor;
    return `${relative}#${targetFragment}`;
  }
  const retiredRoutes = new Map([
    ["docs/adr/README.md", "docs/decisions/README.md"],
    ["docs/adr/CURRENT.md", "docs/decisions/CURRENT.md"],
    ["docs/adr/HISTORY.md", "docs/decisions/LEGACY-MAP.md"],
    ["docs/adr/TEMPLATE.md", "docs/decisions/README.md"],
  ]);
  const routed = retiredRoutes.get(sourceTarget) ?? sourceTarget;
  return `${relativeMarkdownPath(entry.target_file, routed)}${suffix}`;
}

export function normalizeLegacyBody(originalBody, entry, bySourcePath) {
  const normalized = originalBody.replace(/\r\n?/g, "\n");
  const parsed = parseMarkdown(normalized, entry.source_path);
  if (!parsed.tree) throw new Error(`Unable to parse ${entry.source_path}`);
  const replacements = [];
  walkMarkdown(parsed.tree, (node) => {
    if (!["link", "image", "definition"].includes(node.type) || !node.position) return;
    const startOffset = node.position.start.offset;
    const endOffset = node.position.end.offset;
    if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset)) return;
    const raw = normalized.slice(startOffset, endOffset);
    const span = markdownUrlSpan(raw, node.type);
    if (!span) return;
    const originalUrl = raw.slice(span.start, span.end);
    const rewritten = rewriteLegacyUrl(originalUrl, entry, bySourcePath);
    if (rewritten !== originalUrl) {
      replacements.push({ start: startOffset + span.start, end: startOffset + span.end, value: rewritten });
    }
  });
  let rewritten = normalized;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    rewritten = rewritten.slice(0, replacement.start) + replacement.value + rewritten.slice(replacement.end);
  }
  const lines = rewritten.split("\n");
  const firstHeading = lines.findIndex((line) => /^#\s+/.test(line));
  if (firstHeading < 0) throw new Error(`${entry.source_path} has no H1`);
  lines.splice(firstHeading, 1);
  const transformed = [];
  const headingCounts = new Map();
  for (const line of lines) {
    const heading = line.match(/^(#{1,5})\s+(.+)$/);
    if (!heading) {
      transformed.push(line);
      continue;
    }
    const base = gfmSlug(heading[2]);
    const count = headingCounts.get(base) ?? 0;
    headingCounts.set(base, count + 1);
    const unique = count === 0 ? base : `${base}-${count}`;
    transformed.push(`<a id="${entry.legacy_id.toLowerCase()}-${unique}"></a>`);
    transformed.push(`${heading[1]}# ${heading[2]}`);
  }
  return transformed.join("\n").replace(/^\n+/, "").replace(/\n*$/, "\n");
}

export function decisionKernels(body, title) {
  const match = body.match(/\n## Decision\s*\n([\s\S]*?)(?=\n## Consequences\s*\n)/i);
  if (!match) return null;
  const decision = match[1].trim();
  const headings = [...decision.matchAll(/^###\s+(.+)$/gm)];
  if (headings.length === 0) return [title];
  const kernels = [];
  if (decision.slice(0, headings[0].index).trim()) kernels.push(`${title} — decision baseline`);
  for (const heading of headings) kernels.push(heading[1].trim());
  return kernels;
}

function isCurrentLegacy(entry) {
  return (
    entry.status === "accepted" &&
    entry.decision_scope === "cross-version" &&
    entry.superseded_by === null
  );
}

function parseCoverageRows(text) {
  const rows = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!/^\| ADR-\d{4} \|/.test(line)) continue;
    const cells = [];
    let value = "";
    let escaped = false;
    for (const char of line.slice(1, -1)) {
      if (escaped) {
        value += char;
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "|") {
        cells.push(value.trim());
        value = "";
      } else {
        value += char;
      }
    }
    cells.push(value.trim());
    if (cells.length !== 7) continue;
    const target = cells[5].match(/^\[[^\]]+\]\(([^)]+)\)$/)?.[1] ?? null;
    rows.push({
      id: cells[0],
      topic: cells[1].replace(/^`|`$/g, ""),
      kernel: cells[2],
      current: cells[3],
      authority: cells[4],
      target,
      action: cells[6].replace(/^`|`$/g, ""),
      line: index + 1,
    });
  }
  return rows;
}

function parseAuthorityResolutionRows(text, filePath) {
  const diagnostics = [];
  const blocks = [...text.matchAll(/<!-- authority-resolution:begin -->([\s\S]*?)<!-- authority-resolution:end -->/g)];
  if (blocks.length !== 1) {
    diagnostics.push(diagnostic("DECISION_RESOLUTION_BLOCK", filePath, "Exactly one authority-resolution block is required"));
  }
  const rows = [];
  for (const block of blocks) {
    for (const line of block[1].split(/\r?\n/)) {
      if (!/^\| ADR-\d{4} \|/.test(line)) continue;
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      if (cells.length !== 4) continue;
      const action = cells[2].replace(/^`|`$/g, "");
      if (!["replaced", "retired"].includes(action)) continue;
      rows.push({ id: cells[0], kernels: cells[1], action });
    }
  }
  return {
    diagnostics,
    rows,
    block: blocks.length === 1 ? blocks[0][0] : null,
    valid: blocks.length === 1,
  };
}

async function versionLifecycle(repoRoot, version) {
  const file = path.join(repoRoot, "docs", "versions", version, "README.md");
  const parsed = splitFrontMatter(await readFile(file, "utf8"), toRepoPath(repoRoot, file));
  return parsed.data?.lifecycle;
}

function findLegacyBody(text, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<!-- legacy-adr-body:begin id=${escaped} -->\\n([\\s\\S]*?)<!-- legacy-adr-body:end id=${escaped} -->`,
    "g"
  );
  const matches = [...text.matchAll(pattern)];
  return matches.length === 1 ? matches[0][1] : null;
}

function manifestDiagnostics(manifest, manifestText, repoRoot) {
  const diagnostics = [];
  const filePath = "docs/decisions/ADR-MIGRATION-MANIFEST.json";
  if (manifest.schema_version !== 1 || manifest.migration_kind !== "numbered-adr-clean-break") {
    diagnostics.push(diagnostic("DECISION_MANIFEST_SCHEMA", filePath, "Unsupported manifest schema"));
    return diagnostics;
  }
  if (!/^[0-9a-f]{40}$/.test(manifest.baseline_commit ?? "")) {
    diagnostics.push(diagnostic("DECISION_MANIFEST_BASELINE", filePath, "Invalid baseline commit"));
  }
  if (!Array.isArray(manifest.entries) || manifest.source_count !== manifest.entries?.length) {
    diagnostics.push(diagnostic("DECISION_MANIFEST_COUNT", filePath, "source_count must equal entries length"));
    return diagnostics;
  }
  const seenIds = new Set();
  const seenPaths = new Set();
  const seenTargets = new Set();
  const bySourcePath = new Map(manifest.entries.map((entry) => [entry.source_path, entry]));
  for (const entry of manifest.entries) {
    if (!LEGACY_ID_PATTERN.test(entry.legacy_id ?? "")) {
      diagnostics.push(diagnostic("DECISION_MANIFEST_ID", filePath, `Invalid legacy ID: ${entry.legacy_id}`));
    }
    for (const [set, value, rule] of [
      [seenIds, entry.legacy_id, "DECISION_MANIFEST_DUPLICATE_ID"],
      [seenPaths, entry.source_path, "DECISION_MANIFEST_DUPLICATE_PATH"],
      [seenTargets, `${entry.target_file}#${entry.target_anchor}`, "DECISION_MANIFEST_DUPLICATE_TARGET"],
    ]) {
      if (set.has(value)) diagnostics.push(diagnostic(rule, filePath, `Duplicate manifest value: ${value}`));
      set.add(value);
    }
    const reconstructed = `---\n${entry.original_front_matter}\n---\n${entry.original_body}`;
    if (sha256(reconstructed) !== entry.source_file_sha256) {
      diagnostics.push(diagnostic("DECISION_MANIFEST_FILE_HASH", filePath, `${entry.legacy_id} source file hash mismatch`));
    }
    if (sha256(entry.original_body ?? "") !== entry.source_body_sha256) {
      diagnostics.push(diagnostic("DECISION_MANIFEST_BODY_HASH", filePath, `${entry.legacy_id} source body hash mismatch`));
    }
    let normalized;
    try {
      normalized = normalizeLegacyBody(entry.original_body, entry, bySourcePath);
    } catch (error) {
      diagnostics.push(diagnostic("DECISION_MANIFEST_NORMALIZE", filePath, `${entry.legacy_id}: ${error.message}`));
      continue;
    }
    if (normalized !== entry.normalized_migrated_body) {
      diagnostics.push(diagnostic("DECISION_MANIFEST_EQUIVALENCE", filePath, `${entry.legacy_id} normalized body is not an allowed transformation`));
    }
    if (sha256(entry.normalized_migrated_body ?? "") !== entry.normalized_migrated_body_sha256) {
      diagnostics.push(diagnostic("DECISION_MANIFEST_NORMALIZED_HASH", filePath, `${entry.legacy_id} normalized body hash mismatch`));
    }
  }
  return diagnostics;
}

async function validateVersionDecisionFiles(repoRoot, manifest) {
  const diagnostics = [];
  const versionRoot = path.join(repoRoot, "docs", "versions");
  const files = await listFiles(versionRoot, (file) => path.basename(file) === "decisions.md");
  const byTarget = new Map();
  for (const entry of manifest.entries) {
    if (!byTarget.has(entry.target_file)) byTarget.set(entry.target_file, []);
    byTarget.get(entry.target_file).push(entry);
  }
  for (const target of byTarget.keys()) {
    if (!files.some((file) => toRepoPath(repoRoot, file) === target)) {
      diagnostics.push(diagnostic("DECISION_TARGET_MISSING", target, "Manifest target file is missing"));
    }
  }
  for (const file of files) {
    const repoFile = toRepoPath(repoRoot, file);
    const version = path.basename(path.dirname(file));
    const text = (await readFile(file, "utf8")).replace(/\r\n?/g, "\n");
    const parsed = splitFrontMatter(text, repoFile);
    diagnostics.push(...parsed.diagnostics);
    if (parsed.data) {
      if (parsed.data.document_type !== "version-decisions") {
        diagnostics.push(diagnostic("DECISION_DOCUMENT_TYPE", repoFile, "document_type must be version-decisions"));
      }
      if (parsed.data.version !== version) {
        diagnostics.push(diagnostic("DECISION_VERSION", repoFile, `version must equal ${version}`));
      }
      const lifecycle = await versionLifecycle(repoRoot, version);
      if (parsed.data.lifecycle !== lifecycle) {
        diagnostics.push(diagnostic("DECISION_LIFECYCLE", repoFile, `lifecycle must equal ${lifecycle}`));
      }
    }
    const seenIds = new Set();
    const legacyEntries = byTarget.get(repoFile) ?? [];
    const allowedLegacyIds = new Set(legacyEntries.map((entry) => entry.legacy_id));
    for (const match of text.matchAll(/^##\s+(ADR-\d{4})(?=\s*[:：])/gm)) {
      if (!allowedLegacyIds.has(match[1])) {
        diagnostics.push(
          diagnostic(
            "DECISION_NEW_LEGACY_ID",
            repoFile,
            `${match[1]} is not a migrated ID from the immutable manifest`
          )
        );
      }
    }
    for (const match of text.matchAll(/^##\s+(V\d+\.\d+-D\d{2,})(?=\s*[:：])/gm)) {
      const id = match[1];
      if (seenIds.has(id)) diagnostics.push(diagnostic("DECISION_ID_DUPLICATE", repoFile, `Duplicate ${id}`));
      seenIds.add(id);
      const idMatch = id.match(VERSION_DECISION_ID_PATTERN);
      if (`v${idMatch[1]}.${idMatch[2]}` !== version) {
        diagnostics.push(diagnostic("DECISION_ID_VERSION", repoFile, `${id} does not match ${version}`));
      }
      const anchor = id.toLowerCase().replaceAll(".", "-");
      const anchorCount = text.split(`id="${anchor}"`).length - 1;
      if (anchorCount !== 1) {
        diagnostics.push(
          diagnostic("DECISION_ID_ANCHOR", repoFile, `${id} must have exactly one explicit id="${anchor}" anchor`)
        );
      }
    }
    for (const entry of legacyEntries) {
      const body = findLegacyBody(text, entry.legacy_id);
      if (body === null) {
        diagnostics.push(diagnostic("DECISION_LEGACY_BLOCK", repoFile, `${entry.legacy_id} must have exactly one migrated body block`));
      } else if (body !== entry.normalized_migrated_body) {
        diagnostics.push(diagnostic("DECISION_LEGACY_BODY", repoFile, `${entry.legacy_id} migrated body differs from the manifest`));
      }
      const anchorCount = text.split(`id="${entry.target_anchor}"`).length - 1;
      if (anchorCount !== 1) {
        diagnostics.push(diagnostic("DECISION_LEGACY_ANCHOR", repoFile, `${entry.target_anchor} must appear exactly once`));
      }
    }
  }
  return { diagnostics, files };
}

async function validateLegacyMap(repoRoot, manifest) {
  const file = path.join(repoRoot, "docs", "decisions", "LEGACY-MAP.md");
  const text = await readFile(file, "utf8");
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\| (ADR-\d{4}) \| `([^`]+)` \| `([^`]+)` \| `([^`]+)` \| \[[^\]]+\]\(([^)]+)\) \|$/);
    if (match) rows.push({ id: match[1], source: match[2], version: match[3], status: match[4], target: match[5] });
  }
  const diagnostics = [];
  const byId = new Map();
  for (const row of rows) {
    if (byId.has(row.id)) diagnostics.push(diagnostic("DECISION_MAP_DUPLICATE", toRepoPath(repoRoot, file), `Duplicate ${row.id}`));
    byId.set(row.id, row);
  }
  for (const entry of manifest.entries) {
    const row = byId.get(entry.legacy_id);
    if (!row) {
      diagnostics.push(diagnostic("DECISION_MAP_MISSING", toRepoPath(repoRoot, file), `Missing ${entry.legacy_id}`));
      continue;
    }
    const expected = `../versions/${entry.source_version}/decisions.md#${entry.target_anchor}`;
    if (row.source !== entry.source_path || row.version !== entry.source_version || row.status !== entry.status || row.target !== expected) {
      diagnostics.push(diagnostic("DECISION_MAP_MISMATCH", toRepoPath(repoRoot, file), `${entry.legacy_id} mapping differs from manifest`));
    }
  }
  if (rows.length !== manifest.entries.length) {
    diagnostics.push(diagnostic("DECISION_MAP_COUNT", toRepoPath(repoRoot, file), `Expected ${manifest.entries.length} rows; found ${rows.length}`));
  }
  return diagnostics;
}

async function validateCoverage(repoRoot, manifest) {
  const file = path.join(repoRoot, "docs", "decisions", "AUTHORITY-COVERAGE.md");
  const text = await readFile(file, "utf8");
  const repoFile = toRepoPath(repoRoot, file);
  const parsedCoverage = splitFrontMatter(text, repoFile);
  const rows = parseCoverageRows(text);
  const diagnostics = [...parsedCoverage.diagnostics];
  const currentEntries = manifest.entries.filter(isCurrentLegacy);
  const expectedIds = new Set(currentEntries.map((entry) => entry.legacy_id));
  const rowsById = new Map();
  const rowKeys = new Set();
  const resolutionKeys = new Set();
  const authorityRoots = new Map([
    ["Architecture", "docs/architecture/"],
    ["Contract", "docs/contracts/"],
    ["UI", "docs/ui/"],
    ["Development", "docs/development/"],
    ["Context", "CONTEXT.md"],
  ]);
  for (const row of rows) {
    if (!rowsById.has(row.id)) rowsById.set(row.id, []);
    rowsById.get(row.id).push(row);
    if (!expectedIds.has(row.id)) diagnostics.push(diagnostic("DECISION_COVERAGE_EXTRA", repoFile, `Coverage contains non-current ${row.id}`));
    if (!new Set(["migrated", "replaced", "retired"]).has(row.action)) {
      diagnostics.push(diagnostic("DECISION_COVERAGE_ACTION", repoFile, `${row.id} has invalid action ${row.action}`));
    }
    const expectedCurrent = row.action === "migrated" ? "是" : "否";
    if (row.current !== expectedCurrent) {
      diagnostics.push(diagnostic("DECISION_COVERAGE_CURRENT", repoFile, `${row.id} ${row.action} must use 当前有效=${expectedCurrent}`, { line: row.line }));
    }
    if (["replaced", "retired"].includes(row.action)) resolutionKeys.add(`${row.id}:${row.action}`);
    const rowKey = `${row.id}\u0000${row.kernel}`;
    if (rowKeys.has(rowKey)) {
      diagnostics.push(diagnostic("DECISION_COVERAGE_DUPLICATE", repoFile, `${row.id} duplicates kernel ${row.kernel}`, { line: row.line }));
    }
    rowKeys.add(rowKey);
    if (!row.target || !row.target.includes("#")) {
      diagnostics.push(diagnostic("DECISION_COVERAGE_TARGET", repoFile, `${row.id} lacks an exact authority anchor`, { line: row.line }));
      continue;
    }
    const [rawTargetPath, rawFragment] = row.target.split("#", 2);
    let targetPathText;
    let fragment;
    try {
      targetPathText = decodeURIComponent(rawTargetPath);
      fragment = decodeURIComponent(rawFragment).toLowerCase();
    } catch {
      diagnostics.push(diagnostic("DECISION_COVERAGE_TARGET", repoFile, `${row.id} has an invalid encoded authority target`, { line: row.line }));
      continue;
    }
    const targetPath = path.resolve(path.dirname(file), targetPathText);
    const repoTarget = toRepoPath(repoRoot, targetPath);
    const expectedRoot = authorityRoots.get(row.authority);
    if (!expectedRoot || (expectedRoot.endsWith("/") ? !repoTarget.startsWith(expectedRoot) : repoTarget !== expectedRoot)) {
      diagnostics.push(diagnostic("DECISION_COVERAGE_AUTHORITY", repoFile, `${row.id} authority ${row.authority} does not match ${repoTarget}`, { line: row.line }));
      continue;
    }
    if (!(await exactPathExists(repoRoot, targetPath, new Map()))) {
      diagnostics.push(diagnostic("DECISION_COVERAGE_TARGET", repoFile, `${row.id} authority file does not exist: ${row.target}`, { line: row.line }));
      continue;
    }
    const parsedTarget = parseMarkdown(await readFile(targetPath, "utf8"), repoTarget);
    diagnostics.push(...parsedTarget.diagnostics);
    if (parsedTarget.tree && !documentAnchors(parsedTarget.tree).has(fragment)) {
      diagnostics.push(diagnostic("DECISION_COVERAGE_TARGET", repoFile, `${row.id} authority fragment does not exist: ${row.target}`, { line: row.line }));
    }
  }
  for (const entry of currentEntries) {
    const actual = rowsById.get(entry.legacy_id) ?? [];
    const expectedKernels = decisionKernels(entry.original_body, entry.title);
    if (!expectedKernels) {
      diagnostics.push(diagnostic("DECISION_COVERAGE_DECISION", repoFile, `${entry.legacy_id} has no Decision section in the manifest`));
      continue;
    }
    if (actual.length === 0) {
      diagnostics.push(diagnostic("DECISION_COVERAGE_MISSING", repoFile, `Missing ${entry.legacy_id}`));
      continue;
    }
    const actualKernels = actual.map((row) => row.kernel).sort();
    const expectedSorted = [...expectedKernels].sort();
    if (JSON.stringify(actualKernels) !== JSON.stringify(expectedSorted)) {
      diagnostics.push(diagnostic("DECISION_COVERAGE_KERNELS", repoFile, `${entry.legacy_id} kernel coverage differs from its Decision sections`));
    }
  }
  const resolutionSource = parsedCoverage.data?.resolution_source;
  const resolutionSourceMatch = typeof resolutionSource === "string"
    ? resolutionSource.match(/^(docs\/versions\/v\d+\.\d+\/decisions\.md)#([A-Za-z0-9][A-Za-z0-9._-]*)$/)
    : null;
  let resolutionRows = null;
  if (!resolutionSourceMatch) {
    diagnostics.push(
      diagnostic(
        "DECISION_RESOLUTION_SOURCE",
        repoFile,
        "resolution_source must be docs/versions/vX.Y/decisions.md#fragment"
      )
    );
  } else {
    const [, sourceRepoPath, sourceFragment] = resolutionSourceMatch;
    const sourceFile = path.resolve(repoRoot, sourceRepoPath);
    if (!(await exactPathExists(repoRoot, sourceFile, new Map()))) {
      diagnostics.push(
        diagnostic("DECISION_RESOLUTION_SOURCE", repoFile, `Resolution source does not exist: ${resolutionSource}`)
      );
    } else {
      const sourceText = await readFile(sourceFile, "utf8");
      const parsedSource = parseMarkdown(sourceText, sourceRepoPath);
      diagnostics.push(...parsedSource.diagnostics);
      if (!parsedSource.tree || !documentAnchors(parsedSource.tree).has(sourceFragment.toLowerCase())) {
        diagnostics.push(
          diagnostic("DECISION_RESOLUTION_SOURCE", repoFile, `Resolution source fragment does not exist: ${resolutionSource}`)
        );
      } else {
        const sourceSection = explicitLevelTwoSection(sourceText, parsedSource.tree, sourceFragment);
        if (!sourceSection) {
          diagnostics.push(
            diagnostic(
              "DECISION_RESOLUTION_SOURCE",
              repoFile,
              `Resolution source must identify one explicit level-two decision: ${resolutionSource}`
            )
          );
        } else {
          const parsedResolutions = parseAuthorityResolutionRows(sourceText, sourceRepoPath);
          diagnostics.push(...parsedResolutions.diagnostics);
          if (parsedResolutions.valid && !sourceSection.includes(parsedResolutions.block)) {
            diagnostics.push(
              diagnostic(
                "DECISION_RESOLUTION_SOURCE",
                repoFile,
                `The authority-resolution block is outside ${resolutionSource}`
              )
            );
          } else if (parsedResolutions.valid) {
            resolutionRows = parsedResolutions.rows;
          }
        }
      }
    }
  }
  if (resolutionRows) {
    const actualResolutionKeys = new Set();
    for (const row of resolutionRows) {
      const key = `${row.id}:${row.action}`;
      if (actualResolutionKeys.has(key)) {
        diagnostics.push(diagnostic("DECISION_RESOLUTION_DUPLICATE", repoFile, `Duplicate migration resolution for ${key}`));
      }
      actualResolutionKeys.add(key);
    }
    for (const key of resolutionKeys) {
      if (!actualResolutionKeys.has(key)) {
        diagnostics.push(diagnostic("DECISION_RESOLUTION_MISSING", repoFile, `${key} is not recorded in the migration resolution source`));
      }
    }
    for (const key of actualResolutionKeys) {
      if (!resolutionKeys.has(key)) {
        diagnostics.push(diagnostic("DECISION_RESOLUTION_EXTRA", repoFile, `${key} has no matching coverage action`));
      }
    }
  }
  return { diagnostics, rows, currentCount: currentEntries.length };
}

async function validateNoNumberedAdr(repoRoot) {
  const diagnostics = [];
  const adrRoot = path.join(repoRoot, "docs", "adr");
  try {
    for (const entry of await readdir(adrRoot, { withFileTypes: true })) {
      if (entry.isFile() && /^\d{4}-.*\.md$/.test(entry.name)) {
        diagnostics.push(diagnostic("DECISION_NUMBERED_ADR", `docs/adr/${entry.name}`, "Numbered ADR files are retired"));
      }
      if (entry.name !== "README.md") {
        diagnostics.push(diagnostic("DECISION_ADR_RETIRED_ENTRY", `docs/adr/${entry.name}`, "docs/adr may contain only README.md"));
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return diagnostics;
}

async function validateArchitectureIndex(repoRoot) {
  const root = path.join(repoRoot, "docs", "architecture");
  const files = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md")
    .map((entry) => `docs/architecture/${entry.name}`)
    .sort();
  const readme = await readFile(path.join(root, "README.md"), "utf8");
  const block = readme.match(/<!-- architecture-index:begin -->([\s\S]*?)<!-- architecture-index:end -->/)?.[1];
  if (!block) return [diagnostic("ARCHITECTURE_INDEX_MARKER", "docs/architecture/README.md", "Missing architecture index markers")];
  const targets = [...block.matchAll(/\]\(([^)]+\.md)\)/g)]
    .map((match) => path.posix.normalize(`docs/architecture/${match[1]}`))
    .sort();
  const diagnostics = [];
  for (const file of files) if (!targets.includes(file)) diagnostics.push(diagnostic("ARCHITECTURE_INDEX_MISSING", "docs/architecture/README.md", `Missing ${file}`));
  for (const target of targets) if (!files.includes(target)) diagnostics.push(diagnostic("ARCHITECTURE_INDEX_EXTRA", "docs/architecture/README.md", `Invalid ${target}`));
  if (new Set(targets).size !== targets.length) diagnostics.push(diagnostic("ARCHITECTURE_INDEX_DUPLICATE", "docs/architecture/README.md", "Duplicate architecture entry"));
  return diagnostics;
}

function git(repoRoot, args, options = {}) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", ...options });
}

function normalizeFrozenDecision(block) {
  return block
    .replace(/^last_updated:.*$/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "[$1](LINK)")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

function versionDecisionBlocks(text) {
  const matches = [...text.matchAll(/^##\s+(V\d+\.\d+-D\d{2,})(?=\s*[:：])/gm)];
  const blocks = new Map();
  const errataIndex = text.search(/^##\s+历史勘误/m);
  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index].index;
    const nextDecisionIndex = matches[index + 1]?.index ?? text.length;
    const end = errataIndex >= 0 && errataIndex > start
      ? Math.min(nextDecisionIndex, errataIndex)
      : nextDecisionIndex;
    blocks.set(matches[index][1], text.slice(start, end));
  }
  return blocks;
}

async function validateDiffFreeze(repoRoot, baseRef) {
  const diagnostics = [];
  if (!baseRef) return diagnostics;
  const manifestPath = "docs/decisions/ADR-MIGRATION-MANIFEST.json";
  try {
    const baseManifest = git(repoRoot, ["show", `${baseRef}:${manifestPath}`]);
    const currentManifest = await readFile(path.join(repoRoot, manifestPath), "utf8");
    if (`${baseManifest.trimEnd()}\n` !== currentManifest.replace(/\r\n?/g, "\n")) {
      diagnostics.push(diagnostic("DECISION_MANIFEST_FROZEN", manifestPath, "Migration manifest is immutable after introduction"));
    }
  } catch {
    // The clean-break change introduces the manifest.
  }
  let changed = [];
  try {
    changed = git(repoRoot, ["diff", "--name-only", `${baseRef}...HEAD`, "--", "docs/versions/*/decisions.md"])
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return diagnostics;
  }
  for (const repoFile of changed) {
    const version = repoFile.split("/")[2];
    if ((await versionLifecycle(repoRoot, version)) !== "historical") continue;
    let baseText;
    try {
      baseText = git(repoRoot, ["show", `${baseRef}:${repoFile}`]);
    } catch {
      continue;
    }
    const currentText = await readFile(path.join(repoRoot, repoFile), "utf8");
    const baseBlocks = versionDecisionBlocks(baseText);
    const currentBlocks = versionDecisionBlocks(currentText);
    for (const [id, baseBlock] of baseBlocks) {
      const currentBlock = currentBlocks.get(id);
      if (!currentBlock || normalizeFrozenDecision(baseBlock) !== normalizeFrozenDecision(currentBlock)) {
        diagnostics.push(diagnostic("DECISION_HISTORICAL_FROZEN", repoFile, `${id} semantic body changed; append an explicit erratum instead`));
      }
    }
    for (const id of currentBlocks.keys()) {
      if (!baseBlocks.has(id)) diagnostics.push(diagnostic("DECISION_HISTORICAL_ADDITION", repoFile, `${id} was added to a historical version`));
    }
  }
  return diagnostics;
}

export async function validateDecisionRepository(repoRoot, { baseRef = null, requireBase = false, includeLinks = true } = {}) {
  const diagnostics = [];
  if (requireBase && !baseRef) {
    diagnostics.push(diagnostic("DECISION_BASE_REQUIRED", "<environment>", "DOCS_BASE_REF is required"));
  }
  const manifestPath = path.join(repoRoot, "docs", "decisions", "ADR-MIGRATION-MANIFEST.json");
  let manifest;
  let manifestText;
  try {
    manifestText = await readFile(manifestPath, "utf8");
    manifest = JSON.parse(manifestText);
  } catch (error) {
    return {
      diagnostics: [diagnostic("DECISION_MANIFEST_READ", toRepoPath(repoRoot, manifestPath), error.message)],
      manifest: null,
      coverageRows: [],
    };
  }
  diagnostics.push(...manifestDiagnostics(manifest, manifestText, repoRoot));
  const versions = await validateVersionDecisionFiles(repoRoot, manifest);
  diagnostics.push(...versions.diagnostics);
  diagnostics.push(...(await validateLegacyMap(repoRoot, manifest)));
  const coverage = await validateCoverage(repoRoot, manifest);
  diagnostics.push(...coverage.diagnostics);
  diagnostics.push(...(await validateNoNumberedAdr(repoRoot)));
  diagnostics.push(...(await validateArchitectureIndex(repoRoot)));
  diagnostics.push(...(await validateDiffFreeze(repoRoot, baseRef)));
  if (includeLinks) {
    const links = await validateMarkdownLinks(repoRoot);
    diagnostics.push(...links.diagnostics);
  }
  return {
    diagnostics,
    manifest,
    coverageRows: coverage.rows,
    currentLegacyCount: coverage.currentCount,
    decisionFiles: versions.files,
  };
}

export function formatDiagnostics(diagnostics) {
  return diagnostics
    .map((item) => `${item.path}${item.line ? `:${item.line}` : ""} [${item.rule}] ${item.message}`)
    .join("\n");
}
