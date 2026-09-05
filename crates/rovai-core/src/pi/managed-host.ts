import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";

const SCHEMA_VERSION = 3;
const EXTENSION_VERSION = "rovai-pi-host-v7";
const REQUIRED_BINDING_KEYS = [
  "agentRunId",
  "bootstrap",
  "bootstrapPayloadDigest",
  "executionEpoch",
  "expectedNativeSessionId",
  "extensionVersion",
  "hostBindingGeneration",
  "hostInstanceId",
  "nativeBindingGeneration",
  "nativeBindingId",
  "schemaVersion",
];

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hasRequiredKeys(value: any, expected: string[]): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function loadBinding(): any {
  const bindingPath = process.env.ROVAI_PI_HOST_BINDING_FILE;
  if (!bindingPath || !path.isAbsolute(bindingPath)) throw new Error("missing binding path");
  const metadata = lstatSync(bindingPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("invalid binding file");
  if (process.platform !== "win32") {
    if ((metadata.mode & 0o077) !== 0) throw new Error("binding permissions are too broad");
    if (typeof process.geteuid === "function" && metadata.uid !== process.geteuid()) {
      throw new Error("binding owner mismatch");
    }
  }
  const binding = JSON.parse(readFileSync(bindingPath, "utf8"));
  if (!hasRequiredKeys(binding, REQUIRED_BINDING_KEYS)) throw new Error("binding shape mismatch");
  if (
    binding.schemaVersion !== SCHEMA_VERSION ||
    binding.extensionVersion !== EXTENSION_VERSION ||
    !nonEmpty(binding.hostInstanceId) ||
    !Number.isSafeInteger(binding.hostBindingGeneration) ||
    binding.hostBindingGeneration < 1 ||
    !nonEmpty(binding.agentRunId) ||
    !Number.isSafeInteger(binding.executionEpoch) ||
    binding.executionEpoch < 1 ||
    !nonEmpty(binding.nativeBindingId) ||
    !Number.isSafeInteger(binding.nativeBindingGeneration) ||
    binding.nativeBindingGeneration < 1 ||
    !(binding.expectedNativeSessionId === null || nonEmpty(binding.expectedNativeSessionId)) ||
    typeof binding.bootstrap !== "string" ||
    !/^[a-f0-9]{64}$/.test(binding.bootstrapPayloadDigest) ||
    sha256(binding.bootstrap) !== binding.bootstrapPayloadDigest
  ) {
    throw new Error("binding evidence mismatch");
  }
  return binding;
}

function publishManagedSessionState(ctx: any, current: any): void {
  const sessionFile = ctx.sessionManager.getSessionFile();
  const sessionId = ctx.sessionManager.getSessionId();
  const cwd = ctx.sessionManager.getCwd();
  if (!nonEmpty(sessionFile) || !path.isAbsolute(sessionFile) || !nonEmpty(sessionId) || !nonEmpty(cwd)) {
    throw new Error("Pi managed Session state is incomplete");
  }
  ctx.ui.setStatus(
    "rovai-managed-session-state",
    JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      extensionVersion: EXTENSION_VERSION,
      hostInstanceId: current.hostInstanceId,
      hostBindingGeneration: current.hostBindingGeneration,
      sessionId,
      sessionFile,
      cwd,
    }),
  );
}

function publishFailure(ctx: any, binding: any, phase: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  ctx.ui.setStatus(
    "rovai-managed-failure",
    JSON.stringify({
      schemaVersion: 1,
      extensionVersion: EXTENSION_VERSION,
      hostInstanceId: binding?.hostInstanceId ?? null,
      agentRunId: binding?.agentRunId ?? null,
      executionEpoch: binding?.executionEpoch ?? null,
      hostBindingGeneration: binding?.hostBindingGeneration ?? null,
      nativeSessionId: ctx.sessionManager?.getSessionId?.() ?? null,
      phase,
      code: "pi_managed_extension_failure",
      message: message.slice(0, 2000),
    }),
  );
}

export default function (pi: any) {
  pi.on("session_start", async (_event: any, ctx: any) => {
    try {
      publishManagedSessionState(ctx, loadBinding());
    } catch (error) {
      publishFailure(ctx, undefined, "session_start", error);
    }
  });

  pi.on("before_agent_start", async (event: any, ctx: any) => {
    try {
      const current = loadBinding();
      return { systemPrompt: `${event.systemPrompt}\n\n${current.bootstrap}` };
    } catch (error) {
      publishFailure(ctx, undefined, "before_agent_start", error);
      return undefined;
    }
  });
}
