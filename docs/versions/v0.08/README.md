---
document_type: version-overview
version: v0.08
lifecycle: current
authority: version-scope-and-status
last_updated: 2026-07-24
---

# Lumen AI v0.08 Skill Library 与 Runtime 原生发现

> 状态：已完成（检查点 5/5）
>
> 文档规则：[文档导航](../../README.md)
>
> 前置版本：[v0.07 Hearth & Camp 双主题视觉系统](../v0.07/README.md)
>
> 跨版本约束：[ADR 索引](../../adr/README.md)

## 版本目标

v0.08 为设置区增加 Skill 管理能力，让用户把目录型 Agent Skill 导入
Lumen 管理的全局 Skill Library，并由 `AgentRuntimeAdapter` 按各 Runtime
实际支持的原生项目级机制提供给 Agent。

本版本的产品与架构决策已经闭合。本文记录版本范围和决策摘要；
[架构与协议](architecture.md)定义实现边界，
[实施计划](implementation-plan.md)定义检查点和验收门。

## 已确认决策

### SK-01 Lumen 全局管理、Runtime 项目级暴露

- Lumen 拥有独立的应用全局 Skill Library；导入成功后不依赖原始来源目录继续存在。
- “全局”只表示对 Lumen 管理范围内的 Agent 可用，不表示安装到用户机器上的
  Runtime 个人配置。
- Lumen 不写入或链接到 `~/.agents/skills`、`~/.claude/skills`、
  `~/.copilot/skills` 及其他 Runtime 用户级 Skill 目录。
- Skill 由 Adapter 暴露到项目级原生入口；路径、持续投影、冲突和清理遵循
  SK-10～SK-14。
- Lumen 外部独立启动的 Agent 不保证能看到 Lumen Skill。

### SK-02 Skill Library 内容根目录

- Lumen Skill Library 的内容根目录固定为 `~/.lumen/skills/`。
- 每个 Skill 在该目录中保留完整目录内容，包括 `SKILL.md` 及其可选脚本、
  References、Assets 和其他支持文件。
- Skill 元数据、启用状态和管理记录继续进入现有 Lumen SQLite；`~/.lumen`
  不建立第二套数据库、事件日志或 Runtime 状态真源。
- 导入成功后，原始来源目录可以移动或删除，不影响 Lumen 管理的副本。
- Runtime 项目级入口只引用 Lumen 管理的内容，不反向依赖导入来源。

### SK-03 Skill 身份与不可变修订

- `Skill` 表达稳定身份、Library 内唯一名称、启用状态与当前 Revision。
- `SkillRevision` 是一次完整 Skill 目录内容的不可变快照，至少具有稳定 ID、
  内容摘要、来源类型、来源元数据和安装时间。
- 用户重新导入、Bundled Skill 升级或其他内容更新必须创建新 Revision，
  不得原地覆盖 Agent 可能正在读取的目录。
- 项目级 Runtime 入口必须引用一个明确 Revision，不能读取正在写入的临时目录。
- v0.08 UI 仍以一个 Skill 一行展示，不增加通用版本管理页面。
- Skill 存在期间保留其旧 Revision 内容，但 v0.08 不提供回滚 UI；Native Session
  兼容遵循 SK-14。

### SK-04 导入与启用分离

- 用户 Skill 导入成功后创建受管 Skill 与 Revision，但默认保持禁用。
- 只有用户显式启用后，该 Skill 才能进入项目级 Runtime 暴露集合。
- 导入界面必须在启用前展示可核对的名称、描述、来源和风险摘要。
- Lumen 随应用提供且经过产品审核的 Bundled Skill 可以默认启用。
- Bundled 与 Imported Skill 复用同一展示、Revision 和项目级暴露机制，
  但来源与默认启用策略必须明确可见。

### SK-05 最小 Bundled Skill 集合

- v0.08 只随 Lumen 提供 `grill-me` 与 `grill-with-docs` 两个 Bundled Skill。
- Skill 名称保持原样，不增加 `lumen-` 前缀，也不以产品文案重命名目录或
  Frontmatter Name。
- v0.08 不额外 Bundled Worktree、TDD、Debug、Code Review、计划执行或
  Team 协作 Skill；用户需要时可以自行导入。
- 两个 Bundled Skill 必须按 SK-06 自包含打包，不能发布缺少 References 的内容。

### SK-06 Bundled Skill 自包含

- `grill-me` 保持现有名称，但把完整 Grilling 访谈规则纳入自身目录，
  不再依赖另一个可发现的 `grilling` Skill。
- `grill-with-docs` 保持现有名称，并在自身 References 中携带 Grilling、
  Domain Modeling、`CONTEXT.md` 与 ADR 格式规则。
