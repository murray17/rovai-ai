---
document_type: model-context-change
version: v1.68
change_id: public-history-hint
revision: 1
confirmation_status: confirmed
confirmed_by: Principal
confirmed_at: 2026-09-23T14:34:51Z
confirmed_revision: 1
authority: proposed-model-input-change-statement
implementation_status: completed
last_updated: 2026-09-23
---

# 公共历史按需读取与执行边界提示：revision 1

本说明以当前公开 Camp 的 [Run Facts v6](../../contracts/run-facts-v6.md)、
[ContextManifest / Formatter 28](../../contracts/context-manifest-evidence-v28.md)、
[Profile 8](../../contracts/context-delivery-profile-v8.md) 和
[Camp History v8](../../contracts/camp-history-v8.md) 为变更前基线。v28 已明确旧冻结执行不再派发、
转换、双读或自动重播。本说明不从 v5/v27 推导旧执行兼容要求。

本 revision 合并 Mission 的公屏历史方案与 Principal 在 Camp 消息
`dcf41e56-53c6-4093-a6be-58c15372d023` 明确的范围：取消公开 Camp 自动历史投影；
完整保留 `RUN_INPUT`；用 `RUN_FACTS.historyHint` 提供上一次有效接受执行前的公屏边界；
`camp.read` 默认 20、显式上限 100，继续从最新页向较早消息倒翻。
Principal 在审阅完整 revision 1 后，于 Camp 消息
`1828d302-d8d7-4742-b504-d8de8fb53987` 明确同意实施并要求建 PR 合入 main。
该消息是本 revision 的二次确认；下述结构即实施范围。
确认后的说明从已完成的 v1.67 目录移至本次新建的 v1.68 目录，revision 与语义均未改变。

## 变更前：完整相关结构

新公开 Camp Run 的动态 section 顺序如下，问号表示沿现行条件可省略：

    [COLLABORATION_STATE]?
    [SELF_ACTIVE_TASKS]?
    [SHARED_CONVERSATION]?
    [RUN_FACTS]
    [WORKSPACE]?
    [RUN_INPUT]

当前公开模型 JSON 的完整相关顶层 shape：

    type CollaborationState = {
      peers: Array<{
        agentId: string
        name: string
        teamRole: string
        professionalResponsibilities: string
      }>
      defaultLeadAgentId: string | null
      selfIsDefaultLead: boolean
    }

    type SelfActiveTasks = {
      tasks: Array<{ taskId: string; title: string; status: string }>
      omittedCount?: number
    }

    type PublicRunFactsBefore = {
      attachmentOutputRoot: string
      mission?: {
        missionId: string
        title: string
        status: 'needs_you' | 'not_started' | 'in_progress' | 'completed'
        updateNotice?: 'Mission details have changed. Read the latest mission name and description before handling RUN_INPUT.'
      }
      taskContext?: {
        taskId: string
        referenceMode: 'frozen'
        laterChangesRetargetRun: false
      }
      sessionContinuity?: {
        state: 'lost'
        requiredAction: 'recheck_private_session_assumptions'
      }
      externalEffect?: {
        state: 'unsettled'
        requiredAction: 'reconcile_before_repeat'
      }
    }

    type Workspace = {
      workingDirectory: string
      branch?: string | null
    }

`attachmentOutputRoot` 必有；其余现有业务事实只在条件成立时出现，不输出 `null`、空替代对象或
`schemaVersion`。公开 `RUN_FACTS` 不含 `conversationMode`、`gather`、`delegation`。
`COLLABORATION_STATE` 按已接受的完整投影 digest 变化投递；
`SELF_ACTIVE_TASKS` 在真实空集合时为 `{"tasks":[]}`，存在候选但预算全淘汰时省略整个 section，
`omittedCount` 仅大于零时出现。`WORKSPACE` 只在 Mission 适用且新 Session 或事实 digest 变化时投递。

当前 `SHARED_CONVERSATION` 的完整公开 shape：

    type SharedConversationBefore = {
      campId: string
      messages: Array<PublicMessage>
      omittedCount?: number
      historyReadCursor?: string
    }

    type PublicMessage = {
      messageId: string
      sequence: number
      senderType: string
      senderId: string
      body: string
      anchorMessageId?: string
      quotes?: Array<{
        kind: 'message_excerpt'
        source: {
          scope: 'current_conversation_messages'
          messageId: string
          author: { type: 'user'; displayName: string } |
                  { type: 'agent'; agentId: string; displayName: string }
        }
        text: string
      }>
      attachments?: Array<{ name: string; mediaType: string; path: string }>
      mentionsCurrentUser?: true
    }

