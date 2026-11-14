---
document_type: protocol-contract
contract: host-web-v2
authority: shared-host-web-transport
status: accepted
version: 2
source_version: v1.59
last_updated: 2026-11-14
---

# Host Web v2

v2 replaces [v1](host-web-v1.md) for new Web sessions. One Core, local management, renewable browser Bearer credentials and tab-scoped editors, bounded admission, CSP and invalidation SSE remain.
The single-Owner model, directory access, local token rereading and multiple interface origins below supersede v1 restrictions.
This contract admits the shared Camp write path; it does **not** qualify a platform for secure network release.
Implementation and remaining acceptance evidence belong to the [version plan](../versions/v1.59/implementation-plan.md).

## Product and network trust model

One Owner operates a trusted self-hosted Host. An authenticated remote Owner has the same intended business capabilities
as Desktop; incomplete adapters are implementation gaps, not a restricted remote role. This release does not build a
multi-tenant or strongly isolated execution platform and does not promise to defend arbitrary malicious same-UID processes.
The former S1 isolation proof is not a delivery gate. Existing Runtime permission modes, approval, process cleanup and
file-operation validation remain unchanged. Known sentinel failures remain evidence; they are not relabeled as passes.

Local `host.web.status` returns `enabled`, `listen`, optional `origin`, `addresses` and session counts, never credentials.
Each address contains `origin`, `interface` and `recommended`. Rust enumerates actual interfaces compatible with the
listener. Discovery excludes 198.18.0.0/15 (including mapped IPv4 literals); these addresses are not shown, recommended,
copied or encoded as QR codes. This is a presentation filter, not a network ban. IPv6 link-local URLs requiring
browser-unsupported scope IDs are not advertised. Selecting an address is local presentation state only: it cannot
change the listener, Owner, permissions or credentials. Ordinary address sharing contains no credentials. Explicit
scan-to-login QR codes may carry only a short-lived, single-use ticket in a URL fragment, never an administrator Token
or an existing browser Session. Generating a login QR is a separate local credential operation.
`origin` is the first advertised address and is omitted when discovery is empty; starting the listener does not require
an advertised address. Interface discovery does not guarantee remote reachability.
The listener accepts its actual interface authorities and optional explicit reverse-proxy `publicOrigin`; an Origin
header must match the same authority's complete origin. Arbitrary Host, cross-origin business requests and API query parameters are
rejected; there is no credentialed CORS. Sandboxed preview resources have the narrow, handle-bound exception specified by
[File Preview v15](file-preview-v15.md); the resource transport does not include the editing Session; trusted same-origin HTML can still access parent login materials. LAN HTTP requires an explicit enable choice, with HTTPS/VPN for untrusted networks.
In Desktop, the Remote Access switch is that explicit choice: it starts the IPv4 wildcard listener without a separate
local/LAN selector, and shows local and remote addresses separately. The always-visible port is pending launch-form state:
editing it does not restart or reconfigure the running service; the next start uses it. Stopping needs no second confirmation.

Trusted local `host.web.token` returns `{administratorToken}` repeatedly without rotation or Session revocation,
including before the first listener start and after explicit stop. This is a long-lived reusable login Token. Login,
ordinary access, renewal, normal process restart and program upgrade never replace it. Desktop settings retain the
masked Token, visibility and copy actions; the separate explicit local rotation operation remains available.
Neither remote HTTP nor status/diagnostics/logs exposes the long Token. Browsers never persist it or use it for automatic login.

Both Host entrances persist one private `web-auth.json` below the Core data directory, opened only after Core admission.
It contains the local-readable long Token, typed Bearer digests, editor IDs, absolute UTC expiry and last-use milliseconds;
it contains no raw Bearer, editor proof or QR ticket. Creation, renewal, logout, rotation and explicit Web disable
publish an atomic private-file replacement under the registry mutex before returning success or changing live state.
An invalid/unreadable document fails closed without replacing credentials. A write failure returns 503
`session_storage_unavailable` on HTTP and leaves the prior committed authentication state intact.
The standalone preview's `server-token` is a bootstrap input only when no unified document exists;
`rovai-server token` reads the unified document first. An explicit bootstrap Token conflicting with stored state fails.
Sessions from an older Host that never persisted them cannot survive its first upgrade. The old standalone long Token
can be imported; an old Desktop process-only Token cannot be recovered after that process exits. The new persistence
guarantee begins when this version commits the credentials; existing expired/legacy Sessions require manual login.

