---
document_type: model-context-change
version: v1.72
revision: 2
confirmation_status: confirmed
confirmed_revision: 2
confirmed_by: local_user
confirmed_at: 2026-10-03
last_updated: 2026-10-03
---

# Thread 消息寻址与执行查询方案

本稿 r2 将本 Thread 已确认的功能边界整理为已确认的实施方案。目标是让 Agent 查询消息实际寻址，以及谁正在执行、排队或等待。公开条目使用统一的 `items` 与可空 `agentRunId`，不提供 `kind` 或替代分类字段。

完整的 CLI 帮助和模型指令前后文本见[提示词与帮助对照](thread-runs-prompt-comparison.md)。User 已确认 r2 并授权实施；下文保留已确认的设计内容，实施验证在末尾记录。

## 基线与依据

| 项目 | 内容 |
| --- | --- |
| 源码基线 | `f229ce3edf24d4054499babf98b0b3d984e46868` |
| 当前版本 | [版本索引](../README.md)的 v1.72；本次不切换版本 |
| 分支 | `docs/thread-runs-proposal` |
| Worktree | `/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-thread-runs-proposal` |
| Governance | r2 已由 User 确认；实现与合同在同一 PR 合入，无主线治理先行要求 |
| 交付 | 实施与本地验证完成；本次真实任务 Gate 已获 User 豁免；合入记录见 [PR #616](https://github.com/murray17/rovai-ai/pull/616) |

需求依据依次为本 Thread 消息 `98604f4e-d2b7-4ae4-87df-78a916d726e4` 的原方案、
`03c543ae-71ce-414c-a9d6-94986a7e2bc7` 的范围修订、
`37e8b079-22e1-4a8b-9505-05fb5ed584e5` 的删除 kind 修订，
以及 `a395d409-77a6-47e0-869f-de785630bec8` 的完整方案与提示词对照要求。
`ae8c973a-a910-45b4-b789-aa780c7f06b9` 进一步要求上下文提示词尽可能简洁有效，本稿据此保持平台 description 不变，将具体用法放在按需帮助中。
`ce60027c-acac-43ff-ad2f-daa231c3ca05` 要求本次升级保留旧 Session 的 resume 与冻结 Bootstrap、新 Session 使用新版 Bootstrap，并让升级用户直接取得新版 Skill。r2 明确这三条生效规则；CLI 设计和提示词全文保持 r1 内容。

当前权威为 [Camp History v10](../../contracts/camp-history-v10.md)、
[Thread Naming v1](../../contracts/thread-naming-v1.md)、
[Message Delivery v10](../../contracts/message-delivery-v10.md)、
[公开消息与执行架构](../../architecture/public-a2a-message-delivery.md)、
[Built-in Transport v34](../../contracts/builtin-tool-transport-v34.md)和
[Single Chat v8](../../contracts/single-chat-v8.md)。代码事实以本基线的
[camp_history.rs](../../../crates/rovai-core/src/camp_history.rs)、
[delivery_queue.rs](../../../crates/rovai-core/src/delivery_queue.rs)、
[read_model.rs](../../../crates/rovai-core/src/read_model.rs)及
[single_chat.rs](../../../crates/rovai-core/src/single_chat.rs)核对。

## 变更前

- `thread read` 的正常单条详情已有 `addressing`，时间线和回复链的正常条目没有；撤回项只返回固定占位。
- Agent CLI 没有 `thread runs`。现有 Desktop 读取不能直接成为新接口：它含展示状态映射及不同的旧 Run 预览回退。
- 数据库已保存 waiting Delivery、真实 AgentRun 与有序 `agent_run_input`。无需建立新的排队或摘要存储。
- 当前公开 Charter 与 CLI 根帮助只列 `thread list|search|read`；cli-operations 没有执行状态查询指引。
- cli-operations 的历史 reference 仍将所有显式历史读取描述为冻结范围，与当前 `thread read` 实时读取不一致。仅修正与本功能直接相关的这段教学。

附录保存源码还原的完整原文，包括公开 Charter、CLI 根帮助、read 帮助、Skill 正文和 reference。平台 Skill 索引保持原文；对照没有用旧设计稿代替当前原文。

## 变更后

### CLI 入口

新增 Agent operation `thread.runs`，命令为 `rovai thread runs`。沿用当前认证、目录发现、输入解析、IPC、结果投影和错误运输。不增加 `rovai app` 入口或执行管理动作。

```bash
rovai thread read --limit 20
rovai thread read --reply-chain <message-id> --limit 20
rovai thread read --message-id <message-id>

rovai thread runs
rovai thread runs --active
rovai thread runs --agent-id <agent-id> --active
rovai thread runs --status running
rovai thread runs --status queued
rovai thread runs --thread-id <thread-id> --active
rovai thread runs --limit 20
rovai thread runs --cursor <nextCursor>
```

每次调用只接受一种输入来源：直接 flags、stdin/heredoc 的一个 JSON 对象，或 `--input-file <path>`。不能混合来源；未知字段、未知 flag、重复 flag 和错误类型沿用封闭校验。

同一查询的 JSON 输入可写为：

```json
{
  "agentId": "agent_B",
  "active": true,
  "limit": 20
}
```

将该对象保存为 `query.json` 后使用 `rovai thread runs --input-file query.json`；stdin 方式为：

```bash
rovai thread runs <<'JSON'
{"agentId":"agent_B","active":true,"limit":20}
JSON
```

续读这个查询须保留筛选条件，例如 `rovai thread runs --agent-id agent_B --active --cursor '<nextCursor>'`。

新 operation 的规范公开名称只有 `thread.runs`，字段为 `threadId`。不新增 `camp.runs` operation、`campId` 字段或 `--camp-id` 别名；现有 list/search/read 的兼容别名保持。若已有 CLI 族名解析把旧 `camp` 归一成 `thread`，继续沿用该通用路径，不为 runs 单独增加或屏蔽族名别名。

业务调用固定输出 JSON，不接受 `--json`、`--table`、`--output`。正常结果直接输出业务对象；失败沿用 `{"error":{...}}`。Core 内部 Envelope/receipt 不额外暴露到 stdout。帮助和版本查询保持现有文本行为。退出码复用现有 CLI，不增加本功能专用值。

### thread read 输入与输出

输入字段和互斥规则不变：

```ts
type ThreadReadInput = {
  threadId?: string
  messageId?: string
  replyChain?: string
  before?: number
  limit?: number
}
```

`messageId` 不能与 `replyChain / before / limit` 组合。无消息选择器时读取时间线；`replyChain` 读取回复链。默认 limit 20，显式范围 1–100；`before` 继续使用消息 sequence。没有 `mode` 或 `direction` 输入参数。输出既有 mode/direction 字段保持。

所有正常消息条目必须返回：

```ts
type MessageAddressing = {
  effectiveAgentRecipients: string[]
  mentionsCurrentUser: boolean
}
```

`effectiveAgentRecipients` 读取发布时持久化的有效接收者；不重解析正文，不按当前成员或活跃状态重算。无接收者为 `[]`。`mentionsCurrentUser` 由已有结构化用户提及投影得出，无提及为 `false`；它不是用户可见性标志。

时间线、回复链的正常条目保留 `messageId / sequence / authorType / authorId / anchorMessageId / createdAt / body / attachmentCount` 和可选 `quotes`，新增必有 `addressing`。精确单条继续保留这些字段及 `attachments / attachmentsTruncated / attachmentOmittedCount`，其 addressing 形状不变。附件和引用继续使用当前合同，不新增附件加载或引用展开。

```json
{
  "threadId": "<thread-id>",
  "mode": "timeline",
  "direction": "before",
  "items": [
    {
      "messageId": "M1",
      "sequence": 1,
      "authorType": "agent",
      "authorId": "agent_A",
      "anchorMessageId": null,
      "createdAt": "2026-10-02T12:00:00Z",
      "body": "请检查登录接口。",
      "attachmentCount": 0,
      "addressing": {
        "effectiveAgentRecipients": ["agent_B"],
        "mentionsCurrentUser": false
      }
    },
    {
      "messageId": "M2",
      "sequence": 2,
      "withdrawn": true,
      "displayText": "Message withdrawn"
    }
  ],
  "hasMore": false,
  "nextCursor": null
}
```

撤回项仍恰好只有 `messageId / sequence / withdrawn / displayText`，不得带 addressing、作者、正文、时间或附件。回复链与单条外层结构、排序、分页和既有错误保持原样。正常条目的 addressing 在同一读取事务中取得；对当前页批量读取或并入已有查询，避免逐条新增往返。

### thread runs 输入

```ts
type RunStatus =
  | "queued"
  | "running"
  | "waiting"
  | "succeeded"
  | "failed"
  | "cancelled"

type ThreadRunsInput = {
  threadId?: string
  agentId?: string
  active?: boolean
  status?: RunStatus
  limit?: number
  cursor?: string
}
```

| 字段 | CLI flag | 规则 |
| --- | --- | --- |
| threadId | `--thread-id` | 省略使用认证当前 Thread；显式目标按当前 thread read 的实时范围校验 |
| agentId | `--agent-id` | 按 canonical Agent ID 精确筛选；不按显示名解析，不要求该 Agent 当前仍在队 |
| active | `--active` | 默认 false；启用后返回 queued/running/waiting 的真实 Run 和当前排队集合 |
| status | `--status` | 上述六种值之一；queued 同时包含有 ID 和无 ID 的排队条目 |
| limit | `--limit` | 默认 20，整数 1–100；限制条目数，不限制集合内消息计数 |
| cursor | `--cursor` | 非空 opaque 字符串；必须来自相同规范化 Thread 与筛选条件 |

`active` 与 `status` 为输入层面的互斥字段；显式 JSON `active:false` 与 status 同时出现也拒绝。省略 active 和显式 false 在没有 status 时归一为相同筛选。flag `--active` 使用既有 boolean flag 解析，不增加 `--inactive`。

字符串按现有读取习惯去除首尾空白，空 Thread/Agent/cursor 拒绝；status 大小写精确。合法但没有匹配记录的 agentId 返回空列表，不调用队员发现接口补全。不存在、正在删除或当前不能读取的 Thread 返回不可用错误，不返回伪造空列表。

### thread runs 完整返回体

```ts
type MessagePreview = {
  messageId: string
  text: string
  truncated: boolean
}

type ThreadExecutionItem = {
  agentRunId: string | null
  agentId: string
  status: RunStatus
  messageCount: number | null
  messagePreview: MessagePreview | null
  waitReason: null
  cancelRequestedAt: string | null
  createdAt: string
  startedAt: string | null
  endedAt: string | null
}

type ThreadRunsResult = {
  threadId: string
  observedAt: string
  items: ThreadExecutionItem[]
  hasMore: boolean
  nextCursor: string | null
}
```

所有列出的返回字段都必有，nullable 字段返回 JSON null，不省略。时间为 RFC 3339 UTC 字符串。新结果 Schema 在各 object 层关闭额外字段，拒绝 `kind / isPending / claimed` 等替代分类。

```json
{
  "threadId": "<thread-id>",
  "observedAt": "2026-10-02T12:00:00Z",
  "items": [
    {
      "agentRunId": null,
      "agentId": "agent_B",
      "status": "queued",
      "messageCount": 3,
      "messagePreview": {
        "messageId": "M3",
        "text": "接下来请检查权限配置。",
        "truncated": false
      },
      "waitReason": null,
      "cancelRequestedAt": null,
      "createdAt": "2026-10-02T11:59:00Z",
      "startedAt": null,
      "endedAt": null
    },
    {
      "agentRunId": "R1",
      "agentId": "agent_B",
      "status": "running",
      "messageCount": 2,
      "messagePreview": {
        "messageId": "M1",
        "text": "请检查登录接口。",
        "truncated": false
      },
      "waitReason": null,
      "cancelRequestedAt": null,
      "createdAt": "2026-10-02T11:58:00Z",
      "startedAt": "2026-10-02T11:58:01Z",
      "endedAt": null
    }
  ],
  "hasMore": false,
  "nextCursor": null
}
```

示例 ID 只作说明。排序仍按创建时间倒序，因此例中较新的排队集合先出现；不额外按状态或队员重排。

| 字段或约束 | 已创建的真实 Run | 尚未形成 Run 的排队集合 |
| --- | --- | --- |
| agentRunId | 真实 ID，非空字符串 | null |
| status | agent_run 的六种权威状态 | 固定 queued |
| messageCount | 完整冻结输入关联数；无法证明时 null | 当前 waiting 消息数量，正整数 |
| messagePreview 来源 | agent_run_input 按 ordinal 的第一条 | 按 queue_sequence 的当前队首 |
| createdAt | Run 创建时间 | 当前队首 Delivery 的创建时间 |
| startedAt / endedAt | 实际开始、结束时间，无则 null | 均为 null |
| cancelRequestedAt | 原始停止请求时间，无则 null | null |
| waitReason | 首版统一 null | 首版统一 null |

`agentRunId = null` 必须推出 `status = queued`，反向不成立。Schema 使用上述约束校验，不需要公开 discriminator。无 ID 的条目每个 Thread、每位 Agent 最多一个；没有 waiting 消息就不返回该条目。条目数不是实际 Run 数量。

`waitReason: null` 只表示本接口未提供原因。首版不读取或发布原始异常、路径、等待原因码，也不推测排队原因。`--active` 不证明进程存活、Agent 空闲、旧执行隔离或后继任务可领取。终态及停止字段不是 Task/Mission 完成证明。

### 公开范围与一致读取

1. 沿用现有 Built-in 调用方认证，再进入一次只读一致事务。Single Chat 调用方由现有 operation policy 拒绝新命令，不扩展 allowlist。
2. 解析当前或显式指定的存续公共 Thread。显式历史 Thread 使用当前 thread read 的实时边界，不使用 history.search 的冻结全局边界。目标 membership 不是公共读取 ACL。
3. 先筛选公共 Run：兼容 `agent_run.camp_id` 与历史 `camp_turn.camp_id`；排除 Single Chat 的执行和私有 Conversation。不能仅隐藏其预览。只按目标 Thread 筛选，不跨 Thread 合并同一 Agent。
4. 真实 Run 从 `agent_run` 读取领域状态，过滤与返回共用同一状态。不能复用 Desktop 的 failed → cancelled 展示映射。
5. 从现有 `camp_message_delivery` 的 waiting 行按 Thread、Agent 聚合。不从已 claimed 行或历史旧队列表重新构造排队集合。正常的撤回/离队结算规则继续由原写事务负责，查询不修复队列、不补建 Conversation。
6. 当前页 Run、队列聚合及预览源均在同一事务中取得。claim 的写事务仍原子创建 Run、冻结输入并改变 Delivery 状态，所以一次响应不能把同一投递责任同时算在未领取集合和已领取 Run 中。
7. 新增 operation 仍经过现有工具调用证据记录；“只读”指不改变消息、Delivery、Run 或调度业务事实，不禁止已有审计记录。

读取预览使用同一事务中的消息公开投影，并按 thread read 的 tombstone、撤回、归属和边界检查。可撤回但尚未撤回的公开消息仍可被主动读取；读取不会领取消息或关闭撤回资格。

### 输入关联与预览

真实 Run 的数量先对 `agent_run_input` 的全部冻结关联计数，不与可见消息做 inner join 后再计数。第一条由最小 ordinal 确定；不使用 anchor、最后一条、触发消息、日志或冻结 Prompt 回退。

旧 Run 没有可靠完整关联时 messageCount 为 null；无法证明第一条时 messagePreview 为 null。当前新 batch Run 按既有不变量至少有一条输入；若该不变量被破坏，应走现有安全错误路径，不能把损坏数据伪装成旧 Run 的未知值。

队列先计算完整 waiting 数量并选定当前队首，然后生成一条预览。limit 不截断这一计数。预览来源不可读时仍保持已有数量，不偷偷改用第二条消息。

预览函数按以下顺序执行：

1. 复用 `thread read` 的 Agent 正文投影；不直接读取展示用 body 代替结构化正文投影。
2. 将 LF、CR、TAB 各自替换成一个普通空格，再去除首尾 Unicode 空白。连续内部空格不合并；CRLF 会成为两个空格。
3. 按 Unicode 码点保留前 200 个，正好 200 个不截断。
4. 原文超过 200 个码点时，追加单个 U+2026 字符 `…`，并返回 truncated:true；最多 201 个码点。码点不等于字素簇，组合 emoji 可能在码点边界拆开。
5. 来源不存在、已撤回、被 tombstone 或不可读取时返回 messagePreview:null；合法的空正文返回 text:""、truncated:false，并保留 messageId。

不附带 quotes、附件、其他输入 ID 或摘要数组，不拼接整组消息。预览表示查询时的公开正文，不是模型当时收到的完整输入，不是整轮工作总结。SQL、解析或投影失败返回既有安全错误，不能吞错并报告为空列表。

### 排序与游标

- 排序为 `createdAt DESC, stableIdentity DESC`；createdAt 按 UTC 时间值比较。同一时间使用内部带来源区分的稳定键，例如真实 Run 用 run ID，队列用 Thread 和 Agent 的组合。
- 先对候选条目执行筛选、排序和 `limit + 1` 取样，判断 hasMore，再仅为最终返回的最多 limit 条批量加载预览正文。不能先截断 Delivery 行再聚合。
- nextCursor 编码版本、规范化 Thread、agentId、筛选模式及末条完整排序键。调用方不得解释或构造其内容；每次仍重新校验权限和目标存在性，游标不是授权凭据。
- 省略 Thread 和显式当前 Thread 归一为同一范围；无 active 与 active:false 归一一致。limit 是页大小，不是筛选条件，可以在续页时改变。
- 不在游标里存正文、Run 输入数组、结果快照或跨请求锁。格式、版本、筛选不匹配等返回 invalid_input；合法游标对应条目已经消失时仍按值续页，不要求该条目继续存在。
- 无更多条目时 hasMore:false、nextCursor:null；空结果 items:[]。observedAt 是本次事务建立读取视图时记录的 UTC 观察时间。

命令说明必须保留以下限制：

> 分页期间执行和队列可能变化，不保证动态排队项的完整遍历。确认当前状态时，应从首页重新查询。

部分 claim、撤回或队首变化可能使条目移到游标另一侧。这里不承诺跨页完整快照，不增加分页会话、服务端缓存或跨请求锁。“从首页重新查询”服务于新的状态确认请求，不授权 Agent 为等待他人回复而持续轮询。

### 错误与恢复

| 情况 | 公开 code | recovery |
| --- | --- | --- |
| 未知字段/flag、错误类型、互斥参数、越界 limit、无效或不匹配 cursor | builtin_tool.invalid_input | fix_input |
| Thread 不存在、删除中、无法按当前读取范围解析 | thread.runs_unavailable | stop |
| 当前调用 Run 无有效绑定 | builtin_tool.run_not_bound | stop |
| Single Chat 调用方调用 runs | single_chat.operation_denied | stop |
| 完整结果未通过输出 Schema/投影 | builtin_tool.output_contract_mismatch | stop |
| 现有 CLI/运输失败 | 沿用当前安全错误，例如 builtin_tool.cli_error | 沿用当前分类 |

新增的业务不可用错误沿用现有错误封装，不返回原始数据库异常或绝对路径。`thread read` 的错误目录保持原样，不借此改名或统一历史错误。

例如：

```json
{
  "error": {
    "code": "builtin_tool.invalid_input",
    "message": "active and status cannot be supplied together.",
    "recovery": "fix_input"
  }
}
```

```json
{
  "error": {
    "code": "thread.runs_unavailable",
    "message": "Thread executions are unavailable.",
    "recovery": "stop"
  }
}
```

旧成功工具结果按现有 receipt/摘要校验后读取，不回填新的 addressing 或新字段。读取当前状态需新调用，不把重放的旧工具结果解释为新观察。

### 提示词改动清单

完整替换文本在附录，实施不得只依据本表摘要：

| 位置 | 变更 |
| --- | --- |
| 公开 SESSION_CHARTER | catalog 增加 thread runs；等待他人回复时不轮询的句子同时覆盖执行状态 |
| CLI 根帮助 | thread 族增加 runs，其余命令与 User Automation 附加说明保持 |
| thread read description/help | 正常项统一有 addressing、撤回项无该字段；公开参数说明使用 replyChain |
| 新 thread runs description/help | 写完整参数、默认值、互斥、JSON 输出、状态/ID解释、预览、原因 null、分页限制和示例 |
| cli-operations SKILL.md | description 保持；只在正文路由表和 reference 入口补充该读取用途 |
| cli-operations references/camp-history.md | 完整说明正常消息 addressing、实时 read 范围及执行/排队查询 |
| ROVAI_PLATFORM_SKILLS | 整个索引保持，不增加常驻教学 |

常驻公开 Charter 仅增加 25 个 ASCII 字节，平台 description 不增字；参数、字段和分页规则留在按需 help/reference，不重复注入 RUN_INPUT 或 RUN_FACTS。

英文产品指令沿用当前语言策略；用户正文、预览正文及回答语言不改变。不会把内部 Delivery/claim 分类塞进模型指令。Single Chat 专用 Charter/Guidance、Codex 原生系统指令、其他 Runtime 系统提示、其他 Skill、UI 元数据均保持。

## 明确不变

- 保留“消息 → waiting Delivery → claim → 多输入 Run”执行链；查询不创建、领取、停止、重试或修复执行，不提前固定未来批次。
- 无摘要存储、无模型调用、无新队列表、无权限配置、无诊断框架、无后台轮询。
- MessageAddressing 只补已有事实；不改变发送寻址、用户通知、成员加入/离队和撤回语义。
- Bootstrap 的 section 顺序、身份字段、Memory、协作投影保持；Dynamic Context 的 RUN_INPUT、RUN_FACTS、选择、预算、遗漏和冻结证据格式保持。
- 不把 runs 结果自动注入每轮上下文，不追加 roster 执行状态，不增加自动工具调用。
- 原有 Single Chat 读取能力、私有结果、公开/私有隔离及 frozen operation policy 不变。
- 本次不修改 Renderer 展示或创建新界面，不把预览称为执行总结。

### 版本和生效策略

以下为本稿的拟定版本；实施前若主线已占用新编号，需重核并记录实际编号，不能覆盖他人版本。

| 轴 | 当前基线 | 本稿拟定 |
| --- | --- | --- |
| Camp History 合同 | v10 | v11，补 collection addressing |
| Thread Runs 合同 | 无 | v1，定义本稿查询 |
| Built-in Contract / CLI / capability | 34 / 34 / builtin_cli.transport.v34 | 35 / 35 / builtin_cli.transport.v35 |
| Agent Output contract | 7 | 8 |
| Session Charter revision | 18 | 19 |
| Binding Charter compatibility | 16 | 保持 16 |
| Bootstrap contract / formatter | native_session_bootstrap_v5 / 5 | 保持 |
| public batch formatter / manifest / profile | 32 / 32 / 10 | 保持 |
| non-batch formatter / manifest / profile | 28 / 28 / 7 | 保持 |
| Built-in Evidence projection schema | 4 | 保持结构版本，按既有机制增加 operation 投影 |
| IPC / Envelope / receipt | 2 / 1 / 1 | 保持 |
| 数据库 schema / migration | 当前基线 | 无本功能新增迁移 |

本次是兼容升级，直接沿用现有冻结与受管文件同步机制：

1. **旧 Session 继续 resume，并使用原 Bootstrap。** 本功能不得改变已有 Native Binding 的兼容身份、Session ID 或 generation。恢复与压缩补发均读取该 Binding 已冻结的完整 Bootstrap，包括原 Charter 和平台 Skill 索引；不根据新版模板重建或回写。保持现有 compatibility contract 的整份内容，不能把新 Charter revision 或实时 CLI catalog digest 接入旧会话的兼容判断。
2. **新 Session 使用新版 Bootstrap。** 仅在新 Native Binding 首次准备 Bootstrap 时生成并冻结新版 Charter。新 Run、Core 重启或软件升级本身都不等于新 Session。无需批量重置会话、失效旧 Evidence 或增加 Bootstrap 迁移。
3. **升级后直接读取新版受管 Skill。** 新安装包携带修改后的 `cli-operations/SKILL.md` 与 reference；Core 启动及新 Run 准备时使用现有 `ManagedSkills::sync` 同步到原受管路径。用户无需重新导入、重新勾选或重建 Session。旧、新 Session 后续实际读取该路径时均得到新版文件；已进入模型对话历史的旧正文保持，不承诺自动改写模型已经读过的内容。

本轮已核对基线实现：[context_contract.rs](../../../crates/rovai-core/src/context_contract.rs)将 Charter revision 与 Binding compatibility 分开；[context.rs](../../../crates/rovai-core/src/context.rs)的 `prepare_session_bootstrap_evidence_for_snapshot` 优先复用既有 Evidence；[core_subsystems.rs](../../../crates/rovai-core/src/core_subsystems.rs)与 `prepare_additional_skills` 已调用 [ManagedSkills::sync](../../../crates/rovai-core/src/managed_skills.rs)，后者递归同步正文与 references。实施只接通这些现有路径，不增加热更新通知、版本协商或按 Session 维护 Skill 副本。

当前安装包的 Core 与 CLI 按既有发布流程配套更新；新调用使用当前目录/输出合同，不能只替换一个运行中进程的 CLI 二进制。已有原始工具结果保留自身版本和 digest，不用当前必填字段重新伪造旧响应。实现时须明确验证历史结果读取与新结果严格校验分别走各自路径。

平台 Skill description 与路径保持原文，旧索引仍能定位新版文件。新工具可从当前 CLI help 发现，不插入额外迁移消息。Antigravity 的 Native Binding 继续使用既有冻结兼容目录，live catalog 新增 operation 不改变其兼容身份。本次只保证不因这项功能新增 resume 失效条件，其他已有的真实不兼容或证据损坏处理规则保持。

### 实施位置

| 所属模块 | 必要修改 |
| --- | --- |
| camp_history | collection addressing；窄范围复用认证 Thread 解析、消息可见性与 Agent 正文投影 |
| 新 thread_runs 读取模块 | 只读 DTO、候选/聚合、分页、计数和统一预览；不建立通用查询框架 |
| team_tool / team_tool_catalog / application | operation 注册、输入输出封闭 Schema、只读 dispatch |
| builtin_tool_transport / bin/rovai | CLI 身份、目录版本、根帮助、精确帮助、错误目录 |
| builtin_tool_cli_output | 新 operation 的 canonical result 投影；当前输出严格校验及旧结果版本路径 |
| builtin_tool_evidence_projection | 复用 raw digest 绑定；记录有界的筛选、身份、状态和计数，不复制预览正文作为第二份摘要 |
| context / context_contract / charter resource | 应用附录的两处公开 Charter 变更及新 Charter revision |
| skills/cli-operations | 应用附录中两个完整文件；现有发布/同步机制不变 |

小范围共享函数必须接收同一个读取事务和已认证目标；不能通过再次调用 CLI、重新开连接或读取 Desktop 大投影来拼接结果。

确认实施后更新对应当前合同、Architecture、索引、版本实施计划和技能说明；本草案不提前把提议写成 accepted 的当前规范。无编号 ADR，无功能专属 checker 例外。

## 二次确认

本稿 `revision: 2` 已由 User 在 2026-10-03 的消息 `73fbaeb0-cb41-486c-a387-ad4f72c4eb1e` 明确确认实施：“已审阅 r2，没有发现需要修改的核心方案问题，按当前范围实施即可。”同条消息授权在 worktree 完成实现、创建 PR 到 main 并合并。实施基线已合入 `origin/main` 的 `7f6fdafa`；提示词基线和已确认的 r2 语义保持。

遵循[核心模型上下文变更治理](../../development/model-context-change-governance.md)：“未取得确认时可以继续调查和编辑提案文档，但不得修改实现、Schema、当前合同或执行 clean break。”确认时记录真实消息、confirmed_by、confirmed_at 和 confirmed_revision:2；语义修订需更新 revision。

确认记录对应 r2 全文，不增加字段、存储、会话迁移或查询框架；若实现遇到无法满足现有约定的具体冲突，再按实际冲突处理。

## 验证

### 确定性验收

| 场景 | 通过标准 |
| --- | --- |
| read 三种模式 | 每个正常条目 addressing 必有且来源一致；空值为 [] / false |
| read 撤回 | 只保留四字段占位；不重新暴露作者、接收者或正文 |
| 并发 claim | 同一事务响应里，每份责任只在 waiting 集合或对应 Run 中出现一次 |
| 部分 claim | 剩余队列数量/队首更新；已创建 Run 的输入关联保持 |
| FIFO 与容量 | 查询不改变领取策略；集合不保证对应一个未来 Run |
| 公开范围 | 私有 Single Chat Run 完全排除；历史 camp_turn 归属可读；当前成员状态不错误屏蔽公共历史 |
| 调用方限制 | Single Chat 调用 runs 被现有 policy 拒绝；普通公共调用可读允许的历史 Thread |
| 领域状态 | 所有六状态可筛选；failed 不经 UI 映射；waiting 不并入 queued |
| ID 约束 | null ID 只能 queued；真实 queued Run 保留 ID；额外 kind/isPending 被 Schema 拒绝 |
| 原因字段 | 每条 waitReason 都为 null；原始 wait_reason/异常/路径不出现在输出 |
| 输入来源 | count 基于全部冻结关联；按 ordinal 取首；anchor 为最后一条的场景不能选错 |
| 旧 Run | 无可靠关联时数量/预览为 null，不用 0 或 trigger/anchor 猜测 |
| 源不可见 | 第一条缺失/撤回/不可读时只令预览为 null，不减少 Run 输入数量或换源 |
| 预览边界 | 0/199/200/201 码点、中英文、emoji、组合字符、LF/CR/TAB、CRLF 和空正文均按本稿规则 |
| 聚合与 limit | 超过 limit 条 waiting 消息仍返回完整数量；一个 Agent 最多一个无 ID 集合 |
| 分页 | 同时间稳定排序；游标绑定范围/筛选；错误 cursor 拒绝；合法游标原条目消失仍可续页 |
| 动态变化 | 验证跨页队首移动的已声明限制；单页内部仍一致；无快照缓存或长事务跨请求 |
| 输出运输 | stdout 只有一个业务 JSON；无格式选项；成功、失败和历史结果符合既有运输 |
| 无业务副作用 | 查询前后消息、Delivery、Run、accepted 水位和调度行为不改变；允许既有审计证据 |
| 旧 Session 升级恢复 | 同一受支持 Session 的冷 resume 与压缩补发保留 Binding、Session ID、generation 和 Bootstrap 内容/digest；新 catalog 不触发兼容身份变化 |
| 新 Session Bootstrap | 新 Binding 冻结新版 Charter；同一 Session 新建 Run 或 Core 重启不重建 Bootstrap；单聊不扩权 |
| Skill 升级 | 安装包包含新正文和 reference；启动及新 Run 准备沿用现有同步，旧/新 Session 从原路径实际读取均得到新版，无需重新导入或重建会话 |

实现时遵循 [Rust 测试准入规则](../../development/testing.md#rust-测试准入与退役门槛)，优先扩展相关 owner 的语义场景；不新增逐句复制提示词的重复测试，不用全文相等替代权限或状态验证。

### 实施后的验证命令

```bash
pnpm skills:check
pnpm skills:test
pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=f229ce3edf24d4054499babf98b0b3d984e46868 pnpm docs:check:ci
cargo fmt --all --check
cargo check --workspace
cargo test -p rovai-core --lib thread_runs::
cargo test -p rovai-core --lib builtin_tool_cli_output::
cargo test -p rovai-core --lib builtin_tool_transport::
cargo test -p rovai-core --lib builtin_tool_evidence_projection::
cargo test -p rovai-core --bin rovai
cargo test -p rovai-core --features slow-tests --lib camp_history::
pnpm test:rust:pr
```

`thread_runs::` 为拟新增 owner；相关 Bootstrap/Skill 同步与 Single Chat 场景应进入现有 owner。实现时根据实际 owner 的 feature gate 补齐对应命令，记录非零的测试执行数，不能把没有匹配测试当通过。只改方案的本轮不启动 Runtime 或编译产品。

### 真实任务 Gate

本改动涉及共享 cli-operations 与模型可见输出，按[双轨评测](../../development/evaluation.md)选择通用集 DEMO-101–112，12 个 Case。冻结当前 Suite 2.12.0、scoring 2.10.0 和现有 POLICY v2，不改 Case 或评分以适配结果。

基线与候选各运行一次；同环境、同 Runtime/模型/权限配置，至少三名评测队员。预算沿用每 campaign 14,400 秒、Case 并行 2、Judge 2,400 秒、同 campaign 最多两次；保留全部尝试。硬失败阻断、关键协作项须 satisfied、缺证据为 insufficient，禁止跨分数补偿。资源退化沿用同时超过 50% 和 15 秒的耗时阈值。

实际 Runtime/模型、可追溯的固定 Judge snapshot 及路径在执行前按既有配置冻结；本方案不虚构这些环境证据。无 Judge 的设施验证不能宣称 Gate 通过。通用集证明共享流程回归，本功能的字段/事务/权限边界由上表定向验收承担。

### 方案阶段验证记录

r1/r2 方案阶段只改文档，其来源核对和复核记录如下：

- 六个提示词来源文件的 SHA-256 与固定源码基线一致；附录的两份现行 CLI 帮助与实际 `--help` 输出逐字一致。
- JSON 示例解析、公开新增指令不暴露 Delivery/claim 分类，以及平台 description 不变的检查通过。
- r2 核对旧 Bootstrap 复用、Binding compatibility 与受管 Skill 同步的现有代码；附录 15 个文本块与 r1 逐字一致，没有增加上下文提示词。
- `pnpm docs:test`：r1 与 r2 均为 10 项通过。r1 首次并行调用触发 pnpm 自动安装竞争；安装完成后单独重跑本命令通过，无产品文件或 lockfile 改动。
- `DOCS_BASE_REF=f229ce3edf24d4054499babf98b0b3d984e46868 node scripts/check-doc-decisions.mjs --require-base`：通过文档链接、决策治理和历史冻结检查。
- `pnpm docs:check` 与 `docs:check:ci`：版本阶段因本稿 pending 状态的四项确认字段检查而拒绝；没有伪填确认。组合命令的后续决策检查已按上一条独立执行。
- 产品测试、真实 Runtime 与真实任务 Gate 本轮未运行；它们是实施后的验收，不能用本轮文档自检代替。

### 实施验收记录

在 `7f6fdafa` 主线基线上实施，随后同步 `e7525fa0` 并完成集成复验，复用本工作条目的 worktree。功能、封闭工具合同、CLI 帮助、最小 Charter
改动与 Skill 文件已落地。正常 collection 按页批量读取 addressing；执行列表分页后批量读取冻结输入计数与
首条预览源。桌面现有命令名称字典同步新增 operation，仅维持工具名称识别，不新增展示或交互。

本地实际验证：

| 检查 | 结果 |
| --- | --- |
| `cargo fmt --all --check`、`cargo check --workspace` | 通过 |
| `pnpm test:rust:pr` | 集成后 workspace 443 项通过，1 项既有 ignored；包含旧 collection inline/blob 字节、digest、receipt 和受管 Skill 升级回归 |
| `cargo test -p rovai-core --features slow-tests --lib thread_runs::` | 3 项通过，包括最小 SQL owner |
| 同 feature 的 `camp_history::`、`builtin_tool_` | 分别 7、32 项通过 |
| 实时跨 Thread、旧 Bootstrap 补发、新 Binding Bootstrap、Single Chat 封闭策略 | 现有 slow owner 各 1 项通过 |
| `antigravity_catalog_rename_preserves_binding_but_protocol_changes_do_not`，extended feature | 1 项通过；目录变化保持 Binding 兼容身份 |
| `pnpm typecheck`、`pnpm test` | 通过；集成后 Vitest 2,490 项，Node 回归 328 项，2 项平台限定 skip；文档与 Skill 门禁包含在内 |
| 实际 CLI 根帮助、read/runs 帮助对照 | 与已确认附录逐字一致 |

采用 `code-review` 的双轴只读审查：Standards 无明确违规；Spec 发现两项批量读取偏差及一项历史结果验证缺口，
均已修正并复核通过。初轮测试暴露的旧夹具、目录计数和版本断言已同步，未以放宽合同消除失败。

**本次真实任务 Gate 未运行，验收状态为 User 豁免。** 本地现有 Judge 为 `catalog_bound_alias`，缺少本稿
要求的可追溯 `pinned_snapshot` 配置。User 于 2026-10-03 在本 Thread sequence 19、消息
`3d21f416-2187-4c13-90bc-1e1b0e7c7ba4` 明确要求“跳过这个Gate”，据此跳过本次 12 Case 真实任务 Gate，
继续已授权的 PR 合并。本次豁免不改变通用评测规则、Case、评分或预算；上述本地回归、双轴审查与 CI 结果保留。
