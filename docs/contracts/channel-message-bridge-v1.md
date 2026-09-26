---
document_type: protocol-contract
contract: channel-message-bridge-v1
status: accepted
target_version: v1.60
last_updated: 2026-09-26
---

# Channel Message Bridge v1

A Channel is an asynchronous bridge, not a synchronous request/response wrapper around an AgentRun.
Inbound receipt completes when one external-principal `CampMessage` and its target Delivery are committed.
It does not wait for execution or an outbound reply. Later inbound messages enter the same Agent FIFO.

A Camp has at most one Channel binding. Every Agent message published through ordinary `rovai send` in a
bound Camp atomically creates one idempotent ChannelDelivery for that message. The outbound payload is the
published message and its explicit attachments, not Run inputs, logs or anchor ancestors. No `--to-channel`
flag exists.

ChannelDelivery retry/failure is independent of the inbound message, AgentRun and Camp Delivery. It never
reruns the model or silently converts the result to local-only publication.

## Feishu inbound attachments

`channels.inbound.observe` accepts optional `resources: [{fileKey, name, kind}]` in normalized source order.
The Host deduplicates repeated resource keys in a rich-text post. Up to 20 resources are accepted; resource
descriptors participate in the existing multi-Bot observation digest. Remote keys are not local attachment paths.

The existing aggregate's `frozen_payload_json.inboundAttachments` stores `messageId`, `resources`, `sources`,
`attempts` and nullable `retryAt`. Missing state means no resources, preserving old queued requests. No binary
content, credentials or temporary download paths enter this JSON. Pending group bindings retain descriptors
until project/Quick Chat selection creates the Camp and Request. Replayed observations do not create downloads.

A queued Request with incomplete resources cannot publish a CampMessage or create an Agent Delivery. The
ordinary provider-scoped Host tick returns `inboundAttachments` containing `{requestId, appId, messageId,
resources, attempt, retryAt}`. `appId` is the aggregate's canonical acknowledgement Bot. The Host supplies
`inboundAttachmentAppIds` from its managed connections; Core filters by these App IDs before limiting the
download window to 20 requests. An empty or omitted list returns no attachment tasks. Unavailable Bots retain
their queued requests without blocking another Bot's downloads; per-conversation admission remains FIFO.
Main downloads using
the official [message-resource API](https://open.feishu.cn/document/server-docs/im-v1/message-resource/get),
not the app-upload image/file download API. Images use `type=image`; ordinary files, audio and video bytes
use `type=file`. Receiving audio/video does not promise transcription or video understanding. Sticker and
folder descriptors are accepted at observation so the Host can settle them as `channel.attachments.unsupported`
without downloading, publish a visible failure notice, and prevent text-only execution. Neither kind is supported
for download by this ingress. Quoted attachment summaries,
merged forwards and card-embedded resources are outside this ingress contract.

Main allows at most two concurrent message downloads, with a 60-second deadline and an aggregate 100 MiB
streamed-byte limit per message. Download work does not block the Host maintenance pump. Temporary files
remain alive until Core replies and are removed after success, failure or Host cancellation.

`channels.inbound.attachments.complete` is a trusted Feishu Host command carrying
`{requestId, appId, attempt, files, failureCode}`. `files` are ordered temporary local source paths; on failure
the Host sends an empty list and a bounded failure code. Core rechecks the queued Request, active binding,
Camp existence/deletion and retry generation before any filesystem publication. Core imports files into
the Camp-owned default output directory, observes their MIME from bytes and persists normal Source Refs
in the same aggregate. Duplicate filenames have distinct ordinal locations. Retries preserve already
promoted files, and replayed/late completions do not overwrite ready inputs or recreate deleted Camps.

Once all resources are ready, ordinary FIFO admission atomically publishes the CampMessage with
`source_attachments_json` and the existing per-target Deliveries. Thus `CURRENT_INPUT` receives actual local
attachment paths through the same projection as local messages. Subsequent reads follow the existing live
Source Ref semantics; Camp deletion owns downloaded files, including unfinished imports.

Transient failures receive at most three attempts, with 5/10-second retry delays persisted in the aggregate.
Too-large, unsupported and HTTP authorization failures end immediately. Terminal failure closes the Request
and enqueues a visible attention message explaining that the message was not dispatched and can be resent
after correcting the cause. It never silently executes only the text. Startup re-reads queued resource state;
download retry and late completion remain separate from Agent execution retry.