| Action | Persistent Sessions | Long login Token | Unused QR ticket |
| --- | --- | --- | --- |
| Ordinary Host exit/restart or program upgrade | Preserve unexpired Sessions | Preserve | Invalidate |
| Browser tab/window/process close | Preserve; reopening authenticates before business use | Never stored in browser | Never stored in browser |
| Successful logout | Revoke only the current Bearer | Preserve | Preserve |
| Explicit local Token reset | Revoke all | Replace | Invalidate |
| Explicit Web disable | Revoke all before listener shutdown | Preserve | Invalidate |
| True expiry | Reject access and renewal | Reusable for manual login | Independent short expiry |

A failed logout stays visibly retryable; the browser does not claim remote revocation on network or persistence failure.
A failed explicit disable leaves the listener enabled and reports failure. Ordinary shutdown ends streams and in-flight
login grants without clearing the persisted Sessions. Re-enabling after explicit disable cannot restore revoked Sessions.

## Authentication and editor ownership

Trusted local `host.web.loginTicket` requires a running Web listener and returns `{ ticket, expiresInSeconds: 120 }`.
The unified Rust Host uses 256 random bits, stores only its digest and monotonic expiry in memory, and retains at most
one unused ticket. Regeneration invalidates the previous unused ticket; administrator rotation, Web stop and Host exit
invalidate all unused tickets, including exchanges already waiting for Core editor verification. An expired, consumed
or replaced ticket cannot be redeemed. Issuance and atomic consumption belong to the existing Rust session registry;
there is no new account, device or channel service. Already issued Sessions survive QR regeneration.

The QR URL uses `#login-ticket=<ticket>`. The Web entry reads and immediately removes this fragment with `replaceState`
before asynchronous work, then POSTs `{ protocolVersion: 2, ticket, editor? }` to `/api/v1/login-ticket` on the fixed
origin, with redirects rejected and cookies omitted. Ticket values never enter query strings, logs, status, diagnostics,
history state or sessionStorage. The fragment is a transient credential carrier, not a bookmarkable application route.
The exchange shares manual login's admission limits, Origin/Host checks, Core editing proof verification and normal
Session issuance. Ticket consumption and Session creation commit under one lock after Core verification; competing
devices can obtain at most one Session. A lost successful response is not replayable: generate another QR or log in
manually. A new tab gets a fresh editor; same-tab reauthentication preserves its independently proven editor and pending
commands, while copied-tab recovery discards the source editor before ticket exchange. Refresh after success uses the
normal Bearer Session and original editor recovery path. Manual Token login and plain address copying remain available.

`POST /api/v1/login` accepts `{ protocolVersion: 2, administratorToken, editor? }`.
`editor`, when present, is exactly `{ clientId, proof }`. An incompatible protocol is rejected before issuing a session.
The response contains `protocolVersion: 2`, `token`, `clientId`, `editorProof`, `ownerId`, `expiresInSeconds`, `expiresAt`, `serverTime`, `renewalWindowSeconds`, `epoch` and `channels: "desktop" | "unsupported"`.
The browser checks the response protocol before mounting business pages or sending commands.

Fresh login creates a Core-owned random 256-bit editor identity and an independent random recovery proof.
Core persists only the proof digest, bound to the current Owner; the Host first verifies administrator authentication,
a valid login ticket or an existing Bearer Session before resolving the editor. A client ID, Draft ID or proof alone never authenticates
a Session. Another client's proof cannot resume the named editor. Reauthentication replaces that editor's old Session,
including at session capacity. Rotation and explicit Web disable fence an in-flight login as well as existing Sessions.

### Bounded Session admission

The registry retains at most 32 Sessions. Login, QR exchange and fork first remove expired Sessions and replace any
Session for the same proven editor. If still full, admission reclaims the least recently authenticated idle Session.
An authenticated in-flight request or open SSE stream pins its Session; the fork request also pins its parent. Selection,
authentication and persistence share the registry lock, so a newly authenticated request cannot race with reclamation.
If all slots are in use, admission returns the existing capacity error instead of revoking an online Session.

Closing a tab does not revoke credentials. Sequential closes/reopens can reclaim older idle records without exhausting
the cap, while live tabs retain their independent Bearers and drafts. An idle Session reclaimed under capacity pressure
cannot authenticate or renew; the unchanged long login Token can issue another Session using the same admission policy.
Reclamation never extends expiry or transfers editor/draft ownership. The removal and new Session commit atomically;
a storage failure leaves the old registry usable. Last use is updated in memory on authenticated access and captured by
existing registry writes, without a disk write per request. Older stored records without this optional field load with
the oldest priority. Normal Host restart preserves the bounded registry and cannot resurrect a reclaimed Session.

### Session lifetime and renewal

