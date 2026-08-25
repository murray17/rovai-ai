---
document_type: contract
name: Runtime Launch and Verification
version: v27
status: accepted
source_version: v1.28
last_updated: 2026-08-25
---

# Runtime Launch and Verification v27

v27 replaces [v26](runtime-launch-and-verification-v26.md). All non-Pi Runtime terms from v26 remain unchanged.
For Pi, this version replaces the v26 provider overlay, one-Host/one-Session, fixed launch-time Bootstrap/Skill and
unsupported-MCP terms with the confirmed
[model-context-change revision 1](../versions/v1.28/model-context-change.md). If a v26 Pi term conflicts with this
document, v27 is authoritative.

## Product identity、discovery 与平台

- wire identity remains `pi`, display name remains `Pi Coding Agent`, canonical executable remains `pi`, executable
  override remains `ROVAI_PI_BIN`, and transport remains the official LF-delimited `pi-jsonl-rpc-v1`;
- light discovery runs only bounded `pi --version`. A behavioral check or real AgentRun may invoke the model, but it
  must use the same managed Host/input path as production;
- executable path, version, fingerprint, protocol qualification or managed-extension digest drift invalidates the
  corresponding Ready/Host evidence;
- the existing `pi × macos-arm64` admission remains the only qualified Pi platform. macOS x64 and Windows x64 remain
  `not_qualified / runtime_platform.qualification_evidence_missing`.

## Native authentication and model selection

Formal Pi Hosts inherit the user's normal `HOME` and do not override `PI_CODING_AGENT_DIR`. Authentication, provider
catalog, model catalog and default provider/model therefore come from Pi's native `~/.pi/agent` state, including Pi
login, subscription and BYOK mechanisms.

- Core does not read Claude settings, create a MiniMax provider overlay, copy a token, inject
  `ROVAI_PI_MINIMAX_API_KEY`, or write a Rovai-owned `models.json`;
- a new Session launched with `pi://runtime-default` receives no `--provider` or `--model` and uses Pi's native
  default. An exact resumed Session first restores its recorded provider/model;
- an explicit `pi://model?provider=<provider>&id=<id>` selection must resolve through
  `get_available_models -> set_model -> get_state` and match exactly. Pi `0.84.2` persists that explicit choice as its
  global native default; the product must not describe it as Run-local;
- model and thinking identity are per-Run facts and do not enter the Pi Host LRU key. Missing authentication and
  missing model fail closed as `authentication_required` and `model_required`; there is no Claude/MiniMax fallback.

## Resident Host launch and compatibility

The formal launch is semantically equivalent to:

```text
pi --mode rpc
  --no-extensions --no-skills --no-context-files --no-prompt-templates --no-themes
  --no-approve --no-builtin-tools
  --extension <rovai-pi-host-v2>
```

The launch must not fix `--append-system-prompt`, `--skill`, `--tools`, `--provider`, `--model`, or a Rovai-owned
`PI_CODING_AGENT_DIR`. `--no-builtin-tools` is required: `--no-tools` would permanently prevent later
`setActiveTools()` activation in Pi `0.84.2`.

Pi participates in the public Runtime Fleet LRU, but its resident compatibility key is workspace-scoped and contains
only process-level boundaries: exact workspace/execution root, Pi executable path/version/fingerprint, qualified
JSONL protocol revision, `rovai-pi-host-v2` digest, platform and process permission boundary. Camp, member, Native
Session, identity, Bootstrap, Skills, MCP, model, thinking, attachment generation, Built-in lease and AgentRun are
not Host-key inputs.

One Host executes at most one AgentRun at a time. Compatible Runs in the same workspace may serially reuse it;
concurrent Runs receive separate Hosts and cross-workspace reuse is forbidden. A clean release fences per-Run
Approval/MCP/Built-in leases and clears the current binding. Any protocol, receipt, cleanup, MCP, Extension or Session
validation error poisons and stops the Host instead of returning it to the LRU.

Claude Code and Antigravity remain one-shot process integrations and therefore do not enter this resident Host LRU.
That is an execution-shape distinction, not a disabled user-facing LRU option.

## Native Session activation, resume and identity

Every AgentRun publishes a new private binding generation and then activates exactly one Session:

1. an existing binding uses `switch_session(<exact canonical session file>)`;
2. a new binding uses `new_session`;
3. Core verifies the full Pi Session UUID, canonical file, cwd and actual provider/model/thinking state before prompt;
4. cold resume uses only the persisted full UUID and exact canonical file. Partial IDs, `--continue`, recent-session
   scan, fuzzy matching and portable history replay are forbidden.

An exact resume failure is fail-closed and records controlled continuity loss; it does not silently create a new
Session for the same input. Pi `0.84.2` may create the JSONL Session file only after the first assistant entry, so a
new provisional locator may refer to an owned regular-file destination, but successful release must verify the
materialized file header, full UUID and cwd.

Member identity is frozen per Native Binding, not per Host. Bootstrap Evidence v2 stores the exact six-field Member
Identity bytes/digest and full Bootstrap bytes/digest. Profile edits do not patch an existing Pi Session; a new
binding generation for a new Native Session reads the new identity. A resident Host can therefore serve different
members without treating identity as resident process state.

## Managed Bootstrap and input receipt

Pi alone uses `CharterDeliveryMode=managed_system_prompt`. Bootstrap v3/Formatter 3 bytes and Dynamic Context
Formatter 21 remain unchanged, but delivery changes:

```text
P_base  = Pi native system prompt with current active tools + current Skills + exact cwd
P_final = P_base + "\n\n" + frozen Bootstrap
```

