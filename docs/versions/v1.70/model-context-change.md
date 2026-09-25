---
document_type: model-context-change
change_id: skills-rebuild
version: v1.70
target_version: v1.70
revision: 5
confirmation_status: confirmed
confirmed_by: Principal (Camp message 1f13404e-14cc-4af6-acdb-6f1386e99e61)
confirmed_at: 2026-09-24T00:38:34+08:00
confirmed_revision: 5
implementation_status: in_progress
---

# Skills Rebuild：模型上下文变更说明 revision 5

本文件替代已确认的 revision 4。开发者已阅读并确认 revision 3（Camp 消息 `3966cd2d-13dc-4029-9376-99a213595d3a`），随后指定新增 `member-studio` 工具箱项并明确选择“所有队员开启”（消息 `ff2b5704-8387-4048-8784-2081b478dc87`）；在被告知这会形成 revision 4 后，明确回复“确认了，你直接继续”（消息 `b39cdc13-a4d0-488a-94e6-c9bc8f3c2b8d`）。开发者随后要求同步最新 main（消息 `586787f6-9fa6-435b-b114-47239c7b7fa2`）。main 已合入 v1.68 的公共历史变更，改变了本说明的变更前基线、版本轴与旧格式恢复边界；revision 5 的再次确认已记录于文末。

随后 main 将 Camp 主动读取作为 v1.69 合入。本 Skills 工作顺延为 v1.70；Camp 的显式工具结果变化不修改下文已确认的 Bootstrap、Dynamic Context、Formatter/Profile/Manifest 版本轴或冻结恢复语义。迁移 173 的 `v1.69`／schema 123 是此前本地构建已使用的持久数据合同标记，顺延产品版本不改写该标记。

## revision 4 → revision 5 的语义改动

| 事项 | revision 4 原计划 | revision 5 合并 v1.68 后的目标 |
| --- | --- | --- |
| 当前公开 Run 基线 | Manifest/Formatter 28、Profile 8、Run Facts 6，自动 `SHARED_CONVERSATION` | Manifest/Formatter 29、Profile 9、Run Facts 7，无自动 `SHARED_CONVERSATION`；必有 `RUN_FACTS.historyHint` |
| Charter | revision 12 | revision 13 的公开历史按需读取指导原文保留；Skills 不改 Charter 正文或 revision |
| 新公开 Run | Manifest/Formatter 29、Profile 9 | Manifest/Formatter 30、Profile 10；Run Facts 保持 7，Profile 10 的冻结 JSON 保持 v9 的 `{profileVersion,maxSelfActiveTasks}` 字段形状 |
| 新非 batch Run | Manifest/Formatter 27、Profile 7 | 保持同一目标 27/7；Run Facts 仍为 5 |
| 数据迁移 | 以 v1.67/schema 121 为源 | 以已发布 v1.68/schema 122 为源，新建 migration 173、v1.69/schema 123；保留 v172 的全部历史数据与约束 |
| 旧冻结 Run | revision 4 要求旧 v26/v28 均恢复 | v1.68 已明确退役的 v28 及更早公开格式继续不派发、不转换、不重播；升级时已冻结的 v29/9/7 输入按原字节和原证据允许有界恢复，不能在恢复时加 Skills section 或重算历史提示 |

以上是相对于 revision 4 的全部变更。v1.68 的 `camp.read` 默认 20、最大 100、排他 `before` 分页、历史边界推进条件及旧数据保留规则原样继承；Skills 本版不重写这些合同。固定平台两项、工具箱五项及 `member-studio` 全员默认开启等已确认设计不变。

## revision 3 → revision 4 的语义改动

| 事项 | revision 3 | revision 4 |
| --- | --- | --- |
| 工具箱闭合集 | `campfire`、`grill-duo`、`grill-duo-with-docs`、`review-duo` | 上述四项加 `member-studio`；平台两项仍不变 |
| 升级时队员配置 | 四项全部关闭 | 原四项全部关闭；`member-studio` 对所有现存队员开启 |
| 新建队员默认值 | 四项全部关闭 | 原四项关闭；`member-studio` 开启 |
| 后续显式修改 | 四项可按队员保存 | 五项均可按队员保存；显式关闭 `member-studio` 后重启不再自动打开 |
| 新 Run 动态索引 | 仅原四项的配置或本次选用 | 在默认状态增加 `member-studio` 的完整 `name + desc`；本 Run 冻结、后续修改与旧 Run 恢复规则不变 |