当窗口里没有可见历史候选且无遗漏时省略整个 section。候选属于
`(previousAcceptedPublicBoundarySequence, campMessageBoundarySequence]`，保留自己的发言，
也允许与 `RUN_INPUT` 同一条消息重复出现。Profile 8 先保障完整 `RUN_INPUT`，再取最近至多 15 条
历史并按剩余字节预算保留完整后缀；有真实遗漏才同时输出 `omittedCount` 和
`historyReadCursor`。两者只描述自动投影，不是 Run 输入或阅读进度。

`RUN_INPUT` 当前完整模型 shape 如下；本次变更后逐字段、顺序和省略规则相同：

    type RunInput = {
      messages: Array<PublicMessage & {
        skills?: Array<{ name: string; path: string }>
      }>
    }

`messages` 非空，按 public sequence 升序，恰为本 Run 原子 claim 的连续 FIFO 消息集合。
每条消息正文、引用、附件路径、Skill 链接与现有默认接收者 Mention 派生完整投递；
`anchorMessageId`、`quotes`、`attachments`、`skills` 仅有内容时出现，
`mentionsCurrentUser` 只在为真时出现。最后一条消息是 Run anchor。引用来源的
`scope=current_conversation_messages` 由现有 quote 合同决定；引用不是新的工作指令。

当前 public Profile 8 的内部 JSON 为：

    {
      "profileVersion": 8,
      "maxPublicMessages": 15,
      "maxPublicHistoryChars": 24000,
      "maxMessageBodyChars": 2000,
      "maxPublicReferenceChainMessages": 3,
      "maxSelfActiveTasks": 8
    }

Profile 8 只让自动历史使用前四个上限；Run 输入仍按 Runtime 已冻结的
`maxContextPayloadBytes`（能力缺失时默认 96 × 1024 UTF-8 bytes）与真实序列化 payload
作完整消息选择，队首超限明确失败，不截断消息。Manifest 28 保存
`previousAcceptedPublicBoundarySequence`、本 Run 公屏尾、所选历史 refs/evidence、
遗漏范围、Profile、`RUN_FACTS` 原始 JSON/digest、`RUN_INPUT` refs/digest 和完整 payload/digest。

当前公开 Session Charter 在按需取回原则后的原文是：

    - Preserve existing user work. Do not infer omitted content; retrieve it only when the current work requires it. Memory indexes and retrieval keys are discovery hints; read a Memory before relying on it.
    - In SHARED_CONVERSATION, the top-level campId applies to every projected message. omittedCount and historyReadCursor are paired hints for earlier live Camp history; they do not add work to RUN_INPUT.

当前 `camp.read` timeline/thread 不传 `limit` 为 20，显式接受整数 1–20；
`before` 是排他的 public sequence 续读位置。结果包含按 sequence 升序的完整本页
`items`、`hasMore` 和 `nextCursor`（无下页为 `null`）。`messageId` 精确读取不接受
`limit`；timeline/thread 只能从最新可见页向较早页续读，没有 `after` 输入。

## 变更后：完整目标结构

新公开 Camp Run 的动态 section 顺序为：

    [COLLABORATION_STATE]?
    [SELF_ACTIVE_TASKS]?
    [RUN_FACTS]
    [WORKSPACE]?
    [RUN_INPUT]

`SHARED_CONVERSATION` 不再出现，也不在其他 section、自动摘要、合成消息或
`RUN_INPUT.messages[]` 里转存历史。`COLLABORATION_STATE`、`SELF_ACTIVE_TASKS`、
`WORKSPACE` 和 `RUN_INPUT` 使用上文完整 shape 与既有出现、省略和选择规则；
`RUN_INPUT` 仍是唯一的当前工作集合。

新 public `RUN_FACTS` 完整 shape 为：

    type PublicRunFactsAfter = {
      attachmentOutputRoot: string
      historyHint: string
      mission?: {
        missionId: string
        title: string
        status: 'needs_you' | 'not_started' | 'in_progress' | 'completed'
        updateNotice?: 'Mission details have changed. Read the latest mission name and description before handling RUN_INPUT.'
      }
      taskContext?: {
        taskId: string
        referenceMode: 'frozen'
        laterChangesRetargetRun: false
      }
      sessionContinuity?: {
        state: 'lost'
        requiredAction: 'recheck_private_session_assumptions'
      }
      externalEffect?: {
        state: 'unsettled'
        requiredAction: 'reconcile_before_repeat'
      }
    }

