---
document_type: implementation-proposal
version: v1.72
authority: implementation-proposal
status: accepted
revision: 5
confirmation_status: confirmed
last_updated: 2026-11-22
---

# 消息与执行状态收敛提案 R5

起因：会话界面里消息状态、执行状态太多。同一件事在回执、执行行、执行台里各有一套说法，回执还经常和执行行重复。
本文给出统一词表、各位置的分工、逐处改动、Core 字段、合同、测试与验收。

- 交互稿：`docs/prototypes/status-convergence-20261122/index.html`（Git 忽略）。画面由生产 `BusinessApp` 在夹具中渲染，
  “建议”一侧是同一构建打开补丁 `capture/apply-proposal.mjs` 的真实结果。**画面对应 R4**；R5 的修订见下一节，
  四处变化通过生产组件浏览器夹具补拍：插话「待发送」、自动等待、现行恢复失败、执行卡状态位。
- 基线：`main@55fa60416`（v0.5.15）。行号以此为准，实施前用 `rg` 重新定位。

## R5 相对 R4

R4 评审的意见已逐条对照代码核实，全部属实。处理方式如下，能用一条通用规则解决的不按个案补。

| 评审意见 | 核实 | R5 处理 |
| --- | --- | --- |
| 尚未发出的插话显示「发送中」 | 插话绑定到启动中的 Run 即 `claimed`，`dispatchPhase` 在开始投递前为 `materialized`、之后为 `attempting`（`read_model.rs:2854`）。现行回执同样把前者显示为「插话中」 | 回执按 `dispatchPhase` 区分「待发送」「发送中」（2.4） |
| 退回队列后的显示 | `return_to_queue` 把 `requestedMode` 改回 `start`、状态改回 `waiting`（`steer.rs:360`） | 按普通消息显示「排队中」，不带插话前缀；执行卡插话行写「已转为排队」（2.4、2.5） |
| 「需要你处理」出现在自动等待上 | Core 共写入 13 种 `waitReason`，`action_execution`、`runtime_delivery`、`context_compaction` 等都无需用户操作（`action.rs:969`） | 改为白名单：只有待审批、待回答和 5 种需用户决定的等待原因算「需要你处理」，其余非终态一律「执行中」（2.1） |
| Pi 原生问答挂在 `running` 的 Run 上 | 快照 `nativeInteractions` 带 `agentRunId`、`executionEpoch`（`application.rs:8669`） | 同一 Run 有待审批或待回答时即「需要你处理」，不看 `status`（2.1） |
| 「结果无法确认」用了旧恢复路径 | 现行 Core 结算为 `failed / accepted_input_outcome_unknown`；架构要求“作为普通红色执行失败展示，不要求用户理解 unknown”（`agent-run-recovery.md:41-51`） | 现行路径显示「执行失败 · 查看原因」+ 重试；`waiting/recovery_blocked` 仅作旧数据兼容；验收改用现行路径（9） |
| 历史 `direct` 的失败与停止 | `direct + failed` 没有执行行，最近一次 `direct + cancelled` 有（`conversation-run-presence.test.ts:145、159`） | 不按 `invocationKind` 分支。通用规则：先由符合准入条件的执行行显示结果，其次由历史中断标记显示停止，其余失败或停止留在回执（2.4） |
| 核对资格把「Run 非终态」写成前提 | 核对命令按原 Run/epoch 查 Codex 并在原 turn 中匹配，允许迟到的接受证据（`application/steer.rs:273`） | 去掉非终态条件；Host 已释放时命令返回未确认，沿用现有反馈（4） |
| 「核对结果」与「查看执行」二选一 | `ThreadWorkspace.tsx:8900` | 有 Run 时始终显示「查看执行」，可核对时并列「核对结果」（2.4） |
| 只有 `terminalReasonCode` 的失败没有详情 | 配置类失败由读侧把 `last_error_code` 映射为 `terminalReasonCode`，没有 `failure`（`read_model.rs:3092`）；执行卡无内容可展开（`ThreadWorkspace.tsx:11850`） | 执行卡状态位显示「执行失败 · 原因」，执行行收起后原因仍在；可打开详情的执行行可写「查看原因」，卡内只保留具体原因（2.2.1、2.6） |
| 「智能体未登录」不覆盖缺少 API 密钥 | `runtime_failure.rs:260` 含凭据过期与缺少 Provider 凭据 | 改为「认证未通过」 |
| 手机摘要与单聊 | 手机摘要分支只在终态调用且卡片传入 `hideSummary`（`ThreadWorkspace.tsx:8454、11939`）；单聊另有等待提示，其 Run 投影没有 `waitReason`（`SingleChatPanel.tsx:402`） | 删除“手机摘要”条款，手机按实际入口验收；单聊与 `executionRunSummary` 移出本次范围（5） |
| 插话行「待发送」「已转为排队」同为时钟图标，触屏无法区分 | `RunInputRow.tsx:17` | 正常流程（待发送、发送中、已收到）只看图标；异常（未确认送达、未送达、已转为排队、原消息不可用）在标题里写字（2.5） |
| 验收范围过宽 | 工具行保留「等待审批」，用户正文也可能含旧词 | 只断言本次负责的状态元素；更新 `scripts/lib/run-presence.test.mjs`；同步执行面合同（8、9） |