除上表外，revision 3 的固定 Bootstrap、结构化消息、原生来源、旧数据留存、Native Session 兼容、版本轴和验证边界保持原义。`member-studio` 只提供创建队员的方法，不授予队员新的创建权限，也不自动创建队员。

## revision 2 → revision 3 的语义改动

| 事项 | revision 2 | revision 3 |
| --- | --- | --- |
| 平台索引位置 | `SESSION_CHARTER` 内部，跟在 CLI 规则后 | 独立同级 `[ROVAI_PLATFORM_SKILLS]`，位于身份与 Memory Entrypoint 之间 |
| 平台索引集合 | 仅 `cli-operations` | `cli-operations` 与 `memory-stewardship`，按名称排序 |
| Bootstrap 结构 | 三个既有 section | 四个 section，Single Chat 仍省略 Memory Entrypoint |
| Charter 与身份正文 | Charter 插入索引文字 | Charter、身份、Memory Entrypoint 的现有正文保持原样 |
| 已有工具箱配置 | 原样继续使用 | 升级时清零，所有队员初始未勾选 |
| 旧导入 Skill | 旧 Library 记录与副本暂留 | 记录与受管副本继续保留，但退出新读取／投递路径；旧项目入口只在用户显式操作时按所有权处理 |
| 旧 Native Session | 保留 | 保留；冻结的旧 Bootstrap 不热改写 |

revision 2 中的动态 section 格式、选择来源、消息局部 `{name,path}`、同 Run 冻结、原址读取及旧引用保留，在不与上表冲突的范围内继续有效；它们已随 revision 5 确认为目标合同，实现状态以代码和验收证据为准。第六版 Skills／工具箱／会话交互稿的 UI 范围也仍是目标版本的一部分。

## 变更前：当前精确结构与选择

### 固定 Bootstrap

当前 `Native Session Bootstrap v4 / Formatter 4 / Session Charter revision 13` 的 section 顺序是：

```text
[SESSION_CHARTER]
<按 invocation、渠道、Adapter、Mission 条件生成的现有 Charter 正文>
[/SESSION_CHARTER]

[MEMBER_IDENTITY]
<现有六字段身份 JSON>
[/MEMBER_IDENTITY]

[MEMORY_ENTRYPOINT]
<现有有界 Memory 发现索引>
[/MEMORY_ENTRYPOINT]
```

最后一个 section 只在既有规则要求时出现；Single Chat 不输出它。普通 Camp 的 Charter 先输出 Authority boundaries，再接入 `crates/rovai-core/resources/charter-rovai-cli.md` 的完整 `Rovai Built-in CLI Contract`，最后按既有条件接入文件交付、Adapter 最终答复和 Mission 规则。Single Chat 取 `crates/rovai-core/resources/charter-rovai-single-chat.md` 的现有专用正文；其中只有允许的只读 Rovai 操作，不包含普通 Camp 的公开发送规则。当前两个分支均没有 `ROVAI_PLATFORM_SKILLS` section。现有 Bootstrap 字节和摘要按 Binding 冻结，compaction 后由既有 `ROVAI_BOOTSTRAP_REDELIVERY` 包裹重投。

现有 Charter 资源和 formatter 生成的正文在目标版本保持原有规则与字节；平台索引是下文明确给出的新增同级 section。Single Chat 不因此引入普通 Camp 的 CLI 规则。

### 动态 Context

普通 Camp／A2A／Single Chat 当前是 `Formatter 26 / Manifest 26 / Profile 6 / Run Facts 5`；公开 Camp batch 是 `Formatter 29 / Manifest 29 / Profile 9 / Run Facts 7`。当前完整相关 section 顺序分别为：

```text
[COLLABORATION_STATE]?
[SELF_ACTIVE_TASKS]?
[RUN_FACTS]
[WORKSPACE]?
[RUN_INPUT]
```

上述是公开 Camp batch；`RUN_FACTS.historyHint` 必有，`RUN_INPUT.messages` 保持完整 FIFO 当前输入，自动公屏历史 section 已移除。普通 Camp／A2A／Single Chat 的既有结构为：

