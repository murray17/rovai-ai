---
document_type: protocol-contract
contract: channel-message-bridge-v1
status: accepted
target_version: v1.60
last_updated: 2026-09-28
---

# Channel Message Bridge v1

A Channel is an asynchronous bridge, not a synchronous request/response wrapper around an AgentRun.
Inbound receipt completes when one external-principal `CampMessage` and its target Delivery are committed.
It does not wait for execution or an outbound reply. Later inbound messages enter the same Agent FIFO.

A Camp has at most one Channel binding. Every Agent message published through ordinary `rovai send` in a
bound Camp atomically creates one idempotent ChannelDelivery for that message. The outbound payload is the
published message and its explicit attachments, not Run inputs, logs or anchor ancestors. No `--to-channel`
flag exists.
For a DingTalk private conversation, a bound Camp's direct delivery resolves the target Bot's App-scoped
`user_id` through the conversation's recorded external principal. The private IM `chat_id` is a different
identity and cannot replace `user_id` when there is no inbound Request attached to the delivery.

ChannelDelivery retry/failure is independent of the inbound message, AgentRun and Camp Delivery. It never
reruns the model or silently converts the result to local-only publication.

## Execution card recall

Feishu, Lark and DingTalk share one Core-owned execution console per channel-related AgentRun. A later
AgentRun supersedes earlier execution cards only within the same `ChannelConversation` and `agent_id`.
The later Run must have been claimed into `running`, evidenced by its durable `agent_run.started_at`;
a waiting Delivery or queued Run does not trigger recall. Root Request admission by itself does not
trigger execution card recall, and A2A descendants of the same Request follow the same Run rule.

When a later Run has started, an earlier terminal Run's card is recalled after its terminal snapshot
is sealed. An earlier Run still executing keeps its card and exact-Run stop action until it ends;
the next Host reconciliation then recalls it. The latest started Run's terminal card remains until
another Run for that member starts. Core derives this from existing Run and console facts without a
new persisted field. Host restart and repeated ticks use the same durable facts and Outbox dedupe key.
Pending updates are removed before recall; an in-flight send or update settles first. Provider
recall uses the card's persisted external identity. Other members' cards and permanent Agent output
are unaffected. A terminal recall failure may be retried when a still later Run for that member starts.

## Inbound attachments

`channels.inbound.observe`, `channels.lark.inbound.observe` and `channels.dingtalk.inbound.observe` accept optional
`resources: [{fileKey, name, kind, downloadCode?}]` in normalized source order.
The Feishu and Lark Hosts deduplicate repeated resource keys in a rich-text post. Up to 20 resources are accepted; resource
descriptors participate in the existing multi-Bot observation digest. DingTalk group observations exclude
Bot-scoped `downloadCode` from this digest; stable source positions, names and kinds still participate.
The first observation freezes its grants with the canonical acknowledgement App and later Bot callbacks cannot
replace them. Remote keys and download grants are not local attachment paths.

The existing aggregate's `frozen_payload_json.inboundAttachments` stores `messageId`, `resources`, `sources`,
`attempts` and nullable `retryAt`. Missing state means no resources, preserving old queued requests. No binary
content, App secrets/access tokens, signed URLs or temporary download paths enter this JSON. DingTalk
`downloadCode` is a bounded message-resource grant retained only in this private aggregate, never projected
into Camp messages, diagnostics or model context. Pending group bindings retain descriptors
until project/Quick Chat selection creates the Camp and Request. Replayed observations do not create downloads.