Ordinary Sessions, including QR exchanges, start with a 30-day lifetime. The same Bearer and editor binding are reused;
there is no refresh Token, dual-Token protocol, OAuth or saved administrator Token auto-login.
`expiresAt` and `serverTime` are UTC epoch milliseconds. `expiresInSeconds` is the floored remaining lifetime;
`renewalWindowSeconds` is 604800. Login, resume/fork and renewal return this timing metadata.
The browser derives its local deadline from the server's remaining duration, then revalidates with Host when necessary;
Host time remains authoritative. Older protocol-v2 replies without timing do not enable renewal.

`POST /api/v1/session/renew` authenticates the existing Bearer and accepts no replacement credential or editor.
If `0 < expiresAt - now <= 7 days`, it durably extends expiry to the successful renewal's Host time plus 30 days.
Outside the window it returns the unchanged expiry. At or after expiry, or after revocation, it returns 401
`session_required`. The reply contains timing only; renewal never changes the Bearer, editor, proof, mounted Composer
or connection generation. Concurrent renewals serialize: the first extends, the next observes the new expiry.
Renewal and revocation use the same registry lock and private-file commit. Logout/reset/disable cannot be undone by a
late renewal. Existing SSE streams observe the new deadline and stop on revocation or real expiry.

The client checks on normal API use, foreground entry, online recovery and once a minute while the page is visible.
Concurrent calls share one renewal request; a network/503 failure keeps a still-valid Session and retries no sooner than
one minute. At a locally elapsed deadline it first asks Host to validate the existing Session, never silently logs in
with a saved long Token. A 401 clears authentication but retains same-tab edits and original command IDs.

### Browser authentication and tab drafts

Durable browser IndexedDB `rovai-web-auth-v1` stores one ordinary Session candidate per origin: Bearer, Owner and expiry.
It contains no editor proof, draft, command or long login Token. Same-tab `sessionStorage` keeps its own authentication
snapshot separately from editor/proof, unsaved text and unresolved commands. Existing combined v1 snapshots migrate
on successful recovery; the editor document becomes version 2 without a Bearer.

Refresh with an existing tab editor validates `POST /api/v1/session` using
`{ editor: { clientId, proof }, fork?: false }`. It requires both the Session's bound client ID and the Core-verified proof,
and returns the same editor/capabilities/timing without rotating the Bearer. A fresh tab or browser process with only
durable authentication sends `{ fork: true }`; Host creates a new Core editor and ordinary Session with the parent's
remaining expiry. It cannot select or recover another tab's drafts. A copied tab supplies its inherited proof while
requesting the same fork operation, then discards copied editing material.

Updates/removal of the shared durable candidate are conditional IndexedDB transactions; a tab cannot erase or overwrite
another tab's newer candidate on logout, renewal or reload. A successful login may replace the candidate; an active tab
may fill an empty candidate slot. A local logged-out snapshot prevents that same tab from silently borrowing another tab's
login on refresh. Other independent tabs retain their own Sessions. Closing a browser is not logout; if browser storage
is cleared, manual login is required.

Session expiry, reconnect and same-page reauthentication retain the editor, mounted Composer, unsent local edits and
original outstanding command IDs. Host/Owner changes require a different editing/cache scope and are rejected in place.
Bearer Sessions and editor proofs never enter URLs, history, logs or localStorage; the only transient URL exception is
the immediately removed QR fragment above. Authentication persistence never creates cross-tab draft synchronization.

A non-secret browser document lease prevents a copied sessionStorage snapshot from sharing live editing ownership.
IndexedDB transactions serialize claims; a synchronous pagehide release marker allows normal reload to reclaim its editor.
HTTP requests recheck ownership, including after a suspended document resumes. Lease records and release markers contain
only random tab/document identifiers, not credentials or draft content. A copied tab requests `fork: true` through the
existing authenticated Session; Host creates a new Core editor and a separate Bearer with the parent's remaining lifetime.
It does not revoke the original tab, extend authentication, or copy its drafts/unknown commands. Logout revokes only that
Session. Browser storage failure is visible, never silently presented as successful recovery.

Unknown command bodies and IDs persist before dispatch; startup, reconnect and reauthentication only reconcile. Explicit
retry uses the original payload and ID. Upload recovery retains the binding intent; file bytes are not put in sessionStorage.
After refresh an unknown upload is reconciled first, and an unavailable body requires selecting the file again. A matching
recorded private send clears only its matching recovered local text. Unsaved Composer text is restored over the same base
content, never over a different authoritative draft. Presentation preferences remain separately origin/Owner-scoped.

## Admitted operations