```text
[COLLABORATION_STATE]?
[SELF_ACTIVE_TASKS]?
[SHARED_CONVERSATION]?
[RUN_FACTS]
[WORKSPACE]?
[A2A_GUIDANCE | SINGLE_CHAT_GUIDANCE]?
[CURRENT_INPUT]
```

当前没有 `ROVAI_ADDITIONAL_SKILLS` section。当前 `skill_mention` 保存 `{skillId,nameAtSend}`，正文 `/nameAtSend`；claim 时 `SkillSelectionSnapshot v1` 根据 Runtime Delivery Group、Library 状态和名称冻结每批选择，start 时以 Revision、enablement、SkillProjection／Exposure 解析。可用项只在选中该技能的消息上给出 `skills?: Array<{name:string,path:string}>`，无可用项时省略字段。公开 batch 的路径为 `RUN_INPUT.messages[].skills`，其他输入为 `CURRENT_INPUT.skills`。Manifest 冻结 Selection、Exposure、Resolution、消息映射和完整 rendered bytes/digest；旧输入按旧证据解释。

当前 Core 的 frontmatter 读取器是 `crates/rovai-core/src/skill.rs::parse_skill_frontmatter`：它按顶层逐行读取标量，尚未正确解析 YAML `>`／`|` 块字符串。这是达成下述完整 `desc` 规则所需的实现差距。

### 现有 Skills 存储

当前 Library 使用 `skill`、`skill_revision`、`skill_group_assignment`、`skill_projection_observation` 和 root state 等表，`skill.origin` 区分 `official` 与 `imported`；`enabled` 与 Runtime group assignment 是全局旧配置，并非新设计的“队员 × 工具箱技能”勾选。当前九项 official 分别是 `analyze-agent-codebase`、`campfire`、`cli-operations`、`memory-stewardship`、`member-studio`、`worktree`、`grill-duo`、`grill-duo-with-docs`、`review-duo`。旧导入项在私有受管根目录下有 Revision 副本，曾经的项目投递由独立 observation 记录所有权；原始用户 Harness 文件不归 Rovai Library 所有。旧 Camp 消息的 `skill_mention` 和已冻结 Manifest 可能仍引用这些旧 ID，不能把它们重解释成新技能。

## 变更后：完整目标模型输入

### 固定平台索引

新 Native Session Bootstrap 的**完整相关 section 顺序**如下；三个旧 section 的正文和各自既有出现条件不改：

```text
[SESSION_CHARTER]
<现有普通 Camp 或 Single Chat Charter 正文>
[/SESSION_CHARTER]

[MEMBER_IDENTITY]
<现有成员身份 JSON>
[/MEMBER_IDENTITY]

[ROVAI_PLATFORM_SKILLS]
{"root":"/Users/demo/.rovai/skills","skills":[{"name":"cli-operations","desc":"当不确定当前工作应使用 CampMessage、持久 Task、Camp/History 检索还是 Memory，需要由 Default Lead 并行征集多个成员后统一综合，普通消息是否应升级为 Task，一次业务事件需要协调多个 Rovai 操作，需要协调使命内容、状态与公开消息，或 CLI 返回后需要根据最新状态选择恢复动作时使用。普通单一操作及其具体收件人或参数应直接查看对应操作帮助，不要因此自动加载本 Skill。"},{"name":"memory-stewardship","desc":"当用户明确要求记住、更正或停止沿用某项长期信息，或当前内容包含会影响未来协作的稳定偏好、约定或经验时使用。先检查相关 Memory，再决定新增、修订、转交用户治理或不写入。临时状态、当前任务进度、项目事实、敏感信息和无依据推测不使用。"}]}
[/ROVAI_PLATFORM_SKILLS]

[MEMORY_ENTRYPOINT]
<现有 Memory Entrypoint；Single Chat 仍省略此段>
[/MEMORY_ENTRYPOINT]
```

尖括号是格式说明，不进入模型。示例 `root` 仅说明形状。正式第三段由 JSON 序列化器输出一行对象；`root` 来自实际执行 Host 的统一受管根解析入口，两项 `desc` 分别从该 Host 受管 `cli-operations/SKILL.md` 和 `memory-stewardship/SKILL.md` 的 YAML frontmatter 读取完整解析值，`name` 是稳定英文名并按名称排序。索引块内 `root` 只出现一次，无额外标题、通用教学或逐项绝对路径。工具箱配置变化不改变这个固定段。

