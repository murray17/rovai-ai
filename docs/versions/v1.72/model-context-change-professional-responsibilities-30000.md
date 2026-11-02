---
document_type: model-context-change
version: v1.72
change_id: professional-responsibilities-30000
revision: 2
confirmation_status: pending
authority: proposed-model-input-change-statement
implementation_baseline: 277b562f178c62b38a8f50dfe81282118566786f
implementation_status: not_started
last_updated: 2026-11-02
---

# 专业职责 30,000 字符实施方案 R2

## 二次确认

本文件是同一份方案的合并修订稿：收录 Thread `rvcamp_01m6ds2wjqf2hvfvqfa6yzpwbz`
sequence 1 的原方案、五点评审，以及 User 在 sequence 3
（`18f3559c-6fe1-454e-b0c3-33f128223649`）采纳评审并收紧的实施范围。
R1 为 Thread 中的原方案；R2 是首次落入仓库的完整修订，不另建并行评审或实施方案。

User 本轮授权修订方案，尚未要求实施本文件。`confirmation_status: pending` 不代表方案方向被否定；
完成全文审阅并明确授权实施该 revision 后，才据实填写 confirmed revision、by、at 和确认定位。
[模型上下文治理](../../development/model-context-change-governance.md)允许未确认时调查和编辑提案，
不得据此修改实现、Schema 或当前合同。文档门禁会如实报告未确认；不伪造确认、不增加 checker 例外。

## 目标与范围

三个目标保持：专业职责最多 **30,000 个 Unicode scalar**；当前已有 128 KiB Bootstrap 正文检查的
适配链路提高到 **256 KiB / 262,144 字节**；执行包默认预算保持 **256 KiB**，显式配置沿用现有规则。

产品承诺是“专业职责最多可保存 30,000 字符，并按完整必需输入容量执行准入”。保存容量与执行容量
分别校验，不保证任意职责、指引、记忆与消息组合都能执行；不截断、摘要或丢弃必需内容。
本轮不重写公开 claim、不新增预算框架或调度机制、不改变职责编辑生效规则，不扩成全 Runtime／模型矩阵。

## 变更前

基线为上方不可变 SHA；当前版本按[版本索引](../README.md)确定为 v1.72。

| 位置 | 基线行为 |
| --- | --- |
| Core／Renderer 职责校验 | 按现有 ECMAScript `String.trim` 空白集清理首尾后，最多 10,000 scalar；内部格式保留 |
| create／update 工具及 CLI | schema 引用 Core 上限；先规范化职责再校验；CLI help 写 10,000 |
| 保存超限文案／计数器 | `专业职责最多 10,000 个字符。`／`<清理后字符数> / 10,000` |
| Cline／Command Code 正文 | Rust 使用 `MAX_SESSION_BOOTSTRAP_BYTES = 128 * 1024`；Command Code Mod 另有 JS 128 KiB 检查 |
| 新 public 普通输入与 Steer | 既有 claim／共同 Builder 使用冻结内容和实际 UTF-8 字节；不是固定 128 KiB 预留 |
| 旧分派 preflight | 同包预留使用同一个 128 KiB 常量；Hermes 另加 update envelope，其余按 FirstPayload／redelivery 加封装 |
| 执行包 | 默认 256 KiB；原有 `maxContextPayloadBytes` 解析、覆盖和最小值规则保持 |
| 组合超限提示 | `输入内容过大，无法开始执行。请改用文件附件，或拆分后发送。` |

### 固定预留的调用与兼容范围

静态核查得到以下边界；保留兼容代码，不把“新消息不走这里”解释为可以删除整个旧分派链路。