评审未提到、R5 补充：继续按钮改用播放图标与 [Run Process Detail Surface v57](../../contracts/run-process-detail-surface-v57.md)
“继续与重试只显示既有 refresh 图标”冲突，实施时当前合同已到 v59，发布继承 v59 的 [v60](../../contracts/run-process-detail-surface-v60.md)（8）。

## 0. 现状（实测）

| 问题 | 例子（交互稿场景） |
| --- | --- |
| 同一件事多种说法 | 排队：回执「待处理」、执行台「排队中」/「准备中…」。失败：执行行「连接中断 · 查看原因」、读屏「执行中断」、回执「执行失败」、头像提示「失败」 |
| 回执与执行行重复 | 「已停止 1 · 执行失败 1」下方紧跟两条执行行；「处理中 1 · 待处理 1」与洛可的执行行重复 |
| 回执与事实不符 | 三人分别等审批、在重连、结果无法确认，悬停时回执写「处理中 3」（`ThreadWorkspace.tsx:8829` 把 `waiting` 归入 `inProgress`） |
| 等待原因同样轻重 | 「等待审批」「正在恢复」「结果待确认」看不出哪个在等用户 |
| 插话三套词 | 回执「插话中 / 已插话」（心跳图标），下拉「运行时已接收」，执行卡标题「插话 · 发送中 · …」「插话 · 待核对 · …」 |
| 重试与继续同一图标 | 均为 ↻（`ContinueAgentRunButton.tsx:65`） |
| 「核对结果」大多无效 | 对所有 Runtime 显示，Core 只能核对 Codex（`application/steer.rs:273`） |
| 文案 bug 与死代码 | 已送达无 Run 的收件人显示「未读」（`ThreadWorkspace.tsx:8778`）；`agentRunStateTag` 只被测试引用；`runtime_disconnected` 判断在 Core 中没有来源（`conversation-run-presence.ts:163`） |

## 1. 已确认的决定

1. 执行状态只用 7 个词，原因做后缀，格式「状态词 · 原因」。原因写大白话，不出现「Runtime」「运行时」等内部词（界面里统一叫「智能体」）。
2. 每位队员一个执行行，不分组；执行行结构不变，只改文字、标色和继续按钮图标。
3. 「需要你处理」的行用提醒色，不加直接操作按钮；点行仍打开执行台。
4. 旧路径 `waiting/recovery_blocked` 显示「需要你处理 · 结果无法确认」。现行路径已是失败，按普通失败显示（见 R5 说明）。
5. 重试保留 ↻；继续改用现有播放图标。均为图标按钮。
6. 插话保留展示：消息下以「插话 ·」开头；发给多位队员时写人数。执行卡插话行正常流程只写「插话 · 正文」。
7. 「核对结果」只在能核对的 Runtime 上显示，由 Core 给出，界面不判断 Runtime。

## 2. 规则（规范性）

### 2.1 执行状态词