The Rust `operations::Operation` enum remains a closed network allowlist. It now admits the existing Core operations for
Camp creation/preflight/membership, member configuration, Runtime discovery/check/catalog, scoped Camp Draft mutations,
pending editing, send, cancellation, approval, execution detail and read-only command reconciliation.
The management increment also admits Task create/update, Memory governance/export, Automation definition/run operations,
Skill inspection/import/assignment/deletion, MCP config/assignment/import and Runtime startup settings. These call the
existing Rust handlers; they do not admit the scheduler control/tick, platform recovery or arbitrary source binding.
Task projections retain only Core-advertised `update` on Task objects; unknown actions remain filtered. It does not admit
arbitrary internal RPC, local management, source binding or editor-resolution methods. Host workspace paths are admitted
for browsing and existing Core workspace operations after Owner authentication.

HTTP stamps the verified editor on the trusted Core request; JSON cannot select that field. Core applies the same
domain services and command gateway as Desktop. [Camp Draft v13](camp-composer-draft-v13.md) and
[Pending Input v4](pending-camp-input-v4.md) own the editing boundaries. Approval options and versions come from Host
authority, and resolution uses the existing atomic domain command, not a frontend approval state machine.

`commands.reconcile({ operation, params })` reads the original gateway receipt with the original command ID, payload
digest, Owner and editor. It returns `recorded` with the original result or `unknown`; it never executes a command.
For Draft APIs whose original response throws a recorded domain rejection, `recorded.error` carries that same error;
the client settles the original submission as rejected instead of leaving it in an unknown/submitting state.
An admitted request survives HTTP disconnect. Unknown results retain their original request and submitting promise in
the page. Reconnect/reauthentication/SSE only reconcile; an explicit user retry may resubmit the identical ID and payload.
An unsuccessful retry does not prove that the earlier attempt was uncommitted.

Ordinary HTTP timeouts remain 15 seconds; native Runtime check/discovery/catalog reads allow 120 seconds. SSE never
holds the command queue. Capabilities report protocol 2 and the admitted Composer/upload/approval path, while
`releaseQualified` remains false. Read projection filtering still excludes private fields and unsupported actions;
the new write allowance is not permission to expose every internal action.

## Workspaces, uploads and resources

There is no local directory preauthorization list and no `authorizedWorkspaces` / `--web-workspace` grant.
Authenticated `POST /api/v1/workspaces` accepts `{path?, offset?}`. Omitted path starts at the Host account's home;
absolute paths are canonicalized and must be readable directories. The response includes `projectPath`, `name`,
`parentPath`, filesystem `roots`, `directories: [{name, projectPath}]` and `nextOffset`. A page scans at most 4096 entries
and returns at most 256 directories, with a 15-second timeout and shared request capacity. Unavailable paths fail explicitly.
The picker can browse parents, drives and subdirectories or enter an absolute path. Core's existing workspace inspect,
validate and create operations determine project validity; an OS denial remains an error. Selecting a Host directory is
separate from uploading a file chosen on the browser device. Directory listing is discovery, not a permission grant.

`POST /uploads` accepts multipart `intent` JSON and exactly one `file`. Intent contains an original UUID command ID,
Camp, exact Draft revision, display name, byte count and SHA-256. The file limit is 20 MiB, with four uploads in flight.
The browser hashes bounded 256 KiB slices with a UI yield between chunks, preserving the SHA-256 value and exact
retry intent. Host consumes multipart chunks into a private OS temporary file through a 64 KiB writer while computing
the incremental digest; it does not collect a whole file with `field.bytes()`. Either multipart field order is accepted.
An interrupted, invalid, oversized or replayed unbound spool is removed. Once binding is submitted, an unknown result
retains its source until the existing receipt rules permit cleanup. The endpoint asks Core to atomically bind a source reference and receipt to the
verified editor's Draft. The digest excludes the physical temporary path, so a duplicate physical upload can replay
the same command. `POST /uploads/reconcile` reads that binding receipt. A detached binding attempt survives disconnect.

The endpoint cleans failed or provably unbound files; an unknown binding is retained for reconciliation. After Core
accepts a reference, deleting a reference, failed send, logout or shutdown does not delete its source. Draft → Pending →
Message transfers use the existing Core transactions. OS cleanup can make history unavailable. No permanent user asset
store is introduced; [Camp Attachment v9](camp-attachment-v9.md) and Agent Managed artifacts keep their lifetimes.

`POST /files`, `POST /files/bytes` and `POST /attachments` use exact Core owner locators or Core-resolved workspace/evidence sources. Every
read revalidates source ownership; opaque handles/reopen tokens are scoped to the editor and Web instance. An exact external file admitted by Core follows Desktop's existing file semantics: its canonical parent is an ephemeral
child/watch boundary, not a directory grant. Relative resources are resolved under that boundary; canonical checks and
handle-based no-follow opening prevent replacement from changing the retained source.
There are at most 128 handles per server and 32 per editor. Reads have byte and generation bounds. Download uses an
octet-stream response with an encoded original filename; credentials never enter the download URL.

