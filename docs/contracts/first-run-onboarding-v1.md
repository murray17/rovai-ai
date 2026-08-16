---
document_type: protocol-contract
contract: first-run-onboarding-v1
authority: desktop-first-run-state-provisioning-and-draft-entry
status: accepted
version: 1
last_updated: 2026-08-17
---

# First-run Onboarding v1 Contract

## 1. Admission and ownership

Electron Main decides first-run admission before Core startup can create `rovai.sqlite`. If no persisted onboarding
state and no current or legacy product database exists, Main atomically writes an `in_progress` welcome snapshot. If
product data already exists, Main writes `completed(origin = "existing_installation")`; upgrades never enter the
training flow. A persisted `in_progress` or `completed` snapshot always wins over database detection.

The state lives in the private Desktop file `onboarding.json`, not SQLite, Renderer storage, Navigation, Memory or
Agent context. Writes are serialized, atomic and mode `0600`. Renderer can read and request typed transitions through
the preload bridge, but it cannot initialize or reinterpret first-run admission.

## 2. Snapshot union

Every persisted object is an exact-key, closed `schemaVersion: 1` union:

```ts
type OnboardingSnapshot =
  | { schemaVersion: 1; status: 'uninitialized' }
  | {
      schemaVersion: 1
      status: 'in_progress'
      step: 'welcome' | 'member' | 'runtime'
      selectedMemberRole: BuiltinMemberAvatarRole | null
      runtimeSelection: {
        adapterKind: AdapterKind
        model: ModelSelection | null
      } | null
      provisioning: OnboardingProvisioningOperation | null
    }
  | {
      schemaVersion: 1
      status: 'completed'
      origin: 'onboarding' | 'existing_installation'
      completedAt: string
      selectedMemberRole: BuiltinMemberAvatarRole | null
      memberAgentId: string | null
      quickChatCampId: string | null
    }
```

`origin = "onboarding"` requires all three final identities. `origin = "existing_installation"` requires them all to
be `null`. Main does not expose `uninitialized` after startup admission finishes.

## 3. Mandatory pages

`welcome -> member -> runtime` is the mandatory order. There is no skip transition and no progress control that can
navigate around a page. Explicit Back returns only to the immediately preceding page before provisioning begins.
Forward transitions are idempotent for a repeated click on the same boundary and reject attempts to jump over an
unfinished page.

Every accepted selection or page transition is persisted before the returned snapshot reaches Renderer. A restart
therefore opens the exact unfinished mandatory page, including the selected built-in member and Runtime/model draft.

The Runtime page persists only `adapterKind` and `model`. It never asks the user to choose Runtime permissions. The
provisioning command must copy the selected managed Installation's exact
`memberRuntimeDefaults.permissions`; missing or mismatched defaults fail closed.

## 4. Idempotent provisioning

Before invoking any Core mutation, `beginProvisioning` persists one operation containing three UUID command IDs, the
normalized Adapter-owned permissions that form the Runtime command payload, and nullable checkpoints:

```ts
interface OnboardingProvisioningOperation {
  memberCommandId: string
  runtimeCommandId: string
  campCommandId: string
  runtimePermissions: AdapterPermissionConfig
  memberAgentId: string | null
  memberVersionBeforeRuntime: number | null
  memberVersionAfterRuntime: number | null
  quickChatCampId: string | null
}
```

Provisioning then performs these ordered stages:

1. retain the present seeded built-in profile identified by the selected preset; create the same preset with
   `memberCommandId` only if that profile is absent;
2. apply model plus Adapter-owned default permissions using `runtimeCommandId` and the exact member version;
3. create one durable Active Quick Chat Camp with `campCommandId`:
   - title `初次集结`;
   - `workspace = null`;
   - only the selected member in `memberAgentIds`;
   - the same member as `defaultLeadAgentId`;
   - `collaborationMode = "peer"` and `activationState = "active"`;
4. commit `{kind: "camp", campId}` as the Desktop restorable location;
5. write the completed onboarding snapshot.

`runtimePermissions` is frozen from the selected managed Installation's exact defaults in the same durable operation
as the command IDs. Every first attempt and retry uses that saved payload; provisioning never re-reads changed Adapter
defaults after the operation begins. Each successful Core stage is checkpointed before the next one. Retry reuses the
saved command IDs and skips every recorded stage, even if the Installation is temporarily absent during recovery.
Completion is rejected until all checkpoints and the restorable Camp location exist.

## 5. Completion and optional fourth page

The mandatory training is complete immediately after stage 5 above. The fourth page is not another onboarding state:
it is the real `初次集结` Active Camp opened in the normal application shell. Closing the App or navigating away from
it cannot make training incomplete.

While that Camp has no message or AgentRun, Renderer presents three starter rows. Choosing one must:

- replace the current durable Composer Draft with the row's text;
- focus the structured Composer with a collapsed caret at the end;
- announce that the text was filled and remains editable;
- create no CampMessage, CampTurn, AgentRun, Skill invocation or Runtime input.

The existing Composer Draft API owns persistence. Restart restores both the Camp and its unsent text. Sending remains
an explicit user action through the normal Draft-only message contract.

## 6. Failure and compatibility

- A crash on pages 1–3 resumes from the persisted page.
- A crash during provisioning resumes from the first missing checkpoint with the frozen Runtime permissions and
  without duplicate member, Runtime mutation or Camp creation.
- A failure to commit the restorable Camp location leaves onboarding `in_progress`.
- If completion is durable but the Camp cannot be opened in the current Renderer session, the normal App opens with a
  recoverable error; completed training is not rolled back.
- Existing installations are grandfathered as completed and no historical product data is rewritten.

## References

- [ADR-0202: Desktop-Owned Pre-Core First-Run Admission and Checkpointed Product Provisioning](../adr/0202-desktop-owned-first-run-admission-and-checkpointed-provisioning.md)
- [Configured Camp Creation and Lazy Conversations](../adr/0071-configured-camp-creation-and-lazy-conversations.md)
- [Quick Chat Ubiquitous Language](../adr/0074-quick-chat-ubiquitous-language-and-binding-identity.md)
- [Background Runtime Checks](../adr/0083-background-runtime-checks-and-actionable-status.md)
- [Atomic Member Runtime Configuration](../adr/0127-atomic-member-runtime-configuration.md)
- [Structured Draft-only User Message Submission](../adr/0128-structured-draft-only-user-message-submission.md)
- [Camp Composer Draft v2](camp-composer-draft-v2.md)