按顺序判断，命中即止：

| 条件 | 状态词 | 语气 |
| --- | --- | --- |
| 非终态且 `cancelRequestedAt` 不为空 | 进度文字「正在停止…」 | neutral |
| `succeeded` | 已完成 | success |
| `failed` | 执行失败 | danger |
| `cancelled` | 已停止 | neutral |
| 快照中有同一 Run 的待审批（`approvals` 中 `agentRunId` 相同且 `status = pending`）或待回答（`nativeInteractions` 中 `agentRunId`、`executionEpoch` 相同） | 需要你处理 | attention |
| `waiting` + `approval` / `user_input` / `network_recovery_blocked` / `delivery_unknown` / `recovery_blocked` | 需要你处理 | attention |
| `running` + `failure.code = runtime_network_interrupted`；`waiting` + `runtime_recovery` / `network_recovery` / `runtime_delivery_recovery` | 正在恢复 | neutral |
| 其他非终态（含 `queued`、启动中，以及 `action_execution`、`runtime_delivery`、`context_compaction`、`skill_projection_drain`、`unknown_action_outcome`、`runtime_initializing` 和今后新增的等待原因） | 执行中 | info |

- 「需要你处理」只来自白名单和实际待办；未知等待原因默认「执行中」，不制造提醒。`unknown_action_outcome` 本身没有会话内可提交的用户操作，按「执行中」显示；如同一执行另有待办，按待办提醒。
- 会话执行行、头像栏和执行卡节点都用中性色转圈表示「正在恢复」。提醒色暂停图标仅用于「需要你处理」。
- 排队中：Delivery 已收下、还没有 Run（含 `waitCondition`）。
- 「启动中…」「正在停止…」、命令、正文、思考标题和兜底文案是**进度文字**，不是状态词，照旧出现在执行行和执行卡里。
  状态为「执行中」时，执行行显示进度文字，不显示状态词。

### 2.2 原因后缀（会话执行行）

原因是不超过 8 个字的短语，只在能帮用户判断时出现。

| 状态 | 原因 |
| --- | --- |
| 需要你处理 | 待审批：等你批准；待回答或 `user_input`：等你回答；`network_recovery_blocked`：自动恢复已停止；`delivery_unknown`：未确认送达；`recovery_blocked`：结果无法确认 |
| 正在恢复 | 网络：网络重连中；`runtime_recovery` / `runtime_delivery_recovery`：恢复上次执行 |
| 执行失败 | 见 2.2.1 |
| 已停止 | `planned_shutdown_cancelled`：应用已退出；其他不写原因 |

状态词加粗、原因用 muted；失败行整行保持 danger。需要你处理的状态图形用 `--attention`。
可访问名称写作「{队员}，{状态词}，{原因}，{描述}」。头像提示、回执下拉只用状态词。

#### 2.2.1 失败原因

只用 Core 已经归类的结果，界面不解析错误文本，也不直接显示 `failure.summary`（含「Runtime」「运行时」和产品名）。

| 来源 | 原因 |
| --- | --- |
| `failure.code = runtime_network_interrupted` | 网络中断 |
| `failure.code = runtime_authentication_required` | 认证未通过 |
| `failure.code = runtime_rate_limited` | 请求太频繁 |
| `failure.code = runtime_quota_exceeded` | 额度不足 |
| `failure.code = runtime_server_overloaded` | 服务繁忙 |
| `failure.code = runtime_model_unavailable` | 模型不可用 |
| `failure.code = runtime_permission_denied` | 没有访问权限 |
| `failure.code = runtime_execution_timeout` | 运行超时 |
| `failure.code = context_payload_too_large` | 内容过长 |
| `terminalReasonCode = runtime_not_configured` / `runtime_configuration_invalid` | 未设置智能体 / 智能体设置不完整 |
| `adapter_installation_missing` / `adapter_installation_disabled` | 找不到所选智能体 / 所选智能体已停用 |
| `runtime_configuration_adapter_mismatch`、`runtime_permission_adapter_mismatch` | 权限设置不匹配 |
| `conversation_runtime_override_unsupported` / `runtime_adapter_not_implemented` | 会话设置不受支持 / 当前系统不支持 |
| 其他 `runtime_permission_*` / 其他 `runtime_model_*` | 权限设置无效 / 模型设置无效 |
| `member_away`、`member_removed`、`agent_unavailable` | 队员不可用 |
| 其他，且 Run 有 `failure` 或过程记录（含 `accepted_input_outcome_unknown`） | 查看原因 |
| 其他，且没有可展开的详情 | 不写原因 |

