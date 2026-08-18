const CORE_SOURCE_PREFIX = "crates/rovai-core/src/";
const CLI_SOURCE = CORE_SOURCE_PREFIX + "bin/rovai.rs";
const LIB_ROOT = CORE_SOURCE_PREFIX + "lib.rs";
const MAIN_ROOT = CORE_SOURCE_PREFIX + "main.rs";

const RUST_CONFIGURATION_FILES = new Set([
  "rust-toolchain",
  "rust-toolchain.toml",
  "rustfmt.toml",
  ".rustfmt.toml",
  "clippy.toml",
  ".clippy.toml",
]);

const SCRIPT_BY_TARGET = Object.freeze({
  library: "test:rust:lib",
  cli: "test:rust:cli",
  core: "test:rust:core",
});

function normalizedRepoPath(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    throw new Error("Git returned an empty or non-string staged path");
  }
  if (filePath.includes("\\") || filePath.startsWith("/")) {
    throw new Error(`Git returned a non-portable staged path: ${JSON.stringify(filePath)}`);
  }
  const segments = filePath.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error(`Git returned an invalid staged path: ${JSON.stringify(filePath)}`);
  }
  return filePath;
}

function basename(filePath) {
  return filePath.slice(filePath.lastIndexOf("/") + 1);
}

export function isRustOrCargoPath(filePath) {
  const normalized = normalizedRepoPath(filePath);
  const name = basename(normalized);
  return (
    normalized.endsWith(".rs") ||
    name === "Cargo.toml" ||
    name === "Cargo.lock" ||
    normalized.split("/").includes(".cargo") ||
    RUST_CONFIGURATION_FILES.has(name)
  );
}

export function parseNulSeparatedPaths(output) {
  const buffer = Buffer.isBuffer(output) ? output : Buffer.from(output);
  if (buffer.length === 0) {
    return [];
  }
  if (buffer.at(-1) !== 0) {
    throw new Error("Git path output was not NUL terminated");
  }
  const decoded = buffer.toString("utf8");
  if (decoded.includes("\uFFFD")) {
    throw new Error("Git returned a staged path that is not valid UTF-8");
  }
  return decoded.slice(0, -1).split("\0").map(normalizedRepoPath);
}

export function parseDestructivePathChanges(output) {
  const fields = parseNulSeparatedPaths(output);
  const paths = [];
  for (let index = 0; index < fields.length; ) {
    const status = fields[index++];
    if (status === "D") {
      if (index >= fields.length) {
        throw new Error("Git returned an incomplete delete record");
      }
      paths.push(fields[index++]);
      continue;
    }
    if (/^R\d+$/.test(status)) {
      if (index + 1 >= fields.length) {
        throw new Error("Git returned an incomplete rename record");
      }
      paths.push(fields[index++], fields[index++]);
      continue;
    }
    throw new Error(`Unexpected staged path status: ${JSON.stringify(status)}`);
  }
  return paths;
}