The resource adapter supports bounded UTF-8 text/Markdown, PNG/JPEG/WebP and interactive HTML/HTM documents.
HTML uses the shared viewer and diagnostic/find bridge. Its bytes are read by authenticated POST `readHtml`, with
exact-source reauthorization, editor ownership, content-generation validation and the existing 20 MiB read bound.
The static `/preview.html` receives those document bytes through a channel bound to the actual HTTP(S) origin,
parent/source window, preview ID and generation. Connection challenges and document IDs continue fencing messages;
bootstrap, commands and diagnostics use the actual target origin, never the opaque `null` origin or wildcard.
Both the response CSP and iframe use `sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"`.
The preview shell permits `form-action http: https:` while retaining author script support; the workspace/API CSP
and existing resource response policy stay unchanged. No top-navigation or popup-escape permission is added. Desktop-hosted Web and standalone Server Web
use the same Rust implementation; native Desktop preview and local CSS/JS resource loading are unchanged.
This accepts trusted HTML sharing the Host page's origin: attachments may access the parent and same-origin login
materials, and do not have per-attachment storage isolation. localStorage and sessionStorage are the visiting
browser's native storage, with normal origin/tab lifetimes; no storage shim, capability detection, Server data-dir
write or original HTML modification is introduced. The bootstrap does not explicitly include management Token,
Bearer, editor proof or file handles in the preview URL or document; this is not a credential-isolation guarantee.
Closing the file destroys its iframe; reopening/refresh reads and
reauthorizes the source again. Source mode reads the original document, never injected bridge code (up to 4 MiB
whole HTML source, otherwise the existing paged reader). The Web adapter preserves the existing handle-bound relative-resource capability specified by
[File Preview v15](file-preview-v15.md), alongside HTTP(S) dependencies. This policy change does not alter CSS/JS loading.
Missing resources retain visible diagnostics. Standalone SVG stays text or download.
UTF-8 text above 2 MiB is paged (256 KiB pages, 20 MiB read bound); byte offsets preserve
Unicode scalars. Child links retain the Core-authorized parent source; project children receive independent workspace
restore requests, matching Desktop. Local PNG/JPEG/WebP images are read lazily through the same authenticated,
generation-bound parent. The browser creates only in-memory object URLs, revoked on unmount. File metadata polling
marks open tabs changed; reload reauthorizes the source and replaces its generation. Native open/reveal actions are
absent, while download and displayed-path copy use browser controls. Attachment storage paths stay hidden.
Metadata, paging, line resolution and parent-generation checks use a 64 KiB scan buffer. Page reads retain at most
256 KiB plus three UTF-8 boundary bytes; metadata/line/parent checks do not retain the whole body. Metadata records
UTF-8 validity and one line-count entry per 64 KiB block. A subsequent read may reuse those facts only after a fresh
full SHA-256 matches their generation; an equal size/mtime never establishes equivalence. This removes repeated
classification and prefix-line scans, including open → first read, but does not eliminate full-file digest I/O per request.
The Host does not cache source bytes or files across requests; the existing size, no-follow, source and generation fences remain.

Binary actions `readBinary`, `readChildImage` and preview `download` use `POST /files/bytes` with the same closed
`{action, request}` body. Success returns original bytes, MIME, `x-rovai-content-generation`, JSON-valued
`x-rovai-content-version`, and an encoded Content-Disposition filename for downloads. File failures retain the JSON
operation-result envelope; the JSON `/files` endpoint no longer serves Base64 binary actions. The browser uses a Blob
or byte array without JSON/Base64 conversion. Blob consumption still buffers the complete bounded response.

After confirmed upload binding/reconciliation, a ConsoleClient may retain up to 16 local File objects totaling 40 MiB.
A thumbnail still opens the exact source at Host, confirming ownership, availability, byte count and generation.
Only a matching Camp/digest/size uses the local File as a Blob. A missing source stays unavailable; changed content,
eviction, another client or page reload use ordinary Host reads. This optional in-memory cache is cleared with authentication and never changes
source lifetime. Shared attachment cards and gallery accept this browser Blob without copying it into a byte array.

File polling runs every two seconds only while the client retains a handle and an update subscriber. Releasing the
last handle stops the timer; reopening resumes it. Existing in-flight overlap protection, external-update events and
background handling remain; hiding a preview alone does not stop a retained handle's checks.