- `grilling` 和 `domain-modeling` 不作为额外 Bundled Skill 暴露给 Runtime。
- Bundled Skill 不允许依赖另一个未随自身安装、也未声明为产品依赖的用户 Skill。
- 自包含只改变打包结构，不改变两个 Skill 的产品名称和用户调用入口。

### SK-07 全 Adapter 开放与原生语义

- 一个全局启用的 Skill 对所有具备项目级 Skill 发现入口的 Adapter 开放，
  Lumen 不因 Frontmatter 支持差异过滤某个 Adapter。
- Lumen 保留 Skill 的原始 Frontmatter 和内容，不为不同 Adapter 改写出多份
  语义近似的 SkillRevision。
- 某 Runtime 忽略 `disable-model-invocation`、`allowed-tools` 或其他扩展字段时，
  以该 Runtime 的原生行为为准；Lumen 不承诺跨 Runtime 调用控制完全一致。
- UI 可以展示已知兼容提示，但提示不阻止用户启用或 Adapter 项目级暴露。
- Adapter 完全不具备可验证的原生 Skill 发现入口时，仍必须明确报告能力缺失，
  不能把 `SKILL.md` 正文退化为每轮 Prompt 注入来伪造支持。

### SK-08 Library 名称唯一与同名导入

- Skill Name 在整个 Lumen Skill Library 内唯一，不能同时存在两个同名 Skill。
- 同名且内容摘要相同的重复导入是幂等成功，不创建新 Skill 或 Revision。
- 同名 Imported Skill 的内容不同时，UI 必须明确展示“更新现有 Skill”；
  用户确认后为原 Skill 创建新 Revision，不创建平行同名记录。
- 用户导入不得覆盖 Bundled Skill。与 Bundled Skill 同名时拒绝导入，并提示
  用户修改目录名与 `SKILL.md` Name 后重新导入。
- Bundled Skill 的新版本只能由受信任的 Lumen 应用升级流程创建 Revision。

### SK-09 自包含导入边界

- 支持选择一个直接包含 `SKILL.md` 的 Skill 目录，或选择集合目录并只扫描
  其一级子目录；不无限递归发现嵌套 Skill。
- Skill 内容只允许普通文件和普通目录；脚本可保留可执行位。
- Skill 包内部出现符号链接、Socket、FIFO、设备节点、路径逃逸或其他特殊节点时，
  整个候选 Skill 导入失败。
- 不跟随符号链接复制外部内容，也不保留依赖原始来源目录的链接。
- `SKILL.md` 必须具有有效的 `name` 和 `description`，Name 必须与顶层目录名一致。
- 导入必须具有文件数量、单文件大小和总大小上限；具体数值属于可调整实现参数，
  在实施计划中确定，不提升为领域语义。
- 这些限制只约束被导入的 Skill 包，不禁止 Lumen 为 Runtime 项目级发现入口创建
  自己管理的链接。

### SK-10 Camp Execution Root 统一暴露

- Skill 的项目级暴露统一以 `AgentRun.executionRoot` 为边界，不为大厅建立另一套
  Skill 发现协议。
- 项目 Camp 使用其本地项目执行根，并由 Adapter 暴露到对应 Runtime 的原生
  项目级 Skill 入口。
- 大厅 Camp 复用现有由 Core 管理的 Lobby 执行根
  `<Core data_dir>/lobby`；不为每个大厅 Camp 额外创建 Workspace。
- 大厅获得的是全局启用 Skill 的原生发现入口，不因此获得任何用户项目目录、
  Git Workspace 或额外文件访问权限。
- 当前所有大厅 Camp 共享同一个 Lobby 执行根；由于 v0.08 只有 Lumen 全局启用
  范围，它们共享同一组 Skill 暴露结果符合既定语义。

### SK-11 持续投影与运行前校验

- Runtime 原生 Skill 入口采用执行根内的持续投影，不在每次 AgentRun 前后反复
  挂载和卸载。
- Skill 启用、更新或禁用后，Core 对已知相关 `executionRoot` 发起最佳努力的
  增量 Reconcile；Wake Signal 只用于加速，不是正确性真源。
- 每次 AgentRun 启动前必须重新校验该 Adapter 所需的 Skill 入口，并修复缺失、
  过期或尚未完成的受管投影；校验失败时不得假装 Skill 已可用。
- Lumen 只创建和管理具体 Skill 的入口，不接管 Runtime 的整个 `skills` 目录。
- 禁用、卸载或 Revision 切换时，只能更新或删除可证明由 Lumen 创建且仍指向
  Lumen 受管内容的入口；同名用户内容不得清理或覆盖。
- 持续投影避免共享执行根中的并发 AgentRun 与长期 Native Session 因临时
  Mount/Unmount 相互竞争；项目 Git 状态遵循 SK-12。