- 归类在 `runtime_failure.rs` 的 `classify_high_value_runtime_error` 和 `public_codex_terminal_failure`。网络归类依据错误码文本
  （ECONNRESET、ETIMEDOUT、DNS 等）；Codex 带 `codexErrorInfo` 的流断开归为 `runtime_turn_failed`，显示「查看原因」，不猜测为网络中断。
- 原因映射在 shared 中只维护一份，执行行与执行卡状态位共用。

### 2.3 位置分工

| 位置 | 负责 |
| --- | --- |
| 消息回执 | 执行行说不了的：还没开始（排队中）、插话的送达、执行行和历史中断标记均未展示的失败或停止、未确认送达 |
| 执行行 | 每位队员这一次执行的「状态词 · 原因」或进度文字、用时、停止／重试／继续 |
| 执行台 | 完整状态与原因、过程；头像提示「{队员} · {状态词}」；执行卡状态位（2.6） |
| 顶栏「执行」入口 | 不变 |

### 2.4 消息回执

收件人分类沿用现有逻辑（`ThreadWorkspace.tsx:8803-8834`，每人只计一项），只改展示：

1. **计入回执**
   - 插话收件人（`requestedMode = 'steer'`）全部计入。
   - 普通收件人：还没有 Run 时，`pending`、`unknown`、`failed`、`stopped` 计入；有 Run 时只有 Run 的失败或停止计入，
     且仅当时间线上没有承接该结果的位置。符合准入条件的执行行优先，缓存首屏也为它保留结果，等最新快照到达再显示。
     手动停止的执行行收起后，已有队员回复或独立产物上的「你已中断」承接结果。既无执行行也无可见中断标记的旧版 `direct` 失败、历史失败或停止留在回执。进行中的 Run 不计入。
   - 没有计入项时不显示回执。
2. **插话状态**：`steerSending` 按 `delivery.dispatchPhase` 再分——`materialized`（已绑定、未开始投递）为「待发送」，`attempting` 为「发送中」；
   `inputDeliveryStatus = accepted` 为「已收到」，`delivery_unknown` 为「未确认送达」。插话收件人 `pending` 也是「待发送」。
3. **文字**：按顺序拼接 已收到、发送中、待发送、排队中、未确认送达、已停止、执行失败（最后一项沿用 danger）。
   收件人只有一位时不带数字，「已收到」写成「{队员}已收到」；多位时写「{词} {n}」。
4. **插话前缀**：有任一收件人仍为插话投递时，第一段前加「插话 · 」。例：「插话 · 洛可已收到」「插话 · 已收到 1 · 发送中 1 · 排队中 1」。
   插话被退回队列后 `requestedMode` 已是 `start`，按普通消息显示「排队中」，不带前缀。
5. **图标优先级**沿用：未确认送达（警示）＞执行失败＞发送中＞排队中／待发送（时钟）＞已停止＞已收到（勾）。
   发送中用插话图标（与执行卡插话行同形 `M3 3.5h10v7H7l-3.5 2v-2H3z` + `M5.5 6h5M5.5 8h3`），不用执行心跳。
6. **下拉**逐人：排队中 / 待发送 / 发送中 / 已收到 / 未确认送达 / 执行失败 / 已停止 / 已完成；其余按 2.1 的状态词。
   删除「未读」「启动中」「等待中」「运行时已接收」。有 Run 时始终显示「查看执行」；`canReconcile` 为 true 时并列「核对结果」。
7. 计入的回执始终可见。

「已收到」与原「已插话」边界相同：只表示智能体接收，不表示已处理。

### 2.5 执行卡里的插话行