| 路径 | 当前入口与证据 | R2 处理 |
| --- | --- | --- |
| 新公开用户／Agent 消息 | `delivery_queue::enqueue_message_deliveries` → FIFO claim → `ClaimedBatchContext::prepare`；Agent send 的 `persist_queued_agent_message` 也写 `camp_message_delivery` | 保持冻结及实际预留；只扩展指定回归 |
| 新 Steer | 既有动态 Builder、完整输入投影和实际预算；见 [Profile 14](../../contracts/context-delivery-profile-v14.md) 与当前 [Profile 15/16](../../contracts/context-delivery-profile-v15.md) | 不改选择、补发条件及队列关系 |
| 旧 `message_delivery` 分派 | Accepted、RuntimeReady、TargetRunEnded、附件 publication 与渠道 roster pump 仍可调用 `dispatch_delivery`；`establish_dispatch_attempt` 只从旧表领取符合状态的记录 | 不改 pump／状态机；仅隔离旧数值 |
| 旧记录尚无 `frozenContext` | `process_dispatch_attempt` → 唯一生产调用 `ContextService::preflight_delivery_context` → 固定预留；有 `frozenContext` 时复用原冻结选择 | 保留 128 KiB 加原封装，不换成 256 KiB，也不引入新快照结构 |
| 历史迁移／恢复 | `db.rs` Delivery-first cutover 将可重排旧 public A2A 转入新队列并终结对应旧记录；Gather 关闭；原已物化输入按版本恢复 | 不改迁移、不重新排队、不重选旧内容；不推断所有旧库都没有残留记录 |
| 新 non-batch 与最终组包 | `context.rs` 实际构造 `runtime_payload` 后检查长度；Single Chat 等沿现行路径 | 保持现有预算和身份读取规则，不统一改成 public claim |

源代码入口：[旧分派](../../../crates/rovai-core/src/message_delivery.rs)、
[队列与 claim](../../../crates/rovai-core/src/delivery_queue.rs)、
[实际预留](../../../crates/rovai-core/src/context/claim.rs)、
[preflight／组包／恢复](../../../crates/rovai-core/src/context.rs)、[既有迁移](../../../crates/rovai-core/src/db.rs)。

## 变更后

### 字段与编辑规则

| 项目 | R2 确定行为 |
| --- | --- |
| 字段上限 | `professionalResponsibilities` 清理后 0～30,000 Unicode scalar；组合字符逐 scalar 计数，不做 Unicode 合并 |
| 首尾空白 | 沿用现有函数；U+FEFF 清理，U+0085 保留；内部换行、缩进、引号、反斜杠及原本合法的控制字符原样保留 |
| 空值／类型 | 空字符串清空；create 省略默认空；update 省略保留；null 及错误类型仍拒绝 |
| 保存超限 | `专业职责最多 30,000 个字符。`；英文 `Responsibilities allow up to 30,000 characters.` |
| 界面计数 | `<清理后实际字符数> / 30,000`，例如 `30,001 / 30,000`；复用现有计数函数与格式 |
| 草稿与提交 | 不使用原生 maxlength 或切片；沿现有失焦／提交校验显示错误，超限时不发起部分身份／头像写入；后端拒绝仍保留输入 |
| 保存边界 | 只保证职责超限时整次身份写入拒绝；现有“文字已保存、头像后一步失败”的回执语义和独立运行配置保存保持 |

CLI 职责 help 完整替换为：

```text
Up to 30,000 Unicode scalar values after trimming. Use "" to clear. For long or multiline text, use --input-file with a UTF-8 JSON file.
```

### 正文上限与预留解耦

`MAX_SESSION_BOOTSTRAP_BYTES` 仅承担当前相关 Adapter 的正文上限，提高到 `256 * 1024`。
在旧 preflight 所在模块增加一个具名兼容常量（拟名 `LEGACY_DELIVERY_BOOTSTRAP_RESERVE_BYTES`），
固定为 `128 * 1024`，只供旧 Hermes 固定预留及 `bootstrap_payload_reserve` 使用。
该常量解决“提高正文上限导致旧分派剩余预算变成零”的具体失败；不新增配置、类型、存储字段或服务。
Command Code 的内嵌 JS 正文检查同步为 `256 * 1024`；Cline 继续引用 Core 常量。

新 public claim 保持现有算法。令 B 为本次 claim 冻结内容经既有 Bootstrap formatter 输出的字符串：

- Hermes：继续按实际 `envelope("update", B)` 的 UTF-8 长度加两个换行预留。
- FirstPayload 或可能同包补发：继续按实际 redelivery overlay 的 UTF-8 长度加两个换行预留，覆盖
  claim 后补发、规则摘要变化及 cold resume 失败转新 Session；即使眼前不发 B，也保留原有防线。
- 独立系统通道且没有同包补发可能：保持不扣本包 Bootstrap，独立通道按其现有校验处理。
- 不改变实际发送条件；领取与发送消费同一冻结内容，预留可包含本次最终未使用的合法封装。
  最终 payload 继续检查真实字节；原有可选 Tasks／历史裁减、FIFO 和剩余 waiting 行为保持。

