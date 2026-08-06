---
document_type: postmortem
incident_id: INC-2026-08-05-CODEX-MCP-ISOLATION
incident_date: 2026-08-05
status: closed
systems:
  - codex-runtime-adapter
  - mcp-runtime-projection
  - macos-packaged-app
last_updated: 2026-08-06
---

# Codex MCP Configuration Collision and AgentRun Startup Failure

> Current architecture note (2026-08-06): the isolated-Home remediation below is the historical
> incident resolution, not the current product contract. v0.43 supersedes it with Codex Native Home,
> app-server `config/read`, `NativeWinsSkip`, and thread-scoped additive MCP; see
> [ADR-0125](../adr/0125-runtime-native-additive-external-mcp-projection.md) and
> [ADR-0126](../adr/0126-codex-native-home-and-external-session-ownership.md).

## Executive summary

On 2026-08-05, a Codex AgentRun launched by Rovai failed before its first model turn. The user's
native Codex configuration contained a stdio MCP server named `context7`, while Rovai assigned an
HTTP MCP server with the same canonical name. Rovai passed its MCP table as a runtime override and
assumed the table would replace lower-precedence MCP configuration. Codex instead deep-merged the
same-named entries, producing one invalid server definition containing both stdio `command` and
HTTP `url` fields. Codex rejected the effective configuration with:

```text
failed to load configuration: url is not supported for stdio in mcp_servers.context7
```

The same architecture also allowed unrelated user MCP definitions to remain ambient even when
they did not cause a startup failure. The user configuration was valid for native Codex use; the
collision was caused by Rovai's incorrect isolation boundary, not by the user's server name or
transport choice.

The incident was resolved by introducing a persistent Isolated Codex Home for every
`(Camp, AgentProfile)` pair, sanitizing user top-level MCP configuration from the isolated copy,
writing the complete Rovai-owned MCP set atomically, validating Codex's effective configuration,
and replacing the globally shared Codex app-server with an AgentRun-scoped process. The user's
real `~/.codex/config.toml` remains unchanged. A fresh packaged macOS application was then tested
against the original cross-transport collision scenario.

This is a blameless review. The decisions described here were locally reasonable under the
replacement semantics Rovai assumed at the time. The purpose of the document is to correct the
system conditions that made the incident possible, not to attribute fault to an individual or to
the user's valid Codex setup.

## Incident metadata

