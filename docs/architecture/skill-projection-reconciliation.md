---
document_type: architecture
architecture: skill-projection-reconciliation
authority: skill-projection-access-and-reconciliation-boundaries
status: accepted
last_updated: 2026-08-31
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
与全部当前 Skill Delivery Groups 的 Assignment，命令边界拒绝修改；其余十二项 official Skill 为
`user_managed`。当前 inventory 为十四项，名称、固定来源、默认启用值和管理策略由
[`BUNDLED_SKILLS`](../../crates/rovai-core/src/skill.rs)统一声明。该策略只决定 Library desired
state，不改变 projection ownership、preflight、Snapshot 或 Runtime load 证明。

TRAE delivery group 的 Rovai-owned root 固定为项目 `.trae/skills`。该路径已用唯一名称/内容在
`traecli 0.120.52` 上同时验证新 Session 的 `available_commands_update` 和精确 `/skill` 调用；warm Host 的新
Session 与 cold `session/load` 都重新扫描，既有 Idle Session 未观察到动态 refresh。TRAE 还会兼容扫描项目
`.agents/skills`、项目 `.traecli/skills` 以及若干用户目录，但它们是 Runtime 自有 discovery surface，不进入
Rovai projection、ownership、reconcile 或 cleanup。

`available_commands_update` 只属于 Runtime-advertised catalog。它把内建 Slash Command 与已加载 Skill 统一为
command entry，不能替代 SkillExposureSnapshot，也不能由“advertised”推导文件投递成功；反向地，managed
projection 的 Ready 也不保证某个已经存在的 Session 动态刷新 catalog。

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

Renderer 不能直接调用 `skills.projectAccess.*`。Main process 以同一事务队列串行 Navigation preference 的
读取、pin 替换、Project 移除和恢复，使一次操作跨越 preference 与 Core 往返期间不会向其它请求暴露中间
snapshot。Project 移除先关闭 Core access，再提交本机 Navigation preference；偏好写入失败时按偏好中的
权威状态恢复 Core access。Project 恢复先读取事务前 snapshot；只有其中确实存在该 removed record 时才进入
恢复事务，原本 active 或从未 removed 的 root 直接返回前态且不调用 Core。恢复事务先持久化恢复偏好，但在
请求完整成功返回前继续让 Core ledger 和 Core 重启参数保留 `removed`，随后才激活 Core access，最后直接从
本次提交 snapshot 发布新的 removed-root 集合。Core 激活失败时，Main 先重新关闭 Core access，再恢复包含
原 `removedAt` 的精确前态；补偿不完整必须显式失败，不得吞掉错误。该 ledger 不引入 Project table、
Project aggregate 或 Camp 删除语义。

Renderer 在 removed-Project preference 成为权威前，不得显示 Project 导航、启用 Project 选择/提交动作，
或把缓存的 current Project 交给 `workspaces.inspect`；New Conversation 的目录控件以中性 loading/disabled
状态说明正在确认本机 Project access，Quick Chat 创建仍可继续。已移除 Project 只能由用户重新选择目录或在
新对话中显式选择 workspace 后恢复；
窗口启动、上次 Camp 恢复和普通 Camp 打开不得隐式恢复 root access。恢复请求成功并返回新的 Navigation
preference snapshot 前，Renderer 继续保持访问门关闭；失败时不得以仅当前会话可见的方式乐观放行。

Main 在启动 Core 时把 Navigation preference 中完整的 removed-root 集合作为显式启动参数传入，Core
在创建 AgentRun scheduler 前完成 DB-only ledger 同步。每次移除完成，或恢复的偏好持久化与 Core 激活
均完成后，Main 才同步更新 `CoreClient` 保存的启动参数副本。因此 Core 自动重启也不会短暂把已移除
root 当作 active，或把已经完整恢复的 root 再次标为 removed。

## Bundled bootstrap 与完整性门禁

Authority ready 后，optional Skill bootstrap 先短暂持有数据库锁读取并规范化 Library metadata，
随后在 blocking worker 中从 embedded bundled definitions 计算 expected digest，并完成所有目录检查、
物化、哈希、fsync 和文件发布；这些文件操作不占用共享数据库锁，不阻塞 Composer Draft 或 Pending 准入。
准备完成后重新持有短锁，核对规划时的 Skill identity、current Revision 和 version/configuration 仍未变化，
仅提交 metadata 和 dirty 标记。整个过程由既有 subsystem initializer 串行化，Skill consumer/Runtime
执行门禁直到 bootstrap 与必要的恢复完成后才开放。准备或提交失败保持门禁关闭；未注册的完整 Revision
沿用成功 bootstrap 后的 orphan cleanup，不把文件存在误当作 Library 已提交。

数据库 current digest 与
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
| 用户显式修复 | 读取仍 active 的当前 Camp/active Run requirements | 可逐 root 审计并 reconcile；可退役已登记的旧 `.lumen` 断链；removed roots 排除 |

Core 的 AgentRun scheduler 不包含 Skill interval，也不持有 Skill filesystem watcher。其他私有
subsystem 的 interval（例如 App `userData` 下的 MCP projection cleanup）不能被视为 Skill root access。

### 旧 `.lumen` link 退役边界

旧 `.lumen` Revision 不再作为 projection link 的兼容目标。只有用户显式调用 `skills.reconcile` 时，
Reconciler 才可在逐 entry reconcile 前删除一个同时满足以下条件的入口：

1. DB Observation 已登记同一 execution root、delivery group、Skill 和精确 `entry_path`；
2. 当前入口自身是 symlink，且目标因不存在而不可解析；
3. 目标没有 `.` / `..` 绕行，并严格为 `$HOME/.lumen/skills/revisions/<UUID>/<UUID>`；
4. 当前 root 仍 active，并来自显式修复的 known-root requirements。

删除后仍由普通 desired/undesired reconcile 决定重新发布或移除 Observation。AgentRun preflight、terminal
reconcile、Project cleanup 与普通读取继续采用 preserve policy；普通文件、目录、可解析外部链接、其他断链和
未被 Observation 证明的入口仍视为 project-owned，不能删除或覆盖。

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
`operation_id`、`entry_identity` 与 Windows Run registration，目标为 `v1.15 / projection schema 52`。Migration 96
继续只拥有 `agent_run.runtime_observed_model_id`；Migration 97 不改变 macOS link backend、ContextManifest 18 或
SkillExposureSnapshot schema 2。