正文序列化与传输转义分别按各自既有边界验证，不把字符数当字节数。30,000 个普通汉字约 90,000 字节；
30,000 个 U+0000 在身份 JSON 中的字符转义部分即占 180,000 字节，还需计入字段、其他段和封装。
Command Code 当前是 `/rovai-bootstrap` JSON 字符串命令；旧文档中的“绑定文件外层 256 KiB 限额”
已退出当前实现，本轮不恢复或改造它，也不普遍放大 IPC／工具结果限额。

### 模型输入与生效规则

前后都使用以下相同 section 顺序与 shape；唯一新增可接受内容是更长的职责字符串：

```text
[SESSION_CHARTER]
<既有章程全文>
[/SESSION_CHARTER]

[MEMBER_IDENTITY]
{
  "name": "<名称>",
  "teamRole": "<团队角色>",
  "professionalResponsibilities": "<完整职责；10,000 → 30,000 scalar>",
  "personalityTraits": ["<原有有序标签，允许空数组>"],
  "workingPrinciples": "<原工作准则>",
  "growthTopic": "<原成长课题>"
}
[/MEMBER_IDENTITY]

[TEAM_GUIDANCE]
<Thread 创建时冻结的非空团队指引>
[/TEAM_GUIDANCE]

[ROVAI_PLATFORM_SKILLS]
<既有平台技能索引>
[/ROVAI_PLATFORM_SKILLS]

[MEMORY_ENTRYPOINT]
<既有非空记忆入口>
[/MEMORY_ENTRYPOINT]
```

身份六字段不省略；空值保留原 JSON 表达。TEAM_GUIDANCE 只在该 Thread 有固定非空指引时出现，
Single Chat 仍省略；MEMORY_ENTRYPOINT 空时省略；其余条件遵守
[Bootstrap v6](../../contracts/native-session-bootstrap-v6.md)，本轮不增加段、字段或提示文字。
同一份原先合法输入经过 formatter 的字节保持一致。

职责在新 public claim 前编辑，进入新快照；claim 后编辑不修改该 Run；后续新 Run 按既有规则读取。
已有 Native Session 是否再次收到身份，由原 Bootstrap 投递矩阵决定；编辑不创建补发 Requirement、
输入、自动重启或 Session 重建。non-batch 与旧输入保留原读取及恢复规则，不借扩容统一生命周期。

### 超限反馈与内容保留

复用现有 `context_payload_too_large`、失败详情入口和不可直接重试语义。组合超限的 summary 保持
`输入内容过大，未开始执行。`，detail 拟完整替换为：

> 本次完整输入超过执行容量，未开始执行。已保存的队员资料和已提交消息保留。请精简当前输入或专业职责后重新提交；若需精简本对话已固定的团队指引，请使用精简后的指引新建对话并重新提交。

英文 detail：

> The complete input exceeds the execution limit; execution has not started. Saved member details and submitted messages are preserved. Shorten the current input or responsibilities, then submit again. To shorten the team guidance fixed for this conversation, create a new conversation with the shorter guidance and submit again.

这里的“未开始执行”沿用现有失败语义，不承诺不会启动宿主进程。正文自身的 Adapter 拒绝仍沿原校验
及错误路径，边界测试确认拒绝后没有投递该超限正文；不把所有 `bootstrap_invalid` 原因归为容量错误。
只在现有展示处完善提示，不增加错误分类系统、恢复按钮、设置跳转或字节诊断面板。

未保存编辑内容留在身份编辑草稿中；已提交消息保留在消息与原有输入记录中，不伪装成仍在输入框的草稿。
保存成功的资料不因执行失败回滚；设置修改不改变旧冻结输入，不承诺重试旧执行即可恢复，也不自动重放。
Team 模板修改不会改变既有 Thread 的指引；不增加会话级指引编辑入口。

## 最小改动清单

表内每项只解决本次失败路径；实现时优先扩展列出的既有 owner，不新建同类测试体系。

