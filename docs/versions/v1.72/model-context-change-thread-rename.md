---
document_type: model-context-change
version: v1.72
revision: 2
confirmation_status: confirmed
confirmed_revision: 2
confirmed_by: local_user
confirmed_at: 2026-10-01T07:42:07Z
last_updated: 2026-10-01
---

# Camp → Thread：改动范围、兼容场景与前后对照

这是已确认实施的 **r2**，取代尚未实施的 Conversation 命名稿 r1。对照源码基线为
`e41d19dfecd57da0ab17a73c32b3bb7613560839`；完整提示词、CLI schema 和 Skill 前后文本见[附录](thread-rename-comparison.md)。
实施 worktree 为 `/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-thread-rename`，分支 `rovai/thread-rename`，
基于主线 `b534c16f6c8c7c37dcd03d18e6112e88fcd23620`；其相对对照基线只增加无关 UI 改动，相关上下文／CLI 版本轴未变化。代码已实施，完整真实任务 Gate 待 Judge 配置；具体测试与限制见[验收记录](thread-rename-verification.md)。

**顶层用 `Thread / threadId`，回复链用 `Reply chain / --reply-chain`；队员内部的 `Conversation` 保持内部实现，不教给 Agent。**
旧 `campId`、`rovai camp` 和读回复链的 `--thread` 留在兼容入口。旧 Native Session 的绑定与 bootstrap 保留，Skill 沿用现有随包同步。

## r2 的变更依据

用户消息 `13556577-9078-4f1b-b623-418dff430bfe` 将顶层名称改为 Thread，要求不向 Agent 暴露队员内部 Conversation，并将旧 `--thread` 另命名。
此前关于 resume、旧 bootstrap、最新 Skill、`campId` 兼容及简洁提示词的要求继续有效；`conversationId` 作为顶层新字段的选择被本条覆盖。

相对 r1，本稿删去整个私有 `Conversation → AgentSession` 改名和双 ID 重新解释方案，不增加 `agentSessionId`。
内部单聊 DTO 保留私有 `conversationId`；Agent 只需要知道自己处于公开 Thread 还是 Single Chat，Core 自动选定对应上下文。
没有发布过的 `rovai conversation`／公开 `conversationId` 提案不新增兼容别名。

另修正一处事实：`automation.run` 当前返回的 `campId` 与 `conversationId` **都来自 `self.camp_id`**，见
[`ClaimedOccurrence::payload`](../../../crates/rovai-core/src/automation.rs)。它们是同一公开 ID 的重复字段，不能把后者解释成私有会话 ID；新结果只保留 `threadId`。

## 具体场景

`T` 是公开 Thread ID，`P` 是内部私有 Conversation ID，`M` 是消息 ID；仅作示意。

