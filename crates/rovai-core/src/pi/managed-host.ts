import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import {
  SettingsManager,
  getAgentDir,
  getShellConfig,
} from "@earendil-works/pi-coding-agent";

const SCHEMA_VERSION = 2;
const EXTENSION_VERSION = "rovai-pi-host-v5";
const GOVERNED_NATIVE_TOOLS = ["bash", "edit", "write"];
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
    !/^[a-f0-9]{64}$/.test(binding.expectedManagedSkillExposureDigest)
  ) {
    throw new Error("binding evidence mismatch");
  }
  const expectedRoot = realpathSync(path.join(cwd, ".pi", "skills"));
  if (!path.isAbsolute(binding.skillRoot) || realpathSync(binding.skillRoot) !== expectedRoot) {
    throw new Error("binding skill root mismatch");
  }
  return binding;
}

function resolvedShell(cwd: string, projectTrusted: boolean): any {
  const settings = SettingsManager.create(cwd, getAgentDir(), { projectTrusted });
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

function publishFailure(ctx: any, binding: any, phase: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  ctx.ui.setStatus(
    "rovai-managed-failure",
    canonicalJson({
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

function approvalEnvelope(
  binding: any,
  toolCallId: string,
  toolName: string,
  input: any,
  cwd: string,
  projectTrusted: boolean,
): any {
  return {
    schemaVersion: 1,
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
    shell: toolName === "bash" ? resolvedShell(cwd, projectTrusted) : null,
  };
}

function validateSession(binding: any, ctx: any): { sessionId: string; cwd: string } {
  const sessionId = ctx.sessionManager.getSessionId();
  const cwd = realpathSync(ctx.sessionManager.getCwd());
  if (!nonEmpty(sessionId) || !nonEmpty(cwd)) throw new Error("Pi managed Session identity is incomplete");
  if (binding.expectedNativeSessionId !== null && binding.expectedNativeSessionId !== sessionId) {
    throw new Error("Pi managed Session identity mismatch");
  }
  return { sessionId, cwd };
}

export default function (pi: any) {
  let binding: any;
  let approvedBindingDigest: string | undefined;

  pi.on("resources_discover", async (event: any, ctx: any) => {
    try {
      binding = loadBinding(event.cwd);
      return { skillPaths: [binding.skillRoot] };
    } catch (error) {
      publishFailure(ctx, binding, "resources_discover", error);
      return {};
    }
  });

  pi.on("session_start", async (_event: any, ctx: any) => {
    try {
      binding = loadBinding(ctx.cwd);
      approvedBindingDigest = undefined;
      ctx.ui.setStatus("rovai-managed-host", EXTENSION_VERSION);
      publishManagedSessionState(ctx, binding);
    } catch (error) {
      publishFailure(ctx, binding, "session_start", error);
    }
  });

  pi.on("input", async (event: any, ctx: any) => {
    if (event.source !== "rpc") return { action: "continue" };
    try {
      const current = loadBinding(ctx.cwd);
      const { sessionId, cwd } = validateSession(current, ctx);
      if (!ctx.hasUI || ctx.mode !== "rpc") throw new Error("managed receipt channel is unavailable");
      const availableTools = new Set(pi.getAllTools().map((tool: any) => tool.name));
      const governedNativeTools = GOVERNED_NATIVE_TOOLS.map((name) => ({
        name,
        observable: availableTools.has(name),
      }));
      if (governedNativeTools.some((tool) => !tool.observable)) {
        throw new Error("a governed native Tool is not observable");
      }
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
        nativeSessionId: sessionId,
        cwd,
        bootstrapEvidenceId: current.bootstrapEvidenceId,
        bootstrapPayloadDigest: current.bootstrapPayloadDigest,
        governedNativeTools,
        bindingDocumentDigest: canonicalDigest(current),
      };
      const expectedNonce = sha256(
        `rovai-pi-managed-input-receipt-v2\n${canonicalJson(receipt)}`,
      );
      const nonce = await ctx.ui.input(
        "Rovai managed input receipt",
        JSON.stringify(receipt),
      );
      if (nonce !== expectedNonce) throw new Error("receipt commit nonce mismatch");
      binding = current;
      approvedBindingDigest = receipt.bindingDocumentDigest;
      return { action: "continue" };
    } catch (error) {
      approvedBindingDigest = undefined;
      publishFailure(ctx, binding, "input", error);
      return { action: "handled" };
    }
  });

  pi.on("tool_call", async (event: any, ctx: any) => {
    if (!GOVERNED_NATIVE_TOOLS.includes(event.toolName)) return undefined;
    if (!ctx.hasUI || ctx.mode !== "rpc") {
      return { block: true, reason: "Rovai partial approval channel is unavailable" };
    }
    try {
      const current = loadBinding(ctx.cwd);
      validateSession(current, ctx);
      const allowed = await ctx.ui.confirm(
        "Rovai partial approval",
        JSON.stringify(
          approvalEnvelope(
            current,
            event.toolCallId,
            event.toolName,
            event.input,
            ctx.cwd,
            ctx.isProjectTrusted(),
          ),
        ),
      );
      return allowed ? undefined : { block: true, reason: "Blocked by Rovai approval" };
    } catch (error) {
      publishFailure(ctx, binding, "tool_call", error);
      return { block: true, reason: "Rovai partial approval failed closed" };
    }
  });

  pi.on("before_agent_start", async (event: any, ctx: any) => {
    const currentDigest = binding ? canonicalDigest(binding) : undefined;
    if (!binding || approvedBindingDigest !== currentDigest) {
      publishFailure(ctx, binding, "before_agent_start", new Error("managed input receipt was not committed"));
      ctx.abort();
      return undefined;
    }
    approvedBindingDigest = undefined;
    ctx.ui.setStatus("rovai-managed-host", EXTENSION_VERSION);
    return { systemPrompt: `${event.systemPrompt}\n\n${binding.bootstrap}` };
  });
}
