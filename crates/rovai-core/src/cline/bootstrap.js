// Official Cline Rule API. Each setup owns its Session closure, including
// when the native loader reuses this module across warm Sessions.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const hash = value => createHash("sha256").update(value).digest("hex");
export default {
  name: "rovai-cline-system-rule-v1",
  manifest: { capabilities: ["rules"] },
  setup(api, context) {
    const root = process.env.ROVAI_CLINE_OBSERVER_ROOT;
    const sessionId = context?.session?.sessionId;
    if (!root || typeof sessionId !== "string" || !sessionId) {
      throw new Error("cline_bootstrap_session_missing");
    }
    api.registerRule({
      id: "rovai.session.bootstrap",
      source: "plugin",
      content() {
        const binding = JSON.parse(readFileSync(join(root, "bootstrap", `${hash(sessionId)}.json`), "utf8"));
        if (binding.schemaVersion !== 1 || binding.sessionId !== sessionId ||
            typeof binding.bootstrap !== "string" || !binding.bootstrap.trim() ||
            Buffer.byteLength(binding.bootstrap, "utf8") > 32768 ||
            binding.sha256 !== hash(binding.bootstrap)) {
          throw new Error("cline_bootstrap_binding_invalid");
        }
        return binding.bootstrap;
      },
    });
  },
};
