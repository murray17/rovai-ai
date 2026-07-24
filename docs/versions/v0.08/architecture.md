---
document_type: version-architecture
version: v0.08
lifecycle: current
authority: version-architecture-and-protocol
last_updated: 2026-07-24
---

# Lumen AI v0.08 Skill Library 架构与协议

> 状态：设计与实施均已完成
>
> 版本范围：[README.md](README.md)
>
> 跨版本边界：
> [ADR-0017](../../adr/0017-managed-skill-library-runtime-projection.md)
>
> 相关约束：
> [ADR-0001](../../adr/0001-core-transaction.md)、
> [ADR-0009](../../adr/0009-reproducible-context-delivery.md)、
> [ADR-0013](../../adr/0013-managed-content-and-read-side-v2.md)、
> [ADR-0016](../../adr/0016-multi-runtime-execution-v2.md)

## 1. 目标与边界

v0.08 增加一个由 Lumen 管理、对 Lumen 内 Agent 全局可用的本机 Skill Library。
Skill 保持目录形态，由 `AgentRuntimeAdapter` 投影到 AgentRun 执行根中的 Runtime
原生项目级入口。Runtime 继续负责发现、选择和渐进加载 Skill；Lumen 不把
`SKILL.md` 正文重复拼入每轮 Prompt。

本版本必须同时满足：

- 导入后不依赖来源目录；
- 不写入 Runtime 用户级目录；
- 不覆盖项目已有 Skill；
- 一个 Skill 更新不会原地改写 Agent 正在读取的目录；
- 启用 Skill 不授予脚本或工具额外权限；
- App 重启后可以仅凭 SQLite、受管目录和执行根现状恢复；
- 大厅与项目 Camp 使用同一套执行根协议；
- 当前 Native Session 不因 Skill 更新被自动重建。

v0.08 不实现：

- 在线技能市场或远程仓库同步；
- Skill 编辑器、Revision 历史页或回滚；
- 按 Agent、Camp 或项目分配 Skill；
- Runtime 用户级安装；
- 每 Session 独立 Skill 根；
- Skill 专属信任、审批或 Capability 模型；
- 用 Prompt 注入模拟不支持原生 Skill 的 Runtime。

## 2. 领域词汇与不变量

### Skill

Lumen Skill Library 中的稳定身份。`name` 在 Library 内唯一，`enabled` 只表示
是否进入 Lumen 全局目标暴露集合。

### SkillRevision

一次完整 Skill 目录的不可变快照。Revision 包含 `SKILL.md`、脚本、References、
Assets 和文件模式等内容，使用内容摘要识别。更新必须创建新 Revision。

### SkillProjection

一个 SkillRevision 在某个 `executionRoot` 的 Runtime 原生项目级入口中的
受管文件系统投影。它是可重建的运行观察，不是第二个 Skill 真源。

固定不变量：

```text
Skill != SkillRevision != SkillProjection

Skill.enabled
    表示 Library 的目标状态。

Skill.currentRevisionId
    表示当前目标内容。

执行根中的实际链接
    表示 Runtime 当前能够发现的内容。

ContextManifest.skillExposure
    表示该 AgentRun 开始时 Lumen 实际观察到的暴露结果。
```

- 一个 Skill Name 只能对应一个稳定 Skill。
- 一个 Revision 一经发布不得修改。
- 一个项目入口只能在 Lumen 能证明所有权时更新或删除。
- 项目自有同名内容始终优先于 Lumen 投影。
- SkillProjection 的存在不证明 Runtime 或模型已经读取 Skill。
- 启用、投影、读取和执行是四件不同的事。

## 3. 内容存储

### 3.1 根目录

Skill 内容固定存放在：

```text
~/.lumen/skills/
├── .staging/
└── <skill-id>/
    └── revisions/
        └── <revision-id>/
            └── content/
                ├── SKILL.md
                ├── scripts/
                └── references/
```