Static assets remain separate from user files. Only content-hashed emitted build files listed in `asset-cache.json`
receive `Cache-Control: public, max-age=31536000, immutable`, and only when their actual bytes match the build's
SHA-256 inventory. The build hashes final written output after Vite's preload transforms. Unlisted files, unhashed
names, digest mismatches, missing/error responses, page entries (including `/preview.html`), authentication, business
responses, attachments and private files retain `no-store`. The whole `/assets/` directory is not a cache grant.
Entry/version discovery remains online; no service worker or offline application is introduced.

## Shared presentation and verification

Actual Web login mounts the production `BusinessApp`, `CampNavigation` and `CampWorkspace`. Desktop injects IPC and
native APIs; Web injects HTTP, resources and browser preferences. Missing Web dependencies fail explicitly. Desktop
bootstrap, window session, updates and native lifecycle remain in its entry point. No global Electron bridge is forged.

SSE resync/invalidation rereads authorized navigation, active Camp/execution projection and member state through the
existing shared refresh coordinators. Running text/tools, approvals, stop and terminal state must refresh in place;
the connection revision is not a database watermark, and refresh must not remount the Composer or move history.

Verification owners remain v1's auth/operation/client/real-Host tests, extended for ownership, source binding, receipts,
revocation and protocol rejection. Real Runtime execution and real Desktop/browser UI evidence are separate from
component fixtures and no-model HTTP tests. The removed S1 promise does not turn historical failures into passing evidence; release qualification still requires the
remaining business, network and platform checks recorded in the version plan.

## Shared management resources

Management pages receive request, invalidation and resource adapters explicitly. An invalidation rereads the authorized
list/detail while retaining local drafts and version conflict handling. Skill directory selection refers to the Host
filesystem; Runtime startup on Web accepts a Host absolute program path. Browser keyboard conventions remain local,
while installation and Runtime qualification use the Host health platform. Channel capability comes from the authenticated Host deployment; native system-file integration remains absent in Web. Browser code never dereferences an Electron bridge.

`POST /api/v1/avatars` accepts a closed `read | save` action. Save carries bounded normalized PNG source/icon and crop,
never an arbitrary path; the shared Rust member-avatar store verifies dimensions, crop, format and byte limits before
atomic compound publication. Content identity makes repeated saves reuse one asset. Reads require a canonical managed
avatar reference, fixed manifest file names and matching digest, and return PNG bytes. Desktop IPC uses the same Rust
read/save handlers. The network body is limited to 24 MiB and shares the upload concurrency quota. Renderer avatar caches
are scoped to the injected reader, so identical avatar IDs on different Hosts cannot share bytes or late responses.

MCP config and mutation projections include only admitted editor fields. Rust masks stored credential headers/environment,
URLs containing user information or query parameters, and credential-bearing argument lists; masked edits preserve their
exact existing field/index under the original config digest. Explicit reveal is an ephemeral authenticated read requested
by the editor control; it never enters list refreshes, SSE or command receipts. MCP configuration continues to use its
existing config-digest CAS. A lost result requires rereading authority and resolving a conflict, without silently claiming
success or automatically retrying a configuration change. SQLite-backed Task/Memory/Automation/Skill commands instead
use their existing durable gateway receipts and the original command ID.

## 私聊与其他上传目标

Migration 154 将 Single Chat Draft 改为 `(conversation_id, client_id)`，既有记录归 Desktop，
Pending 的来源与活动编辑也记录后端 client。认证后的 Owner 共享已提交的私聊会话，但未提交附件、引用、
编辑令牌和 Pending working refs 只通过已校验的编辑身份读取；命令的幂等摘要包含该身份。
Desktop 的默认身份不增加旧命令的序列化字段。结束私聊沿用 Core 的线性化点，清除该会话全部客户端 Draft。

`singleChat.open/get/list/send/end`、原 Pending 编辑和移除草稿附件均调用同一 SingleChatService。
上传 intent 保持原 Camp 默认形状，显式 target 可选择 Camp Pending、Single Chat Draft 或 Single Chat Pending。
四种目标共用上传限额、摘要校验、弱持久 Source Ref 和命令回执；目标的版本、编辑令牌和 client 检查发生在原领域事务中。
上传回执查询不重新派发；返回对应客户端当前授权视图。SSE 只发失效通知，共享私聊页面重读列表／当前快照，
不把失效消息解释为私有 CoreEvent。正文输入仍由当前页面保存，同 Owner 重新认证不重挂业务子树。


Shared administration now includes Camp rename/delete/discard, member reorder/removal preview/removal, Camp Fast
configuration, accepted-input recovery decisions, notifications, monitoring, diagnostics and Skill reconciliation.
Each public method is individually admitted; durable commands use their existing Core envelope and receipt lookup,
including after Camp deletion. No host shutdown, token management, raw source resolver or source-path ingress RPC is
made public. Diagnostics download uses Core's redacted v5 export; monitoring uses the existing filtered snapshot.
Notification preferences and acknowledgements belong to the single Owner; heads-up queues, focus and visible-source
observations remain per browser. Invalidations reread authorized notification changes/preference; they are not CoreEvents.
Channels are supported in Desktop-hosted Web through the closed adapter below; standalone Server channels remain outside stage 1–4 qualification.


