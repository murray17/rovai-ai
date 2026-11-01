---
document_type: protocol-contract
contract: mission-v13
authority: mission-team-creation
status: accepted
version: 13
last_updated: 2026-10-31
---

# Mission v13

Inherits [Mission v12](mission-v12.md). User `missions.create`, including the attachment creation route,
additionally accepts optional `team: { teamId: string, expectedVersion: number }`. Omitted/null selections
retain the Custom behavior; serialization omits `None`, preserving existing command replay digests.

The existing Thread creation transaction resolves the selected Team and checks its version. Its authoritative
roster and Default Lead replace any client member/lead projection. Distinct description mentions are then
unioned into that roster, preserving the Team Lead and the v12 invitation validation. Team lookup/version
failures use the existing `team.unavailable` / `team.conflict` results. Unavailable initial members use the
existing Thread rejection. No failure silently falls back to Custom.

Mission, description, Thread membership and nonempty frozen Team guidance commit together. Storage failure
rolls everything back; command replay returns the original receipt even if the Team subsequently changes.
The resulting Thread uses [Team Templates v2](team-templates-v2.md) and
[Bootstrap v6](native-session-bootstrap-v6.md) unchanged: later members receive the same immutable text,
and Team editing/deletion never rewrites it. There is no Mission-specific guidance field, live Team binding,
new model-visible section, formatter version or storage migration. Existing Missions are not backfilled.

The shared Desktop/Web creation dialog initializes from General's Team/Custom source. Selecting a Team is
read-only; Custom independently edits members and Lead. Creation does not write global defaults or one-click
preferences. Unknown outcomes retain the exact command, attachments and selected Team snapshot for retry.
Presentation and long-guidance reading are owned by the [Mission board UI](../ui/components/mission-board.md).

Workspace cleanup admission and `cleanupAvailable` share the current execution ownership rule:
nonterminal Runs, waiting Deliveries, and terminal cleanup owned by this Core block removal. Ownership
uses the existing exact Run/epoch snapshot and includes shared execution-root conflicts. A prior-generation
missing ACK cannot alone block cleanup, and cleanup does not fabricate or repair that historical ACK.

Ordinary non-Mission dispatch may bypass the Mission lifecycle gate only for an already validated canonical
execution root proven disjoint from persisted workspace and preparation paths, including ancestor/descendant
relationships and all preparation/cleanup states. Shared or uncertain paths retain the existing serialized
flow. Mission preparation, current Run/epoch occupancy, Stop ownership, branch identity and dirty-state
cleanup protections are unchanged. The proof uses existing records without a new lock table or persistent state.

If any Mission has no persisted workspace plan yet, existing records cannot rule out the path its first
preparation will choose. Ordinary dispatch conservatively retains the gate in this case, including a
not-yet-started Mission. No filesystem scan or extra coordination state is introduced to remove that wait.