- 根目录和暂存目录使用仅当前用户可访问的权限。
- 最终 Revision 目录只通过完整暂存、校验和原子 Rename 产生。
- 路径以稳定 ID 组织，不把用户可变名称当作唯一文件系统身份。
- Skill 仍存在时保留其全部 Revision 内容；v0.08 不提供回滚 UI。
- 删除 Imported Skill 时，排空运行和投影后删除全部 Revision。

Skill 目录不是 `ManagedBlobStore` 的替代品。Skill 需要保留目录结构、相对路径和
脚本可执行位，因此使用独立的 `SkillLibraryStore`；MessageAttachment、
ContextManifest Payload 和其他不可变单文件仍由 ADR-0013 的 Managed Blob
边界管理。

### 3.2 Bundled Skills

应用资源只打包：

```text
grill-me
grill-with-docs
```

两者必须自包含：

- `grill-me` 自身携带完整 Grilling 规则；
- `grill-with-docs` 自身携带 Grilling、Domain Modeling、
  `CONTEXT.md` 和 ADR 格式 References；
- 不额外暴露 `grilling` 或 `domain-modeling` Skill。

首次启动时，Core 通过与用户导入相同的校验和 Revision 发布路径安装 Bundled
内容。应用升级发现同名 Bundled Skill Digest 改变时创建新 Revision，但保留
用户已经选择的启用状态。Bundled Skill 不能由用户更新或删除。

### 3.3 受管目录篡改

`~/.lumen/skills` 是可检查但不可原地编辑的受管存储。Core 在发布、启动扫描和
投影前验证 Revision Digest：

- 内容未变：正常使用；
- Imported Revision 内容被手工修改：标记 `corrupted`，停止新投影；
- Bundled Revision 内容被手工修改：从应用资源重新发布受信任 Revision；
- 不把手工修改静默吸收成新 Revision。

用户修改 Imported Skill 必须重新导入来源目录并确认更新。

## 4. SQLite 数据模型

Migration v19 增加以下最小表。字段名是协议意图，实施可以在不改变语义的前提下
调整物理索引和约束名称。

```ts
type Skill = {
  id: string;
  name: string;                    // Library UNIQUE
  sourceKind: "bundled" | "imported";
  enabled: boolean;
  lifecycleStatus: "active" | "deleting";
  currentRevisionId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletionRequestedAt: string | null;
};

type SkillRevision = {
  id: string;
  skillId: string;
  name: string;
  description: string;
  contentDigest: string;
  sourceMetadata: unknown;
  riskSummary: SkillRiskSummary;
  fileCount: number;
  totalBytes: number;
  installedAt: string;
};

type SkillProjectionObservation = {
  executionRoot: string;
  nativeRootKind: "agents" | "claude" | "antigravity";
  skillId: string;
  revisionId: string;
  entryPath: string;
  state:
    | "ready"
    | "stale"
    | "shadowed"
    | "unsupported"
    | "pending_removal"
    | "error";
  lastErrorCode: string | null;
  lastObservedAt: string;
};
```

必要约束：

- `skill.name` 唯一；
- `skill_revision(skill_id, content_digest)` 唯一；
- 当前 Revision 必须属于同一个 Skill；
- Bundled/Imported 来源类型创建后不改变；
- 删除中的 Skill 不允许重新启用或创建新投影；
- Projection Observation 不得成为启用状态或 Revision 的权威真源。

`context_manifest` 增加不可变 `skill_exposure_json` 和
`skill_exposure_digest`。Camp Snapshot/Context Inspector 合约升级到 Schema v5，
展示每个 AgentRun 实际观察到的：

```ts
type SkillExposureEntry = {
  skillId: string;
  name: string;
  revisionId: string;
  contentDigest: string;
  nativeRootKind: string;
  status: "ready" | "stale" | "shadowed" | "unsupported" | "error";
  entryPath: string | null;
  reasonCode: string | null;
};
```

该记录不证明 Runtime 已经加载 Skill 正文。

## 5. 导入协议

### 5.1 两阶段导入

导入必须先检查、再确认：