## Desktop-hosted channels and logout

The authenticated login reply and `/api/v1/capabilities` declare `channels: "desktop" | "unsupported"`.
Standalone Server omits the channel settings navigation; retained routes show:
“独立 Server 当前不支持飞书／钉钉渠道。渠道功能请使用 Rovai Desktop。” No manual Bot import or credential migration route is added.

Desktop-hosted Web mounts the production `ChannelSettings` page with an injected channel client. Account connection,
switching and reauthentication stay on the computer running that Desktop; only genuinely native steps redirect there.
Publishing, retrying and structured approver selection remain browser actions against the existing Desktop coordinator,
provider service, publication identity and Core persistence. Unknown creation outcomes never authorize a new Bot.

`POST /api/v1/channels` shares the authenticated, same-origin, bounded-body network boundary. Its closed tagged bodies are
`{operation:"get"}`, `{operation:"publish"|"retry",kind,agentId}` and
`{operation:"selectApprover",kind:"dingtalk",agentId,userId}`. IDs are nonempty, at most 256 UTF-8 bytes, with no control
characters. Extra fields, native login operations and arbitrary RPC methods are rejected. The Host bounds waiters to 16,
with a 60-second result deadline; losing a waiter never cancels admitted Desktop work. A result timeout is unknown,
not proof that the operation failed. Re-read the existing publication and use its existing recovery path.

The local parent pipe uses `host.channels.dispatch`/`host.channels.reply` with a Host-registered request identity and one
`host.channels.request` notification. Dispatch acknowledgement frees the Core queue before Desktop calls Core again.
These methods are never admitted as Web Core operations. The Desktop callback accepts only the same four operations,
fences responses by child generation, and projects the public snapshot field by field. Cookie, App Secret, native login
QR and raw exceptions are absent. Generic Main forwarding and new platform publication state machines are prohibited.
Desktop IPC and Web publication mutations share a per-provider admission gate in the existing coordinator.

The mounted Web page re-reads the authorized snapshot every two seconds, including progress that has no Core event;
responses are fenced by authentication generation. Read failure shows unavailable/unknown live state while retaining
stored publication facts. Each provider's `provisioning` retains its original publication progress independently;
the legacy aggregate cannot hide another provider's in-flight work or approver choices.
`connection.sessionStatus` is the latest runtime inspection (`valid`, `invalid`, `unavailable`,
`unknown`), distinct from account connection records. Bot `connectionStatus` is `online`, `offline`, `unknown`, `connecting` or `reconnecting`, separate
from publication status. `published` retains the durable Bot publication fact when a later retry/connection failed. Absent live fields are unknown; persisted records alone cannot establish current connectivity.
`connectionFailureCode` is an optional safe classification; `connectionNeedsAttention` marks a persistent connection issue on the compact disconnected-link icon,
and `canReconcile` preserves the existing retry action for terminal configuration failures. These fields are projected
with failure-specific guidance in its hover/focus/click tooltip, without permanent connection descriptions in the row.
The icon appears only for `reconnecting` or observed `offline` states; `online` (including pending local confirmation),
initial `connecting` and `unknown` states have no icon. Recovery removes the icon. A legacy brand mismatch disables reconciliation on the wrong provider.
An initial publication whose only remaining work is connection recovery returns its ongoing provisioning snapshot,
not an action error. Its Dialog can close while the Host continues; an online transport with pending local confirmation
remains online and reports `connection_confirmation_pending` if that confirmation fails. Fields are projected
explicitly by Desktop; raw SDK errors and external identity values are never forwarded. An App with no live observation
is `unknown`; `offline` requires an observed disconnect or terminal failure. A recovery timer or active SDK loop is
required before displaying `reconnecting`.

Only known expired/mismatched sessions produce `channel_session_expired` and the instruction:
“请在运行此服务的 Rovai Desktop 中重新连接账号，完成后返回本页重试。” Timeouts, platform approval and ordinary
recoverable failures stay in the current page. Existing structured approval candidates use the shared selection form.

Web logout is available once under Settings → Remote connection. It revokes only that Session; Host, tasks, other
sessions and channel services keep running. Closing a browser or stopping Desktop's Web listener does not stop channel
connections or admitted publication work. Only Desktop's existing controlled shutdown owns channel service shutdown.

## Shared creation preferences

