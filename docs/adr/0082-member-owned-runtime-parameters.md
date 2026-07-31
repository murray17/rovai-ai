---
document_type: adr
id: ADR-0082
title: "Member-Owned Runtime Parameters and Explicit Configuration"
status: accepted
date: 2026-07-31
decision_scope: cross-version
source_version: v0.26
supersedes: []
superseded_by: null
---

# ADR-0082: Member-Owned Runtime Parameters and Explicit Configuration

## Context

ADR-0066 simplified ordinary member setup to a Product Runtime Selection. The member saved only an
`AdapterKind`; after a managed Installation became ready, Core silently materialized the Runtime
default model and Rovai-reviewed conservative permission defaults. This kept executable discovery
out of the member page, but removed member-level control over model selection, model options,
sandboxing, approvals and other Runtime-native permission modes.

The supported Product Runtimes expose materially different concepts and values. Treating all of
them as one generic permission level would discard native meaning, while allowing Renderer to pass
arbitrary capability fields would make the UI a configuration authority. Runtime configuration
also participates in Native Session compatibility and must remain frozen per AgentRun.

## Decision

### Member Runtime Configuration is one atomic preference

A resolved member configuration consists of:

```json
{
  "adapterKind": "codex-cli",
  "model": {
    "mode": "explicit",
    "modelId": "gpt-5",
    "options": {
      "reasoning_effort": "high"
    }
  },
  "permissions": {
    "adapterKind": "codex-cli",
    "schemaVersion": 1,
    "values": {
      "sandbox_mode": "danger-full-access",
      "approval_policy": "never"
    }
  }
}
```

Product Runtime, model policy and Adapter Permission Configuration are edited as one draft and
saved by one version-checked command. Switching Product Runtime only replaces the local draft until
save succeeds. A successful save replaces all old Runtime-specific values; fields are never
translated or retained across Runtimes.

Ordinary configuration continues to resolve the shared Managed Default Installation internally.
Installation ID, executable path, fingerprint, auth scope, discovery and migration evidence remain
absent from the editable command and member UI.

### Unresolved selection is the only partial state

If no ready managed Installation and capability snapshot exists, a user may save only the
`AdapterKind`. The member remains `selected_unresolved` and cannot create a new AgentRun. Later
discovery or probing never silently materializes model or permission values. Once the Runtime is
ready, the user must explicitly save a complete Member Runtime Configuration.

When a ready snapshot exists, model and permissions must either both validate and commit or neither
may change. Core validates the complete configuration against the current snapshot inside the save
transaction.

### Model policy has two precise modes

`runtime_default` follows both the Runtime's current default model and that model's default options.
It persists no `modelId` and no model options.

`explicit` persists one model ID and only options reported for that model by the current capability
snapshot. Model-specific controls are unavailable in `runtime_default` mode. Unknown models,
unknown options and invalid values are rejected.

### Runtime-native permissions and explicit member defaults

Each Product Runtime owns a dedicated parameter component and Core mapping. Renderer owns layout,
labels and control shape for recognized fields; Core Adapter policy owns native field names,
values, member defaults and schema version. Models and model-option values come from the latest
Adapter Capability Snapshot. Unknown fields are neither rendered nor passed through.

When the user explicitly saves a ready Runtime without changing its initial draft, Core may write
the following least-restrictive member defaults:

| Runtime | Permission defaults |
|---|---|
| Codex CLI | `sandbox_mode=danger-full-access`, `approval_policy=never` |
| OpenCode | `permission=allow` |
| GitHub Copilot CLI | `allow_all=on` |
| Claude Code | `permission_mode=bypassPermissions` |
| Kiro CLI | no persisted permission field |
| Qoder CLI | `permission_mode=bypass_permissions` |
| CodeBuddy | `permission_mode=bypassPermissions` |
| Qwen Code | `approval_mode=yolo` |
| Antigravity | `mode=accept-edits`, `sandbox=off`, `dangerously_skip_permissions=on` |

These defaults are ordinary values in the member editor. The UI adds no danger label, warning
color or second confirmation. Core never infers a default from enum order or labels and still
rejects a configured value absent from the current native descriptor.

This replaces ADR-0066's requirement that automatic member resolution materialize only
Rovai-reviewed conservative defaults and never enable bypass/yolo/allow-all values. The replacement
applies only to an explicit member save; background discovery, refresh and migration never expand
permissions.

### Drift blocks new Runs without rewriting configuration

If a later capability snapshot no longer supports a saved fixed model, option, permission value or
schema version, Runtime Readiness becomes `needs_attention` and new AgentRuns are blocked. Core does
not reset the member to Runtime defaults or replace permissions. The user must correct and
atomically save the configuration.

Each AgentRun freezes the member configuration at creation. Profile edits and capability drift do
not rewrite already frozen Runs. Host/Session-scoped differences participate in ADR-0007's binding
compatibility digest and cause lazy Native Session replacement before the next incompatible Run;
pure Run-scoped changes do not.

### v0.26 is a clean member-configuration reset

The project remains pre-release. v0.26 deletes every existing member Product Runtime Selection and
member model/permission preference instead of preserving or translating configurations created by
the adapterKind-only workflow. Shared Installations, capability snapshots, historical frozen
AgentRuns and diagnostic evidence remain intact. Every member must explicitly select and save a
Runtime again.

## Consequences

- Members regain model and Runtime-native execution control without seeing Installation details.
- Runtime-specific components and mappings add deliberate code, test and review cost, but avoid a
  misleading cross-Runtime abstraction.
- Least-restrictive defaults reduce approval interruptions and can authorize broad side effects;
  this is an explicit product choice made at member save rather than a background mutation.
- Snapshot changes fail closed for new Runs and may require user repair.
- Existing member Runtime choices are intentionally lost once at v0.26 upgrade.
- Native Session rollover remains lazy and preserves Rovai-owned portable Conversation context.

## Rejected Alternatives

- Keep adapterKind-only member configuration and Core-selected conservative defaults.
- Use one universal “permission level” or generic arbitrary-key form for all Runtimes.
- Persist model options while following the Runtime default model.
- Silently repair invalid values after Runtime upgrade.
- Materialize broad permission defaults when background discovery completes.
- Preserve, translate or automatically broaden pre-v0.26 member configurations.
- Expose Installation ID, executable path or fingerprint in the ordinary member editor.

## References

- [ADR-0007: Portable Conversation Handoff](0007-portable-conversation-handoff.md)
- [ADR-0059: Runtime-Owned Resource Permissions](0059-runtime-owned-resource-permissions.md)
- [ADR-0066: Managed Product Runtime Resolution](0066-managed-product-runtime-resolution.md)
- [v0.26 Member Runtime Parameters](../versions/v0.26/README.md)