```text
用户选择目录
→ Electron Main 返回本地路径
→ Core InspectSkillImport
→ 校验并复制到私有 Staging
→ 返回候选名称、描述、Digest、来源和风险摘要
→ 用户确认
→ CommitSkillImport(commandId, stagingToken, expectedDigest)
→ 原子发布 Revision
→ SQLite 事务提交 Skill/Revision/event_log
→ 后续最佳努力 Reconcile
```

`InspectSkillImport` 是无副作用读取/暂存操作，不创建 Skill。`stagingToken` 只引用
Core 私有目录，具有短期过期时间；过期或 App 重启后的孤儿 Staging 由启动扫描
删除。

提交前重新验证 Staging Digest。文件系统先把完整不可变目录原子移动到最终位置，
随后由 ADR-0001 的 `DomainCommandGateway` 提交元数据和 `command.result`。
SQLite 失败留下的无引用 Revision 目录由启动 GC 清理；不得为了文件系统事务
增加通用 Outbox。

### 5.2 发现范围

- 选择直接包含 `SKILL.md` 的目录时，只产生一个候选。
- 选择集合目录时，只检查其一级子目录是否直接包含 `SKILL.md`。
- Skill 内部内容可以递归复制，但不能把更深层的 `SKILL.md` 自动解释为独立 Skill。

### 5.3 校验

每个候选必须满足：

- `SKILL.md` 是普通文件；
- Frontmatter 包含有效 `name` 与 `description`；
- Name 与顶层目录名一致，并满足跨 Runtime 的安全名称格式；
- 所有内容都位于候选目录内；
- 只包含普通文件和普通目录；
- 不包含符号链接、Socket、FIFO、设备节点或其他特殊节点；
- 文件数量、递归深度、单文件大小和总大小不超过 Core 常量；
- 复制后文件模式和脚本可执行位与检查结果一致；
- Digest 覆盖规范化相对路径、内容和相关文件模式。

实现默认上限由具名常量控制并覆盖边界测试，初始建议值：

```text
最大文件数       1,000
最大递归深度     32
最大单文件       10 MiB
最大 Skill 总量  50 MiB
```

这些值是本版本实现参数，不是跨版本领域不变量。

### 5.4 同名行为

```text
同名 + 同 Digest
    → 幂等成功，不创建 Revision。

同名 Imported + 不同 Digest
    → UI 明确确认更新，创建新 Revision。

同名 Bundled
    → 拒绝用户导入。

不同名称
    → 创建新 Imported Skill，默认 enabled=false。
```

更新 Imported Skill 不原地改写旧 Revision。

## 6. Runtime 原生投影

### 6.1 执行根

投影统一作用于 AgentRun 的 `executionRoot`：

```text
项目 Camp
    → 本地项目/Git 执行根

大厅 Camp
    → <Core data_dir>/lobby
```

大厅不会因此获得用户项目文件访问权。

### 6.2 最小目录覆盖

```text
.agents/skills/<name>/
    Codex、OpenCode、Copilot

.claude/skills/<name>/
    Claude Code

.agent/skills/<name>/
    Antigravity
```

不额外创建 `.opencode/skills` 或 `.github/skills`。一个 Skill 的全部等价入口都
解析到同一个 Revision。Adapter Registry 提供稳定的
`SkillDiscoveryCapability`，至少包含支持状态和所需 Native Root Kind；能力缺失
必须显式呈现。

一个执行根需要的 Native Root 集合，由使用该执行根的活跃 CampMember/
Conversation Adapter 并集确定。AgentRun 启动前必须至少校验当前 Adapter 所需入口。

### 6.3 持续 Reconcile

触发点：

- Core 启动；
- Bundled 安装或升级；
- Imported Skill 导入、更新、启用、禁用或删除；
- CampMember/Runtime Adapter 配置改变；
- 已知执行根重新出现；
- 每个 AgentRun 启动前；
- 用户从诊断页显式重试。

Reconcile 从 `Skill.enabled + currentRevisionId + executionRoot + Adapter
requirements` 派生期望状态，检查实际文件系统后更新 Observation。IPC Wake 只用于
加速；应用重启后必须能通过扫描恢复。

入口创建使用同目录临时链接和原子 Rename。Lumen 不接管整个 `skills` 目录。