| 场景 | 原用法／现状 | r2 行为 |
| --- | --- | --- |
| 1. 新 Agent 查当前对话历史 | `rovai camp read` | `rovai thread read`；仍默认当前公开范围 |
| 2. 查另一条公开对话 | `rovai camp read --camp-id T` | `rovai thread read --thread-id T`；原有可见性约束不变 |
| 3. 读取回复链 | `rovai camp read --thread M --limit 20` | `rovai thread read --reply-chain M --limit 20`；M 仍是链内消息锚点，不是顶层 ID |
| 4. 同时指定顶层范围和回复链 | `--camp-id T --thread M` | `--thread-id T --reply-chain M`；名字明确区分两层 |
| 5. 旧 Session 继续用旧命令 | 旧 bootstrap 教 `rovai camp`、`--camp-id`、`--thread` | 均被新版入口接受，进入同一实现；不要求重建 Session |
| 6. JSON 输入 | `{"campId":"T","thread":"M"}` | `{"threadId":"T","replyChain":"M"}`；旧键分别归一化 |
| 7. 重复的新旧参数 | `campId + threadId`，或 `thread + replyChain` | 值相同也拒绝重复；不静默选一个 |
| 8. 精确消息与回复链混用 | `messageId` 加 `thread` | 新旧别名归一化后仍拒绝；精确读取仍不能附带回复链、before 或 limit |
| 9. 搜索后继续读取 | 从结果取 `campId`、`messageId` | 新结果取 `threadId`、`messageId`；读取旧结果字段的脚本需更新，不返回双份字段 |
| 10. 跨对话查询／trace 筛选 | `campIds`、`excludeCampIds` | 新用 `threadIds`、`excludeThreadIds`；旧输入兼容，范围与数组约束不变 |
| 11. 单聊内部路由 | `{campId:T, conversationId:P}` | Host／UI 用 `{threadId:T, conversationId:P}`；只改父范围字段，P 不改名、不交给 Agent 选择 |
| 12. Agent 读自己的单聊记录 | `rovai single-chat history` | 命令保持；Core 从当前 Run 选目标，没有私有 ID 参数 |
| 13. Agent 发布公开消息 | `rovai send` 隐式使用当前 Camp | 隐式使用当前 Thread；仍拒绝自带 campId／threadId，不能跨范围发言 |
| 14. App 创建／打开／发送 | `rovai app camp create\|open\|send` | 新用 `rovai app thread create\|open\|send`，旧命令是别名 |
| 15. Automation 返回范围 | 结果中 campId 与 conversationId 值相同 | 新结果只出 threadId；不是改成 threadId + agentSessionId |
| 16. 旧 Native Session resume | 已有 binding、generation、bootstrap evidence | 沿用旧绑定和旧 Charter，不用新模板重建旧证据 |
| 17. 旧 Thread 中建立新 Native Session | 新队员、首次单聊或既有恢复原因创建新绑定 | 使用新 bootstrap；新旧边界是 Native Session 绑定，不是 Thread 创建日期 |
| 18. 新 Run／已准备 Run／压缩补投 | 三者生命周期不同 | 新准备 Run 用新动态字段；已冻结 Run 和旧 bootstrap 补投按原版验证、使用原字节 |
| 19. 升级 Skill | 新包同步受管文件 | 原路径更新；再次读文件取得新版，已在模型历史里的文本不会自动消失 |
| 20. ID／附件／数据目录 | `rvcamp_…`、SQLite 关系和旧目录 | 值、物理编码及路径不改；新 threadId 可继续装原 rvcamp_ 值 |
| 21. Antigravity 绑定摘要 | 额外包含工具合同版本和目录摘要 | 固定本次旧工具兼容身份；否则即使 Charter 兼容版本不变也会换 Session |
| 22. 升级前后同一操作重试 | 相同请求身份，旧／新参数拼写 | 归一化后复用持久命令身份和原收据；不得重复创建或发布 |
| 23. 第三方 conversation／thread | 渠道、Runtime 供应商自己的字段 | 保留其语义；不能按字面替成 Rovai 的 Thread 或 reply chain |

## 变更前

当前实现分三层：Camp 是公开共享对话，Conversation 是队员私有逻辑连续性，Native Session 是外部 Runtime 句柄。
`camp.read` 的 `thread` 参数表示消息回复链，其结果为 `mode: "thread"`，根消息字段为 `threadRootMessageId`。
这些含义见[领域模型](../../../CONTEXT.md)、[历史读取代码](../../../crates/rovai-core/src/camp_history.rs)和[工具目录](../../../crates/rovai-core/src/team_tool_catalog.rs)。

现行提示中公开范围叫 Camp；`SHARED_CONVERSATION` 是公开参考消息段，并非队员私有 Conversation 的模型。
Single Chat 的 `conversationMode` 表示单聊行为约束，不要求 Agent 管理私有会话 ID。
所有受影响文本的完整原文在[附录“变更前”](thread-rename-comparison.md)，没有改写 r1 的基线原文。

## 变更后

### 术语与可见边界

| 语义 | 新名称 | Agent 是否需要知道 |
| --- | --- | --- |
| 公开共享对话 | Thread；`threadId`、`threadIds`、`threadTitle`、`threads` | 是，作为公开协作／读取范围；中文仍用“对话” |
| 公开成员、消息、回合 | ThreadMember、ThreadMessage、ThreadTurn；`threadTurnId` | 仅沿用原来已投影的内容，不额外注入内部 ID |
| 消息回复链 | Reply chain；`replyChain`、`replyChainRootMessageId` | 是，用于历史读取 |
| 队员私有连续性 | 内部仍为 Conversation、`conversationId`、`sourceConversationId` | 否；无需新增 AgentSession 或暴露私有 ID |
| 与用户的私聊 | Single Chat | 是，说明当前交流模式与权限 |
| 原生 Session 与绑定 | 现有 Native Session、native binding | 保持现有运行边界，不因公开名词修改生命周期 |

