import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import {
  SettingsManager,
  getAgentDir,
  getShellConfig,
} from "@earendil-works/pi-coding-agent";

const SCHEMA_VERSION = 1;
const EXTENSION_VERSION = "rovai-pi-host-v4";
const NATIVE_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const BINDING_KEYS = [
  "agentRunId",
  "bootstrap",
  "bootstrapEvidenceId",
  "bootstrapPayloadDigest",
  "executionEpoch",
  "expectedManagedSkillExposureDigest",
  "expectedNativeSessionId",
  "extensionVersion",
  "hostBindingGeneration",
  "hostInstanceId",
  "nativeBindingGeneration",
  "nativeBindingId",
  "nativePromptId",
  "runtimeInputDeliveryId",
  "schemaVersion",
  "skillRoot",
];

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalize(value: any): any {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value: any): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalDigest(value: any): string {
  return sha256(canonicalJson(value));
}

function exactKeys(value: any, expected: string[]): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
  );
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function canonicalSessionFilePath(sessionFile: string): string {
  if (!path.isAbsolute(sessionFile)) throw new Error("non-absolute Session file");
  try {
    const metadata = lstatSync(sessionFile);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("invalid Session file");
    }
    return realpathSync(sessionFile);
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
    return path.join(realpathSync(path.dirname(sessionFile)), path.basename(sessionFile));
  }
}

function failClosed(): Promise<never> {
  return new Promise(() => undefined);
}

function loadBinding(cwd: string): any {
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
  if (!exactKeys(binding, BINDING_KEYS)) throw new Error("binding shape mismatch");
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
    !nonEmpty(binding.runtimeInputDeliveryId) ||
    !nonEmpty(binding.nativePromptId) ||
    !(binding.expectedNativeSessionId === null || nonEmpty(binding.expectedNativeSessionId)) ||
    !nonEmpty(binding.bootstrapEvidenceId) ||
    typeof binding.bootstrap !== "string" ||
    !/^[a-f0-9]{64}$/.test(binding.bootstrapPayloadDigest) ||
    sha256(binding.bootstrap) !== binding.bootstrapPayloadDigest ||
    !nonEmpty(binding.expectedManagedSkillExposureDigest)
  ) {
    throw new Error("binding evidence mismatch");
  }
  const expectedRoot = realpathSync(path.join(cwd, ".pi", "skills"));
  if (!path.isAbsolute(binding.skillRoot) || realpathSync(binding.skillRoot) !== expectedRoot) {
    throw new Error("binding skill root mismatch");
  }
  return binding;
}