### 6.4 所有权证明

Lumen 只有同时满足以下条件时才能更新或删除入口：

1. 路径是文件系统链接，而不是普通文件或目录；
2. 链接目标位于 `~/.lumen/skills/<skill-id>/revisions/<revision-id>/content`；
3. Skill/Revision 在 SQLite 中存在且 Digest 验证通过；
4. Projection Observation 与实际入口一致。

Observation 丢失但链接仍能解析到有效受管 Revision 时，可以重建 Observation。
目标未知、链接损坏或内容不匹配时不得猜测所有权，必须标记冲突并保留现场。

### 6.5 项目冲突

同名入口已经存在非 Lumen 内容时：

- 不覆盖、不删除；
- 不创建第二个竞争入口；
- 标记 `shadowed`；
- AgentRun 降级继续；
- ContextManifest 记录未暴露的 Revision、路径和原因；
- UI 提供冲突诊断。

### 6.6 Git 本地排除

对 Git 执行根，Lumen 使用 `git rev-parse --git-path info/exclude` 定位本地排除文件，
并只维护如下受管区块中的具体入口：

```text
# BEGIN LUMEN MANAGED SKILL PROJECTIONS
/.agents/skills/grill-me
/.claude/skills/grill-me
# END LUMEN MANAGED SKILL PROJECTIONS
```

- 不修改版本化 `.gitignore`；
- 不忽略整个 Runtime 配置目录；
- 不改写受管区块之外的内容；
- 失去入口所有权时立即移除对应排除项；
- 非 Git 执行根不创建 Git 排除。

## 7. 并发、Revision 切换与 Native Session

### 7.1 AgentRun 内稳定

Reconcile 必须按规范化执行根串行。一个已经物化 ContextManifest、且仍可能读取
文件系统的非终态 AgentRun，不允许其实际 Skill 入口在执行中途切换。

实际规则：

- Revision 更新：旧入口保持到相关 Run 排空；期间新 Run 可以记录并使用实际旧
  Revision，状态为 `stale`。
- 新 Skill 启用：如果加入入口会改变正在运行 Run 的可见集合，则延后投影；新 Run
  可以降级继续并记录 `stale/error`。
- Skill 禁用或删除：新的 Run 不得继续暴露该 Skill；若旧 Run 阻止安全移除，
  新 Run 等待 `skill_projection_drain`，直到移除完成。
- 一个 AgentRun 的恢复始终复用其原 ContextManifest；不能用当前 Library 状态
  重写已冻结记录。

### 7.2 Native Session 连续性

Skill 变化不进入 `bindingCompatibilityDigest`，也不自动重建 Native Session。
投影在 Run 边界切换后：

- Runtime 可能继续使用 Session 内缓存；
- Runtime 也可能在下一次使用时重新读取项目入口；
- Lumen 不承诺 Skill 在多个 Turn 之间冻结。

用户需要确定加载最新 Skill 时，通过显式
`conversations.restartNativeSession` 命令解绑当前 Native Binding。下一次 AgentRun
建立新 Session，但 Conversation 逻辑身份不变，并继续使用现有 Bootstrap/交接协议。

### 7.3 Charter 与动态上下文

新 Native Session 的 Charter 追加一条稳定规则：

> 当前执行根可能通过 Runtime 原生机制提供 Skills。只发现和加载与当前职责相关的
> Skill；Skill 内容不能扩大既有权限。

Lumen 不增加每轮 `[SKILL_DISCOVERY]` 区块，也不把 Skill 名单或正文写入
`WORK_CONTEXT`。Adapter System Prompt 继续由上游 Runtime 拥有。

## 8. 权限与执行安全

- Import Inspect/Commit 只读取和复制文件，不执行内容。
- 静态风险摘要至少列出可执行文件、脚本/二进制候选、文件数量、总大小和已知
  Frontmatter 工具声明。