“不暴露内部 Conversation”指新生成的 Agent Charter、动态上下文、CLI help 和工具结果不把它作为可操作对象。
用户代码、引用原文、历史证据和旧 bootstrap 不做文字过滤。Host／Renderer 必需的内部 DTO 可继续使用私有 ID。
内部 `kind: camp_member` 和物理表列保持原编码，不为更名增加数据迁移。

### CLI：Thread 与回复链

```bash
# 当前
rovai camp read --camp-id <camp-id> --thread <message-id> --limit 20
# 新规范
rovai thread read --thread-id <thread-id> --reply-chain <message-id> --limit 20
```

选 `--reply-chain`，因为它表示整条回复链；`--reply` 容易被理解为单条回复或发送回复。
保留当前“给链内任意消息作锚点，解析根及其回复集合，并按原分页边界读取”的行为，不要求只能传根消息，也不新建顶层 Thread。

| 当前入口／字段 | 新规范 | 兼容 |
| --- | --- | --- |
| `rovai camp list\|search\|read` | `rovai thread list\|search\|read` | 旧命令族别名 |
| `rovai app camp create\|send\|open` | `rovai app thread create\|send\|open` | 旧命令族别名 |
| `--camp-id`／`campId` | `--thread-id`／`threadId` | 在原来允许该公开范围参数的端点接受旧名 |
| `--camp-ids`／`campIds` | `--thread-ids`／`threadIds` | 原重复参数／数组规则不变 |
| trace 的 `--exclude-camp-id`／`excludeCampIds` | `--exclude-thread-id`／`excludeThreadIds` | 原排除语义不变 |
| read 的 `--thread`／`thread` | `--reply-chain`／`replyChain` | 只在原回复链选择器入口接受旧名 |
| read 结果 `mode: "thread"` | `mode: "reply_chain"` | 新结果只出新值；旧冻结结果不改 |
| read 结果 `threadRootMessageId` | `replyChainRootMessageId` | ID 仍是根消息 ID，不是顶层 Thread ID |
| `camp.list`／`camp.search`／`camp.read`／`camp.message.send` | `thread.list`／`thread.search`／`thread.read`／`thread.message.send` | 对外 operation 新名；原持久 key 兼容 |
| `rovai send`、`single-chat history`、Task／Memory／Mission／Automation 等命令族 | 不变 | 只改其中公开范围术语和字段 |

`threadId` 与 `replyChain` 是可一起使用的两个参数。只有各自新旧别名重复才拒绝；旧命令与新参数、新命令与旧参数可组合。
先归一化，再检查封闭 schema、Single Chat allowlist、身份和可见性；单加 serde alias 不够。
未知字段与原本不允许的范围参数仍拒绝，不能把别名当成权限扩展。

read／search 的新响应只出新字段；`messageId`、序号、锚点、nextCursor、addressing、撤回和附件规则不变。
完整输入与输出 schema 见附录 J1–J14，包含三个 read 模式及 Automation 摘要。
旧 receipt／历史响应先按原版验摘要，再投影新读取结果；不重写历史 blob，也不以新名称重新生成幂等身份。

### 内部单聊 DTO：只换公开父范围

下列是 Desktop／Core 的 `single_chat.send` 业务体，**不是 Agent 工具参数**；现有 draftClient 可信注入不变。

```json
{
  "campId": "rvcamp_01h47kvsy5fk1shh6w1g60eecf",
  "conversationId": "11111111-1111-4111-8111-111111111111",
  "body": "解释这个改动",
  "draftRevision": 3
}
```

新的同一请求：

```json
{
  "threadId": "rvcamp_01h47kvsy5fk1shh6w1g60eecf",
  "conversationId": "11111111-1111-4111-8111-111111111111",
  "body": "解释这个改动",
  "draftRevision": 3
}
```

open／end／排队编辑同样只将 campId 归一化为 threadId，私有 conversationId 的含义不变。
不把它当 threadId 的别名，不新增 agentSessionId，不靠 ID 前缀猜用途。campId 与 threadId 同时出现仍拒绝。

### 模型上下文 shape

公开参考段 `SHARED_CONVERSATION` → `SHARED_THREAD`，位置、选取条件和省略规则不变。完整顶层形状如下；
`?` 表示缺失时省略，referenceClosure／recentMessages 仍在空数组时省略。