| 项目／当前缺口 | 拟修改入口 | 验证方式 |
| --- | --- | --- |
| M1：30,000 职责被前后端 10,000 限制拒绝 | `agent_profile.rs` 上限与文案；Renderer `member-identity-draft.ts`、现有 Editor 与 `locales/en.json` | 扩展 `professional_responsibilities_use_trimmed_unicode_scalar_limits`、`member-identity-draft.test.ts`；30,000／30,001、Unicode、trim、格式及其他字段不变 |
| M2：schema／CLI help 仍宣告 10,000 | `member_studio.rs` 共享 schema／normalize、`member_tool.rs` 派生 update schema（原则上无需新增常量）、`bin/rovai.rs` help | 扩展 `member_create_schema_keeps_avatar_file_optional`、`exact_help_surface_covers_the_current_catalog_and_no_family_aliases`；create／update、JSON 文件、空串／省略／null、normalize 在 schema 前 |
| M3：有效大 Bootstrap 被 128 KiB 检查拒绝 | `context.rs` 正文上限；`command_code/bootstrap.mjs`；Cline／Command Code Rust 继续引用共享上限 | 扩展 Cline `long_bootstrap_bindings_preserve_utf8_and_enforce_body_limits`、Command Code `native_home_and_bootstrap_control` 与既有 JS Mod owner；262,144／262,145 字节、UTF-8 与 JSON 转义往返 |
| M4：正文扩容可能使旧 preflight 预留耗尽默认预算 | `context.rs` 两处旧预留改用固定 128 KiB 兼容常量；旧数值断言随 owner 解耦 | 扩展现有 Bootstrap／reserve owner；断言小输入有剩余预算，Hermes update 与 redelivery 的旧封装结果不变；不改旧 dispatcher |
| M5：30,000 字符下的 claim 后变化未覆盖 | 仅扩展 `delivery_queue.rs`、`context.rs` 既有用例；生产 claim 与 Builder 不改 | 扩展 `changed_bootstrap_splits_before_claim_and_materializes_the_frozen_snapshot`、`redelivery_overlay_is_frozen_at_prepare_and_acknowledges_only_its_revision`、replacement binding owner；覆盖 claim 后补发、cold resume 失败转新 Session 以及前后编辑 |
| M6：容量失败建议没有覆盖职责与冻结指引 | `runtime_failure.rs` 既有 detail 与 `locales/en.json`；现有失败详情 UI 保持 | 扩展 `ThreadWorkspace.run-artifacts.test.ts`／既有失败 owner；确认草稿、已提交消息、资料各自保留，无旧执行自动重试；复用身份 save owner 验证拒绝后未写头像 |
| M7：已有运行 smoke 的职责较短，缺少本次字节证明 | 参数化现有 `smoke-member-routing.mjs`、`smoke-bootstrap-claim-budget.mjs` 的本次 fixture；复用 Command Code 原生 ACP、Cline 既有验收入口 | 只跑下文受影响分支；保留实际正文、冻结／绑定／发送内容的字节数与 SHA-256，不以模型复述或首尾标记充当全文证明 |
| M8：文档仍写 10,000／128 KiB | 确认实施后更新职责当前权威条款、`docs/ui/components/member-identity.md`、`skills/member-studio/references/identity-generation.md`、相关 Bootstrap／容量说明与现有发布记录 | 通用文档／Skill 检查；只改当前上限及对应说明，历史记录不全局替换；发布句为“专业职责上限提升至 30,000 字符，保留完整正文与内部格式。” |