- 正常流程（待发送、发送中、已收到）：标题「插话 · {正文摘要}」，状态只看行尾图标，提示与读屏写状态词。
- 异常（未确认送达、未送达、已转为排队、原消息不可用、原消息已删除）：标题「插话 · {状态} · {正文摘要}」，与现状写法相同。
- 图标形状沿用 `RunInputRow.tsx:17`；`pending` 的提示词由「待插话」改为「待发送」，`accepted` 由「运行时已接收」改为「已收到」，
  `delivery_unknown` 由「待核对」改为「未确认送达」，`queued` 由「已转排队」改为「已转为排队」。

### 2.6 执行卡状态位与其他

- **执行卡状态位**（`ThreadWorkspace.tsx:7803`，现在只给 `cancelled` 显示「已停止」）：`failed` 显示「执行失败 · {2.2.1 原因}」，
  只有「查看原因」这个兜底词时，卡内只写「执行失败」，详情在同一张卡里。
  `cancelled` 显示「已停止」（含原因时带原因）。执行行收起后，历史卡仍能看到具体原因。
- **排队卡**：`executionDeliveryQueuePresentation` 一律「排队中」，删除「准备中…」；「等待上一轮完成」说明保留。
- **继续按钮**：执行行 `appearance="continue"` 用播放图标，路径 `m8 5 11 7-11 7Z`（`MissionControls.tsx:25` 的 `play`），
  `viewBox 0 0 24 24`、描边 1.8；重试保留 `DialogControlIcon name="refresh"`。可访问名称不变（重试／继续执行）。
- **旧路径兼容**：`waiting/recovery_blocked` 的执行卡说明标题改为「结果无法确认」，正文「原请求不会自动重发。请先查看执行记录，
  再决定是否重新发送；清理完成后，后续消息会按正常顺序继续执行。」`network_recovery_blocked` 的「自动恢复已停止」不变。

## 3. 改动清单

| 文件 | 改动 |
| --- | --- |
| `shared/execution-presentation/index.ts` | 新增 `agentRunStatus(run, { cancelling, pendingApproval, pendingQuestion })`，返回 `{ word, reason, tone }`（2.1、2.2、2.2.1），原因映射只此一份。`agentRunPresentation` 原样保留给飞书卡片。删除 `agentRunStateTag` |
| `renderer/src/ThreadWorkspace.tsx:263` | `localizedAgentRunPresentation` 改为基于 `agentRunStatus`，传入该 Run 是否有待审批、待回答；调用点 7301、7309、8381、11940、12552 随之变为状态词 |
| `renderer/src/ThreadWorkspace.tsx:7803` | 执行卡状态位（2.6） |
| `renderer/src/ThreadWorkspace.tsx:7272` | 排队卡一律「排队中」 |
| `renderer/src/ThreadWorkspace.tsx:8778-8935` | 回执按 2.4 重写计入、文字、图标与下拉；删除「未读」等分支；「核对结果」与「查看执行」并列 |
| `renderer/src/ThreadWorkspace.tsx:11728` | 旧路径说明（2.6） |
| `renderer/src/conversation-run-presence.ts` | 将同一时间线的执行行资格用于回执；`RunPresencePreview` 增加 `label?`、`tone?`；`runPresencePreview` 对非「执行中」状态返回状态词与原因；删除 `runtime_disconnected` |
| `renderer/src/ConversationRunPresence.tsx:104、241-248` | 读屏描述「执行失败，查看原因」；预览渲染「**状态词** · 原因」；`is-attention` 类 |
| `renderer/src/conversation-run-presence.css` | `.run-presence-label`（ink、600）、`.run-presence-open.is-error .run-presence-label`（inherit）、`.run-presence-status.is-attention`（`--attention`） |
| `renderer/src/ContinueAgentRunButton.tsx:62-66` | 继续用播放图标 |
| `renderer/src/RunInputRow.tsx:16、35` | 提示词替换；正常流程标题去掉状态（2.5） |
| `renderer/src/locales/en.json` | 新增与改名的中文键补英文 |
| `crates/rovai-core/src/read_model.rs` | `canReconcile`（第 4 节） |