`cli-operations` 与 `memory-stewardship` 是同一个 `[ROVAI_PLATFORM_SKILLS]` JSON 的两项，不分别建立 section。Memory Entrypoint 保持既有有界发现缓存与治理入口，不能因平台索引已包含 `memory-stewardship` 而删掉。Single Chat 也有该平台段，但索引只提供发现入口，不能扩展 Single Chat Charter 允许的 Rovai 操作。

### 逐 Run 动态工具箱索引

新生成的每个 Run 动态上下文（公开 Camp batch、普通 Camp、A2A、Single Chat）都输出 `ROVAI_ADDITIONAL_SKILLS`，没有省略分支。公开 Camp batch 的完整相关顺序为：

```text
[COLLABORATION_STATE]?
[SELF_ACTIVE_TASKS]?
[RUN_FACTS]
[WORKSPACE]?
[ROVAI_ADDITIONAL_SKILLS]
[RUN_INPUT]
```

普通 Camp／A2A／Single Chat 的完整相关顺序为：

```text
[COLLABORATION_STATE]?
[SELF_ACTIVE_TASKS]?
[SHARED_CONVERSATION]?
[RUN_FACTS]
[WORKSPACE]?
[ROVAI_ADDITIONAL_SKILLS]
[A2A_GUIDANCE | SINGLE_CHAT_GUIDANCE]?
[CURRENT_INPUT]
```

该 section 的**完整格式**是：

```text
[ROVAI_ADDITIONAL_SKILLS]
Current for this run; replaces any earlier Rovai Additional Skills.
{"root":"/Users/demo/.rovai/skills","skills":[{"name":"campfire","desc":"当用户希望 Camp 中多位成员共同讨论、从不同角度分析、比较方案、评估利弊或讨论后形成建议时使用。主持人发起和继续整理讨论，成员在收到本次讨论任务时也使用。普通单人问题、无关发言、迟到补充和已经结束的讨论不使用。"},{"name":"member-studio","desc":"当用户希望创建新的 Rovai 队员，或继续调整、确认本次创建中尚未写入的队员名牌和头像方案时使用。普通成员资料咨询、编辑已创建队员，以及只设计角色或头像但不加入名册的任务不使用。"}]}
[/ROVAI_ADDITIONAL_SKILLS]
```

空集合时仍完整输出：

```text
[ROVAI_ADDITIONAL_SKILLS]
Current for this run; replaces any earlier Rovai Additional Skills.
{"root":"/Users/demo/.rovai/skills","skills":[]}
[/ROVAI_ADDITIONAL_SKILLS]
```

`skills` 是**当前接收队员长期配置的工具箱技能 ∪ 本 Run 当前输入中明确选用的工具箱技能**，按稳定英文 `name` 去重并确定性排序。工具箱闭合集是 `campfire`、`grill-duo`、`grill-duo-with-docs`、`member-studio`、`review-duo`；旧 Library 的 `enabled` 或 Runtime group assignment 不自动转成队员勾选。默认状态下每位队员的索引含 `member-studio`；显式关闭后，若本次消息没有选用它，则下一 Run 不再包含。显式选用不写入长期配置，不按消息的 `@` 接收者或该队员是否配置过此技能排除。`cli-operations`、`memory-stewardship`、其余 bundled Skill、旧导入 Skill 和 Harness 原生 Skill 不属于这个动态集合。Runtime 同时以原址提供某技能，也不使它从集合中消失。每个新 Run 使用当前选用事实形成一个完整新列表；没有增量 `add/remove/changed`、`SKILL_CHANGES` 或第二条提醒。`root` 在此块只出现一次，可与独立固定块分别各出现一次。

`root` 必须是执行 Host 的绝对受管根，不使用前台机器路径、硬编码用户名或模型侧 `~` 展开。每个 `{name,desc}` 只对应受管 `SKILL.md` frontmatter：`name` 为经验证与目录同名的稳定英文名，`desc` 为标准 YAML 解析后的完整 `description` 字符串值。解析后不截断、翻译、摘要或二次折叠空白；JSON 序列化器处理中文、引号、反斜杠和换行。配置或选用的受管 Skill 若在准备时缺源、不可读或 frontmatter 无效，不能编造 `desc` 或改绑同名来源；Core 保留消息选用事实与发送，模型索引只列成功读取的项，并在 Manifest 机器证据中记录该项未索引及原因。若因此输出 `skills:[]`，它只表示本 Run 没有**可索引**的工具箱项，不宣称队员配置也为空。此失败边界需要在确认本 revision 时一并接受。