`historyHint` 每个新公开 Run 必有，且只允许下列两种英文值：

    有有效的先前执行前边界 N：
    The latest public message before your last recorded run in this Camp had sequence {N}.

    没有有效的先前边界：
    No public-message boundary from a previous run is recorded for you in this Camp.

`N` 是当前 `(CampId, AgentId)` 上一次有效接受的 Run 在执行前冻结的公屏尾序号，
不是上一条用户消息序号、上次 `RUN_INPUT` 的最大序号、已读或处理进度。
内部零值表示尚无有效记录，不作为消息序号输出。没有边界时不推断“首次执行”或“无历史”。
例如边界 150 已有效记录，即使该 Run 后被用户停止，下一个 Run 仍使用 150；
若该 Run 未形成有效边界，就沿用更早边界或使用“没有记录”文案。
`historyHint` 由 Core 在构造本轮 facts 时生成并计入输入长度，与其他 facts 一起冻结；
同一新格式 Run 恢复直接复用已冻结字节，不从当前水位重算。

公开 Charter 只把上述第二条整体替换为以下原文，第一条逐字保留：

    - Preserve existing user work. Do not infer omitted content; retrieve it only when the current work requires it. Memory indexes and retrieval keys are discovery hints; read a Memory before relying on it.
    - Use `rovai camp read` for relevant Camp history. The boundary in `RUN_FACTS.historyHint` is a reference point, not a record of messages read or work completed.

其他 Charter 段落、Mission-only、Runtime-specific 条款和
“`RUN_INPUT.messages` 是本 Run 全部当前工作”的原文不变。
Charter 不要求每轮读历史，也不要求补齐整个序号区间。

新 public Profile 9 仅保存仍对公开自动上下文有效的选择上限：

    { "profileVersion": 9, "maxSelfActiveTasks": 8 }

Profile 8 中 `maxPublicMessages`、`maxPublicHistoryChars`、`maxMessageBodyChars` 和
`maxPublicReferenceChainMessages` 只用于已删除的自动公屏历史投影，不进入新 public
Profile 或模型输入选择。非 batch Profile 6 的字段与行为原样保留。
Runtime payload capacity、完整 FIFO `RUN_INPUT` 优先、Optional Task 裁剪和超限失败保持原机制；
新增的 `historyHint` 必须参与 claim 预估与最终实际字节检查。

新 Manifest 29 对同一 Run 冻结 public Profile 9、执行前接受水位、本次公屏尾、
`RUN_FACTS` 原始 JSON 与 digest、完整 `RUN_INPUT` refs/digest、Skill/附件/可见性证据、
Bootstrap/Collaboration/Workspace 证据和真实 payload bytes/digest。
`runFactRefs` 记入 `history_hint`，不向模型输出内部数值字段。新 Run 的历史专属
`recentMessageRefs`、`referenceClosureRefs`、`omissionEntries` 和
`sharedMessageEvidence` 为空集合；`omittedMessageCount` 与 sequence bounds 为空值；
`rawMessageRefs`、附件 refs 只来自 `RUN_INPUT`。保留现有数据库列以容纳这些空值，
不因删除模型 section 迁移或改写旧记录。

`camp.read` timeline/thread 继续用排他 `before` 倒翻，改为：

| 输入/结果 | 目标行为 |
| --- | --- |
| 不传 `--limit` | 最多返回 20 条可见消息 |
| `--limit N` | 仅接受整数 1–100，返回最多 N 条完整消息 |
| 0、101、负数、非整数或非数字 | 明确参数错误，不截断、钳位或静默代换 |
| 合格消息超过本页容量 | 返回完整本页、`hasMore=true` 与可用于下一次 `--before` 的 `nextCursor` |
| 合格消息不足容量 | 返回实际可见消息、`hasMore=false`、`nextCursor=null` |

