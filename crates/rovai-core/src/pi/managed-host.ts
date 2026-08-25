import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

const SCHEMA_VERSION = 1;
const EXTENSION_VERSION = "rovai-pi-host-v2";
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
  "mcpProjectionDigest",
  "mcpTools",
  "nativeBindingGeneration",
  "nativeBindingId",
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
    !(binding.expectedNativeSessionId === null || nonEmpty(binding.expectedNativeSessionId)) ||
    !nonEmpty(binding.bootstrapEvidenceId) ||
    typeof binding.bootstrap !== "string" ||
    !/^[a-f0-9]{64}$/.test(binding.bootstrapPayloadDigest) ||
    sha256(binding.bootstrap) !== binding.bootstrapPayloadDigest ||
    !nonEmpty(binding.expectedManagedSkillExposureDigest) ||
    !nonEmpty(binding.mcpProjectionDigest) ||
    !Array.isArray(binding.mcpTools)
  ) {
    throw new Error("binding evidence mismatch");
  }
  const expectedRoot = realpathSync(path.join(cwd, ".pi", "skills"));
  if (!path.isAbsolute(binding.skillRoot) || realpathSync(binding.skillRoot) !== expectedRoot) {
    throw new Error("binding skill root mismatch");
  }
  let previousName = "";
  const sources = new Set<string>();
  for (const tool of binding.mcpTools) {
    if (
      !exactKeys(tool, [
        "description",
        "descriptionDigest",
        "inputSchema",
        "inputSchemaDigest",
        "runtimeName",
        "serverId",
        "serverName",
        "toolName",
      ]) ||
      !nonEmpty(tool.serverId) ||
      !nonEmpty(tool.serverName) ||
      !nonEmpty(tool.toolName) ||
      !/^[a-z0-9_]{1,64}$/.test(tool.runtimeName) ||
      NATIVE_TOOLS.includes(tool.runtimeName) ||
      typeof tool.description !== "string" ||
      canonicalDigest(tool.description) !== tool.descriptionDigest ||
      tool.inputSchema === null ||
      typeof tool.inputSchema !== "object" ||
      Array.isArray(tool.inputSchema) ||
      canonicalDigest(tool.inputSchema) !== tool.inputSchemaDigest ||
      tool.runtimeName <= previousName
    ) {
      throw new Error("MCP catalog mismatch");
    }
    const source = `${tool.serverName}\0${tool.toolName}`;
    if (sources.has(source)) throw new Error("duplicate MCP source identity");
    sources.add(source);
    previousName = tool.runtimeName;
  }
  return binding;
}

function approvalEnvelope(binding: any, toolCallId: string, toolName: string, input: any): any {
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
  };
}

