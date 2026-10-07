---
document_type: protocol-contract
contract: builtin-tool-transport-v36
authority: builtin-tool-transport
status: accepted
version: 36
last_updated: 2026-10-07
---

# Built-in Tool Transport v36

Inherits [v35](builtin-tool-transport-v35.md). Contract/CLI are 36, Agent Output is 9,
and capability is `builtin_cli.transport.v36`. The catalog has 30 operations. IPC 2,
Envelope 1, receipt 1 and evidence projection schema 4 are unchanged.

Adds only `member.list/get/update`; `member.create` retains its input/result and confirmation
rules, with the same Run-relative upload-path resolution as update. New Charter revision 20
expands the member command index. Bootstrap v5/Formatter 5, native binding compatibility
v4/4/16/26/26, ordinary context 28 and public batch 32 remain unchanged. Existing Sessions
retain their frozen Bootstrap and identity; managed cli-operations updates its existing
path. Single Chat's allowlist is unchanged.

## Scope and authorization

Every invocation, including a replay, requires the current authenticated Run, lease,
Native Binding and active caller membership version. `list` returns all active members
of the current Thread, including self and away; leaving/left and globally removed members
are excluded. Without a Default Lead, every `isDefaultLead` is false; reading never
appoints a Lead. It has no global selector or pagination.

`get/update` target a non-removed Profile that is either a current Thread member or was
created by the caller in this same Thread. The creation exception uses the existing Core
`member_creation` receipt with its creator, target and source Run; knowing an ID, being
Default Lead, or possessing a result from another Thread grants no additional access.
This exception survives a subsequent authenticated Run and does not invite the target.

`update` changes the global Profile only at the User's explicit request. Core additionally
requires direct User input in the authenticated Run; this is not an inference of consent
from the caller's Lead role. Core rechecks scope inside the mutation transaction.

## Closed inputs and results

All objects reject unknown fields. Optional input fields reject JSON null. Integers are
positive. Identity limits and normalization reuse `member.create` and AgentProfile.

```typescript
type MemberListInput = {};
type MemberListResult = {
  threadId: string;
  items: Array<{
    agentId: string;
    displayName: string;
    teamRole: string;
    professionalResponsibilities: string;
    isDefaultLead: boolean;
  }>;
};
type MemberGetInput = { agentId: string };
type ImageStatus = "available" | "absent" | "unavailable";
type MemberGetResult = {
  agentId: string;
  displayName: string;
  teamRole: string;
  professionalResponsibilities: string;
  personalityTraits: string[];
  workingPrinciples: string;
  growthTopic: string;
  version: number;
  images: { icon: string | null; portrait: string | null };
  imageStatus: { icon: ImageStatus; portrait: ImageStatus };
};
type MemberUpdateInput = {
  requestId: string;
  agentId: string;
  expectedVersion: number;
  displayName?: string;
  teamRole?: string;
  professionalResponsibilities?: string;
  personalityTraits?: string[];
  workingPrinciples?: string;
  growthTopic?: string;
  avatarFile?: string;
  avatarCenterX?: number;
  avatarCenterY?: number;
  avatarSize?: number;
  clearAvatar?: boolean;
};
type MemberUpdateResult = { agentId: string; version: number; changed: boolean };
```

Reads never expose Runtime, model, permissions, Presence, ordering, asset references or
permanent storage paths. No relationship mutations are available.

## Images and PATCH

`get` reads identity, version and one compound `avatarRef` from the same snapshot. It
resolves built-in and managed renditions to new private files under the authenticated
lease's exact Run tmp root, already included in the Runtime's filesystem access. Only
successfully written files have an `available` path; no reference means `absent`, and
a failed rendition read/write means `unavailable` with null. Reads reauthorize and
materialize again instead of replaying stale paths. Existing lease reset/fence cleanup
owns these files; consumers reacquire them with `get` in later Runs. No base64 is returned.

PATCH omission preserves a field. `""` clears optional text, `[]` clears traits, and name
cannot be empty. At least one effective change field must be supplied; `clearAvatar:false`
alone is not a patch. Supplying values already stored returns `changed:false` with the
same version and no roster invalidation. Equivalent normalized source, crop and icon
preserve the existing managed reference even when the upload uses a new request ID.

`avatarFile` accepts the same local PNG/JPEG import as creation. Normalized source is the
portrait; its crop produces the icon. For create and update, the CLI preserves `avatarFile`
from flags, stdin or an input file. After authenticating the AgentRun, Core resolves a
relative path against that Run's frozen `execution_root`; an absolute path stays unchanged.
The CLI cwd, input JSON directory and Core cwd do not change that base. Core reuses the
existing Run/epoch file-ingress scope and the same path helper as Agent source attachments;
it does not register an attachment. Missing or invalid Run scope fails closed.
Resolution does not canonicalize, follow symlinks or require the source to exist. The
avatar importer still owns file/image safety checks; update retains durable replay after
source cleanup. All three crop fields are supplied together:
centers 0–1, size 0.12–1 of the source's shorter edge, fully inside the source. Without
crop fields a source replacement uses the existing default crop. Crop fields without a
file crop the current source, preserving its bytes in a new immutable compound asset.
`clearAvatar:true` clears both and conflicts with a file or any crop field. No portraitRef
or unrelated second-image upload is introduced.

Core checks the expected Profile version and merges the six identity fields inside the
existing DomainCommandGateway transaction. Image validation/preparation precedes the
single SQL update of text and asset reference. Image or SQL failure cannot partially
update the Profile. Unreferenced prepared immutable assets follow the existing asset
lifecycle; there is no filesystem/database transaction framework or schema migration.

## Replay and errors

`requestId` is one canonical lowercase UUID, explicitly carried by the CLI as its existing
transport request identity and reused as `member-update:<requestId>` at the domain gateway.
The existing semantic digest and durable `command.result` own replay; there is no second
key store. The command binds caller, Thread, target, expected version, supplied fields and
prepared source identity/crop intent. Uploads reuse the existing creation importer's
request-bound immutable asset identity; the source locator participates only as a digest.
When the original local source is gone, only an already recorded matching command can
replay. A missing source cannot initiate a new update. When present, the source is checked
against the immutable prepared asset before replay, so replacing bytes at the same path
cannot bypass a semantic conflict through the lease cache. This check never publishes
an asset: a missing or corrupt prepared asset fails closed instead of rebinding its ID.
Exact replay returns the original result without another version increment or
invalidation. Changed input under the same identity fails.

`member.access_denied`, `member.user_confirmation_required` and idempotency conflicts
stop. `version_conflict` uses `refresh_then_decide`; invalid identity/patch/image and name
conflict use `fix_input`. Uncertain transport outcome retains `confirm_outcome`; an Agent
must not infer a receipt from matching current data or issue a fresh ID blindly. Existing
recovery rules decide whether any retry is allowed.

Only a changed, non-replayed update emits the existing member-roster invalidation. It
does not create or rewrite a creation receipt, public message, frozen context or historical
evidence, and does not claim an already running Native Session has refreshed.