thread 使用同一数量与分页语义；`messageId` 精确读取仍不接受 `limit`。
响应 schema 的 timeline/thread `items.maxItems` 改为 100。消息继续按页内 sequence
升序输出，续读从本页最早 sequence 之前继续。边界可能有不可见消息和序号空洞，
`historyHint` 不保证一次请求覆盖某个范围，也不直接充当 `before` 游标。
Agent 可按当前任务需要从最新页逐页倒翻；不会增加按 N 向前读取的新接口。

## 明确不变

- `RUN_INPUT` 的全部字段、正文、顺序、引用、附件、Skill、合批、默认接收者 Mention、
  投递责任及权限保持；不因旧 Run 停止而重新加入旧输入。
- `(CampId, AgentId)` 接受水位仅在匹配 Run、Binding、generation 的有效 Runtime
  accepted ACK 后推进到本 Run 冻结的执行前公屏尾。读取、搜索、发布、Run 结束/失败/停止、
  prepared/rejected/unknown 或迟到、过期 ACK 不提供第二条推进路径，也不回退已有效边界。
- 公屏存储、可见性、撤回、recipient suppression、引用 source 校验、实时
  `camp.read` 权威、消息发布与 Delivery 机制不变；读取不 claim Delivery 或推进水位。
- Bootstrap 的 section 顺序、`MEMBER_IDENTITY`、Memory Entrypoint、内置 CLI 合同及
  `RUN_INPUT` 权威说明不变。Single Chat 和其他非 batch 动态 section/事实/Profile 仍走
  当前 26/5/6 轴，不接收 `historyHint`。
- 保留其他本轮事实、Self Active Task 选择与预算、Mission/Workspace 权威、
  Runtime 交付证据。新 Run 的真实序列化与 digest 仍是证明模型实际可见内容的依据。

## 版本轴、失效与兼容策略

| 轴 | 当前基线 | revision 1 目标 |
| --- | --- | --- |
| 公开 Run Facts 内部合同 | 6 | 7；模型只增加必有的英文 `historyHint` |
| 公开 Formatter / ContextManifest | 28 / 28 | 29 / 29 |
| 公开 Context Delivery Profile | 8 | 9；删除已无用途的四个自动历史上限 |
| 公开 Session Charter revision | 12 | 13；只替换一条公开历史指导 |
| Native Bootstrap 合同 / Formatter | v4 / 4 | v4 / 4；Bootstrap section 和身份结构不变 |
| 非 batch Formatter / Manifest / Profile / Run Facts | 26 / 26 / 6 / 5 | 不变 |
| Camp History 合同 | 8 | 9；`camp.read` 的 timeline/thread 最大 100 |
| Built-in CLI 运输与结果 Envelope | v32 | 不变；只更新 `camp.read` 参数 schema/help 与分页上限 |

Charter revision 在当前共享 Binding compatibility digest 中升级，确保新公开 Session
不沿用旧 Charter；非 batch 的 Charter 文本不改。若实施发现能用现有 seam 精确避免
无关非 batch Binding 轮换，应在不改变这里的模型字节与公开版本目标下收敛；
不得为此引入多版本运行框架或向 Agent 暴露版本号。

旧 ContextManifest、冻结 Runtime payload、Bootstrap Evidence、命令回执、历史审计和公屏消息
原字节保存。旧格式执行**不再继续派发或恢复**，不迁移、回填、格式转换、双读或自动重播；
需要继续工作时建立新的执行，必要时使用新 Session。新格式同一 Run 的输入、
`historyHint`、Manifest 和 Runtime payload 则照常冻结并复用。这两种边界不互相推导。
本次没有业务数据迁移，也不新增阅读记录、已读确认、未读数量或强制补读机制。

## 验证

以下包含可执行验证与关键负向测试：

1. 对新公开 Run 校验 section 精确顺序、完全没有 `SHARED_CONVERSATION`；
   即使间隔 0、1、15、超过 15 或超过 100 条，也没有自动历史消息、摘要或遗漏提示。
   `RUN_INPUT` 与变更前逐字段、顺序、正文、引用、附件、Skill 和 Mention 一致。
2. 无先前有效水位时生成固定无边界文案；有效水位为 150 时生成固定 N 文案。
   Run 150 被用户停止后 151 仍提示 150；无有效 ACK 则沿用更早有效边界。
   读/搜/发、rejected、unknown、stale ACK、Run 终态均不推进或回退水位。