function stripRustCommentsAndLiterals(source) {
  let result = "";
  let index = 0;
  let state = "normal";
  let blockDepth = 0;
  let rawHashes = 0;

  const blank = (character) => (character === "\n" || character === "\r" ? character : " ");
  const characterLiteralEnd = (start) => {
    let cursor = start + 1;
    if (cursor >= source.length || source[cursor] === "\n" || source[cursor] === "\r") {
      return -1;
    }
    if (source[cursor] === "\\") {
      cursor += 1;
      if (source[cursor] === "x") {
        cursor += 3;
      } else if (source[cursor] === "u" && source[cursor + 1] === "{") {
        const closingBrace = source.indexOf("}", cursor + 2);
        if (closingBrace === -1 || /[\r\n]/.test(source.slice(cursor, closingBrace))) {
          return -1;
        }
        cursor = closingBrace + 1;
      } else {
        cursor += 1;
      }
    } else {
      const codePoint = source.codePointAt(cursor);
      cursor += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    }
    return source[cursor] === "'" ? cursor + 1 : -1;
  };

  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];

    if (state === "line-comment") {
      result += blank(character);
      index += 1;
      if (character === "\n") {
        state = "normal";
      }
      continue;
    }

    if (state === "block-comment") {
      if (character === "/" && next === "*") {
        result += "  ";
        index += 2;
        blockDepth += 1;
      } else if (character === "*" && next === "/") {
        result += "  ";
        index += 2;
        blockDepth -= 1;
        if (blockDepth === 0) {
          state = "normal";
        }
      } else {
        result += blank(character);
        index += 1;
      }
      continue;
    }

    if (state === "string") {
      result += blank(character);
      index += 1;
      if (character === "\\" && index < source.length) {
        result += blank(source[index]);
        index += 1;
      } else if (character === '"') {
        state = "normal";
      }
      continue;
    }

    if (state === "raw-string") {
      if (character === '"' && source.slice(index + 1, index + 1 + rawHashes) === "#".repeat(rawHashes)) {
        const width = rawHashes + 1;
        result += " ".repeat(width);
        index += width;
        state = "normal";
      } else {
        result += blank(character);
        index += 1;
      }
      continue;
    }

    if (character === "/" && next === "/") {
      result += "  ";
      index += 2;
      state = "line-comment";
      continue;
    }
    if (character === "/" && next === "*") {
      result += "  ";
      index += 2;
      state = "block-comment";
      blockDepth = 1;
      continue;
    }

    const rawMatch = source.slice(index).match(/^(?:b)?r(#{0,255})"/);
    if (rawMatch) {
      result += " ".repeat(rawMatch[0].length);
      index += rawMatch[0].length;
      rawHashes = rawMatch[1].length;
      state = "raw-string";
      continue;
    }

    if (character === '"') {
      result += " ";
      index += 1;
      state = "string";
      continue;
    }

    if (character === "'") {
      const end = characterLiteralEnd(index);
      if (end !== -1) {
        for (const literalCharacter of source.slice(index, end)) {
          result += blank(literalCharacter);
        }
        index = end;
        continue;
      }
    }

    result += character;
    index += 1;
  }

  if (state !== "normal" && state !== "line-comment") {
    throw new Error(`Rust module source ended inside a ${state}`);
  }
  return result;
}

export function parseTopLevelModules(source) {
  if (typeof source !== "string") {
    throw new Error("Rust module source was not readable as text");
  }
  const stripped = stripRustCommentsAndLiterals(source.replace(/^\uFEFF/, ""));
  if (/^\s*#\s*\[\s*path\s*=/m.test(stripped)) {
    throw new Error("#[path] module declarations cannot be classified safely");
  }

  const modules = new Set();
  let braceDepth = 0;
  for (const line of stripped.split(/\r?\n/)) {
    if (braceDepth === 0) {
      const declaration = line.match(
        /^\s*(?:pub(?:\s*\([^\r\n)]*\))?\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*;\s*$/
      );
      if (declaration) {
        if (modules.has(declaration[1])) {
          throw new Error(`Duplicate top-level module declaration: ${declaration[1]}`);
        }
        modules.add(declaration[1]);
      } else if (/^\s*(?:pub(?:\s*\([^\r\n)]*\))?\s+)?mod\b/.test(line) && !line.includes("{")) {
        throw new Error(`Unsupported top-level module declaration: ${line.trim()}`);
      }
    }

    for (const character of line) {
      if (character === "{") {
        braceDepth += 1;
      } else if (character === "}") {
        braceDepth -= 1;
        if (braceDepth < 0) {
          throw new Error("Rust module source contains an unmatched closing brace");
        }
      }
    }
  }
  if (braceDepth !== 0) {
    throw new Error("Rust module source contains unmatched braces");
  }
  return modules;
}

function moduleForSource(relativeSource, modules) {
  for (const moduleName of modules) {
    if (
      relativeSource === `${moduleName}.rs` ||
      relativeSource === `${moduleName}/mod.rs` ||
      relativeSource.startsWith(`${moduleName}/`)
    ) {
      return moduleName;
    }
  }
  return undefined;
}

function fullPlan(reason) {
  return { route: "full", reason, scripts: ["test:rust:workspace-default"] };
}