交互稿补丁 `capture/apply-proposal.mjs` 可作 R4 部分的参考实现；其中第 1 段直接改了 `agentRunPresentation`，实施时按上表新增函数。

## 4. Core：`canReconcile`

- `MessageDeliveryView` 增加可选 `canReconcile?: boolean`，由 `load_message_deliveries`（`read_model.rs:2838`）计算。
- 为 true 当且仅当：`requested_mode = 'steer'`，输入状态 `delivery_unknown`，目标 Run 的 Adapter 为 `codex-cli`，
  且该执行轮已记录初始 `native_input_id`——即 `reconcile_active_input` 的查询前提。不要求 Run 非终态：原 Host 仍可查询时允许迟到的接受证据；
  Host 已释放时命令返回 `delivery_unknown`，界面沿用「暂未确认送达」。
- 字段缺省按 false：旧 Host 不显示按钮。将来其他 Adapter 支持核对时只改 Core 判断。
- 测试覆盖：Codex 非终态、Codex 终态且 Host 仍在、Codex 终态且 Host 已释放（按钮显示，核对返回未确认）、非 Codex、已接收、缺 `native_input_id`。

## 5. 不在范围内

- 单聊（`SingleChatPanel` 的等待提示与运行摘要，其 Run 投影没有 `waitReason`）以及 `executionRunSummary` 的「工作了 X」等历史摘要。另行处理。
- 飞书、钉钉、Lark 渠道卡片的状态文字（`feishu-card.ts` 继续用 `agentRunPresentation`）。其配置类文案同样含「Runtime」，建议另行按决定 1 的文案规则清理。
- 世界地图环境文字（`camp-world-map-model.ts`）、顶栏「待处理 N」审批入口、工具行状态（含工具行「等待审批」）。
- 执行台卡片内 `appearance="icon"` 的继续按钮（`execution-continue`）、`ExecutionStatusGlyph` 的形状、执行台默认位置、通知。
- Core 状态机与数据。除 `canReconcile` 外无读模型变化，无数据迁移。

## 6. 对现有用户的影响

- 普通消息下大多不再出现回执：执行中的消息不再显示「处理中」，原来经由回执下拉「查看执行」打开执行台，改为点执行行。
  排队、送达异常、执行行及历史中断标记均未承接的失败／停止仍显示回执。
- 仍作为插话投递的消息下始终有「插话 · …」；退回队列的按普通消息显示「排队中」。插话在启动期显示「待发送」而不是「发送中」。
- 自动进行的等待（工具执行、结果回送、上下文压缩等）从「等待处理」等提醒改为「执行中」；Pi 原生问答等待回答时提醒。
- 配置类失败的原因在执行卡里也能看到。非 Codex 的「未确认送达」不再有「核对结果」按钮（原来点了也只能得到未确认）。
- 状态词变化：帮助文档、截图与英文文案同步；飞书卡片和单聊不变。

## 7. 测试

需要更新：

- `ThreadWorkspace.delivery-receipts.test.ts`：摘要、图标、下拉文字与按钮。
- `conversation-run-presence.test.ts`：状态词与原因；`runtime_disconnected` 相关断言删除。
- `App.test.ts`：删除 `agentRunStateTag` 用例；更新「处理中」「待处理」「准备中…」「执行异常，正在清理」等断言；`agentRunPresentation` 现有用例保留。
- `scripts/lib/run-presence.test.mjs:586` 起的浏览器回归：执行中不再断言回执「处理中 1」，改为通过执行行打开并定位执行。

新增：

- `agentRunStatus` 表驱动用例，覆盖 2.1、2.2、2.2.1 每一行，含：自动等待各原因为「执行中」、未知等待原因为「执行中」、
  `running` 且有待回答为「需要你处理 · 等你回答」、待审批优先于 `waitReason`、`codexErrorInfo` 流断开为「查看原因」、
  无详情的未知失败不写原因。