3. claim 保持现有完整 `RUN_INPUT` 前缀选择，最终完整 payload 检查计入
   `historyHint` UTF-8 bytes；队首超容量仍 `context_payload_too_large`，
   不发送残缺 `RUN_INPUT`。Manifest 的 Profile 9、
   facts JSON/digest、空历史 evidence 和完整 payload digest 与实际字节一致。
   新格式同一 Run 恢复的提示字节不因后续水位变化而漂移；旧 28 冻结执行不派发、转换或重播。
4. `camp.read` timeline/thread 用默认 20 与显式 1、20、100 验证条数、完整正文、
   `hasMore/nextCursor` 和排他续读；0、101、负数、小数、字符串明确报参数错误。
   精确 `messageId` 仍拒绝 `limit`。以超过 200 条可见消息的长间隔 Case
   从最新页逐页倒翻到边界之后，校验无漏页、无重复及可见性过滤；不把部分页报告成全部。
5. 检查公开 Charter 只替换指定一行；非 batch/Single Chat 的模型内容与版本轴保持。
   运行定向 Core/CLI/schema 验证、文档通用门禁，并按
   [上下文改动 Gate](../../development/evaluation.md#上下文改动-gate)
   保留新旧真实任务执行对照、Case/预算与结果。

## 二次确认

`confirmation_status: confirmed`、`confirmed_revision: 1`。确认者为 Principal，
时间与来源为上述 Camp 消息。原始 Mission、范围澄清和实现者判断不替代此确认；
如方案语义改变，先递增 revision，再重新确认。

## 实施与验证记录（2026-09-23）

已按确认的 revision 1 实施；核心提交为 `29a0c2c6`，旧 Profile 摘要路径的修正提交为
`14018d8f`。实际公开轴为 Run Facts 7、Formatter/Manifest 29、Profile 9、
Charter revision 13、Camp History 9；数据合同为 v1.68/schema 122，migration 172。
非 batch 26/5/6 轴未变。Profile 9 冻结 JSON 仅含 `profileVersion` 和
`maxSelfActiveTasks`。旧业务行及 ContextManifest/AgentRunInput 证据在升级时保留原字节，
新公开 batch 写入受 29/9/7 约束；旧格式执行仍不续派或恢复。

`pnpm test:rust:pr`、42 项 Context 慢速测试、230 条消息的 `camp.read` 倒翻 owner 测试、
schema 172 保留/门禁/重启 owner 测试、旧 Profile 4 摘要迁移定向测试、
`cargo fmt --all -- --check`、`pnpm docs:test`、`pnpm docs:check`、
`DOCS_BASE_REF=origin/main pnpm docs:check:ci` 与 `git diff --check` 通过。
构建出的 CLI help 显示默认 20、显式 1–100；101 与小数值返回参数错误。
一次全量扩展 Rust 检查记录 815 通过、56 失败、6 忽略；其中本次的旧触发器断言和
Profile 4 摘要问题已修正并分别定向通过。合入前基线也复现早期迁移夹具失败，
但全量扩展检查仍未通过，不能将余下失败概括为已全部证实的既有问题。

冻结的 12 个通用 Case Gate 保留两次尝试：基线 `776f1345`，最终候选
`14018d8f`，计划 digest `386a3d74…`（第二次计划因候选产品更新而另有 digest）。
两次报告均为 `insufficient`、无已证实新回归、各有 57 项证据缺口；
基线合同检查已有 3 项失败，候选合同清单仍要求已退役的自动历史 cursor 测试，
因此 24 个计划 Trial 均未启动，Judge 未评分。报告保存在本机
`/tmp/rovai-m053-gate-campaign/attempt-01` 与 `attempt-02`；
这不是 12 Case Gate 通过的证据。

另以原封存 `DEMO-109` 单独运行真实 Runtime：基线和最终候选的硬验收均通过，
都从序号 1 的公屏原文交付 `region=eu-west`、`retryLimit=4`。
候选实际 Manifest 记录 Formatter 29、Profile 9、必有的无旧边界
`historyHint`，自动历史 evidence、recent refs 与遗漏均为空；
工具账本记录基线 2 次、候选 1 次 `camp.read`。
两侧单次耗时分别约 135 秒、205 秒；该诊断 Case 无语义 Judge，
也不能替代受合同检查阻断的通用 Gate 或证明总体耗时趋势。
原始 Trial 保存在本机 `/tmp/rovai-m053-supplemental-trials/DEMO-109-*`。