### 消息局部选用与来源

新结构化选用仍保留 `skill_mention {skillId,nameAtSend}` 与正文 `/nameAtSend`，但 `skillId` 是来源身份，不以相同 `name` 混合 Rovai 受管项与用户／项目原生项。同一实际文件多入口按目标归并；同名不同入口保留不同身份。旧 UUID 引用按历史来源解析，不能按新同名项猜测。新 Selection／Resolution 证据的完整目标 shape 为：

```ts
type SkillSelectionSnapshotV2 = {
  schemaVersion: 2
  entries: Array<{
    skillId: string
    nameAtSend: string
    source: 'rovai' | 'native' | 'legacy'
    sourcePath: string | null
    firstMessageIndex: number
    firstSegmentIndex: number
  }>
}
type SkillResolutionV2 = {
  schemaVersion: 2
  selectionSnapshotDigest: string
  entries: Array<{
    skillId: string
    nameAtSend: string
    source: 'rovai' | 'native' | 'legacy'
    sourcePath: string | null
    outcome: 'available' | 'unavailable'
    reason?: 'source_missing' | 'source_unreadable' | 'legacy_unresolved'
  }>
}
type ModelSkillLink = { name: string; path: string }
```

`sourcePath` 来自 Core 已发现或历史冻结的绝对入口，不接受客户端任意路径。Selection 按本批消息顺序和 segment 顺序对来源身份首次出现去重；Resolution 对冻结身份给出可用性，不宣称模型已读取。缺源、不可读或旧引用无法解析时，保留正文和结构化事实，发送与协作资格不受阻，模型局部链接按既有可用路径规则省略。

模型可见 `RUN_INPUT.messages[].skills` 或 `CURRENT_INPUT.skills` 仍为可选 `Array<{name,path}>`：`name` 是发送时冻结名称，`path` 是选中来源的实际 `SKILL.md` 入口；每条消息按本条第一次选用顺序去重。只有成功取得可用路径时才有链接。明确选用的原生 Skill 可在消息局部链接出现，但从不进入两个 Rovai 索引。即使受管 Skill 已通过某 Runtime 原址加载，消息局部显式选用链接仍保留。链接只给出入口，不宣称模型已读取，也不授予额外工具、权限或协作资格。

### 升级时的数据 clean break

应用安装包本身不扫描或删除用户目录。安装新版后，在 Core 首次启动的数据库迁移与 Skill 子系统准入阶段建立新的“队员 × 五项工具箱 Skill”配置；**不迁移**旧 `skill.enabled`、Runtime group assignment 或历史 UI 选择。迁移对每位现存队员只插入 `member-studio`，原四项不插入，因此初始关闭。以后新建队员时同样默认插入 `member-studio`，其余四项关闭。用户可以显式关闭任一队员的 `member-studio`；迁移可重入，Core 重启不得再次插入或重置其后修改的配置。未配置任何工具箱项的空列表格式仍可通过用户显式关闭全部五项产生。

旧 `origin='imported'` 的 `skill`／`skill_revision` 记录、受管 `revisions/<skillId>/<revisionId>` 内容和审计证据**保留**，不在更新、启动或后台执行中自动删除。当前本机日常实例使用 `~/Library/Application Support/Rovai-ai/rovai.sqlite` 保存记录；其受管内容实际落在兼容旧路径 `~/.lumen/skills/revisions/`，因为首选 `~/.rovai/skills` 不存在。其他 Host、隔离实例或 Windows 使用各自的显式根目录，不能硬编码这些本机路径。用户原生 Harness Skill 文件仍在自己的原址，Rovai 只读发现，不迁移、不删改。

新 Skills 设置页只读选定 Runtime 的原生用户级来源；会话 `/` 候选读取五项工具箱的队员配置，以及当前成员环境中发现的用户级与项目级原生 Skill。旧导入 Library 行不会因此成为候选、平台项或动态工具箱项；如果同一原始文件也由 Harness 原生发现，它以**原生来源身份**出现，不按旧 Library UUID 自动继承。旧 `analyze-agent-codebase`、`worktree` 等不在新平台两项／工具箱五项内的 bundled 项亦不主动索引或投递；仓库源文件与历史记录保留。`member-studio` 的默认配置只影响指南发现；现有成员创建的确认与权限流程仍须按原规则验收。