### SK-12 仓库本地 Git 排除

- Lumen 不修改项目版本化的 `.gitignore`，也不要求用户提交 Lumen 全局 Skill
  的本地投影入口。
- 对 Git 执行根，Lumen 在仓库本地 `info/exclude` 中维护带有明确 Lumen 标记的
 受管区块，只列出 Lumen 实际创建的具体 Skill 入口。
- 不允许通过该机制忽略整个 `.agents`、`.claude`、`.agent` 或其他 Runtime
  配置目录，避免遮蔽用户自有项目配置。
- Skill 入口被删除、禁用或失去 Lumen 所有权时，Reconcile 必须同步移除对应
  排除项；不得修改受管区块以外的用户规则。
- 非 Git 执行根不创建排除配置。设置界面应说明该行为只影响本机 Git 状态，
  不会写入或提交项目 `.gitignore`。

### SK-13 最小原生目录覆盖

- 一个执行根只维护当前支持矩阵所需的最小原生目录集合：
  - `.agents/skills/` 供 Codex、OpenCode 与 Copilot 共用；
  - `.claude/skills/` 供 Claude Code 使用；
  - `.agent/skills/` 供 Antigravity 使用。
- v0.08 不同时生成语义重复的 `.opencode/skills/` 或 `.github/skills/` 投影。
- 同一个 Skill 在多个原生目录中的入口必须解析到同一个不可变
  `SkillRevision`，不得为不同 Adapter 生成内容不同的副本。
- 会扫描多个兼容目录的 Runtime 必须通过真实 Runtime Smoke 验证同名、同内容、
  同 Revision 入口不会产生歧义。若 Runtime 提供原生搜索目录约束，Adapter
  可以用它消除重复发现。
- 某 Runtime 无法稳定处理等价入口时，Adapter 必须明确报告能力降级或不支持；
  不允许通过静默改名、复制并改写内容来掩盖冲突。

### SK-14 Native Session 连续性优先

- Skill 启用状态或当前 Revision 改变时，Lumen 不自动失效、解绑或重建已有
  Native Session。
- 同一个 AgentRun 执行期间不得切换其执行根中的 Skill 投影；待该 Run 结束后
  才能 Reconcile 到 Library 的最新目标状态。
- 已有 Native Session 后续使用缓存内容还是重新发现最新项目入口，由对应
  Runtime 的原生语义决定；Lumen 不承诺 Skill 内容在多个 Turn 之间冻结。
- `ContextManifest` 记录 AgentRun 开始时由 Lumen 暴露的 Skill 与 Revision，
  作为可观测输入清单，但不将其解释为 Runtime 已经读取正文的证明。
- 用户需要确定应用最新 Skill 时，可以显式重启该 Conversation 的 Runtime
  Session；Conversation 的逻辑身份与历史连续性不变。
- v0.08 不为严格锁定旧 Revision 引入每 Session 独立 Skill 投影或独立
  `executionRoot`。

### SK-15 Charter 一次性 Skill 提醒

- Lumen 不在每个 AgentRun 的动态 Prompt 中重复注入 `[SKILL_DISCOVERY]` 区块，
  也不把全部 Skill 名称、描述或正文附加到 `WORK_CONTEXT`。
- 新 Native Session 的 Charter 只增加一句稳定说明：当前项目可能通过 Runtime
  原生机制提供 Skills，应按任务相关性发现并按需加载。
- 具体暴露的 Skill 与 Revision 只进入 `ContextManifest`，用于观测和审计，
  不将该记录解释为 Runtime 已向模型展示或已经读取正文。
- Runtime 原生发现仍是唯一执行入口。Adapter 无法原生发现 Skill 时必须报告
  能力缺失，不能用重复 Prompt 提醒伪造支持。
- 该规则避免长期 Native Session 在每个 Turn 中重复收到相同提醒，也降低
  Agent 为使用 Skill 而使用 Skill 的偏置。

### SK-16 技能页最小操作范围

- 技能页以一个 Skill 一行展示名称、描述、来源、启用状态、已知兼容提示和
  当前 Revision 安装时间。
- 用户可以选择一个直接包含 `SKILL.md` 的目录导入单个 Skill，也可以选择
  集合目录并扫描其一级子目录。
- Imported Skill 支持显式启用、禁用、同名确认更新和删除。
- Bundled Skill 支持启用与禁用，但不能由用户手动更新或删除；内容更新只随
  受信任的 Lumen 应用升级进入新 Revision。
- 用户可以在 Finder 中打开 Lumen 受管 Skill 目录，以检查 `SKILL.md`、脚本和
  References 等实际内容。
- v0.08 不提供 Skill 内容编辑器、Revision 历史页面、回滚、按 Agent 或项目
  分配、远程目录或在线技能市场。