- 文案守卫：执行行、回执、回执下拉、插话行提示、执行卡状态位的中文文案不含「Runtime」「运行时」。
- 回执：单人插话（名字）、多人插话（「插话 · 已收到 1 · 发送中 1 · 排队中 1」）、`materialized`→「待发送」、`attempting`→「发送中」、
  退回队列→「排队中」无前缀、普通收件人执行中不计入、缓存首屏预留执行行、已有中断标记的停止不计入、`direct` 失败计入、被后续执行收起的失败计入、
  已送达无 Run 显示「已完成」、`canReconcile` 为 true 时「核对结果」与「查看执行」并列、为 false／缺省时只有「查看执行」。
- `RunInputRow`：正常流程标题无状态、异常标题含状态，提示与读屏为对应词。
- 执行卡状态位：配置类失败（无 `failure`）显示「执行失败 · 未设置智能体」等。
- `ContinueAgentRunButton`：继续为播放图标，重试为 ↻，可访问名称不变。
- Core：`canReconcile` 第 4 节各情形。

## 8. 文档与合同同步

- `docs/ui/components/conversation-workspace.md`：「A2A 会话消息」中处理回执一段、“处理中”回执与心跳路径一段、
  「Thread 执行过程」中“准备中…”的描述、「运行中插话」「Steer 资格与回执」「Run Card 中的插话」三节。
- 新增 Run Process Detail Surface v60（继承 [v59](../../contracts/run-process-detail-surface-v59.md)）：继续用播放图标、
  排队卡文案、执行卡失败状态位、执行行「状态词 · 原因」。
- 新增 Message Delivery v20（继承 [v19](../../contracts/message-delivery-v19.md)）：`canReconcile`。两份合同同步 `docs/contracts/README.md` 索引行。
- 本次决定已记录于[版本决定 D93](decisions.md#v1-72-d93)和[版本概览](README.md)。

## 9. 验收

只断言本次负责的状态元素：回执按钮与下拉的状态词、执行行的状态词与原因（`.run-presence-preview`、`.run-presence-label`）、
执行卡插话行标题与图标提示、排队卡文字、执行卡状态位、重试／继续图标。不对整个执行台或消息正文做全文排查。

| 场景 | 预期 |
| --- | --- |
| 一条消息给两人，一人执行、一人排队 | 回执「排队中 1」；下拉「执行中」「排队中」；排队卡「排队中」 |
| 插话：启动期 → 开始投递 → 接收 | 回执「插话 · 待发送」→「插话 · 发送中」→「插话 · 洛可已收到」；执行卡标题始终「插话 · 正文」 |
| 插话：未确认送达（Codex / 非 Codex） | 回执「插话 · 未确认送达」；Codex 下拉有「核对结果」与「查看执行」，非 Codex 只有「查看执行」；执行卡标题含「未确认送达」 |
| 插话退回队列 | 回执「排队中」无前缀；执行卡标题「插话 · 已转为排队 · …」 |
| 插话给三人 | 回执「插话 · 已收到 1 · 发送中 1 · 排队中 1」 |
| 等审批、等回答（Pi，Run 仍为 `running`） | 「需要你处理 · 等你批准」「需要你处理 · 等你回答」，提醒色 |
| 已批准的工具自动执行、结果回送 | 执行行显示进度文字，不出现「需要你处理」 |
| 网络重连、恢复上次执行 | 执行行显示「正在恢复 · 网络重连中」或「正在恢复 · 恢复上次执行」，执行行、头像栏和执行卡节点均为中性色转圈 |
| 现行“结果无法对账”：`failed / accepted_input_outcome_unknown` | 执行行「执行失败 · 查看原因」+ ↻，执行卡状态位只写「执行失败」；此时再发一条消息，回执与排队卡均为「排队中」 |
| 配置类失败（无 `failure`）后被后续执行收起 | 回执「执行失败」；执行卡状态位「执行失败 · 未设置智能体」 |
| 用户停止 | 执行行「已停止」+ 播放图标；行收起后已有「你已中断」时由该标记承接，回执不重复 |
| 手机（390 宽，实际执行卡入口） | 执行行与执行卡状态位同上；插话行异常状态可在标题读到 |

- 五套配色下「需要你处理」的提醒色与状态词对比度达标。
- 飞书卡片输出与改动前一致。