旧 Library 曾在项目目录创建 Rovai 自有 SkillProjection 链接或副本。新 Run 停止新建这类投递；升级和 Core 启动不扫描或删除项目文件，仅按 Navigation 中明确移除的项目同步 root access，保留 `skill_projection_observation` 供候选排除与用户后续核对。新原生候选读取继续排除已登记的旧 Rovai 投递入口，避免旧导入项经项目扫描重新进入候选。用户自行清理时应逐项确认归属；后续诊断与修复中的显式清理必须按 observation、所有权校验、active-Run 保护和 root access 规则处理**仅 Rovai 创建的项目投影**，不可访问或无法确认的入口保留，不能按名称扫删用户项目文件。冻结的旧 Run、Manifest 和历史引用继续按旧字节解释；新 Run 遇旧 Library ID 仅保留意图与历史来源，不能静默映射到同名原生文件。

### 冻结、预算与恢复

首次准备新 Run 时，Core 在同一 preparation 边界读取队员工具箱配置、本批输入选用、执行 Host 受管根和 frontmatter，序列化并冻结**完整 section 精确文本及 digest**；Manifest 同时冻结 Selection／Resolution、每消息链接和整个 rendered payload bytes/digest。同 Run 重试、恢复和已有冻结投递只使用冻结值，不重读随后变更的配置来替换该 Run 的索引。冻结的是索引文本，不是整个 Skill 文件目录；Agent 后来按入口读取的正文仍为当时受管目录内容。

完整固定动态 section 参与现有 payload 字节计算，不能截断 section 或当前输入来凑预算。普通 Profile 6 升为 7，维持普通 Run 现有数值上限；公开 batch Profile 9 升为 10，维持 v9 的 `{profileVersion,maxSelfActiveTasks}` 冻结 JSON shape 和任务上限。公开 Run 不重新引入 v1.68 已移除的自动公屏历史预算或 section。两条路径继续保证 FIFO 当前输入优先与完整消息选择；新增 section 的实际字节占用通过新 Profile 的证据可追溯。超预算仍按既有 `context_payload_too_large` 纪律处理。

Compaction 保留当前 Bootstrap 包裹文本、ACK、去重和重投机制；新 Binding 的四段 Bootstrap 补发时包含其冻结的 `ROVAI_PLATFORM_SKILLS`，旧 Binding 仍补发其冻结的旧三段 Bootstrap。若 Core 重新投递某 Run 输入，复用其已冻结的完整 payload，因此使用相同动态索引。原生 Runtime 在**已接受的单次 Run 内部**自行 compaction 时，现有 Core 不会另发一条只含 Skills 的消息；该场景不靠重放整个 `[CURRENT_INPUT]`／`[RUN_INPUT]` 制造第二次任务。后续新 Run 获得按新配置重新计算的索引；既有 Bootstrap redelivery 如发生，继续恢复该 Binding 冻结的 Bootstrap。这里的保证是 Core 控制的交付字节不漂移，原生模型内部摘要能否保留索引须以 Runtime 实测覆盖陈述。

## 明确不变

以下不变边界与兼容版本轴是本 revision 的组成部分。