```ts
// 前：[SHARED_CONVERSATION]
type SharedConversation = {
  campId: string;
  originatingPublicUserMessage?: ModelSharedMessage;
  referenceClosure?: ModelReferenceClosureMessage[];
  recentMessages?: ModelSharedMessage[];
  omittedMessages?: OmittedMessages;
};
// 后：[SHARED_THREAD]
type SharedThread = {
  threadId: string;
  originatingPublicUserMessage?: ModelSharedMessage;
  referenceClosure?: ModelReferenceClosureMessage[];
  recentMessages?: ModelSharedMessage[];
  omittedMessages?: OmittedMessages;
};
```

引用原文、作者、闭包距离和遗漏数据不变。模型引用的完整单条结构及两种 scope 替换如下；它描述可读消息范围，不携带私有 Conversation ID。

```ts
type QuoteAuthor =
  | { type: "user"; displayName: string }
  | { type: "agent"; agentId: string; displayName: string };
// 前
type ModelQuote = {
  kind: "message_excerpt";
  source: { scope: "current_conversation_messages" | "camp_messages"; messageId: string; author: QuoteAuthor };
  text: string;
};
// 后
type ModelQuote = {
  kind: "message_excerpt";
  source: { scope: "current_messages" | "thread_messages"; messageId: string; author: QuoteAuthor };
  text: string;
};
```

当前输入引用用 `current_messages`；公开历史读取用 `thread_messages`。两者由 Core 选择，不允许调用者随意混用；
原 MAX_QUOTE_SCALARS、非空、封闭对象规则不变。旧存储快照和旧投递照原值校验。

`RUN_FACTS` 完整顶层结构与受影响子对象：

```ts
// 前
type RunFacts = {
  attachmentOutputRoot: string;
  historyHint?: string;
  mission?: MissionFacts;
  conversationMode?: ConversationModeFact;
  taskContext?: TaskContextFact;
  sessionContinuity?: SessionContinuityFact;
  externalEffect?: ExternalEffectFact;
  gather?: GatherFact;
  delegation?: DelegationFact;
};
type ConversationModeFact = {
  kind: "single_chat";
  visibility: "principal_only";
  responseDelivery: "conversation_message";
  operationPolicy: "single_chat_v1";
  campPublicationAllowed: false;
  memberDispatchAllowed: false;
  taskMutationAllowed: false;
  memoryMutationAllowed: false;
};
// 后
type RunFacts = {
  attachmentOutputRoot: string;
  historyHint?: string;
  mission?: MissionFacts;
  singleChat?: SingleChatFact;
  taskContext?: TaskContextFact;
  sessionContinuity?: SessionContinuityFact;
  externalEffect?: ExternalEffectFact;
  gather?: GatherFact;
  delegation?: DelegationFact;
};
type SingleChatFact = {
  kind: "single_chat";
  visibility: "principal_only";
  responseDelivery: "single_chat_message";
  operationPolicy: "single_chat_v1";
  threadPublicationAllowed: false;
  memberDispatchAllowed: false;
  taskMutationAllowed: false;
  memoryMutationAllowed: false;
};
```

`singleChat` 仍只在单聊提供；行为约束保留，不再叫内部 conversationMode 或新增 agentSessionMode。
公开批次 historyHint 必有，普通投影保持原来可选性；只改称谓。其余子类型沿用[当前实现](../../../crates/rovai-core/src/context.rs)，
gather／delegation 不恢复已退役功能。

A2A 的模型形状仍是 `{"instructions": string[]}`，return 五条、forward 四条，条件和顺序不变。
为验证旧指令原文，内部 Evidence 使用明确文本版次：

```ts
// 前
type A2aGuidanceEvidenceV1 =
  | { schemaVersion: 1; included: false }
  | { schemaVersion: 1; included: true; variant: "forward" | "return"; payloadDigest: string };
// 后：仅新准备 Run；V1 校验保留
type A2aGuidanceEvidenceV2 =
  | { schemaVersion: 2; included: false }
  | { schemaVersion: 2; included: true; variant: "forward" | "return"; payloadDigest: string };
```

### 提示词与 Skill

全文见[附录](thread-rename-comparison.md)。新提示只使用公开 Thread、Reply chain 和当前 Single Chat 所需信息，
删除 r1 拟加的内部 AgentSession 解释句；不在每轮追加术语迁移说明。