### SK-17 设置导航边界

- “成员”继续保留为应用左侧一级入口，不迁入设置，也不在设置内增加重复入口。
- 设置内部增加二级导航，并按“技能、外观、诊断”组织。
- Runtime 安装、Adapter 可用性与通用本机依赖状态归入“诊断”；单个成员实际
  使用的 Adapter、模型和原生权限仍在成员编辑页配置。
- 技能页是 Lumen 全局 Skill Library 的管理入口，不归属于某个成员、Camp 或
  项目页面。
- Runtime 相关设置和诊断界面统一使用中文用户文案；底层命令、Adapter ID 和
  原生参数值可以保留其稳定技术名称。

### SK-18 Imported Skill 彻底删除

- 删除 Imported Skill 是内容删除，不是归档；Bundled Skill 仍不可删除。
- 用户确认删除后，Skill 立即进入不可用于新 AgentRun 的删除排空状态，新的
  ContextManifest 和项目投影不得再包含它。
- 已经运行的 AgentRun 不被中途切断；待相关 Run 结束后，Reconcile 删除所有
  可证明由 Lumen 管理的项目入口及对应本地 Git 排除项。
- 排空完成后删除 Skill 管理记录及其全部 Revision 目录，不为历史回放保留
  `SKILL.md`、脚本、References 或 Assets 正文。
- `event_log` 只保留 Skill 名称、Revision ID、内容摘要、操作者和删除时间等
  最小审计事实。历史 `ContextManifest` 保留原 Revision ID/Digest，并明确
  标记其内容已不可用。
- 删除不自动重建已有 Native Session；旧 Session 后续尝试读取已删除入口时，
  按 Runtime 原生失败语义处理。

### SK-19 Skill 不授予额外权限

- 导入过程只读取、验证并复制文件，不执行 Skill 中的脚本或其他可执行内容。
- 启用只代表允许 Adapter 将 Skill 暴露给 Runtime，不代表用户批准其中声明或
  建议的任何副作用。
- Skill 脚本、Shell、网络、文件与其他工具行为继续受当前成员的 Runtime 原生
  权限配置及 Lumen 已有 Approval/Action 安全边界约束。
- `allowed-tools` 等 Frontmatter 字段只按 Runtime 原生语义生效，不能扩大
  AgentProfile、Camp 或 AgentRun 已有权限。
- Bundled Skill 也不获得免审批特权。
- 技能页可以展示静态风险摘要，但 v0.08 不建立 `trusted`、`allow_always`
  或 Skill 专属 Capability/权限模型。

### SK-20 当前仅有全局启用

- v0.08 只使用 `Skill.enabled` 表达 Lumen 全局启用，不增加
  `scope: global | agent | project` 字段。
- “为未来作用域预留”只表示保持稳定 `skill_id` 和清晰关系边界，不建立空表、
  隐藏配置或尚无行为的枚举。
- 未来确有按成员或项目分配需求时，应增加独立的 `SkillAssignment` 或
  `SkillActivation` 关系，以支持一个 Skill 同时关联多个目标。
- 未来设计不得为了 Skill 作用域倒逼 v0.08 提前建立 Project 领域实体。

### SK-21 项目内容优先、运行降级继续

- 项目原生 Skill 入口已存在同名非 Lumen 内容时，Lumen 不覆盖、不删除，也不
  把它登记为自己的投影。
- 项目自有内容保持其 Runtime 原生优先级；对应 Lumen Skill 在该执行根标记为
  `shadowed/conflict`，不创建第二个竞争入口。
- 单个可选 Skill 冲突不阻止 AgentRun 启动。AgentRun 以降级状态继续，其
  `ContextManifest` 必须记录 Lumen Revision 未暴露、冲突路径和原因。
- 技能页与诊断页展示冲突；用户改名、移动或删除冲突内容后，下一次 Reconcile
  可以恢复 Lumen 投影。
- Lumen 不把项目自有同名 Skill 伪装成 Library 中的 Revision，也不对其内容、
  权限或兼容性作出保证。

## 已闭合版本范围

以下范围已经由上述决策闭合：

- 设置区增加“技能”入口，并收拢成员、外观和诊断的页面关系。
- 导入单个 Skill 目录，或扫描集合目录的一级子目录。
- 新 Native Session 的 Charter 只提供稳定 Skill 提醒，具体暴露清单进入
  `ContextManifest`，不重复注入 `SKILL.md` 正文。
- 当前只实现 Lumen 全局启用；未来通过独立关系扩展 Agent/项目作用域。

## 实施文档

- [架构与协议](architecture.md)
- [实施计划与验收](implementation-plan.md)
- [ADR-0017：受管 Skill Library 与 Runtime 原生投影](../../adr/0017-managed-skill-library-runtime-projection.md)
