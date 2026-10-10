---
document_type: architecture
authority: diagnostics-center-component-boundary
status: accepted
last_updated: 2026-08-21
---

# Diagnostics Center Architecture

## Component authority

| Component | Responsibility |
| --- | --- |
| Core diagnostics module | Owns public status/group DTOs, summary aggregation, read-only SQLite quick check and the final v5 centralized redaction pass. |
| Core router | Composes current Core/Git/data-dir facts, stored Skill projection state, Windows fixed-name legacy entry presence, strict-read MCP inspection, persistent member Runtime selections and cached Runtime evidence into one `DiagnosticsReport`; Git is resolved to an absolute executable through the shared Runtime search environment before the managed health process starts. |
| Skill projection reconciler | Exposes stored observation/root-access/dirty diagnostics; on Windows it also checks only the nine fixed names under known Skill group paths of registered active roots. Explicit user cleanup remains a separate filesystem mutation. |
| MCP config store | Exposes `inspect` that never materializes a missing file; `get` and permission repair remain separate user-authorized operations. |
| Runtime platform admission + health cache | Supplies platform rows for the complete Product Runtime Catalog, but machine observations only for qualified Adapters and without rescan/probe scheduling. Runtime check remains an explicit qualified-product command. |
| Renderer Diagnostics Center | Owns Loading/Running/Partial/Error/Success/Disabled/Recovery presentation, attention-only issue projection, filters and the explicit action-to-Core mapping. |
| Electron Main / Preload | Allowlist the typed read method, broker Save Dialog, write v5 with the platform private atomic-write helper, and constrain host-file-manager reveal to the last successful session export. |
| Startup Recovery | Remains the only recovery surface when Core cannot open or migrate SQLite; Diagnostics Center is not a second Core startup mode. |

## Read and repair flows

```text
open page / run full self-check
  -> diagnostics.check
     -> read current facts only
     -> status + summary + checks
  -> Renderer derives issue list and filtered complete results

explicit single-item action
  -> one existing safe mutation or settings navigation
  -> diagnostics.check
  -> same check is ok: Success + replace report
     same check attention/unknown: preserve honest result
     read fails: Recovery + retain prior report

export
  -> diagnostics.export
     -> fresh read-only report + allowlisted aggregate counts
     -> centralized v5 redaction
  -> Electron platform-private atomic save
  -> exact-session host file-manager reveal
```

## Invariants

- No Renderer-derived health calculation can replace Core statuses or summary counts.
- `diagnostics.check` never invokes an operation whose purpose is reconcile, repair, rescan, probe, login,
  replacement or data mutation.
- Except for the Windows fixed-name legacy check, `diagnostics.check` never resolves, canonicalizes,
  stats, or enumerates a historical Skill execution root. That check only inspects exact paths under
  registered active roots and never writes project files or database records.
- `unknown` is evidence insufficiency and never enters the attention issue list.
- Runtime Catalog visibility and Runtime issue eligibility are different: all supported Adapters are visible, only selected
  platform-qualified unavailable products become attention. Not-qualified/unsupported rows never become machine health.
- Repair and its post-action read are a two-step protocol; mutation success alone is not health success.
- The legacy-link exception belongs only to explicit `skills.reconcile`: automatic preflight/terminal cleanup preserves
  every project-owned entry, while explicit repair may remove a recorded missing symlink only when its target is exactly
  `$HOME/.lumen/skills/revisions/<UUID>/<UUID>`.
- v5 is built from an allowlist and still receives a final recursive redaction pass; raw health/profile/camp objects
  never become export fields.

## 旧智能体环境配置

Agents 环境变量编辑退役后，Core 为每个非空归档生成独立的 `legacy_runtime_environment` 诊断。
尚未确认的归档进入“需要处理的问题”，明确说明功能已移到 Teammates，需要手动复制仍需使用的变量。
展开读取属于 Owner 私有接口，默认遮蔽；公开报告只携带数量、状态和归档身份。
“标记已处理”只记录对应内容身份的持久确认，不执行迁移、删除或连接检查，也不纳入自动修复。
已处理的归档仍可在该区域展开查阅，后续检查不再重复列为待处理。旧值从升级起停止参与启动，与确认状态无关。
精确接口及迁移见 [Runtime Launch v57](../contracts/runtime-launch-and-verification-v57.md)。

## References

- [Runtime 平台安全不变量](foundational-invariants.md#runtime-platform-security)
- [Diagnostics Center v2](../contracts/diagnostics-center-v2.md)
- [v0.51 production design](../versions/v0.51/production-design.md)