不得因表格列出入口而无理由修改所有文件；派生 schema 和已成立的草稿保留以现有代码及扩展测试证明即可。
新增抽象仅限 M4 的局部兼容常量；无新数据库字段、迁移、缓存、队列、调度器、测量服务或评测 Case。
如果实现发现现有 owner 无法覆盖具体失败，先在本文件记录失败输入、缺失 seam 与新增测试理由，按
[Rust 测试准入](../../development/testing.md#rust-测试准入与退役门槛)评估；不能以“增加覆盖率”为由扩大范围。

## 版本轴与兼容策略

以下为 R2 基于已核查路径的决定，不把“长度上限变化”当成所有轴递增的理由。

| 轴 | 当前值／R2 决定 | 理由 |
| --- | --- | --- |
| public Delivery Profile | 15，保持 | 实际冻结、封装预留、FIFO／Task 选择和 256 KiB 总预算不变 |
| non-batch Delivery Profile | 16，保持；历史 Profile 原样 | 实际组包算法不变；旧 preflight 仍保留原 128 KiB 预留，不重选旧输入 |
| public／non-batch Formatter、Manifest | 43／44，保持 | section、shape、序列化、locator、证据字段与恢复字节均不变 |
| Bootstrap contract／formatter | v6／6，保持 | 六字段、可选段、排序、digest 算法保持；只放宽合法职责与相关 Adapter 正文长度 |
| Charter／Binding compatibility | 26／16，保持 | 无新规则或身份编辑触发行为；不批量失效 Native Session |
| Redelivery envelope／formatter | 2／2，保持 | 不改变封装、Requirement 选择及 ACK 水位 |
| Built-in Transport／CLI、IPC／Envelope、Agent Output | 45、3／2、15，保持 | 只放宽已有字段的 maxLength 和 help；命令、shape、授权、幂等、输出和传输不变；新版 Core／CLI 配套交付，不承诺旧 CLI 接受新增长度 |
| Adapter 绑定／Mod 协议 | 保持 | 数值校验更新不改变注册、控制命令、Rule 文件 shape 或握手；不得恢复旧 Command Code 外层绑定文件机制 |
| 数据库／projection schema | 保持，无迁移 | 职责沿原 TEXT 字段；本次未新增 CHECK、列或冻结结构，不写回既有资料／证据 |

当前版本配对以 [Manifest 43/44](../../contracts/context-manifest-evidence-v44.md) 和
[Transport 45](../../contracts/builtin-tool-transport-v45.md) 为基线；旧合同的继承条款与实际代码并列核对。
实施时更新拥有长度语义的当前条款及必要导航，不改历史 Profile／Transport 正文来冒充当前升级。
若发现必须改变模型输入选择、冻结结构或协议语义，先说明具体失败路径并修订本文件的版本决定；
不在本轮默认引入迁移或 clean break。

已保存资料不迁移；旧 frozen claim、Manifest、Blob、Delivery 及摘要按原版本消费，不加入新职责或指引。
保留现有 read／恢复兼容，不承诺旧二进制能读取新保存的超过 10,000 字符资料；本轮不新增降级迁移。

## 明确不变

- 其他身份字段各自的校验、空值、类型、权限、版本冲突与幂等规则；不联动改变运行配置、头像工作流。
- public claim 的单一冻结快照、实际字节算法、Steer 共同 Builder、补发和恢复失败处理；不新增编辑触发。
- 默认执行预算 256 KiB、显式覆盖、旧 preflight 128 KiB 预留及既有可选内容削减规则。
- 模型 section、投递层级、字节 formatter、历史证据、accepted／unknown 输入的恢复和禁止自动重放边界。
- Thread 创建时冻结的团队指引及无会话级编辑入口；现有产品界面、保存入口与消息保留位置。
- 12 个通用 Case 的定义、评分和评测设施；不增加全运行时／全模型／全长度组合验收。

## 验证

### 必需的定向回归

| 用例 | 通过标准／失败路径 |
| --- | --- |
| 30,000／30,001 scalar | UI、Core、工具、CLI 口径一致；保存／读取完整，超限拒绝且未部分提交 |
| 中文、四字节、组合字符、空白 | 覆盖 FEFF／0085、内部换行与缩进、引号／反斜杠／合法控制字符；不归一化或截断 |
| 正文 262,144／262,145 字节 | 在 Cline／Command Code 正文校验层分别接受／拒绝；JSON 命令往返保真；不把正文刚好通过误认为合包也通过 |
| 小职责与小消息 | 默认预算正常执行；正文上限提高不耗尽旧预留后的剩余空间；旧 helper 数值独立于新正文常量 |
| 组合容量 | 30,000 职责＋10,000 scalar 团队指引＋非空记忆入口＋动态输入，构造实际序列化后可容纳／超限各一个 fixture；结果由实际字节确定 |
| claim 后出现补发需求 | 原快照完整投递，原有 wrapper 预留生效；不重新扩展选择，不自动消费未 accepted 的 Requirement |
| cold resume 失败转新 Session | 使用同一 claim 的完整职责和启动材料；不重读后来的编辑，不在最终组包时才暴露漏预留 |
| 修改生效与续聊 | claim 前修改进入新快照，claim 后修改留给后续；未触发原有投递条件时不强制补发 |
| 重启／历史恢复 | 复用既有恢复 owner 验证字节与摘要不变；配置或身份后来变化不重写旧输入，不自动重播 accepted／unknown |
| 失败呈现 | 身份编辑草稿与已提交消息分别保留；提示重新提交，冻结指引需新建对话；无“修改后重试旧执行即可恢复”的承诺 |

字符矩阵放在低成本 owner；SQLite／恢复／进程只在已有拥有该语义的用例扩展，不在每层重复整套组合。
Rust feature-gated owner 使用其现有 feature，先用 `-- --list` 核对实际运行；不以零个匹配测试记通过。

### 有界真实运行与证据

沿[隔离开发流程](../../development/local-workflow.md)使用独立数据、项目、Skills／MCP 和产物目录，
不启动或修改日常 App 数据。真实运行仅在实施授权后进行，本轮方案修订不执行。

专项覆盖三类实际受影响分支：OpenCode 的 FirstPayload／既有补发与恢复路径，Command Code 的 Rust＋JS
独立系统提示，以及 Cline 的正文与原生 Rule 绑定。复用既有入口，每类固定一个实际 Runtime 版本和模型；
不额外扩展 Pi、Codex、Claude 或其他未改 Adapter 的专项矩阵。通用 Gate 自己的固定运行配置不受此限制。
只有具备真实证据的补发／cold resume 分支才标记实测；未能触发时记录未测，不拿普通续聊成功替代。

每个专项保留：fixture 输入及清理后职责字符数／UTF-8 字节、实际 Bootstrap 与最终 payload 字节数、
对应 SHA-256、Run／Binding／Delivery 定位及 accepted 状态。独立系统提示核对实际绑定或发送内容，
同包核对实际 runtime payload；冻结内容、绑定内容、发送内容的证明层级分别标注。
首中尾标记只用于定位；单独 marker、模型复述、动态 Manifest digest 均不足以证明职责全文送达。
证据使用合成职责，不把真实用户职责复制到公开仓库。

### 既有 12 个通用 Case Gate

复用 [suite.json](../../../qualification/context-regression/suite.json) 的 **2.12.0** 通用集
DEMO-101～112，repetitions=1，两臂相同 Runtime／模型／权限／Judge，至少三个队员身份。
按现有 `eval:gate build → freeze → run` 生成基线与候选产物；基线 SHA 为本文件记录值，候选记录实际实现 SHA。
不改 Case、verifier、评分标准、Runner 或 suite 版本，不添加专项通用 Case。

计划预算沿现有配置形状：每个 campaign `wallSeconds=14400`，`maxParallelCases=2`、`judgeSeconds=2400`；
每个 Case 保持 suite 的既有上限，最多两次 campaign 尝试，不根据结果调高预算或改变标准。
执行前在现有冻结计划中填入可用 Runtime／模型的实际版本、权限和真实 Judge 配置及摘要；复用已验证环境，
不以 `judge: null`、缺失证据或不同两臂配置宣称 Gate 通过。本文件不虚构尚未选择的模型／版本或运行结果。

通过标准沿[现有 Gate](../../development/evaluation.md#上下文改动-gate)与 suite 评分：规则、语义、
关键协作及资源门槛均按冻结配置判定；保存所有失败、未运行项和 evidence gaps，不挑成功样本收口。
通用 Gate 证明既有任务回归，专项证明本次容量与投递边界；均不宣称模型一定遵循长职责中的每句话。

## 实施顺序与交付

1. 交付并审阅本 R2；在同一文件记录对应 revision 的实施确认。当前只新增此方案及版本概览入口。
2. 实施 M1～M4 的数值／文案／局部解耦，保持 claim 不动；完成 M5～M6 定向回归与现有提示更新。
3. 运行定向测试、相关类型／前端检查、三类专项与现有 12 Case Gate；记录实际未测与失败，不扩矩阵追求全覆盖。
4. 同步 M8 当前文档、创建指引与发布记录；实际结果追加在本文件或既有证据产物中，不重写已确认的语义。
5. 交付实现 diff、测试与真实证据、版本轴结论及兼容限制。按用户偏好提交并推送分支；只有用户明确要求时创建 PR，
   PR 需说明正文保存上限与单次执行预算的区别，以及冻结输入不能靠修改设置重新解释。

文档检查使用 `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=<base SHA> pnpm docs:check:ci`。
本提案未确认时，确认字段检查预期不通过；其余文档链接与决定治理另行核对，不修改门禁规避该状态。
