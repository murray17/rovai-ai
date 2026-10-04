// Cline CLI 3.0.65 official Plugin API. This observer never changes prompts,
// tools, approval decisions or model results. Only the Host's active lease can
// receive observations; private messages and tool results are not serialized.
import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.env.ROVAI_CLINE_OBSERVER_ROOT;
const hash = value => createHash("sha256").update(value).digest("hex");
const integer = value => Number.isSafeInteger(value) && value >= 0;
let sessionId;
let active;
let sequence = 0;
let modelWindows = {};
try {
  if (root) modelWindows = JSON.parse(readFileSync(join(root, "model-windows.json"), "utf8"));
} catch {
  // An unavailable optional capacity must not interfere with the native run.
}

function emit(kind, payload) {
  if (!root || !active) return;
  const record = {
    schemaVersion: 1, sessionId, leaseId: active.leaseId,
    runId: active.runId, seq: ++sequence, kind, observedAt: new Date().toISOString(), ...payload,
  };
  const prefix = hash(JSON.stringify([sessionId, active.leaseId]));
  const name = `${prefix}-${String(sequence).padStart(8, "0")}.json`;
  const destination = join(root, "observations", name);
  const temporary = `${destination}.tmp`;
  writeFileSync(temporary, JSON.stringify(record), { mode: 0o600, flag: "wx" });
  renameSync(temporary, destination);
}

export default {
  name: "rovai-cline-observer-v2",
  manifest: { capabilities: ["hooks"] },
  setup(_api, context) {
    sessionId = context?.session?.sessionId;
  },
  hooks: {
    beforeRun(context) {
      if (context?.snapshot?.parentAgentId != null) return;
      active = undefined;
      sequence = 0;
      if (!root || typeof sessionId !== "string") return;
      const lease = JSON.parse(readFileSync(join(root, "bindings", `${hash(sessionId)}.json`), "utf8"));
      const runId = context?.snapshot?.runId;
      if (lease.schemaVersion !== 1 || lease.sessionId !== sessionId ||
          typeof lease.leaseId !== "string" || typeof runId !== "string") {
        throw new Error("rovai_cline_observer_lease_mismatch");
      }
      active = { leaseId: lease.leaseId, runId };
      emit("run_started", {});
    },
    afterModel(context) {
      if (!active || context?.snapshot?.parentAgentId != null || context?.snapshot?.runId !== active.runId) return;
      const message = context.assistantMessage;
      if (typeof message?.id !== "string") return;
      const metrics = {};
      for (const key of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "reasoningTokenCount"]) {
        if (integer(message.metrics?.[key])) metrics[key] = message.metrics[key];
      }
      const modelId = message.modelInfo?.id;
      const providerId = message.modelInfo?.provider;
      const window = typeof modelId === "string" && typeof providerId === "string" &&
        Object.hasOwn(modelWindows, providerId) && Object.hasOwn(modelWindows[providerId], modelId)
        ? modelWindows[providerId][modelId] : undefined;
      emit("model_completed", {
        messageId: message.id,
        requestId: typeof context.requestId === "string" ? context.requestId : null,
        modelId: typeof message.modelInfo?.id === "string" ? message.modelInfo.id : null,
        providerId: typeof message.modelInfo?.provider === "string" ? message.modelInfo.provider : null,
        ...(integer(window) && window > 0
          ? { contextWindow: window, contextWindowSource: "native_models_config" } : {}),
        metrics,
      });
    },
    onEvent(event) {
      if (!active || event?.snapshot?.runId !== active.runId || event.type !== "status-notice") return;
      const metadata = event.metadata;
      if (!["manual_compaction", "auto_compaction", "overflow_recovery_compaction"].includes(metadata?.kind)) return;
      if (!["started", "completed", "skipped"].includes(metadata?.phase)) return;
      const values = { trigger: metadata.kind, phase: metadata.phase };
      for (const key of ["tokensBefore", "tokensAfter", "messagesBefore", "messagesAfter"]) {
        if (integer(metadata[key])) values[key] = metadata[key];
      }
      emit("compaction", values);
    },
    afterRun(context) {
      if (!active || context?.result?.runId !== active.runId) return;
      const status = context.result.status;
      if (typeof status === "string") emit("run_finished", { status });
      active = undefined;
    },
  },
};