A queued Request with incomplete resources cannot publish a CampMessage or create an Agent Delivery. The
ordinary provider-scoped Host tick returns `inboundAttachments` containing `{requestId, appId, messageId,
resources, attempt, retryAt}`. `appId` is the aggregate's canonical acknowledgement Bot. The Host supplies
`inboundAttachmentAppIds` from its available download clients (Feishu and Lark managed connections,
DingTalk published Bots with loaded App clients); Core filters by provider and these App IDs before limiting the
download window to 20 requests. An empty or omitted list returns no attachment tasks. Unavailable Bots retain
their queued requests without blocking another Bot's downloads; per-conversation admission remains FIFO.
No queue acknowledgement card is enqueued while resources are incomplete: Feishu, Lark and DingTalk wait
silently during download. Requests already ready when first deferred still use the existing "Rovai 已接收，正在排队"
acknowledgement. Already-sent download acknowledgements from older versions remain eligible for recall.
For Feishu and Lark, Main downloads using each provider's SDK domain and
the official [message-resource API](https://open.feishu.cn/document/server-docs/im-v1/message-resource/get),
not the app-upload image/file download API. Images use `type=image`; ordinary files, audio and video bytes
use `type=file`. Receiving audio/video does not promise transcription or video understanding. Sticker and
folder descriptors are accepted at observation so the Host can settle them as `channel.attachments.unsupported`
without downloading, publish a visible failure notice, and prevent text-only execution. Neither kind is supported
for download by this ingress. Quoted attachment summaries,
merged forwards and card-embedded resources are outside this ingress contract.

For DingTalk, the normalizer retains user-written `richText` text as the body and preserves the original
positions of `picture` nodes as resources, plus private-chat
`file`, `audio` and `video` resources. Each resource uses a stable source-position `fileKey` and optional
`downloadCode` (falling back to legacy `pictureDownloadCode`); a missing grant still gates admission and
settles as download failure instead of running text alone. Quoted images remain summaries.
Resource-only messages have an empty body; the normalizer does not add `[图片]` or attachment summaries to
the current message text. For DingTalk groups, Core removes one textual `@<Bot display name>` for each
observed target Bot when building Camp content, since it adds a structured MemberMention for that target.
This presentation cleanup leaves the normalized transport body unchanged for the cross-Bot observation digest and
keeps mentions of other people as text.
The acknowledgement Bot's App client sends `{robotCode, downloadCode}` to
`POST /v1.0/robot/messageFiles/download`, then streams the returned HTTP or HTTPS signed `downloadUrl` as issued,
without forwarding
App tokens to storage. The receiving Bot's published `robotCode` is used, not another Bot's identity.
Token retrieval, grant exchange and body streaming all accept the message cancellation/deadline signal.
Each retry exchanges the persisted grant again; temporary URLs are never persisted. Expired grants that
cannot be exchanged end through the bounded failure/resend path. This is not a DingTalk Drive ingress.
DingTalk group Robot callbacks support images/rich text in the current channel scope; ordinary group
file/audio/video reception remains outside the platform capability gate.

Each provider's Main allows at most two concurrent message downloads, with a 60-second deadline and an aggregate 100 MiB
streamed-byte limit per message. Download work does not block the Host maintenance pump. Temporary files
remain alive until Core replies and are removed after success, failure or Host cancellation.

`channels.inbound.attachments.complete`, `channels.lark.inbound.attachments.complete` and
`channels.dingtalk.inbound.attachments.complete` are trusted
provider Host commands carrying
`{requestId, appId, attempt, files, failureCode}`. `files` are ordered temporary local source paths; on failure
the Host sends an empty list and a bounded failure code. Core derives provider from the trusted Host actor and rechecks the queued Request, matching provider/App, active binding,
Camp existence/deletion and retry generation before any filesystem publication. Core imports files into
the Camp-owned default output directory under `feishu/`, `lark/` or `dingtalk/`, observes their MIME from bytes and persists normal Source Refs
in the same aggregate. Duplicate filenames have distinct ordinal locations. Retries preserve already
promoted files, and replayed/late completions do not overwrite ready inputs or recreate deleted Camps.

Once all resources are ready, ordinary FIFO admission atomically publishes the CampMessage with
`source_attachments_json` and the existing per-target Deliveries. Thus `CURRENT_INPUT` receives actual local
attachment paths through the same projection as local messages. Subsequent reads follow the existing live
Source Ref semantics; Camp deletion owns downloaded files, including unfinished imports.
Current-message `attachmentSummaries` remain accepted for compatibility but are not appended to the
CampMessage body. Feishu, Lark and DingTalk present downloaded files through Source Refs instead.
Feishu and Lark remove SDK-generated `![image](fileKey)` placeholders from the inbound body only
when `fileKey` matches a normalized image resource; other Markdown remains user text.
External Quote attachment summaries stay in their structured quote segment; already published messages
retain their stored body.

Transient failures receive at most three attempts, with 5/10-second retry delays persisted in the aggregate.
Too-large, unsupported and HTTP authorization failures end immediately. Terminal failure closes the Request,
recalls any older already-sent queue acknowledgement, and enqueues a visible attention message explaining that the message was not dispatched and can be resent
after correcting the cause. It never silently executes only the text. Startup re-reads queued resource state;
download retry and late completion remain separate from Agent execution retry.
DingTalk presents the attention card as a terminal failure, not an in-progress card.

## Provider references and validation

- [DingTalk message shapes](https://opensource.dingtalk.com/developerpedia/docs/learn/bot/message/)
- [DingTalk receiving-message download API](https://open.dingtalk.com/document/orgapp/download-the-file-content-of-the-robot-receiving-message)
- [Official DingTalk Stream SDK](https://github.com/open-dingtalk/dingtalk-stream-sdk-python/blob/8d8bb1c630848fee1ae8c7bdd11bc1b78097b611/dingtalk_stream/chatbot.py)

Provider normalizer/transport tests own raw callback shapes, authorization headers, cancellation and
temporary-file lifetime. Existing Core attachment owners cover Feishu and DingTalk admission, retry, terminal
unsupported failure, Camp deletion and unavailable-Bot filtering; the DingTalk multi-Bot owner also proves
that distinct grants retain the first receiver without duplicate dispatch. Lark extends the provider isolation
owner with resource admission, wrong-Host rejection and Source Ref publication. These use isolated fixtures.
Real tenant file reception, permission grants and desktop/mobile clients require separate platform acceptance;
automated fixture results do not claim that acceptance.
