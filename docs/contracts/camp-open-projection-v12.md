---
document_type: contract
name: Camp Open Projection
version: v12
status: accepted
source_version: v1.37
last_updated: 2026-08-31
---

# Camp Open Projection v12

v12 combines main's [business projection v10](camp-open-projection-v10.md) with the channel branch's
[Runtime image v11](camp-open-projection-v11.md). The channel branch's independently numbered
[channel-source v10](camp-open-projection-channel-v10.md) is preserved verbatim at its historical
path; main's v10 is not overwritten. No model Context, channel routing or project-binding rule changes.

## Wire and read boundary

- `CampOpenProjection.schemaVersion` remains **6**; `CampSnapshot.schemaVersion` remains **34** and
  Navigation remains **3**. Desktop rejects old Open wire versions as specified by main v10.
- Open and all nested loaders read business projections, never `event_log`. Open has no `timeline`
  or `coverage.timeline`; Open messages have `timelineGlobalSequence: null`. The singleton
  `event_sequence.last_sequence` still supplies the transactional high-water mark.
- CampSnapshot/Open `camp` and NavigationCampItem retain optional `channelSource`, including closed
  bindings, as specified by [Channel Camp Naming v1](channel-camp-naming-v1.md). Stored `title` stays
  unprefixed. Loading the source does not contact a provider or write data.
- Snapshot/Open retain optional `agentRunImages`, as specified by [Runtime Images v2](runtime-images-v2.md).
  A missing field is an empty collection; bytes and absolute source paths are not exposed in this
  metadata projection. Image bytes are read through the existing Camp-scoped image endpoint.
- Membership/Fast, collection windows, complete non-terminal Evidence, approvals, historical
  pagination, selection generation and non-regressing high-water rules remain unchanged.

## Conversation ordering

Messages use Camp-local `sequence`, independently of historical event sequence or clock rollback.
Other cards use business time, a stable kind rank and ID. The separately ordered message/card streams
are merged as in main v10; Runtime images do not reintroduce event-log ordering.

Run image galleries remain immediately after that Run's last public message and before its Files
Changed card, even if image observation arrives after file-change completion. Without a public
message, images precede that Run/epoch's Files Changed card; without either anchor they use business
time. Supplemental cards at one message anchor use kind rank first, then business time and ID.

`agent_run.images.updated` invalidates only the matching current Camp. An equal global sequence may
still carry new image metadata; no CampMessage or automatic channel delivery is created.

## Public A2A 投递来源

The optional `MessageDeliveryView.public_a2a.sourceAgentRunId` keeps the causal sender semantics of
[main v10](camp-open-projection-v10.md#public-a2a-投递来源). It is projected from the delivery's business
row, never inferred from the target Run, reply relation or event history.
