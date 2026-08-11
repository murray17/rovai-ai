---
document_type: architecture
architecture: skill-projection-reconciliation
authority: skill-projection-access-and-reconciliation-boundaries
status: accepted
last_updated: 2026-08-11
---

# Skill Projection Reconciliation Architecture

本文件说明 Rovai Skill Library、execution-root SkillProjection 与 AgentRun
SkillExposureSnapshot 的长期组件边界。决策理由见
[ADR-0105](../adr/0105-runtime-group-assigned-skill-delivery.md)、
[ADR-0158](../adr/0158-default-all-runtime-delivery-for-managed-skills.md)和
[ADR-0161](../adr/0161-event-driven-root-scoped-skill-projection-reconciliation.md)。

## 三层状态

```text
Skill Library (authoritative desired state)
        │ config event → DB-only dirty/pending cleanup
        ▼
SkillProjection (mutable, rebuildable view in one execution root)
        │ current AgentRun preflight → reconcile + verify
        ▼
SkillExposureSnapshot (immutable start-time evidence in ContextManifest)
```

| 层 | 权威 | 生命周期 | 不是 |
| --- | --- | --- | --- |
| Skill Library | Skill identity、current immutable Revision、Enablement、Group Assignments、deletion lifecycle | 应用全局 | 项目目录状态 |
| SkillProjection | 当前 execution root 中由 Rovai 拥有的 native discovery links 与最后观测 | 可删除、可重建、多个 Run 共享 | 每 Run Revision 副本、Library 真源 |
| SkillExposureSnapshot | Run 启动时观察到的 Skill/Revision/Group/path/status/conflict 与 digest | 单个 AgentRun 的不可变 Evidence | 文件锁、Runtime load receipt、终身内容保证 |

`skill_projection_observation` 证明上次看到的 entry 和 Rovai 所有权，只能支持安全清理、诊断和
下一次当前-root 修复。它不能把 execution root 加入启动、定时或 watcher 调度。

## 组件职责

| 组件 | 职责 |
| --- | --- |
| `SkillLibraryService` | 提交 Library desired state 与 immutable Revision；启动时只维护 Rovai 私有 Library |
| `skill_projection_root_state` | 持久 `active | removed`、dirty 与 pending cleanup；不探测 filesystem |
| `SkillProjectionReconciler` | 只在明确 root trigger 下安全检查、投影、验证、记录 observation 与 Snapshot |
| `ContextService` | 在 Runtime launch 前取得或复用该 Run 已持久化的 start-time Snapshot |
| AgentRun dispatcher | 对 removed root fail closed；只为当前 Run 调用 preflight |
| Electron Main navigation preferences | 拥有本机 Project 隐藏偏好，并通过私有 Core method 同步 root access ledger |
| Diagnostics | 默认只读取 DB stored state；用户显式“修复”才允许检查仍 active 的已知 roots |

Renderer 不能直接调用 `skills.projectAccess.*`。Project 移除和恢复由 Main process 先同步 Core
access state，再提交本机 Navigation preference；写入失败时恢复 Core access state。该 ledger 不引入
Project table、Project aggregate 或 Camp 删除语义。

Main 在启动 Core 时把 Navigation preference 中完整的 removed-root 集合作为显式启动参数传入，Core
在创建 AgentRun scheduler 前完成 DB-only ledger 同步。每次移除或恢复成功后，Main 同步更新
`CoreClient` 保存的启动参数副本，因此 Core 自动重启也不会短暂把已移除 root 当作 active，或把已经
恢复的 root 再次标为 removed。

## 触发矩阵

| 触发 | Library / DB | 项目 filesystem |
| --- | --- | --- |
| App 启动 / Core 恢复 | 加载 Library、observation、dirty、removed、active Run recovery | 不枚举、不 canonicalize 历史 roots |
| Skill install/update/enable/assignment/delete | 提交 desired state；把已有 observation roots 标 dirty/pending cleanup | 不访问 |
| Runtime selection/config change | 提交配置；标记相关已知 projection dirty | 不访问 |
| 新 AgentRun | 读取当前 Run root 与 Runtime Groups | 只 reconcile/verify 当前 canonical root |
| AgentRun terminal | 读取该 Run 的 persisted root state | 只在 dirty 或 removed cleanup pending 时处理该 root |
| Project 移除 | 写 `removed`；active Run 时保留 cleanup pending | 无 active Run 可做一次 best-effort managed cleanup；之后停止 |
| Project 恢复/重新选择 | 写 `active + dirty` | 等下一次 Run preflight |
| Settings/Diagnostics 普通读取 | 读取 stored observation/root state | 不访问 |
| 用户显式修复 | 读取仍 active 的当前 Camp/active Run requirements | 可逐 root 审计并 reconcile；removed roots 排除 |

Core 的 AgentRun scheduler 不包含 Skill interval，也不持有 Skill filesystem watcher。其他私有
subsystem 的 interval（例如 App `userData` 下的 MCP projection cleanup）不能被视为 Skill root access。

## AgentRun Preflight

```text
claimed AgentRun
  → 从 persisted workspace 取得 exact execution_root
  → 在任何 resolve/canonicalize 前检查 removed ledger
  → canonicalize 当前 root（只此一个）
  → 计算目标 Runtime Groups ∪ 同 root active Run Groups
  → 将 Rovai-owned entries reconcile 到最新 Library state
  → 保留 project-owned entry 并记录 shadowed
  → verify observations / Revision content
  → error 或 stale: 阻止 Runtime launch
  → ready 或 honest shadowed: 记录 SkillExposureSnapshot
  → start Runtime
```

同一 Agent 的 AgentRun 串行由 Runtime/AgentRun admission 保证；SkillProjection 不重复实现该锁。
不同 Agent 的新 Run 可以把共享 projection 更新到最新 Revision。旧 Run 不被取消，也不阻塞更新；若
之后重新读取 native Skill path，可以观察到新 Revision 或已删除 entry。

已存在 ContextManifest 的 active Run 恢复时复用其已持久化 SkillExposureSnapshot，不把 Snapshot
重新解释为当下 filesystem health，也不因此扫描其他 roots。

## 安全与失败

- Rovai 只替换能通过 Library identity 与 observation 证明为自身所有的 link。
- 普通目录、文件、外部 link、损坏或身份不匹配的 link 都按 project-owned/shadowed 处理，不覆盖。
- Revision 内容损坏、expected observation 缺失或 reconciliation 后仍 stale/error 时，Run preflight
  fail closed；Settings 的绿色状态不能放宽该门禁。
- removed root 在 preflight 的路径解析前拒绝，避免已移除的 Downloads/Documents/Desktop 路径再次
  触发权限访问。
- active Run 结束后的 removed-root cleanup 是唯一受限例外；完成或失败后保持 removed，不进入后续
  background schedule。