The current Host owns default member IDs, default Lead, the confirmation latch and one-click creation flag.
Desktop and Web compose these fields with their own presentation preferences through one shared adapter.
`preferences.newConversation.get`, `.setDefaults` (`{defaults, enableOneClick}`), `.setOneClick` (`{enabled}`)
and `.invalidate` (`{expectedDefaults}`) are individually authenticated network operations with closed parameters.
Saving the team clears its confirmation latch, optionally enables one-click atomically, and otherwise preserves
that flag. Enabling requires an existing, confirmed team; unknown/removed members, duplicate IDs and a Lead
outside the team are rejected without changing saved values. Invalidation only applies to the expected team,
so a stale client cannot invalidate a newer selection. Temporary Runtime unavailability continues to open the
shared creation dialog without invalidating the saved team; normal Core creation admission remains unchanged.

Core serializes and atomically stores this small record in `new-conversation-preferences.json` within its selected
data root, using the existing platform private-file publisher. It persists across Host restart. An unreadable or
invalid record is an error, never a successful empty preference snapshot. A change emits invalidation and clients
reread authorized preferences; new-conversation entry also rereads before choosing one-click or dialog.

Desktop's private `preferences.newConversation.initialize` imports only the three creation fields from its
previous general preferences, and only while the Host record does not exist. Main completes this before exposing
Desktop Web; subsequent reads and Core restarts cannot overwrite Web edits with the retained legacy file.
Initialize is not admitted over HTTP. Existing browser-local copies are ignored; appearance, navigation, startup
location, execution placement and map display remain local presentation choices. This is instance-wide preference
storage, not shared Composer editing, account sync, or a second business service. Independent Server uses the same
store under its own data root and does not read another Desktop instance's preferences.

## Login presentation and Server updates

The no-store HTML entry contains only `rovai-host-kind=desktop|server` as public presentation metadata.
It selects one Token-help sentence before authentication; it grants no capability. First login, logout and
expired-session login reuse the same form and heading. Editor proof, drafts, renewal and logout revocation
retain the authentication contract above.

Desktop-hosted Web/Mobile expose the shared About and Updates page with the current version and bundled,
version-matched release notes. They expose no check/download/install actions or native updater bridge.
Standalone `rovai-server` supplies the authenticated `POST /api/v1/updates` capability. The closed request is
`{operation:"get"|"check"}` or `{operation:"download"|"install",version:string}`; paths, URLs and commands are
never browser inputs. Desktop and the legacy headless Host return `updates_unsupported` (501).
The response is `{result:AppUpdateSnapshot,error:null}` using the shared Desktop presentation states.
The failure reason `release_unpublished` distinguishes an unpromoted Server channel from up-to-date.
If restart remains unreachable for one minute, the browser uses `restart_unconfirmed` and offers a read-only
connection retry instead of claiming success or issuing another installation.

The Host checks once after startup and every six hours; automatic checks never download or install.
Manual check is explicit. Check/download are serialized background operations, observed by authenticated
polling. Repeated actions during a busy operation return its current state. Download and install require
the exact release version observed by the client; stale versions and invalid state transitions fail.
Only the fixed GitHub repository, `scripts/server-channel.txt`, stable `server-v<version>` release,
matching native Server asset and `SHA256SUMS` are accepted. A draft, prerelease, missing/duplicate asset,
invalid coordinate, oversized response, truncated file or checksum mismatch cannot become installable.
The existing bundled native installer validates and extracts into an isolated staging installation with
PATH modification disabled. The matching program/UI are copied to the program filesystem before shutdown.

Installing requires a complete packaged installation with business data outside the program directory.
Each running Server holds a shared lease on its executable; the updater must obtain an exclusive lease
before a program switch, so another instance using the same files prevents replacement. Unix retains this
lease across the move. Windows releases its own executable handle immediately before renaming the
directory; operating-system image/handle restrictions remain the final gate if a process races the switch.
Only after staging/preflight succeeds does the Host close HTTP and use the existing durable Core shutdown.
An unsuccessful settlement never arms the program switch. Unix switches the managed revision link or
portable program directory and execs the new Server; Windows uses a copied helper outside the locked
program directory, waits for the parent's explicit settlement marker and pipe closure, then switches and
starts the new Server. Restart preserves the resolved data directory, listener, proxy and LAN arguments.
On Windows the restarted Server runs without opening another console; diagnostics remain in the same data root.

A failed directory switch restores the prior program before attempting restart. Old program revisions/
backups are retained; this is not database/schema rollback and does not promise recovery from failed new
Core admission. The browser retains its ordinary Session and reloads the matching UI after observing a
changed version. Network interruption is not proof of installation success. Official Release delivery and
native Windows/Linux restart qualification must be recorded independently of fixture tests.
