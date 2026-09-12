---
document_type: protocol-contract
contract: host-web-v2
authority: shared-host-web-transport
status: accepted
version: 2
source_version: v1.59
last_updated: 2026-09-12
---

# Host Web v2

v2 replaces [v1](host-web-v1.md) for new Web sessions. One Core, local management, authority/origin checks,
memory-only Bearer credentials, bounded admission, CSP and invalidation SSE retain v1 semantics.
This contract admits the shared Camp write path; it does **not** qualify a platform for secure network release.
Implementation and remaining acceptance evidence belong to the [version plan](../versions/v1.59/implementation-plan.md).

## Authentication and editor ownership

`POST /api/v1/login` accepts `{ protocolVersion: 2, administratorToken, editor? }`.
`editor`, when present, is exactly `{ clientId, proof }`. An incompatible protocol is rejected before issuing a session.
The response contains `protocolVersion: 2`, `token`, `clientId`, `editorProof`, `ownerId`, `expiresInSeconds` and `epoch`.
The browser checks the response protocol before mounting business pages or sending commands.

Fresh login creates a Core-owned random 256-bit editor identity and an independent random recovery proof.
Core persists only the proof digest, bound to the current Owner; the Host must first verify fresh administrator
authentication before it can resolve or resume that editor. A client ID, Draft ID or proof alone never authenticates
a Session. Another client's proof cannot resume the named editor. Reauthentication replaces that editor's old Session,
including at session capacity. Rotation and Web shutdown fence an in-flight login as well as existing sessions.

Session expiry, reconnect and same-page reauthentication change authentication/connection generations, while retaining
the editor identity, mounted Composer, unsent local edits and original outstanding command IDs. Host or Owner changes
require a different editing/cache scope. Production Web currently has one fixed origin per page and refuses an Owner
change in place. Separate pages create separate editors. Tokens and recovery proofs are kept only in page memory;
a full reload creates a new editor and is not a cross-page Draft recovery service. Presentation preferences may use
origin/Owner-scoped browser storage; business state, credentials and Drafts must not enter that store.

## Admitted operations

The Rust `operations::Operation` enum remains a closed network allowlist. It now admits the existing Core operations for
Camp creation/preflight/membership, member configuration, Runtime discovery/check/catalog, scoped Camp Draft mutations,
pending editing, send, cancellation, approval, execution detail and read-only command reconciliation. It does not admit
arbitrary internal RPC, local management, raw paths, source binding or editor-resolution methods.

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

Trusted local startup supplies up to 64 absolute `authorizedWorkspaces`; standalone CLI uses repeatable
`--web-workspace`. Host canonicalizes existing roots. `GET /workspaces` lists those choices. Workspace inspection,
validation and Camp creation only accept an exact grant, rechecked against the current filesystem. Browser path strings
cannot create a grant. A granted workspace is separate from browser-device native file selection.

`POST /uploads` accepts multipart `intent` JSON and exactly one `file`. Intent contains an original UUID command ID,
Camp, exact Draft revision, display name, byte count and SHA-256. The file limit is 20 MiB, with four uploads in flight.
The endpoint creates a private OS temporary file and asks Core to atomically bind a source reference and receipt to the
verified editor's Draft. The digest excludes the physical temporary path, so a duplicate physical upload can replay
the same command. `POST /uploads/reconcile` reads that binding receipt. A detached binding attempt survives disconnect.

The endpoint cleans failed or provably unbound files; an unknown binding is retained for reconciliation. After Core
accepts a reference, deleting a reference, failed send, logout or shutdown does not delete its source. Draft → Pending →
Message transfers use the existing Core transactions. OS cleanup can make history unavailable. No permanent user asset
store is introduced; [Camp Attachment v9](camp-attachment-v9.md) and Agent Managed artifacts keep their lifetimes.

`POST /files` and `POST /attachments` use exact Core owner locators or authorized workspace/evidence sources. Every
read revalidates source ownership; opaque handles/reopen tokens are scoped to the editor and Web instance. Canonical
containment plus handle-based no-follow opening prevents path replacement from becoming an arbitrary Host read.
There are at most 128 handles per server and 32 per editor. Reads have byte and generation bounds. Download uses an
octet-stream response with an encoded original filename; credentials never enter the download URL.

The initial resource adapter supports bounded UTF-8 text/Markdown and PNG/JPEG/WebP. HTML/SVG use text or download,
never executable preview. Paged large text, relative resources and external-change watching remain implementation
gaps; they are not declared permanent Web exclusions. Static assets remain separate from user files.

## Shared presentation and verification

Actual Web login mounts the production `BusinessApp`, `CampNavigation` and `CampWorkspace`. Desktop injects IPC and
native APIs; Web injects HTTP, resources and browser preferences. Missing Web dependencies fail explicitly. Desktop
bootstrap, window session, updates and native lifecycle remain in its entry point. No global Electron bridge is forged.

SSE resync/invalidation rereads authorized navigation, active Camp/execution projection and member state through the
existing shared refresh coordinators. Running text/tools, approvals, stop and terminal state must refresh in place;
the connection revision is not a database watermark, and refresh must not remount the Composer or move history.

Verification owners remain v1's auth/operation/client/real-Host tests, extended for ownership, source binding, receipts,
revocation and protocol rejection. Real Runtime execution and real Desktop/browser UI evidence are separate from
component fixtures and no-model HTTP tests. S1 remains a distinct release blocker.