- `MEMBER_IDENTITY`、`MEMORY_ENTRYPOINT`、现有 Charter 平台规则、Single Chat 权限、Run Facts 5/7、v1.68 的 `historyHint`、历史/Task/引用/附件选择和预算数值保持现有业务语义。Skill 只提供指引，不能改变接收者、工具、权限或参与资格。
- 新 Binding 的 Bootstrap 合同／Formatter 从 v4／4 升到 **v5／5**，增加同级平台 section；Charter 正文不变，Session Charter revision 保持 **13**。动态普通 Camp／A2A／Single Chat Formatter／Manifest 从 26／26 升到 27／27，公开 batch 从 29／29 升到 30／30；Delivery Profile 按上文升到 7／10。结构化 Skill Selection／Resolution 升 v2。Bootstrap Evidence 独立冻结平台 section 的精确 bytes/digest 并纳入完整 Bootstrap 摘要；新 Manifest 冻结动态 section bytes/digest。
- 当前 `native_binding_context_contract()` 把 Bootstrap v4／Formatter 4、Charter revision 和动态 Formatter／Manifest 一同纳入兼容性摘要。目标实现须将仅由本次**新增平台 section／动态格式**造成的旧摘要差异作为有界兼容别名，保留旧 Binding 的原 Session 与 v4 Bootstrap Evidence；新建 Binding 使用 v5。别名须逐项核对 Adapter、安装、Camp／成员身份和其他实际不兼容字段，不能笼统忽略摘要差异。其他真正不兼容的 Runtime／Bootstrap 条件仍轮换。
- 已存在的 Native Binding 保持原 v4 Bootstrap Evidence、旧 Charter／身份／Memory 字节；旧会话的后续**新 Run**可以接收新动态 section，但新增 `ROVAI_PLATFORM_SKILLS` 只随自然新建 Binding 的 v5 Bootstrap 到达。旧会话若 compaction，仍补发原冻结 v4 Bootstrap，不能热插入新 section 或伪造一次 compaction。此限制是“继续旧会话”和“Bootstrap 冻结”同时成立的直接结果，须作为验收边界明确接受。
- 旧 Manifest／已冻结或正在投递的旧输入保留原字节、版本与证据；旧格式缺少新 section 是合法历史，不批量回填或因缺段判损坏。v1.68 已退役的公开 v28 及更早格式继续按其合同不派发、转换或重播；对于 v1.68 已冻结的公开 v29／Profile 9／Run Facts 7 和非 batch v26／Profile 6／Run Facts 5，目标实现按精确已知版本组合及完整证据增加有界恢复准入，复用原 payload 而非生成新 Skills section。真实不可恢复的旧证据错误仍按当前恢复纪律处理。Library、Revision、历史选用和审计文件不批量搬迁或删除；新 Run 的受管 Skill 不继续依赖项目投递 Exposure，旧项目投影保留至用户显式处理。
- 当前第六版交互稿的只读 Skills 页、队员工​​具箱配置、会话 `/` 来源选择、错误与恢复状态及 32 个候选上下文缓存属于同一目标版本的其他实现范围。缓存是 Core 实例内非模型可见的候选读取优化，不能替代 Run 冻结或改变 Session 生命周期。

## 验证

以下是可执行验证与关键负向案例。