function mcpEnvelope(binding: any, tool: any, toolCallId: string, argumentsValue: any): any {
  return {
    schemaVersion: SCHEMA_VERSION,
    extensionVersion: EXTENSION_VERSION,
    kind: "mcp_tool",
    hostInstanceId: binding.hostInstanceId,
    hostBindingGeneration: binding.hostBindingGeneration,
    agentRunId: binding.agentRunId,
    executionEpoch: binding.executionEpoch,
    nativeBindingGeneration: binding.nativeBindingGeneration,
    mcpProjectionDigest: binding.mcpProjectionDigest,
    runtimeName: tool.runtimeName,
    serverId: tool.serverId,
    serverName: tool.serverName,
    toolName: tool.toolName,
    toolCallId,
    arguments: argumentsValue,
    argumentsDigest: canonicalDigest(argumentsValue),
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
      for (const tool of binding.mcpTools) {
        pi.registerTool({
          name: tool.runtimeName,
          label: `MCP ${tool.serverName}/${tool.toolName}`,
          description:
            `Rovai external MCP tool ${tool.serverName}/${tool.toolName}.` +
            (tool.description.length > 0 ? `\n\n${tool.description}` : ""),
          promptSnippet: `MCP ${tool.serverName}/${tool.toolName} (Core-managed approval)`,
          promptGuidelines: [],
          parameters: tool.inputSchema,
          async execute(toolCallId: string, params: any, _signal: any, _onUpdate: any, toolCtx: any) {
            try {
              const current = loadBinding(toolCtx.cwd);
              const currentTool = current.mcpTools.find((entry: any) => entry.runtimeName === tool.runtimeName);
              if (!currentTool) throw new Error("stale MCP proxy");
              const envelope = mcpEnvelope(current, currentTool, toolCallId, params);
              const allowed = await toolCtx.ui.confirm(
                "Rovai managed approval",
                JSON.stringify(envelope),
              );
              if (!allowed) {
                return { content: [{ type: "text", text: "Blocked by Rovai approval" }], isError: true };
              }
              const response = await toolCtx.ui.input(
                "Rovai MCP bridge",
                JSON.stringify(envelope),
              );
              if (!response) throw new Error("missing MCP bridge response");
              const result = JSON.parse(response);
              if (
                !exactKeys(result, ["content", "isError"]) ||
                !Array.isArray(result.content) ||
                typeof result.isError !== "boolean"
              ) {
                throw new Error("invalid MCP bridge response");
              }
              return result;
            } catch (_) {
              return { content: [{ type: "text", text: "Rovai MCP bridge failed closed" }], isError: true };
            }
          },
        });
      }
      pi.setActiveTools([...NATIVE_TOOLS, ...binding.mcpTools.map((tool: any) => tool.runtimeName)]);
      ctx.ui.setStatus("rovai-managed-host", EXTENSION_VERSION);
    } catch (_) {
      return await failClosed();
    }
  });

  pi.on("tool_call", async (event: any, ctx: any) => {
    if (["read", "grep", "find", "ls"].includes(event.toolName)) return undefined;
    if (binding?.mcpTools?.some((tool: any) => tool.runtimeName === event.toolName)) return undefined;
    if (!["bash", "write", "edit"].includes(event.toolName) || !ctx.hasUI || ctx.mode !== "rpc") {
      return { block: true, reason: "Rovai managed Host blocks unknown mutating tools" };
    }
    try {
      const current = loadBinding(ctx.cwd);
      const allowed = await ctx.ui.confirm(
        "Rovai managed approval",
        JSON.stringify(approvalEnvelope(current, event.toolCallId, event.toolName, event.input)),
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
      const mcpToolCatalog = current.mcpTools.map((tool: any) => ({
        serverId: tool.serverId,
        serverName: tool.serverName,
        toolName: tool.toolName,
        runtimeName: tool.runtimeName,
        descriptionDigest: tool.descriptionDigest,
        inputSchemaDigest: tool.inputSchemaDigest,
      }));
      const receipt = {
        schemaVersion: SCHEMA_VERSION,
        extensionVersion: EXTENSION_VERSION,
        hostInstanceId: current.hostInstanceId,
        hostBindingGeneration: current.hostBindingGeneration,
        agentRunId: current.agentRunId,
        executionEpoch: current.executionEpoch,
        nativeBindingId: current.nativeBindingId,
        nativeBindingGeneration: current.nativeBindingGeneration,
        nativeSessionId: ctx.sessionManager.getSessionId(),
        bootstrapEvidenceId: current.bootstrapEvidenceId,
        bootstrapPayloadDigest: current.bootstrapPayloadDigest,
        piBaseSystemPromptDigest: sha256(event.systemPrompt),
        effectiveSystemPromptDigest: sha256(effectiveSystemPrompt),
        skillCatalog,
        skillCatalogDigest: canonicalDigest(skillCatalog),
        activeToolNames: pi.getActiveTools(),
        mcpToolCatalog,
        mcpToolCatalogDigest: canonicalDigest(mcpToolCatalog),
        mcpProjectionDigest: current.mcpProjectionDigest,
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