| 位置 | 主要变化 |
| --- | --- |
| 公开 Charter／CLI Contract | Camp → Thread；`rovai camp` → `rovai thread` |
| 非批次与 Single Chat Charter | 指向 SHARED_THREAD；当前引用 scope 为 current_messages；私有目标只称 Single Chat |
| historyHint／A2A return／Mission／文件交付／Codex final | 只改公开范围称谓，原触发条件保持 |
| Single Chat guidance | SHARED_THREAD 是参考材料；禁止向公开 Thread 发言 |
| 历史读取 help／Skill | `--reply-chain`、replyChain、reply chain，避免同一句用 thread 表示两层 |
| `single-chat history` help | Core 选择当前 Single Chat，不解释或要求传内部 Conversation ID |
| Automation help／结果 | 创建新 Thread；结果只给一个公开 threadId |

17 份 Skill 资产（14 Markdown、3 YAML）直接更新原受管文件；保留 Skill 名称、目录和 `camp-history.md` 路径，
包括工作流专有名 `campfire`。原平台 Skill 索引随旧 bootstrap 冻结；再次读取相同路径可得到新版文件。
新包启动和准备新 Run 沿用已有同步器，未知用户文件保持；已准备 Run 的附加 Skill 片段仍冻结。
不增加自动重读提示、后台迁移服务或第二套 Skill 版本系统；同步失败仍按现有诊断和重试处理。

### 代码与文档落点

| 范围 | 主要文件／边界 | 要改的内容 |
| --- | --- | --- |
| 公开领域与 DTO | `CONTEXT.md`、`packages/contracts/src/index.ts`、Core domain／read model／application transport、`camp_*.rs` | 公开 Camp → Thread；映射新字段，物理存储保持 |
| 私有单聊 | `single_chat.rs`、调度与 native binding | 只接收新的父范围 threadId；内部 Conversation 和私有 ID 留原名 |
| 历史读取 | `camp_history.rs`、`team_tool_catalog.rs`、`bin/rovai.rs` | replyChain 输入、reply_chain 模式、根消息字段、旧选择器别名和 help |
| CLI／App CLI | `builtin_tool_transport.rs`、`bin/rovai/app_cli.rs`、`camp_message_send_teaching.rs` | 新 thread 命令／flags；校验前归一化，allowlist 同步 |
| Agent 输出 | `builtin_tool_cli_output.rs`、工具目录、`automation.rs::ClaimedOccurrence::payload` | 规范输出不出现内部私有 ID；Automation 删除重复公开别名 |
| 模型上下文 | `context.rs`、`context_contract.rs`、`resources/charter-*.md`、Single Chat guidance、`message_quote.rs` | 本文精确 shape 和附录替换文本，保留旧验证分支 |
| Runtime 兼容 | `agent_runtime_adapter.rs`、`builtin_tool_runtime.rs` | Native Binding 身份不因更名改变，运行时使用新版 CLI 与当前 lease |
| Desktop／Web／渠道 | `CampNavigation.tsx`、`CampWorkspace.tsx`、Main／Preload／Web transport、自动化与 trace | 公开类型／调用方贯通；已有公开含义的 `NewConversation*` 可改为 `NewThread*`，不得误归为私有对象 |
| 本地状态与路径 | 草稿、侧栏／滚动位置缓存、SQL、附件与 Runtime 路径 | 保持现有物理键和 ID，避免丢状态；不做目录搬迁 |
| Skill／当前文档／验证 | 附录 S1–S17、受管打包同步、当前合同和说明、既有测试 | 实施时同步当前权威；历史文档、旧迁移与旧证据保留 |

### Resume 与版本轴

Bootstrap Evidence 已按 `native_binding_id + generation` 冻结 Charter、平台 Skill 索引和 Memory Entrypoint，直接沿用。
`MEMBER_IDENTITY` 仍按既有机制更新，因此不把整个 bootstrap 包承诺为身份变化后仍字节相同。
新绑定才用新 Charter；压缩补投从旧 Evidence 取回旧 Charter。