| Field | Value |
|---|---|
| Detection | User reported a failed local Camp execution and questioned whether the packaged application contained the latest Core |
| Affected path | Rovai-managed Codex AgentRun startup |
| Trigger condition | User and Rovai MCP servers shared a name but used incompatible transports |
| User-visible symptom | The AgentRun failed before producing model output |
| Data integrity | No Camp data corruption and no modification of the user's real Codex configuration were found |
| Security boundary | Ambient user MCP configuration could enter the effective Codex configuration; no invocation or credential disclosure was found in this incident |
| Resolution | v0.39 Codex Home and process isolation, shipped in commit [`efc50da`](https://github.com/murray17/rovai-ai/commit/efc50daee7a95a078aaa25b8e5fc6cc1e2fa7cc3) |
| Incident duration | Not calculated because the first-failure and recovery timestamps were not retained as structured incident data |

## Impact

The observed AgentRun could not start, so the requested work did not execute and the user had to
investigate and retry after a new build. The directly affected population was Codex AgentRuns whose
effective configuration contained a name collision capable of producing an invalid merged MCP
entry. Other Runtime adapters were not on this configuration path.

The latent impact was broader than the visible failure. With the former design, differently named
MCP servers from the user's native Codex configuration could remain available to a Rovai AgentRun.
That violated Rovai's intended ownership of the external MCP set even when Codex accepted the
configuration. We found no evidence that an unintended server was invoked during this incident,
but startup success alone would not have proved isolation.

There was no evidence of database corruption, loss of Camp history, modification of
`~/.codex/config.toml`, or disclosure of a persisted Team Gateway credential.

## Detection and response

The incident was detected by the user from the failed conversation rather than by an automated
isolation check. The failure text identified a transport inconsistency, but the initial diagnostic
surface did not establish all of the following in one place:

- which `CODEX_HOME` the failing process had loaded;
- which configuration layers contributed to the effective MCP entry;
- whether the running Core came from current source or an older packaged application;
- whether Rovai's requested MCP table exactly matched Codex's effective table.

Investigation reproduced both cross-transport directions: user stdio versus Rovai HTTP, and user
HTTP versus Rovai stdio. That established that the defect was not specific to Context7 or to one
transport. Inspection of the process model then showed that a global app-server could not support
different per-member Homes, even if configuration generation alone were corrected.

## Timeline

All times are Asia/Shanghai. Exact discovery and intermediate-response times were not captured, so
the timeline deliberately avoids invented precision.

| Time | Event |
|---|---|
| Before 2026-08-05 | Rovai used a globally shared Codex app-server, inherited the user's real Codex Home, and supplied `mcp_servers` as a runtime override. Tests did not prove cross-transport same-name isolation against Codex's effective configuration. |
| 2026-08-05, time not recorded | A local Codex AgentRun failed before its first model turn with a same-name stdio/HTTP MCP configuration error. |
| 2026-08-05, time not recorded | Investigation confirmed that Codex deep-merged the user and Rovai entries instead of replacing the lower-precedence entry. The possibility of running an older packaged Core also made initial build provenance unclear. |
| 2026-08-05, time not recorded | The design boundary was corrected: persistent state was keyed by Camp and AgentProfile, while the live app-server was scoped to an AgentRun. ADR-0107 and the v0.39 implementation contract were accepted. |
| 2026-08-05, time not recorded | The Isolated Codex Home manager, exact MCP replacement, effective-config validation, per-AgentRun process lifecycle, cleanup protocol, and regression coverage were implemented. |
| 2026-08-05 14:20:01 | The final packaged arm64 Core was built with Mach-O UUID `83AA9EBD-065F-3D59-B0C2-08A99E63562B`. |
| 2026-08-05, after packaging | Real Codex 0.146.0 smoke tests passed for isolated config, project-config exclusion, `AGENTS.md` preservation, new process IDs across AgentRuns, same-Home thread resume, and stdio/HTTP projection in both Debug and packaged Core paths. |
| 2026-08-05 14:28:51 | Commit `efc50da` recorded the completed fix and acceptance evidence. |

## Technical root cause

Rovai modeled a runtime `mcp_servers` override as a whole-table replacement. Codex's configuration
semantics merge nested tables across sources. For a same-named server, transport-specific fields
from both sources survived:

```text
user ~/.codex/config.toml             Rovai runtime override
[mcp_servers.context7]                [mcp_servers.context7]
command = "npx"                       url = "https://..."
                 \                    /
                  effective deep merge
                 command + url in one entry
                            |
                       startup rejected
```

This incorrect replacement assumption was the immediate configuration root cause. The deeper
architectural root cause was ownership mismatch: Rovai attempted to promise a task-specific MCP
boundary while starting Codex inside a user-owned configuration root and reusing one process across
multiple Camps and members. `CODEX_HOME` is process-scoped and also contains native session state,
so a global process and the user's Home could not provide the required isolation or continuity
model.

## Contributing factors

### Missing effective-configuration invariant

Rovai validated the configuration it intended to send, not the complete configuration Codex
actually loaded. There was no pre-turn `config/read` assertion that the effective top-level MCP set
and each transport identity exactly matched the frozen Rovai projection.

### Incomplete collision coverage

Earlier smoke coverage did not exercise both directions of a same-name stdio/HTTP collision against
a real Codex app-server. Tests that only compare rendered JSON or use the same transport cannot
detect stale transport fields created by a deep merge.

### Process and state lifecycles were coupled incorrectly

The global app-server cache optimized process reuse before Rovai had a correct Home identity. Native
session continuity was therefore implicitly tied to a shared process instead of to the durable
`(Camp, AgentProfile)` state root.

### Packaged-build provenance was not immediately visible

Source tests and an installed application can execute different Core binaries. The initial question
about whether a new package had been produced was reasonable because the diagnostic surface did not
show a verifiable Core build identity. This did not create the MCP collision, but it increased time
to establish whether a local reproduction contained the candidate fix.

### Lifecycle terminology was initially ambiguous

The word "task" could refer to a domain Task, CampTurn, AgentRun, or Camp. That ambiguity initially
made retention proposals easier to attach to the wrong object. The final design explicitly uses the
Camp as the persistent Home boundary and AgentRun as the process boundary.

## Why existing safeguards did not prevent the incident

- Canonical MCP JSON and stable assignment identities defined what Rovai wanted to project, but did
  not prove how Codex combined that projection with ambient configuration.
- A whole-table runtime override removed the need to edit user files, but it was not a replacement
  primitive under Codex's merge semantics.
- Startup failure surfaced an invalid mixed transport, but differently named ambient MCP servers
  could have remained undetected because they produced no error.
- Source-level verification did not prove that the packaged app under test contained the same Core
  binary.

## What was not the cause

- Reusing the canonical MCP name `context7` was not an error. Rovai is responsible for isolating
  namespaces it claims to own.
- Choosing HTTP in Rovai and stdio in native Codex was not an error. Both definitions were valid in
  their intended environments.
- Context7 service availability did not cause the failure; Codex rejected configuration before any
  server call.
- A potentially stale package did not create the merge defect. It made fix verification less
  certain until the packaged Core identity was recorded.

## Resolution and recovery

The correction separated persistent identity from process lifetime:

1. Rovai now creates `<data>/codex-homes/<camp_id>/<agent_profile_id>/` and reuses it for later
   AgentRuns by the same member in the same Camp.
2. On first creation, Rovai copies the user's non-MCP configuration, removes the complete top-level
   `mcp_servers` table, marks the execution project untrusted, writes Rovai's complete external MCP
   set, and atomically publishes an owner marker.
3. Authentication and plugin state remain available through narrow shared links; the user's real
   configuration is never modified. Plugin-provided MCP remains an explicit exception to the
   top-level external MCP guarantee.
4. Every AgentRun gets a new Codex app-server with its isolated `CODEX_HOME`. Terminal Runs shut the
   process down, while later Runs use the same Home to resume the native thread.
5. Before the first model turn, Rovai reads and validates Codex's effective configuration. Unknown
   top-level MCP servers, stale transport fields, or an active project `.codex` layer fail closed.
6. A Camp deletion enqueues durable cleanup and immediately removes its Homes when possible. Valid
   Camps retain their Homes; unknown orphan directories are eligible for cleanup after 72 hours.
7. The macOS package was rebuilt and its embedded Core identity was recorded before repeating the
   original real-Runtime scenario.

## What went well

- The concrete Codex error preserved the MCP name and invalid transport relationship, making the
  configuration collision reproducible.
- The investigation expanded from the visible `context7` failure to the broader ambient-MCP
  isolation breach instead of applying a name-specific workaround.
- The design review identified the process-lifetime defect before shipping a config-only patch that
  would still have shared state across members and Camps.
- The final validation used a real Codex app-server and the packaged Core, not only mocks or rendered
  configuration snapshots.
- The user-owned `~/.codex/config.toml` remained untouched throughout remediation and testing.

## What could be improved

- Effective configuration should have been treated as the launch invariant from the first MCP
  projection implementation.
- Cross-source, same-name, cross-transport cases should have been mandatory compatibility tests.
- Runtime diagnostics should identify the Core build and isolated Home without exposing secrets.
- Incident milestones should be recorded as structured timestamps so detection and recovery time
  can be measured rather than reconstructed.
- Optimization through process reuse should follow a documented ownership model, not precede it.

## Where we were fortunate

- The conflicting transport fields caused a hard startup failure. A silent merge of valid but
  unintended servers would have been harder to detect.
- The failure occurred in a local environment with a reproducible user configuration rather than
  after broader distribution.
- The required continuity boundary already aligned with the existing Camp-and-AgentProfile
  Conversation identity, avoiding a destructive migration of user session history.

## Corrective and preventive actions

Status reflects the evidence available when this postmortem was published. Accountable roles must
be mapped to a named maintainer before an open action starts.

| ID | Action | Accountable role | Priority | Status | Evidence or target |
|---|---|---|---|---|---|
| PM-01 | Isolate persistent Codex state by Camp and AgentProfile without modifying the user's real configuration | Codex Runtime | P0 | Complete | `CodexHomeManager`; ADR-0107 |
| PM-02 | Replace global Codex app-server reuse with AgentRun-scoped process ownership and bounded shutdown | Runtime Lifecycle | P0 | Complete | Real test proves distinct PIDs and same-Home thread resume |
| PM-03 | Validate the effective config before the first model turn and fail closed on unknown top-level MCP or project config | Codex Runtime | P0 | Complete | `config/read` validation and regression tests |
| PM-04 | Add bidirectional stdio/HTTP same-name tests using a real Codex app-server | MCP Integration | P0 | Complete | `scripts/smoke-mcp-projection.mjs` |
| PM-05 | Rebuild and verify the packaged macOS Core against the original scenario | Release Engineering | P0 | Complete | UUID `83AA9EBD-065F-3D59-B0C2-08A99E63562B` |
| PM-06 | Make the real cross-transport projection smoke a required release gate on a compatible macOS runner | Release Engineering | P1 | Planned | Target: next Codex Runtime release |
| PM-07 | Include redacted Core build identity, effective config source, and Isolated Home identity in exported launch diagnostics | Core Observability | P1 | Planned | Target: v0.41 planning |
| PM-08 | Record structured detection, acknowledgement, mitigation, and recovery timestamps for release-blocking local incidents | Release Engineering | P2 | Planned | Target: incident template and release checklist update |

## Recurrence criteria

This incident is considered to have recurred if any Rovai-managed Codex AgentRun:

- loads a user top-level MCP server not present in its frozen Rovai projection;
- combines transport fields from two same-named MCP definitions;
- enables project `.codex` configuration in a workspace where only `AGENTS.md` project instructions
  should be preserved;
- reuses a live Codex process across different Isolated Codex Homes; or
- cannot establish which Core binary and Home produced a launch failure.

Any recurrence should be treated as an isolation failure even if the model turn succeeds.

## Lessons

Configuration intent is not configuration evidence. When an external runtime merges layered
configuration, isolation must be established at the source boundary and verified from the runtime's
effective view. Durable session state and live process reuse are separate lifecycle decisions; they
must not share an identity merely because one implementation previously stored both behind a global
client. Finally, packaged-binary provenance is part of incident response: a fix is not operationally
verified until the artifact under test can be tied to the validated source.

## References

- [ADR-0107: Camp-Member Isolated Codex Home and AgentRun-Scoped App Server](../adr/0107-camp-member-isolated-codex-home-and-agentrun-app-server.md)
- [v0.39 Codex Isolated Home implementation contract](../versions/v0.39/codex-home-isolation.md)
- [v0.39 implementation and acceptance evidence](../versions/v0.39/implementation-plan.md)
- [ADR-0103: Canonical MCP JSON and Stable Assignment Identity](../adr/0103-canonical-mcp-json-and-stable-assignment-identity.md)
- [ADR-0104: Rovai-Preferred MCP Projection and Non-Blocking External Degradation](../adr/0104-rovai-preferred-mcp-projection-and-external-degradation.md)
- [Fix commit `efc50da`](https://github.com/murray17/rovai-ai/commit/efc50daee7a95a078aaa25b8e5fc6cc1e2fa7cc3)
