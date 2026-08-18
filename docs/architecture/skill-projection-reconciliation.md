---
document_type: architecture
architecture: skill-projection-reconciliation
authority: skill-projection-access-and-reconciliation-boundaries
status: accepted
last_updated: 2026-08-18
---

# Skill Projection Reconciliation Architecture

本文件说明 Rovai Skill Library、execution-root SkillProjection 与 AgentRun
SkillExposureSnapshot 的长期组件边界。决策理由见
[Skill Library 与投影不变量](foundational-invariants.md#skills-library-projection)、
[Skill Library 与投影不变量](foundational-invariants.md#skills-library-projection)和
[Skill Library 与投影不变量](foundational-invariants.md#skills-library-projection)。当前 official
inventory 与 system-required policy 见
[Skill Library 与投影不变量](foundational-invariants.md#skills-library-projection)。
bundled bootstrap 与执行完整性时机见
[Skill Library 与投影不变量](foundational-invariants.md#skills-library-projection)。用户结构化选择与
`CURRENT_INPUT.skills` 的交叉边界见
[ContextManifest 与 Run Facts 不变量](foundational-invariants.md#context-manifest-run-facts)和
[Structured Current Input Skill Links](structured-current-input-skill-links.md)。
Windows copy backend 的 crash recovery 与执行根准入见
[Skill Library 与投影不变量](foundational-invariants.md#skills-library-projection)和
[Windows Skill Projection v1](../contracts/windows-skill-projection-v1.md)。

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
| SkillProjection | 当前 execution root 中由 Rovai 拥有的 native discovery entries 与最后观测 | 可删除、可重建、多个 Run 共享；macOS 为 link，Windows 为受控 copy | 每 Run Revision 副本、Library 真源 |
| SkillExposureSnapshot | Run 启动时观察到的 Skill/Revision/Group/path/status/conflict 与 digest | 单个 AgentRun 的不可变 Evidence | 文件锁、Runtime load receipt、终身内容保证 |

`skill_projection_observation` 证明上次看到的 entry 和 Rovai 所有权，只能支持安全清理、诊断和
下一次当前-root 修复。它不能把 execution root 加入启动、定时或 watcher 调度。

Skill Library view 的 `managementPolicy` 来自 bundled official manifest，而不是用户可改数据库字段。
`cli-operations` 与 `memory-stewardship` 为 `system_required`：bundled install 以 DB-only 事务恢复 enabled
与全部九组 Assignment，命令边界拒绝修改；其余十一项 official Skill 为 `user_managed`。当前 inventory
精确为十三项，名称和 provenance 由 ADR-0191 冻结。该策略只决定 Library desired
state，不改变 projection ownership、preflight、Snapshot 或 Runtime load 证明。

## 组件职责

| 组件 | 职责 |
| --- | --- |
| `SkillLibraryService` | 提交 Library desired state 与 immutable Revision；启动时只维护 Rovai 私有 Library |
| `skill_projection_root_state` | 持久 `active | removed`、dirty 与 pending cleanup；不探测 filesystem |
| `skill_projection_run_registration` | Windows-only 持久 launch registration；绑定 AgentRun epoch 与 canonical root volume/file identity，不保存文件锁 |
| `SkillProjectionReconciler` | 只在明确 root trigger 下安全检查、投影、验证、记录 observation 与 Snapshot |
| `ContextService` | 在 Runtime launch 前取得或复用该 Run 已持久化的 start-time Snapshot |
| `CurrentInputSkillResolver` | 只读相交发送时 selection、start-time Library availability 与 verified Exposure；生成 model entries 和完整 resolution evidence，不修改 filesystem |
| AgentRun dispatcher | 对 removed root fail closed；只为当前 Run 调用 preflight |
| Electron Main navigation preferences | 拥有本机 Project 隐藏偏好，并通过私有 Core method 同步 root access ledger |
| Diagnostics | 默认只读取 DB stored state；用户显式“修复”才允许检查仍 active 的已知 roots |

这里的“应用全局”只表示同一日常应用数据权威内共享，不表示不同 Core 数据目录可以共享一套可清理的
Revision filesystem。日常安装版由 Desktop 显式传入 `--use-default-skill-library`，继续使用现有全局
Skill Library；Desktop 只要显式收到 `--user-data-dir`，以及所有开发版、Smoke 和打包验收版等隔离
实例，都必须通过绝对 `--skill-library-root` 把 Library 绑定到自己的 `userData`。两个选择互斥且必须
恰好提供一个；Core 对缺失或冲突选择 fail closed，并在创建、修复或清理任何 Revision 前退出。
Core 自动重启保留同一参数，任何一个实例的 `cleanup_orphan_revisions` 都只能清理本实例数据库拥有的
私有 Library。

Renderer 不能直接调用 `skills.projectAccess.*`。Project 移除和恢复由 Main process 先同步 Core
access state，再提交本机 Navigation preference；写入失败时恢复 Core access state。该 ledger 不引入
Project table、Project aggregate 或 Camp 删除语义。

Main 在启动 Core 时把 Navigation preference 中完整的 removed-root 集合作为显式启动参数传入，Core
在创建 AgentRun scheduler 前完成 DB-only ledger 同步。每次移除或恢复成功后，Main 同步更新
`CoreClient` 保存的启动参数副本，因此 Core 自动重启也不会短暂把已移除 root 当作 active，或把已经
恢复的 root 再次标为 removed。

## Bundled bootstrap 与完整性门禁

Core ready 前先从 embedded bundled definitions 在内存计算 expected digest。数据库 current digest 与
文件树 paths/types/sizes/modes 全部匹配时，bootstrap 不创建 staging、不复制、不 `fsync`、不读取全文；
只继续检查 system-required DB configuration。bundle 变化或轻量检查不匹配时才执行完整 materialize、
digest verify 与 publish/repair。

这条快速路径不是 Revision 内容证明。下方 AgentRun preflight 在 Runtime launch 前仍读取并哈希该 Run
需要的精确 current Revision；同大小内容篡改、bootstrap 后漂移或任何 digest mismatch 都在此 fail closed。
Bootstrap report 只服务启动性能诊断，不进入 SkillExposureSnapshot。

若新版本认领的 official 名称在 bootstrap 前已作为 imported Skill 存在，Core 在发布 bundle 前原地提升：
保留 Skill ID、enablement 与 group assignments，把 origin 切为 official，追加不可变 bundled Revision 和
审计事件。official inventory 建立后，同名 import 仍被拒绝；这条迁移不允许 imported 内容覆盖 bundle。

### Windows Revision v1 逻辑 mode

既有 `rovai-skill-revision-v1` digest 包含 POSIX mode，但 NTFS/DACL 不提供等价的 executable mode。Windows
导入因此把每个 admitted regular file 的**逻辑 mode**确定为 `0644`；实际读写权限完全由 Windows Private
Storage 的 protected DACL 拥有，不能从 logical mode 推导，也不能把 DACL 位混入 revision digest。脚本风险仍
按扩展名、shebang 与内容探测，`executableFileCount` 在 Windows v1 为 `0`。

当前 embedded bundled inventory 的所有文件 mode 均为 `0644`，所以 macOS 与 Windows 对同一 bundle 产生相同
digest。若未来 bundle 需要其他 mode，Windows bootstrap 必须先随新的 Revision digest contract 明确迁移；在此
之前直接 fail closed，不能静默改写 mode 或制造跨平台同名异 digest。Windows Library 与 projection 的遍历都从
不跟随 reparse point 的 retained handle 开始，子项按父目录 handle 相对打开；复制文件 flush 后重开/重算完整树，
不能用路径字符串或 DACL 等价猜测替代内容证明。

## 触发矩阵

| 触发 | Library / DB | 项目 filesystem |
| --- | --- | --- |
| App 启动 / Core 恢复 | 加载 Library；unchanged bundled Revision 走 digest + 私有 Library 文件树元数据快速路径；加载 observation、dirty、removed、active Run recovery | 不枚举、不 canonicalize 历史 execution roots |
| Skill install/update/enable/assignment/delete | 提交 desired state；把已有 observation roots 标 dirty/pending cleanup | 不访问 |
| Runtime selection/config change | 提交配置；标记相关已知 projection dirty | 不访问 |
| 新 AgentRun | 读取当前 Run root 与 Runtime Groups；Windows 进入 root launch gate | 只 reconcile/verify 当前 canonical root |
| AgentRun terminal | 读取该 Run 的 persisted root state；Windows 注销 active run | 只在 dirty 或 removed cleanup pending 时处理该 root |
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

同一 Agent 的 AgentRun 串行由 Runtime/AgentRun admission 保证；SkillProjection 不重复实现该锁。macOS link
backend 中，不同 Agent 的新 Run 可以把共享 projection 更新到最新 Revision；旧 Run 不被取消也不阻塞更新，
之后重新读取 native Skill path 仍可能观察到新 Revision 或已删除 entry。

Windows copy backend 使用 `Execution Root Projection Gate`：launch 在同一 Core database critical section 内验证
ready，并持久登记 `AgentRun + execution epoch + canonical root identity` 后释放；publish/recovery 只有在该 exact
root 无 active registration 时才能取得 mutation admission。等待方必须释放 database mutex，使 terminal settlement
能够推进；Core restart 继续使用持久 registration，并在当前 root preflight 中恢复未完成 journal 后才开放新
launch。这个平台特例避免 copy/swap 期间 Runtime 读取半发布目录，但仍不把 SkillExposureSnapshot 升级为
lifetime load proof。

已存在 ContextManifest 的 active Run 恢复时复用其已持久化 SkillExposureSnapshot，不把 Snapshot
重新解释为当下 filesystem health，也不因此扫描其他 roots。

为 `CURRENT_INPUT.skills` 解析时，Exposure 仍只是 start-time 物理可见性证据。Core 必须额外读取该 Run
发送时 `SkillSelectionSnapshot` 与 Manifest materialization 时的 Library desired-state view；否则发送后
启用会回溯获得路径，或 active-Run protection 保留的旧 link 会绕过后来 disable/unassign/delete。
Resolver 只接受 `ready`、同 ID/同名且与冻结 Runtime Group 相容的候选，并把 `entryPath` 解释为目录，
模型文件为其下 `SKILL.md`。这条只读解析不缩窄本节的全量 fail-closed preflight。

## 安全与失败

- Rovai 只替换能通过 Library identity 与 observation 证明为自身所有的 link。
- 普通目录、文件、外部 link、损坏或身份不匹配的 link 都按 project-owned/shadowed 处理，不覆盖。
- Revision 内容损坏、expected observation 缺失或 reconciliation 后仍 stale/error 时，Run preflight
  fail closed；Settings 的绿色状态不能放宽该门禁。
- removed root 在 preflight 的路径解析前拒绝，避免已移除的 Downloads/Documents/Desktop 路径再次
  触发权限访问。
- active Run 结束后的 removed-root cleanup 是唯一受限例外；完成或失败后保持 removed，不进入后续
  background schedule。
- Windows staging/final/backup 必须同父目录、同一 admitted NTFS volume；发布使用多阶段私有 journal，
  staging 的 volume/file identity 在 rename 后必须成为 final identity，old final identity 必须跟随 backup；每一步
  在 reopen/verify 后推进。journal、DB observation 与 opened identity/digest 无法唯一解释时，root 保持
  `skill_projection_recovery_required` 且不启动 Runtime。
- crash recovery 对 rename 后 journal 未更新、DB commit 后 metadata state 未更新均幂等；文件系统工作不放进
  长 SQLite transaction，project-owned 或 externally modified entry 永不静默覆盖/删除。

Migration 97 从已完整应用 Migration 96 的 Data Contract `v1.13 / projection schema 51` 安装 observation
`operation_id`、`entry_identity` 与 Windows Run registration，目标为 `v1.14 / projection schema 52`。Migration 96
继续只拥有 `agent_run.runtime_observed_model_id`；Migration 97 不改变 macOS link backend、ContextManifest 18 或
SkillExposureSnapshot schema 2。