1. Golden prompt：新 Camp、Mission、A2A 与 Single Chat 的 `[ROVAI_PLATFORM_SKILLS]` 准确位于身份后、可选 Memory 前；Charter 和身份原文字节不变，固定平台项恰为两项；两个索引的 JSON 各只有根目录一次；Single Chat 省略 Memory Entrypoint 且权限不扩展。
2. YAML：用引号、反斜杠、中文、`>` 折叠块和 `|` 保留换行块构造 frontmatter，解析后与标准 YAML 字符串值逐字相同；反序列化模型 JSON 后仍相同。解析失败不降级成误导性空集合。
3. 集合：升级时旧 global enabled／group 配置不迁入新队员表，各现存队员及今后新建队员只默认开启 `member-studio`，原四项关闭；用户显式关闭后重启不重置；配置增删在下一 Run 全量生效；关闭全部五项产生固定提醒及 `skills:[]`；未长期配置的消息显式选用进入本 Run 但不改变长期配置；两项平台技能、其他 bundled、旧导入与原生 Skill 都不进入动态集合；Runtime 原址加载不改变集合；`name` 排序确定。
4. 来源：相同名字的原生／受管、用户／项目 Skill 保持身份和局部路径；旧 UUID、旧导入引用、失效路径、项目切换、部分读取失败保留原选择意图，不把同名另一项当成它；新 Skills 页只读 Harness 原址；未配置技能的队员正常接收协作消息。
5. 冻结：Run A 冻结后取消配置，同 Run 重试和 Core 恢复的 index bytes/digest 不变，Run B 得到新集合；旧 v29／v26 Manifest 按旧冻结字节和证据有界恢复，v28 及更早公开格式仍不派发；旧 Binding 保留 v4 Bootstrap 且后续新 Run 得到动态索引，compaction 仍重投旧 v4；新 Binding 使用 v5 四段 Bootstrap，并在 compaction 重投相同四段。
6. 迁移与交付：从 v1.68/schema 122 迁至 v1.69/schema 123；旧 `imported` 记录和受管 Revision 内容在升级前后计数／摘要一致；升级和 Core 启动不删项目投影，旧入口继续从原生候选排除，active Run、不可访问 root 和用户同名文件均获保护；新 Run 不新建投影。普通与 batch 新 Profile、v1.68 的历史提示、首次 payload、后续 input、compaction Bootstrap 补发、超预算、ACK/去重均保留一次任务语义；不得额外重放当前输入。覆盖隔离 Home、远程 Host 实际根路径及多 Runtime。
7. 真实任务 Gate：使用[双轨评测通用集](../../development/evaluation.md#上下文改动-gate)的 12 Case、至少三位明确配置的队员；冻结基线和候选 checkout、Case、模型、权限、预算、Judge 与标准。默认各运行一次；协议与边界硬规则全通过、无质量/协作回归且无不可解释证据缺口。无真实 Runtime/Judge 条件时报告未运行或证据不足，不用单测冒充 Gate。

## 阶段性实施验证记录

- 实际模型输入版本为 Bootstrap v5／Formatter 5、普通 Manifest／Formatter 27／27、公开 batch Manifest／Formatter 30／30、Delivery Profile 7／10、Skill Selection／Resolution v2；Session Charter revision 13、Run Facts 5／7 和 v1.68 的 `historyHint` 保持不变。
- 数据迁移从 v1.68/schema 122 到 v1.69/schema 123；当前迁移准入矩阵、v172 历史上下文保留、新写入门禁及旧 v26／v29 冻结输入恢复的定向测试通过。新增投递附件授权触发器允许精确的 v26／v27／v29／v30 组合，已排除新 v27／v30 被旧触发器拒绝的失败路径。
- `cargo test -p rovai-core --lib` 为 376 通过、0 失败、1 忽略；`cargo check -p rovai-core -p rovai-web --lib`、`cargo fmt --all -- --check`、`pnpm typecheck`、合入 main 后 Renderer Vitest 2197 项、Skills 与文档定向检查通过。基线与候选的 `current-contract-conformance@1.69.0` 均为 16／16 通过；此结果只覆盖合同断言，不代表真实任务 Gate。
- 隔离 `userData` 的打包 macOS App 在合入 main 后重新验收，Day／100% 与 Night／200% 均通过原生 Skill 只读预览、五项工具箱默认配置、开关写入和恢复、窄视口布局检查；验收时使用合成 Home，没有触及日常 App 数据。
- 首次完整真实任务对照固定基线 `56e2b8ad`、候选 `168d7d3c`，12 Case × 新旧两侧共 24 个槽位实际执行。报告结论为 `degraded`：17 条回归记录（其中 1 个新增耗时回归槽位）、11 条证据缺口、4 个 Judge 执行失败。候选 DEMO-105 的 `report.json` 将 `rejected` 写成对象，而验收器期望按字母排序的名称字符串数组，硬验收失败；DEMO-103～106 的协作最低要求在两侧均未满足，DEMO-107 两侧均有交付失败。CLI Judge 对带引号的动态原文 `enum` 返回 `invalid_json_schema`，且其模型别名不能证明固定提供方快照。
- 评测器对动态引号／反斜杠 `enum` 的处理已在后续提交修复：保留来源 ID 约束，原文改由现有 `applyClaimAudit` 在响应后核对；19 项定向测试通过，真实失败证据包生成的新 schema 不再含该不兼容 `enum`。此修复不改变上述已冻结 Gate 结果；固定 Judge 配置、协作／交付失败及新增耗时回归仍需重新评测收口。`implementation_status` 保持 `in_progress`。

## 二次确认记录

`confirmation_status: confirmed`；`revision: 5`；`confirmed_revision: 5`。revision 3 的完整说明及首次确认见消息 `3966cd2d-13dc-4029-9376-99a213595d3a`；revision 4 加入 `member-studio` 并经消息 `b39cdc13-a4d0-488a-94e6-c9bc8f3c2b8d` 确认。revision 5 在完整说明发送并请求二次确认后，开发者于消息 `1f13404e-14cc-4af6-acdb-6f1386e99e61` 回复“看起来就是把她删除公共消息区的内容适配了一下，没问题”，确认按该 revision 继续实施。确认涵盖合入 v1.68 后的公开历史基线、版本轴、数据迁移源与旧 v29 恢复边界。