| 版本轴 | 当前 → 提议 | 理由 |
| --- | --- | --- |
| Session Charter revision | 16 → 17 | 新文本；r1 未实施，不因文档 r2 再跳一个号 |
| Native Binding Charter compatibility revision | 16 → **16** | 本次不换旧绑定 |
| Codex session guidance revision | 1 → **1** | 原生启动策略未改 |
| Native Bootstrap contract／formatter | v5／5 → 不变 | Evidence 结构和拼接算法不改 |
| 普通 formatter／Manifest | 27／27 → 28／28 | 新 section、字段、scope 与指令 |
| 公开批次 formatter／Manifest | 31／31 → 32／32 | 新 historyHint 与引用 scope |
| RunFacts | 普通 5 → 6；公开 8 → 9 | 新模型投影留证 |
| Delivery Profile／预算 | 普通 7、公开 10 → 不变 | 未改选择、预算或投递策略 |
| A2A evidence／Single Chat guidance | 1 → 2；v2 → v3 | 新旧原文分开严格校验 |
| Built-in tool contract／CLI command | 32 → 33 | 新工具名、别名输入、回复链 schema |
| Agent output contract | 5 → 6 | 新结果字段／模式，Automation 去除重复 ID |
| Read Model snapshot schema | 34 → 35 | 公开 DTO 使用 Thread 字段 |
| Execution Evidence operation projection | 3 → 4 | 新字段投影，先校验旧原始摘要 |
| Data projection schema／Migration | 127 → 128／178 | 只扩展新 Context 格式准入，原证据与绑定不变 |
| IPC／结果 envelope／receipt | 2／1／1 → 不变 | 运输和证据外壳不改 |

保留旧普通 26／27、旧公开 29／30／31 的原版冻结恢复；不通过替换 current 常量删除上一版，也不复活更早已退役的准入。
若实施时主线已占用版本，先顺延本稿并更新 revision。新准备 Run 可在旧绑定上使用新动态段；已准备 Run 不重渲染，
旧 Charter 与新字段／新工具输出混用必须通过专门升级验证，不能靠重新 bootstrap 规避。

Antigravity 的 binding digest 还包含工具合同版本与目录摘要。绑定计算要保持**本次改名前的兼容身份**：合同 32 与基线真实目录摘要；
真实工具发现、schema、结果仍使用新版 33 和真实新摘要。实现时固定基线摘要并验证同安装／协议下 digest 相等，
不接受任意旧摘要；以后真正不兼容时才提升绑定兼容身份。不建立通用多版本矩阵。
其他 Adapter 同样逐一比较绑定摘要，保留原有安装、协议和 session-scoped 配置检查。

## 明确不变

- 用户／Default Lead 权限、Task 归属、消息派发、Single Chat 隔离、Memory 作用域不变。
- 除本文明确的 section／字段名外，section 顺序与条件、历史边界、预算、引用选取、截断与分页算法不变。
- 旧 Charter、Manifest、投递字节、摘要、工具 receipt、用户历史和审计事件不重写；先验原证据。
- 公开／私有／Native Session ID、generation、物理表列、内部枚举、附件和 Runtime 路径不变；新 ID 沿用 rvcamp_ 编码。
- 不把私有 Conversation 改名为 AgentSession，不向 Agent 增加私有会话管理参数；不改第三方自己的 conversation／thread 含义。
- 不做强制 clean break、数据库搬家、历史材料替词；更名不能用于忽略供应商原有 Session 失效等真实失败。

## 二次确认

**confirmed：用户已确认 r2 开始实施。** 确认依据为消息 `9c872318-658c-4991-909e-6de9123b4aa1`：
“开启wt开始改吧”，并再次明确旧 Session resume、旧 bootstrap 和新 Skill 的要求。确认记录时间为本次读取指令的 UTC 时间。