`rovai-pi-host-v2` performs this exact append in `before_agent_start`. Dynamic Context remains the exact
`prompt.message`; Bootstrap is not duplicated as a user message or Tool result. Pi never creates a
`ROVAI_BOOTSTRAP_REDELIVERY` payload overlay or compaction-redelivery requirement.

Before returning `P_final`, the Extension submits a blocking Pi Managed Input Receipt v1. Core verifies and durably
binds Host/binding/Run/epoch/Session identities, Bootstrap evidence/digest, Pi base and final prompt digests, exact
Skill catalog, active Tool names, MCP catalog/projection and binding-document digest. Only a committed receipt yields
the private commit nonce. A Pi prompt response can become the accepted ACK only after that receipt exists, and the
Runtime request digest schema 2 binds its digest. Receipt failure, timeout, restart or generation mismatch prevents
the provider request.

The private binding document is atomically published at a fixed Core-owned path with parent mode `0700` and file
mode `0600`. Unknown fields/version, wrong owner/mode, symlink/non-regular file, partial write, stale generation,
digest mismatch or wrong workspace/Run/Binding/Session fail closed. Its body and private receipt do not enter argv,
public diagnostics, Activity, model-visible ordinary messages or public read models.

## Skills

Pi starts with `--no-skills`. On each Session activation the managed Extension's `resources_discover` returns only
the exact `<workspace>/.pi/skills` root. That root may contain both project-native Pi Skills and Rovai-reconciled
ready Skills; user-home, ancestor, Package and third-party Extension discovery remain disabled.

Core calls `get_commands` before prompt and verifies every expected managed Skill exactly once, its name,
description digest and lexical entry path, plus canonical target containment. Duplicate real files, duplicate names,
missing expected Skills, prior-Session paths and workspace escapes stop the Host. `switch_session`/`new_session`
rebuilds Pi's ResourceLoader, so Skill changes take effect per Session activation without restarting the process.

## External MCP and Approval

Pi exposes:

```text
ExternalMcpProjection = AdditivePerRun
McpSameNamePolicy     = RovaiWins
McpApprovalControl    = CoreManaged
stdio                 = supported
Streamable HTTP       = unsupported
```

Core owns each ready stdio MCP process tree, performs initialize/initialized and paginated `tools/list`, validates
description and input schema, and publishes stable non-colliding `mcp_<server>_<tool>` proxy Tools in the current
binding. The Extension registers those proxies and activates the seven Pi native Tools followed by MCP names in
bytewise order. MCP definitions are refreshed for every Session activation and never written to user Pi config.

Every MCP call, including read-only-hinted Tools, creates a durable `mcp_tool` Approval. After `allow_once`, the
private Core bridge revalidates Host/binding/Run/epoch/projection/Tool/argument digests before one call; deny,
timeout, cancel, restart, late response and unknown UI/Tool/mutation do not call the server. Text, image and bounded
resource content are normalized to Pi results; audio, unknown content, invalid base64 and over-limit payloads return
a bounded error. MCP secrets, stderr and private envelopes are never model-visible or public.

Native `read/bash/edit/write/grep/find/ls` keep their Pi schemas. `bash/write/edit` retain blocking durable Approval;
read/search Tools do not prompt, and Pi still has no native sandbox. The bundled `rovai` CLI continues through native
`bash` with a per-Run lease and is not MCP.

## Final, cleanup, Usage and Compaction

`prompt` response remains accepted-only, `message_end.message` remains the authoritative assistant snapshot, and
`agent_settled` remains the only successful terminal/Missing-Send boundary. `agent_end`, process exit, receipt or
silence cannot replace it. Abort plus Fleet Stop remains the authoritative cancel/descendant fence.

Usage/Cost remain Disabled. Pi compaction remains product-disabled/unqualified until ordinary, manual, threshold
automatic and overflow+automatic-retry real smokes all prove the same effective System Prompt digest and identity
marker. Structured compaction lifecycle may be private monitoring only; it never changes Bootstrap revision or
causes ordinary-message redelivery.

## Data transition

Migration 108 upgrades `v1.21 / schema 62 / migration 107` to `v1.22 / schema 63`:

- adds `managed_system_prompt`, Bootstrap Evidence v2 identity/full-Bootstrap fields and the private one-to-one
  `pi_managed_input_receipt` acceptance gate;
- fences nonterminal legacy Pi Runs as `pi_managed_context_v1_required`, clears legacy Pi binding/compaction technical
  state and never fabricates receipts for completed history;
- preserves non-Pi bindings/evidence and completed Pi Camp messages, Tasks, Actions, Activity and final output;
- startup quarantines legacy Pi session/config roots before the new managed Host can reuse them.

## Acceptance

- Rust fixtures cover launch argv/env privacy, managed receipt acceptance, Bootstrap identity freeze, no Pi
  redelivery overlay, workspace Host reuse/member invalidation separation, exact Session validation and migration;
- a real Pi `0.84.2` native-default prompt must pass through `rovai-pi-host-v2` and a committed receipt;
- a real stdio MCP fixture covers initialize/list/call and process cleanup; Streamable HTTP remains rejected;
- capability claims must distinguish these qualified paths from the still-disabled Usage/Cost and unqualified
  compaction/platform rows.

## References

- [Runtime Launch and Verification v26](runtime-launch-and-verification-v26.md)
- [Confirmed Pi model-context change](../versions/v1.28/model-context-change.md)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [Pi Runtime Research](../research/pi-runtime-research.md)
- [Runtime 兼容性清单](../runtime-compatibility.md)
