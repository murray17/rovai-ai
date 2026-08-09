import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  parseDestructivePathChanges,
  parseNulSeparatedPaths,
  runStagedRustCheck,
} from "./lib/check-rust-staged.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pnpmExecutable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

async function gitOutput(arguments_) {
  const { stdout } = await execFileAsync("git", arguments_, {
    cwd: repoRoot,
    encoding: "buffer",
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

async function listStagedPaths() {
  const output = await gitOutput([
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=ACMR",
    "-z",
    "--",
  ]);
  return parseNulSeparatedPaths(output);
}

async function listDestructivePaths() {
  const output = await gitOutput([
    "diff",
    "--cached",
    "--name-status",
    "--diff-filter=DR",
    "-z",
    "--",
  ]);
  return parseDestructivePathChanges(output);
}

async function readStagedFile(filePath) {
  const output = await gitOutput(["show", `:${filePath}`]);
  const source = output.toString("utf8");
  if (source.includes("\uFFFD")) {
    throw new Error(`${filePath} is not valid UTF-8 in the Git index`);
  }
  return source;
}

async function runPnpmScript(script) {
  await new Promise((resolve, reject) => {
    const child = spawn(pnpmExecutable, [script], {
      cwd: repoRoot,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else if (signal) {
        reject(new Error(`pnpm ${script} was terminated by ${signal}`));
      } else {
        reject(new Error(`pnpm ${script} failed with exit code ${code ?? "unknown"}`));
      }
    });
  });
}

try {
  await runStagedRustCheck({
    listStagedPaths,
    listDestructivePaths,
    readStagedFile,
    runPnpmScript,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