function resolvedShell(cwd: string): any {
  const settings = SettingsManager.create(cwd, getAgentDir(), { projectTrusted: false });
  const resolved = getShellConfig(settings.getShellPath());
  if (
    !nonEmpty(resolved.shell) ||
    !Array.isArray(resolved.args) ||
    resolved.args.some((value: unknown) => !nonEmpty(value)) ||
    !(resolved.commandTransport === undefined || resolved.commandTransport === "argv" || resolved.commandTransport === "stdin")
  ) {
    throw new Error("invalid Pi shell resolution");
  }
  return {
    path: resolved.shell,
    args: [...resolved.args],
    commandTransport: resolved.commandTransport ?? "argv",
  };
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
    canonicalJson({
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

function approvalEnvelope(binding: any, toolCallId: string, toolName: string, input: any, cwd: string): any {
  return {
    schemaVersion: SCHEMA_VERSION,
    extensionVersion: EXTENSION_VERSION,
    kind: "native_tool",
    hostInstanceId: binding.hostInstanceId,
    hostBindingGeneration: binding.hostBindingGeneration,
    agentRunId: binding.agentRunId,
    executionEpoch: binding.executionEpoch,
    nativeBindingGeneration: binding.nativeBindingGeneration,
    toolCallId,
    toolName,
    input,
    shell: toolName === "bash" ? resolvedShell(cwd) : null,
  };
}

export default function (pi: any) {
  let binding: any;

  pi.on("resources_discover", async (event: any) => {
    try {
      binding = loadBinding(event.cwd);
      return { skillPaths: [binding.skillRoot] };
    } catch (_) {
      return await failClosed();
    }
  });

  pi.on("session_start", async (_event: any, ctx: any) => {
    try {
      binding = loadBinding(ctx.cwd);
      pi.setActiveTools(NATIVE_TOOLS);
      ctx.ui.setStatus("rovai-managed-host", EXTENSION_VERSION);
      publishManagedSessionState(ctx, binding);
    } catch (_) {
      return await failClosed();
    }
  });

  pi.on("tool_call", async (event: any, ctx: any) => {
    if (["read", "grep", "find", "ls"].includes(event.toolName)) return undefined;
    if (!["bash", "write", "edit"].includes(event.toolName) || !ctx.hasUI || ctx.mode !== "rpc") {
      return { block: true, reason: "Rovai managed Host blocks unknown mutating tools" };
    }
    try {
      const current = loadBinding(ctx.cwd);
      const allowed = await ctx.ui.confirm(
        "Rovai managed approval",
        JSON.stringify(approvalEnvelope(current, event.toolCallId, event.toolName, event.input, ctx.cwd)),
      );
      return allowed ? undefined : { block: true, reason: "Blocked by Rovai approval" };
    } catch (_) {
      return { block: true, reason: "Rovai managed approval failed closed" };
    }
  });

  pi.on("before_agent_start", async (event: any, ctx: any) => {
    try {
      const current = loadBinding(ctx.cwd);
      ctx.ui.setStatus("rovai-managed-host", EXTENSION_VERSION);
      const effectiveSystemPrompt = `${event.systemPrompt}\n\n${current.bootstrap}`;
      const skillCatalog = [...(event.systemPromptOptions.skills ?? [])]
        .map((skill: any) => ({
          name: skill.name,
          descriptionDigest: canonicalDigest(skill.description ?? ""),
          entryPath: skill.filePath,
          modelVisible: !skill.disableModelInvocation,
        }))
        .sort((left: any, right: any) =>
          left.name === right.name
            ? Buffer.from(left.entryPath).compare(Buffer.from(right.entryPath))
            : Buffer.from(left.name).compare(Buffer.from(right.name)),
        );
      const receipt = {
        schemaVersion: SCHEMA_VERSION,
        extensionVersion: EXTENSION_VERSION,
        hostInstanceId: current.hostInstanceId,
        hostBindingGeneration: current.hostBindingGeneration,
        agentRunId: current.agentRunId,
        executionEpoch: current.executionEpoch,
        nativeBindingId: current.nativeBindingId,
        nativeBindingGeneration: current.nativeBindingGeneration,
        runtimeInputDeliveryId: current.runtimeInputDeliveryId,
        nativePromptId: current.nativePromptId,
        nativeSessionId: ctx.sessionManager.getSessionId(),
        nativeSessionFileDigest: sha256(canonicalSessionFilePath(ctx.sessionManager.getSessionFile())),
        cwd: realpathSync(ctx.sessionManager.getCwd()),
        bootstrapEvidenceId: current.bootstrapEvidenceId,
        bootstrapPayloadDigest: current.bootstrapPayloadDigest,
        skillExposureDigest: current.expectedManagedSkillExposureDigest,
        piBaseSystemPromptDigest: sha256(event.systemPrompt),
        effectiveSystemPromptDigest: sha256(effectiveSystemPrompt),
        skillCatalog,
        skillCatalogDigest: canonicalDigest(skillCatalog),
        activeToolNames: pi.getActiveTools(),
        bindingDocumentDigest: canonicalDigest(current),
      };
      const expectedNonce = sha256(
        `rovai-pi-managed-input-receipt-v1\n${canonicalJson(receipt)}`,
      );
      const nonce = await ctx.ui.input(
        "Rovai managed input receipt",
        JSON.stringify(receipt),
      );
      if (nonce !== expectedNonce) throw new Error("receipt commit nonce mismatch");
      return { systemPrompt: effectiveSystemPrompt };
    } catch (_) {
      return await failClosed();
    }
  });
}