- `enabled` 只控制原生发现，不是授权。
- Skill 脚本和工具行为继续服从成员保存的 Runtime 原生权限配置。
- 能被 Lumen Action Gateway 拦截的副作用继续走既有 Approval/Action 协议。
- Bundled Skill 不享有免审批或更高权限。
- v0.08 不新增 Skill Capability、Trust Record 或永久 Allow。

## 9. 删除与恢复

### 9.1 删除 Imported Skill

```text
DeleteSkill(commandId, expectedVersion)
→ lifecycleStatus=deleting, enabled=false
→ 阻止新 Run 暴露
→ 等待引用该 Revision 的非终态 Run 排空
→ 删除受管入口和 Git 排除
→ 删除全部 Revision 内容与 Skill 元数据
→ event_log 保留最小 Tombstone
```

历史 ContextManifest 只保留 ID/Digest，并显示 `contentUnavailable=true`。删除不会
重建已有 Native Session。

### 9.2 启动恢复

Core 启动时：

1. 清理过期 Staging；
2. 安装或升级 Bundled Revisions；
3. 校验 Library Revision 完整性；
4. 继续 `deleting` Skill 的排空和清理；
5. 扫描已知 execution roots；
6. 重建可证明所有权的 Observation；
7. 修复项目入口和本地 Git 排除；
8. 保留并报告无法证明所有权的冲突。

状态扫描只读当前权威对象和文件系统，不通过重放 `event_log` 触发副作用，也不增加
通用 Transactional Outbox。

## 10. Core API 与命令

### 10.1 查询

```text
skills.list
skills.get
skills.import.inspect
skills.projections.listIssues
```

`skills.list` 直接从 SQLite Skill/Revision 与确定性 Observation 生成 DTO，不建立
持久 Read Model 数据库。

### 10.2 写命令

```text
skills.import.commit
skills.setEnabled
skills.delete
skills.reconcile
conversations.restartNativeSession
```

所有写命令使用 ADR-0001 的 Command Envelope：

```ts
type SkillCommandEnvelope = {
  commandId: string;
  expectedVersion?: number;
  // command-specific payload
};
```

重复 `commandId + 相同规范化请求` 返回原结果；冲突请求返回
`idempotency_conflict`。文件系统步骤使用 Revision Digest、稳定最终路径和
受管链接目标保证幂等。

### 10.3 Electron 边界

Renderer 不获得任意文件系统能力：

- Electron Main 显示“选择 Skill/集合目录”原生 Dialog；
- Core 对 Main 返回的路径重新验证；
- “在 Finder 中显示”由 Main 根据 Core 返回的受管 Skill 身份执行；
- Preload 只暴露具名 API，不暴露 `ipcRenderer`、Shell 或任意路径写入。

## 11. 设置 UI

应用一级“成员”入口保持不变。设置内部顺序：

```text
技能
外观
诊断
```

技能页必须覆盖：

- Loading、Empty、Error；
- Bundled/Imported 来源；
- Enabled/Disabled/Deleting/Corrupted；
- 当前 Revision 安装时间；
- 已知 Adapter 兼容提示；
- Projection Conflict/Unsupported/Error；
- 单目录导入与集合预览；
- 更新确认；
- 启用、禁用、删除；
- Finder 检查入口；
- 操作中的 Disabled/Busy 和版本冲突重载。

删除必须使用明确确认 Dialog。启用和更新失败不得乐观保留错误状态。Runtime 与
Adapter 用户文案统一为中文，稳定产品名、Adapter ID、命令和原生参数值保留原文。

## 12. 可观测性

技能页、诊断页和 Context Inspector 分别回答：

```text
Library
    当前安装、启用和目标 Revision 是什么？

Projection
    某执行根实际暴露了什么？是否冲突、陈旧或不支持？

ContextManifest
    某 AgentRun 开始时观察到了哪些 Revision 和暴露结果？
```

建议事件：

```text
skill.imported
skill.revision_published
skill.enabled
skill.disabled
skill.delete_requested
skill.deleted
skill.corrupted
skill.projection_reconciled
skill.projection_conflict
native_session.restart_requested
```

事件用于审计和 UI 失效，不作为重建 Skill 或 Projection 状态的唯一真源。