export function classifyStagedRustChanges({ paths, mainSource, libSource }) {
  const normalizedPaths = paths.map(normalizedRepoPath);
  const rustPaths = normalizedPaths.filter(isRustOrCargoPath);
  if (rustPaths.length === 0) {
    return { route: "skip", reason: "no staged Rust changes", scripts: [] };
  }

  const cargoOrConfigurationPath = rustPaths.find((filePath) => !filePath.endsWith(".rs"));
  if (cargoOrConfigurationPath) {
    return fullPlan(`Cargo or Rust configuration changed: ${cargoOrConfigurationPath}`);
  }
  if (rustPaths.includes(LIB_ROOT)) {
    return fullPlan(`${LIB_ROOT} changed`);
  }

  let mainModules;
  let libraryModules;
  const targets = new Set();
  for (const filePath of rustPaths) {
    if (filePath === CLI_SOURCE) {
      targets.add("cli");
      continue;
    }
    if (filePath === MAIN_ROOT) {
      targets.add("core");
      continue;
    }
    if (!filePath.startsWith(CORE_SOURCE_PREFIX)) {
      return fullPlan(`Rust source cannot be classified safely: ${filePath}`);
    }

    const relativeSource = filePath.slice(CORE_SOURCE_PREFIX.length);
    if (mainModules === undefined || libraryModules === undefined) {
      mainModules = parseTopLevelModules(mainSource);
      libraryModules = parseTopLevelModules(libSource);
    }
    const libraryModule = moduleForSource(relativeSource, libraryModules);
    const mainModule = moduleForSource(relativeSource, mainModules);
    if (!libraryModule && !mainModule) {
      return fullPlan(`Rust source cannot be classified safely: ${filePath}`);
    }
    if (libraryModule) {
      targets.add("library");
    }
    if (mainModule) {
      targets.add("core");
    }
  }

  if (targets.size !== 1) {
    return fullPlan(`staged changes affect multiple Rust targets: ${[...targets].sort().join(", ")}`);
  }
  const [target] = targets;
  return {
    route: target,
    reason: `staged changes affect only the ${target} target`,
    scripts: ["check:rust", SCRIPT_BY_TARGET[target]],
  };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function executePlan(plan, { runPnpmScript, log }) {
  if (plan.route === "skip") {
    log("No staged Rust changes; skipping Rust tests.");
    return plan;
  }

  if (plan.route === "full") {
    log(`Staged Rust validation route: full (${plan.reason}).`);
  } else {
    log(`Staged Rust validation route: ${plan.route} (${plan.reason}).`);
  }
  for (const script of plan.scripts) {
    log(`Running pnpm ${script}...`);
    await runPnpmScript(script);
  }
  return plan;
}

export async function runStagedRustCheck({
  listStagedPaths,
  listDestructivePaths,
  readStagedFile,
  runPnpmScript,
  log = console.log,
  warn = console.error,
}) {
  let stagedPaths;
  let destructivePaths;
  try {
    [stagedPaths, destructivePaths] = await Promise.all([
      listStagedPaths(),
      listDestructivePaths(),
    ]);
    stagedPaths = stagedPaths.map(normalizedRepoPath);
    destructivePaths = destructivePaths.map(normalizedRepoPath);
  } catch (error) {
    const plan = fullPlan(`staged file inspection failed: ${errorMessage(error)}`);
    warn(`Unable to inspect staged Rust changes; falling back to full Rust tests: ${errorMessage(error)}`);
    return executePlan(plan, { runPnpmScript, log });
  }

  if (destructivePaths.some(isRustOrCargoPath)) {
    return executePlan(fullPlan("a Rust or Cargo file was deleted or renamed"), {
      runPnpmScript,
      log,
    });
  }

  let plan;
  try {
    const relevantPaths = stagedPaths.filter(isRustOrCargoPath);
    const needsModuleSources = relevantPaths.some(
      (filePath) =>
        filePath.endsWith(".rs") &&
        filePath !== CLI_SOURCE &&
        filePath !== LIB_ROOT &&
        filePath !== MAIN_ROOT
    );
    let mainSource;
    let libSource;
    if (needsModuleSources) {
      [mainSource, libSource] = await Promise.all([
        readStagedFile(MAIN_ROOT),
        readStagedFile(LIB_ROOT),
      ]);
    }
    plan = classifyStagedRustChanges({ paths: stagedPaths, mainSource, libSource });
  } catch (error) {
    plan = fullPlan(`staged Rust classification failed: ${errorMessage(error)}`);
    warn(`Unable to classify staged Rust changes; falling back to full Rust tests: ${errorMessage(error)}`);
  }
  return executePlan(plan, { runPnpmScript, log });
}
