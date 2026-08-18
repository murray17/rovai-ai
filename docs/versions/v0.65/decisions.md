---
document_type: version-decisions
version: v0.65
lifecycle: historical
last_updated: 2026-08-18
---

# v0.65 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0165](#adr-0165) | Core-Owned Current-User Message Attention | `accepted` |
| [ADR-0166](#adr-0166) | Progressive Built-In CLI Teaching | `accepted` |
| [ADR-0167](#adr-0167) | Seven-Skill Official Inventory | `superseded` |
| [ADR-0169](#adr-0169) | Core-Owned Directory Attachment Snapshots | `accepted` |

<!-- legacy-adr:begin id=ADR-0165 source-file-sha256=163690b80dc9d458e27c562d77cfd708c379bc63744e0a7b183ebb06ce544fdc -->
<a id="adr-0165"></a>

## ADR-0165: Core-Owned Current-User Message Attention

迁移时原路径：`docs/adr/0165-core-owned-current-user-message-attention.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0165
title: Core-Owned Current-User Message Attention
status: accepted
date: 2026-08-12
decision_scope: cross-version
source_version: v0.65
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0165 -->
<a id="adr-0165-context"></a>
### Context

Agent 已能用 `--to` 与 inline Agent Addressing Token 发布公共消息并唤醒队员，但没有一种安全、
可审计的方式明确提醒当前用户。把 `@你` 当正文模式会混淆普通文字与身份引用；只在 Renderer 加样式
会在重载、Context、search 和通知之间分叉；把 user ID 暴露给 Agent 则会提前引入未认证的多用户
routing。若通知在消息提交后由 Renderer 或 event consumer 补建，崩溃和重放还会留下消息与用户注意力
不一致的双写窗口。

现有数据内部使用过 `local-user` literal，但本版本产品决定把当前本地用户的唯一 canonical identity
固定为 `local_user`。同时，Agent recipient 会产生 Message Delivery、AgentRun 和 A2A budget，用户
注意力只需要结构化正文和持久 Inbox；把两者塞进同一个 recipient set 会制造虚假的 Delivery 与 Task
cardinality。

<a id="adr-0165-decision"></a>
### Decision

1. 本版本的唯一 Current User identity 是 Core-owned `local_user`。Agent 只提交
   `mentionUser: true` / `--to-user`，不能提交 user ID、alias、`me` 或 `user`；Renderer 也不推断身份。
2. Agent routing 与 User attention 是两个正交轴。`to` 与 strict inline Agent tokens 形成
   Effective Agent Recipients、Message Delivery 和 A2A responsibility；`mentionUser` 形成
   `current_user_mention(local_user)` 与 User Mention Notification，永远不创建 Delivery 或占用 slot。
3. Structured Camp Message Content 墠加 closed Current User Mention segment。CampMessage 内容的唯一
   权威是有序 Structured Content；Agent 的 submitted body 只保留为 command input/evidence，所有可见
   body、search、Context、Clipboard、摘要与 accessibility 都从 Structured Content 投影。
4. `mentionUser=true` 的接受事务原子创建 CampMessage、Current User Mention、每个 Agent recipient
   的 Delivery/slot 和一条 `camp_message_user_mention` Notification。Notification recipient 固定为
   `local_user`，source 固定为同一 message；唯一键为 kind + recipient + source message。
5. Durable replay 复用原消息、segment、identity、notification 和 Deliveries。显示名称只影响当前
   presentation；不得改变 semantic digest、持久 identity 或 replay。
6. `taskId` 继续要求恰好一个 Effective Agent Recipient，Current User Mention 不计入该集合。
   exact CampMessage read 增加分离的 Agent recipient 与 `mentionsCurrentUser` 安全投影；compact send
   output 不增加 user 字段。
7. `local-user → local_user` 采用 clean break。Rovai-owned incompatible data、projection 和 frozen
   Context 可以清理或重建，不保留 alias、双 reader 或双 writer；用户 Project 与 Runtime-owned data
   不在清理范围。

本决策细化 ADR-0087 的通知来源键与原子生成、ADR-0128 的 Structured Content 模型、ADR-0130 的
Public Message/Delivery 分离和 ADR-0135 的 compact output；这些 ADR 的其余边界保持生效。

<a id="adr-0165-consequences"></a>
### Consequences

- 消息、Mention 与通知只有一个接受点，崩溃或幂等重放不会产生幽灵通知或裸 Mention；
- 普通正文 lookalike 永远只是 Text，用户和 Agent 可以从结构与 exact read 判断真实 attention；
- Renderer、search、Context 和 Clipboard 必须共享 Core projection 语义，不能继续把持久 `body` 当成
  可独立修改的真源；
- Notification schema、Camp read、Context Formatter/Manifest、Data Contract、CampSnapshot 和 Built-in
  Transport 都需要发布新版本；
- 固定单用户使本版本可验证，但未来多用户必须通过新 ADR/合同引入 authenticated binding，不能把
  `mentionUser` 偷换成 Agent-selected ID。

<a id="adr-0165-rejected-alternatives"></a>
### Rejected Alternatives

- **解析 `@你`、显示名或 `@local_user`。** 普通文字会因语言、改名或巧合变成 mutation，无法稳定
  区分视觉 Mention 与真实通知。
- **把当前用户加入 Effective Recipients。** 会伪造 Message Delivery、Task recipient、A2A budget 和
  AgentRun，混淆人类 attention 与执行责任。
- **Renderer 创建或补偿通知。** 无法与 Core CampMessage 同事务提交，重载和多窗口会分裂身份、已读
  与幂等状态。
- **Agent 提交 user ID。** 当前没有 authenticated multi-user binding；可变 ID 会扩大攻击与兼容面，
  同时破坏唯一当前用户决定。
- **在 Agent success output 增加 `userMentioned`。** 原子接受已由 `messageId` 表示；增加布尔值会扩大
  compact projection，却不能在 indeterminate/no-locator 场景提供权威确认。
- **保留 `local-user` alias 双读。** 会让同一用户拥有两个 durable identity，并把 clean break 变成
  永久兼容层。

<a id="adr-0165-references"></a>
### References

- [v0.65 版本目标](README.md)
- [v0.65 实现规格](implementation-spec.md)
- [ADR-0087: Core-Owned Durable In-App Notification Inbox](../v0.28/decisions.md#adr-0087)
- [ADR-0128: Structured Draft-Only User Message Submission](../v0.43/decisions.md#adr-0128)
- [ADR-0130: Public A2A Messages and Unified Delivery](../v0.45/decisions.md#adr-0130)
- [ADR-0135: Compact Agent Output](../v0.46/decisions.md#adr-0135)
- [Camp Message Send v5](../../contracts/camp-message-send-v5.md)
- [Camp Message Send v4 (historical)](../../contracts/camp-message-send-v4.md)
- [Current User Attention v1](../../contracts/current-user-attention-v1.md)
<!-- legacy-adr-body:end id=ADR-0165 -->
<!-- legacy-adr:end id=ADR-0165 -->

<!-- legacy-adr:begin id=ADR-0166 source-file-sha256=f9194157d815a6e31b2524fb666201c20fe5b63fd7420de5e9ca6050b659299b -->
<a id="adr-0166"></a>

## ADR-0166: Progressive Built-In CLI Teaching

迁移时原路径：`docs/adr/0166-progressive-built-in-cli-teaching.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0166
title: Progressive Built-In CLI Teaching
status: accepted
date: 2026-08-12
decision_scope: cross-version
source_version: v0.65
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0166 -->
<a id="adr-0166-context"></a>
### Context

Session Charter 当前同时承担命令清单、输出义务和部分操作指导，容易随字段增加而膨胀；反过来，若
把所有 CLI 决策放进一个宽触发 Skill，普通 send/read/search 也会加载长工作流。CLI 真实 parser 只有
root help、`rovai send --help` 和完整 group+action help；教学中使用 `rovai task --help` 之类不存在的
family entry 会让 Agent 在需要恢复时先遇到第二个错误。

现有 `memory-stewardship` 已拥有完整 Memory authority、安全、cache state、revision 和限制规则。用一份
精简 CLI 文档整体替换它会丢失治理语义。CLI 教学因此需要按稳定全局边界、具体 operation 参数和少数
跨 operation 决策分层，同时保留业务领域 Skill 的既有权威。

<a id="adr-0166-decision"></a>
### Decision

1. Built-in CLI 教学分为三层：Session Charter 只给稳定全局边界；每个 operation 的精确 `--help`
   拥有 flags/closed input/短例子；`cli-operations` Skill 只拥有命令族选择、message→Task、
   多 operation 协调和复杂 recovery。
2. 统一入口文案是：先运行 `rovai --help` 选择 operation，再运行该 operation 的精确 `--help`；不得
   假设 command family 自己有 help entry。有效例子必须写成 `rovai task create --help`、
   `rovai camp read --help` 等完整路径。
3. `cli-operations` 使用窄 description。普通单一 send、`--to`、`--to-user`、list、get、search 或 read
   不触发该 Skill；只有命令族歧义、普通消息是否升级 Task、同一业务事件协调多个 Rovai operation，
   或 `refresh` / `confirm_outcome` 等复杂业务恢复才触发。
4. `cli-operations/SKILL.md` 只保留触发后的选择与路由，直接链接 `send`、`task`、`camp-history`、
   `memory`、`recovery` 五份一层 reference。规则只保留一个权威落点，不复制完整 operation schema，
   不使用聊天 URL、绝对路径、嵌套 fence 或 family-level help。
5. `confirm_outcome` 有权威 CampMessage locator 时可 exact read；没有 locator 时不得正文猜测、近似
   搜索或盲目重发，必须报告结果不确定并停止该 mutation。
6. `memory-stewardship` 保持现有语义权威，只允许按 references 无损搬移与 Agent-facing CLI 命名整理。
   current authority、Entrypoint cache、read-before-use、状态处理、安全、scope/revision/body/key limits 和
   mutation 顺序都必须由 semantic tests 保留。

`cli-operations` 的 official identity、打包集合与投递策略由 ADR-0167 独立拥有；教学分层不因此获得
required prompt injection、特殊 Capability 或第二套 Skill delivery authority。

本决策细化 ADR-0124 的 CLI-only discovery 与 ADR-0135 的 compact Agent output；不改变其 transport、
projection、用户 Assignment 或 Runtime-native discovery 权威。

<a id="adr-0166-consequences"></a>
### Consequences

- 普通调用用最短上下文得到准确 flag，复杂协调才支付 Skill discovery 与 reference 阅读成本；
- Charter 可以稳定跨字段演进，operation help 与 parser/catalog 保持同一真源；
- `memory-stewardship` 拆分需要 semantic golden checklist，不能以更短字数作为成功标准；
- references、help path、front matter trigger 和 no-locator recovery 都成为自动化验收内容；
- Skill 是否属于 official inventory、默认分配到哪些 Runtime Groups，不再与教学职责混成同一决定。

<a id="adr-0166-rejected-alternatives"></a>
### Rejected Alternatives

- **把全部 CLI schema 放入 Charter。** 每次字段变更都扩大所有 Session Bootstrap，并复制 catalog 真源。
- **让 `cli-operations` 在任何 Rovai 命令上触发。** 普通单操作会加载无关决策树，违背 progressive
  discovery 并增加模型误选 Task/Memory 的机会。
- **使用 family-level help。** 当前 CLI 没有这些入口，教学不能依赖不存在的命令。
- **整体重写 `memory-stewardship`。** 精简摘要无法无损覆盖 authority、cache invalidation、security、
  revision 与 byte/key 限制。
- **把 CLI 决策树强制注入每个 Session。** 会重新制造 Charter 膨胀，并把按需教学误当作权限或
  Runtime 已读取的事实。
- **无 locator 时 search/guess send outcome。** 相同正文不是 invocation identity，近似命中既不能证明
  成功也不能证明失败，重发会产生重复 mutation。

<a id="adr-0166-references"></a>
### References

- [v0.65 版本目标](README.md)
- [v0.65 实现规格](implementation-spec.md)
- [ADR-0124: CLI-Only Transport](../v0.42/decisions.md#adr-0124)
- [ADR-0135: Compact Agent Output](../v0.46/decisions.md#adr-0135)
- [ADR-0167: Seven-Skill Official Inventory](decisions.md#adr-0167)
- [Built-in Tool Transport v8](../../contracts/builtin-tool-transport-v8.md)
- [Built-in Tool Transport v7 (historical)](../../contracts/builtin-tool-transport-v7.md)
- [Built-in Tool Runtime architecture](../../architecture/builtin-tool-runtime.md)
<!-- legacy-adr-body:end id=ADR-0166 -->
<!-- legacy-adr:end id=ADR-0166 -->

<!-- legacy-adr:begin id=ADR-0167 source-file-sha256=fd27cc366a985d679e54443e1d1f1e38626d4cfd9bff4dbe23c1ff4f690d65d1 -->
<a id="adr-0167"></a>

## ADR-0167: Seven-Skill Official Inventory

迁移时原路径：`docs/adr/0167-seven-skill-official-inventory.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0167
title: Seven-Skill Official Inventory
status: superseded
date: 2026-08-12
decision_scope: cross-version
source_version: v0.65
supersedes:
  - ADR-0159
superseded_by: ADR-0174
```

<!-- legacy-adr-body:begin id=ADR-0167 -->
<a id="adr-0167-context"></a>
### Context

ADR-0159 把 Rovai official Skill inventory 冻结为恰好六项，并拥有 pinned `tasteful-ui` 的上游来源、
许可、完整打包和不可变 Revision 边界。v0.65 的渐进式 CLI 教学需要新增 `cli-operations`；只修改 Core
fixture 或 UI 数量会让正式 inventory 仍停在六项，也可能在新增 Skill 时意外弱化第三方来源和既有五项
Rovai-owned Skill 的决定。

`cli-operations` 应通过现有统一 Skill Library 与 Runtime-native discovery 按普通 official Skill 交付。
为它增加 required/locked 状态、专属设置组或第二套投递协议，会绕过用户已有的 enabled 与 Runtime Group
Assignment 权威。

<a id="adr-0167-decision"></a>
### Decision

1. Rovai 当前发布恰好七个 official Skills：`analyze-agent-codebase`、`cli-operations`、
   `memory-stewardship`、`worktree`、`grill-duo`、`grill-duo-with-docs` 与 `tasteful-ui`。
2. Unprefixed name + `origin=official` + immutable bundled Revision 仍是 official identity；同名 Imported
   Skill 拒绝。`cli-operations` 的教学内容与窄触发由 ADR-0166 拥有。
3. `cli-operations` 是普通 official bundled Skill：首次安装默认 enabled、默认全部九个 Runtime Groups，
   用户后续可以禁用或调整 Assignment。它不获得 required/locked 状态、专属 UI group、特殊来源标签、
   第二套投递协议或额外 Capability。
4. `tasteful-ui` 继续完整使用 ADR-0159 固定的上游仓库
   `https://github.com/DonkeyKing01/tasteful-ui-skill`、Revision
   `159ccd47a320f3a7bd0289d07366d422211895a1`、MIT license、source notice、84-file bundled snapshot、
   build-time symlink/unsupported-node rejection、immutable Revision 与无启动/构建网络拉取。其 router、
   investment gates、catalog、implementation/verification workflow 全部保留，且不授予额外权限。
5. `analyze-agent-codebase` 的 evidence-first/read-only default、`worktree` 的 Task-scoped isolation、两项
   duo Skill 的 self-contained references/A2A workflow、`memory-stewardship` 的既有治理边界，以及所有
   Skill 不授予 filesystem/Git/tool/approval/implementation authority 的决定全部保留。
6. 未来增加或删除 official Skill 必须以新 ADR 完整替代本精确 inventory，并同步 Core manifest、
   terminology、UI copy、source labels、smoke 与 acceptance fixtures。刷新 `tasteful-ui` 仍需精确上游
   Revision、完整 re-vendor、许可/notice 和全 manifest 验证。

本决策完整替代 ADR-0159，并无损继承其 pinned `tasteful-ui` 与此前 ADR-0150 的五项 official Skill
决定；ADR-0158 继续拥有所有 managed Skill 默认全 Runtime Group 与用户后续修改保持的一般策略。

<a id="adr-0167-consequences"></a>
### Consequences

- Core、Renderer、文档和验收 fixture 共享一个精确七项 inventory；
- 新 CLI Skill 复用现有来源、启停、Assignment、Revision 和 exposure evidence，不产生产品特例；
- `tasteful-ui` 的可复现来源、许可、文件 manifest 与离线安装保持不变；
- Skill Exposure 只证明 Runtime-native discovery 可见，不证明模型读取，也不授予命令或执行权限；
- 以后修改 inventory 必须显式接替本 ADR，不能在实现或 UI 中静默增减。

<a id="adr-0167-rejected-alternatives"></a>
### Rejected Alternatives

- **只把 `cli-operations` 加入 Core fixture。** 会让长期 inventory、UI 与实现事实分叉。
- **把 CLI 指导直接并入 `memory-stewardship`。** 会混淆 Memory 治理与跨领域 operation 选择。
- **为 CLI Skill 创建锁定组或 prompt injection。** 会绕过统一 Skill governance、否定用户 Assignment，
  并把可发现内容误称为已被模型读取。
- **借本次新增刷新 `tasteful-ui` 上游。** 未经独立 review 的来源变化会破坏已固定的 provenance、许可
  与文件清单，不属于新增 inventory item 的必要效果。
- **使用浮动 official 集合。** 代码、设置、离线包与验收将无法证明同一发布内容。

<a id="adr-0167-references"></a>
### References

- [v0.65 版本目标](README.md)
- [v0.65 实现规格](implementation-spec.md)
- [ADR-0158: Default-All Runtime Delivery for Managed Skills](../v0.58/decisions.md#adr-0158)
- [ADR-0159: Pinned Third-Party Tasteful UI Bundled Skill (historical)](../v0.58/decisions.md#adr-0159)
- [ADR-0166: Progressive Built-In CLI Teaching](decisions.md#adr-0166)
- [Skill settings UI strategy](../../../apps/desktop/.impeccable/surfaces/settings-workspace.md)
- [Domain terminology](../../../CONTEXT.md)
<!-- legacy-adr-body:end id=ADR-0167 -->
<!-- legacy-adr:end id=ADR-0167 -->

<!-- legacy-adr:begin id=ADR-0169 source-file-sha256=df4cb140fbf628c05f1681d4b4c9bc825cac358df2444e83e632afcc7052dcd5 -->
<a id="adr-0169"></a>

## ADR-0169: Core-Owned Directory Attachment Snapshots

迁移时原路径：`docs/adr/0169-core-owned-directory-attachment-snapshots.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0169
title: "Core-Owned Directory Attachment Snapshots"
status: accepted
date: 2026-08-12
decision_scope: cross-version
source_version: v0.65
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0169 -->
<a id="adr-0169-context"></a>
### Context

Camp 附件原先只接受普通文件。用户从 Finder 交付一组有层级的资料时，只能逐文件选择，
而 Renderer 自行展开目录又会把路径遍历、安全检查、冻结时点和 Draft 原子性分散到不可信的
UI 边界。目录也不能继续引用原位置，否则发送后的内容会随用户后续编辑改变，并暴露本机目录结构。

本决定局部替代 ADR-0080 中“目录失败关闭”的条款，并扩展 ADR-0081 的单一稳定附件路径；
两者关于 Core-owned Draft、发送原子性、公共附件授权和冻结发现边界的其余决定继续有效。

<a id="adr-0169-decision"></a>
### Decision

1. Camp Attachment 是 `file | directory` 的封闭联合。一个被拖入的目录是一个有层级的
   Prepared Attachment，计为一个顶层附件；不得在 Renderer 中展开成多个附件。
2. Core 是目录分类、遍历、限制、复制、摘要和只读化的唯一权威。目录快照包含用户明确拖入
   根目录下的全部普通文件、普通目录、隐藏项和空目录；任意 symlink 或其他特殊节点使整个项目
   失败，不允许静默跳过或部分成功。
3. Core 使用不跟随 symlink 的目录句柄遍历并检测复制期间的结构或内容变化。快照使用确定性
   路径顺序和文件内容摘要形成单一 SHA-256 树摘要；原始绝对路径既不持久化，也不进入
   Renderer、Camp Message 或 Runtime Context。
4. 目录快照沿用 ADR-0081 的稳定位置：
   `<userData>/camp-attachments/<camp-id>/<attachment-id>/<safe-name>`。对于目录，
   `<safe-name>` 是只读快照根；Runtime 只能从冻结消息上下文获得该根路径，并可枚举根内层级，
   不能因此枚举 Camp Attachment 根或未来消息附件。
5. 文件与目录共享同一 Draft revision、十个顶层附件和 64 MiB Draft 总量边界。目录内每个普通
   文件继续受 25 MiB 限制，并额外受有界文件数、节点数和深度限制。任一准备项失败时消息不可
   部分发送。
6. Prepared/Message Attachment 读侧显式投影 `kind`、`fileCount` 与聚合 `byteSize`；目录不能只靠
   文件名或 MIME 猜测。ContextManifest 的 Attachment Ref 仍只冻结 ID、稳定路径和内容摘要，
   不创建第二套目录投递协议。

<a id="adr-0169-consequences"></a>
### Consequences

- 用户可把完整资料树作为一个消息附件交付，原目录后续变化不会影响已准备或已发送内容。
- Core 必须承担有界但可能明显长于单文件的 I/O；Renderer 需要显示 preparing/error 并在完成前
  阻止发送。
- Runtime 得到的是应用受管目录根而非归档文件，可直接使用原生文件工具读取层级；这也要求快照
  内目录结构和空目录保持稳定。
- 持久附件目录需要一个 Core-private 元数据记录来恢复类型、文件数、总量和摘要；删除 Draft 或
  Camp 时必须递归解锁并清理整个受管树。

<a id="adr-0169-rejected-alternatives"></a>
### Rejected Alternatives

- Renderer 递归读取并逐文件上传：会把安全与冻结权威移出 Core，并丢失“一个目录”的用户意图。
- 自动打包 ZIP：Runtime 必须先解包，空目录与文件工具路径语义改变，也增加新的归档攻击面。
- 保留原始目录路径：内容不再冻结，并泄漏本机结构和生命周期。
- 跳过 symlink、隐藏文件或超限节点后继续：用户无法知道实际交付了哪一部分，摘要和消息边界不可信。
- 把目录复制进 Project/Worktree：污染用户仓库，并把公共附件生命周期错误绑定到工作区。

<a id="adr-0169-references"></a>
### References

- [v0.65 当前版本](README.md)
- [ADR-0080: Durable Camp Composer Draft](../v0.25/decisions.md#adr-0080)
- [ADR-0081: Camp-Public Attachment Paths](../v0.25/decisions.md#adr-0081)
- [Camp Attachment v1](../../contracts/camp-attachment-v1.md)
- [Camp 会话区拖放 UI](../../ui/components/conversation-drop-zone.md)
<!-- legacy-adr-body:end id=ADR-0169 -->
<!-- legacy-adr:end id=ADR-0169 -->