[仓库上下文变更规则](../../development/model-context-change-governance.md#二次确认门槛)要求：
“未取得确认时可以继续调查和编辑提案文档，但不得修改实现、Schema、当前合同或执行 clean break。”
本稿 Front Matter 已记录确认人、时间与 `confirmed_revision: 2`，不是继承其他方案或由 Agent 自行确认。

## 验证

### r2 提案阶段的文档验证（实施前）

以下保留实施前的检查记录，不代表本次实现状态；实施后的结果见[验收记录](thread-rename-verification.md)。提案阶段未运行产品 App、真实 Runtime 或 Session resume。

| 检查 | 2026-10-01 结果 |
| --- | --- |
| `pnpm docs:test` | 10／10 通过 |
| `check-doc-decisions.mjs --require-base` | 通过，基线为本稿开头的源码 commit |
| 文本与结构核对 | 86 个原有“变更前”块保持；17 份 Skill 原文与源码匹配；160 个本地链接有效，8 个 JSON 示例可解析 |
| 新替换稿核对 | 无私有 Conversation／AgentSession 教学残留；replyChain 输入、reply_chain 输出与根消息字段匹配；Automation 仅一个公开 threadId |
| `pnpm docs:check`／`pnpm docs:check:ci` | 未通过，仅缺 r2 的确认状态、confirmed revision、确认人、确认时间四项 |
| 工作区范围 | 仅改主文档、附录及版本导航；`git diff --check` 通过 |

这次确认缺口随后由 Principal 的实施指令补齐；本轮 docs gates 结果另记。以上提案记录不代表产品升级验收。

### 实施后的验收

按[Rust 测试政策](../../development/testing.md#rust-测试准入与退役门槛)扩展既有 owner，不为改词添加大量镜像测试。

| 验证组 | 必须证明的行为与负向用例 | 既有 owner |
| --- | --- | --- |
| 命令／ID 兼容 | 新旧命令与 flags 同结果；threadId 与 replyChain 可同传；各自新旧别名重复拒绝；未知字段拒绝 | `bin/rovai.rs`、`app_cli.rs`、`builtin_tool_transport`、`team_tool_catalog` |
| 回复链 | 任意链内消息作锚点；新旧输入相同根、条目和游标；新 mode／根字段；messageId 与选择器／分页混用拒绝 | `camp_history` 既有读取和权限测试 |
| 私有边界 | 单聊内部 conversationId 不换含义；Agent 单聊 history 无私有 ID 参数；新 Agent 文本／结果不教内部 Conversation／AgentSession | `single_chat`、context、`builtin_tool_cli_output` |
| Automation | 原两 ID 来自同一公开值；新输出只有 threadId；started／skipped／failed 的 null 和状态规则不变 | `automation`、工具 schema／投影测试 |
| 恢复／幂等 | 旧 receipt 原摘要可验证；同请求只一次副作用；旧绑定摘要一致；旧 Session 用旧 bootstrap，新绑定用新模板 | command receipt、`context_contract`、`agent_runtime_adapter`、`context::slow_tests` |
| 动态／Skill | 新 Run 用新段名，冻结 Run 原字节；旧证据拒绝新摘要混用；新版文件原路径更新、未知文件保留 | context evidence、`managed_skills` 既有同步升级测试 |
| 界面／调用方 | DTO 与旧数据恢复贯通，草稿、位置、附件不丢；渠道外部 ID 不误改 | contracts、desktop、channel 既有测试及隔离环境验收 |

文档执行入口：

```bash
pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=e41d19dfecd57da0ab17a73c32b3bb7613560839 pnpm docs:check:ci
DOCS_BASE_REF=e41d19dfecd57da0ab17a73c32b3bb7613560839 node scripts/check-doc-decisions.mjs --require-base
```

实现后按[上下文真实任务 Gate](../../development/evaluation.md#上下文改动-gate)运行 Suite 2.12.0 的 DEMO-101–112，
评分 `generic-task-quality@2.10.0`；基线为本稿源码 commit，候选为固定实施 commit，同模型、权限和预算。
预算沿用 r1：wallSeconds 14400、maxParallelCases 2、judgeSeconds 2400、repetitions 1，同一 campaign 最多两次。
三位评测队员、Runtime／模型、Judge 和路径须执行前写入冻结 plan，目前未选择、未运行；通过标准为完整既有 Gate 通过且上述兼容矩阵无失败。
预算／证据不足不能标通过，不通过重建旧 Session 来修复结果。

## 实施收口

已按 r2 完成公开 Thread 命名、局部旧参数别名、旧命令幂等结果投影、Context 新版本准入和桌面持久状态兼容。
实际版本轴见上表；新旧 Native Binding 兼容身份保持，Migration 178 不改写旧 Bootstrap、Run 输入与审计字节。
新增当前合同 [Thread Naming v1](../../contracts/thread-naming-v1.md)、[ContextManifest v32](../../contracts/context-manifest-evidence-v32.md)
与 [Built-in Transport v33](../../contracts/builtin-tool-transport-v33.md)。测试证据、已知基线失败和完整 Gate 缺口见[验收记录](thread-rename-verification.md)。
