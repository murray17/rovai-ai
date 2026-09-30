---
document_type: model-context-change
version: v1.72
revision: 1
confirmation_status: pending
last_updated: 2026-10-01
---

# Camp → Conversation：改动范围、兼容场景与前后对照

这是待评审的 r1，基线为 `e41d19dfecd57da0ab17a73c32b3bb7613560839`。本次只交付文档，未修改产品实现、Schema 或当前合同。
完整提示词和 Skill 替换稿见[文本附录](conversation-rename-comparison.md)。本页先回答“哪些地方要改、哪些具体场景要兼容”。

方案只有三条主规则：**新公开会话统一叫 Conversation、用 `conversationId`；旧输入在入口兼容；已有 Native Session 和冻结证据继续使用原记录。**
Skill 继续使用现有随包同步，不引入迁移服务、会话版本管理器或第二套 Skill 安装系统。

## 已确认的方向

| 来源 | 已确认内容 |
| --- | --- |
| 用户消息 `936d57b7-8c45-4f13-b59d-4b455200ea12` | 用 Conversation；旧 Session 能 resume，旧 bootstrap 保留；新版本用户能取得最新 Skill；避免复杂设计 |
| 用户消息 `121d6c38-4757-43ca-b961-28c75db2ebbb` | 先列代码、上下文提示词、CLI 改动，并给简洁有效的前后对照 |
| 用户消息 `b61ab9dd-b52d-4ca9-bd72-a20ef5b27a79` | 新的用 `conversationId`，支持 `campId` 兼容，并列出具体场景 |

这些是本稿的需求依据；用户尚未看过完整 r1，不记作实施确认。

## 具体场景

下表的 `C` 表示公开会话 ID，`A` 表示某位队员的私有会话 ID；字母只用于解释，不是实际可提交的 ID。

| 场景 | 当前／旧调用 | 新版行为 |
| --- | --- | --- |
| 1. 旧 Session 按旧提示词查历史 | `rovai camp read --camp-id C` | 命令与参数仍接受，进入同一个 `conversation read` 实现；不新建 Session |
| 2. 新 Session 查历史 | 无旧用词约束 | 教 `rovai conversation read --conversation-id C`，help 和新结果只展示新名 |
| 3. JSON 参数或旧脚本指定公开会话 | `{"campId":"C","query":"预算"}` | 与 `{"conversationId":"C","query":"预算"}` 相同；先归一化，再执行原验证和权限检查 |
| 4. 同一公开 ID 重复传新旧字段 | `campId` 与 `conversationId` 同时出现 | 对普通公开接口拒绝重复，值相同也拒绝；不静默挑一个 |
| 5. 单聊同时带两种 ID | 旧：`campId=C, conversationId=A` | 新：`conversationId=C, agentSessionId=A`；按单聊端点识别两种完整形状，不能全局字符串替换 |
| 6. 单聊编辑排队输入、结束单聊 | 同样持有公开 ID 和私有 `conversationId` | 与场景 5 共用明确的旧／新双 ID 解析；混合形状拒绝，不把 A 当成公开会话 |
| 7. 搜索结果接着精确读取 | 旧结果取 `campId`、`messageId` | 新结果取 `conversationId`、`messageId`；旧请求仍能调用。读取旧结果字段的脚本须更新为新字段，不承诺双份输出 |
| 8. 跨会话历史与执行记录筛选 | `campIds`、`excludeCampIds`，或旧 CLI flags | 新用 `conversationIds`、`excludeConversationIds`；旧输入别名保留，数组上限、可见性和分页不变 |
| 9. 发一条公开消息 | `rovai send` 隐式使用当前 Camp | 命令不变，隐式使用当前 Conversation；仍不接受调用者传 `campId` 或 `conversationId`，不能借更名跨会话发消息 |
| 10. 单聊读取自己的历史 | `rovai single-chat history` | 命令不变，Core 从当前 Run 确定 AgentSession；不增加任意 ID 读取参数 |
| 11. App 创建、打开、发起对话 | `rovai app camp create\|open\|send` | 新命令族为 `rovai app conversation`；旧 `app camp` 为别名，创建的仍是同一种实体 |
| 12. Mission／Automation／Task 关联 | Mission 行含 `campId`；Automation 结果可能同时含 `campId`、私有 `conversationId` | 分别改为 `conversationId`、`agentSessionId`。已省略公开 ID 的紧凑 Task 输出不为更名新增字段 |
| 13. 升级后继续同一 Native Session | 已有 native binding、generation、bootstrap evidence | 同一绑定继续 resume，读取旧 Charter、旧平台 Skill 索引与旧 Memory Entrypoint；不是重新生成后伪装成旧证据 |
| 14. 旧公开对话里出现新绑定 | 新增队员、首次单聊，或其他既有原因需要新 Native Session | 使用新 Charter。新旧边界是 Native Session 绑定，不是公开 Conversation 的创建日期 |
| 15. 恢复已经准备好的 Run／压缩补投 | 已有 frozen Manifest／Bootstrap Evidence／投递摘要 | 按旧版本验证与重放原字节；不把旧 JSON 先改名再验摘要。新准备的 Run 才用新动态上下文 |
| 16. 升级后读 Skill | 安装版启动或准备新 Run | 同步新包的受管文件到原路径；新读文件得到新版。旧 Session 已读入的文字不会自动从模型历史中消失 |
| 17. 已保存的 ID、附件与 Runtime 工作目录 | `rvcamp_…`、SQLite 外键、旧目录路径 | 值和路径不改。新字段可返回 `conversationId: "rvcamp_…"`；不增加 ID 前缀迁移 |
| 18. Antigravity Session | 绑定摘要额外包含工具目录摘要和工具合同版本 | 更名会改变真实目录摘要，必须保留本次旧绑定兼容身份；否则只保持 Charter 兼容版本仍会换 Session |
| 19. 同一命令在升级前后重试 | 相同 request／command identity，输入有新旧拼写 | 归一化后落到既有持久命令身份；复用原执行结果，不能因字段或 operation 改名重复发消息／创建实体 |
| 20. 外部平台自身的 conversation／thread | 渠道 `channelConversationId`、供应商 Session／thread ID | 保留供应商语义，不能改成 Rovai 的公开 `conversationId` 或内部 `agentSessionId` |

## 变更前

当前三个层次的名称有冲突，见[领域模型](../../../CONTEXT.md)：

| 当前词 | 实际含义 | 当前字段举例 |
| --- | --- | --- |
| Camp | 共享公开消息、成员、目标与资源的顶层对话 | `campId`、`campIds`、`campTitle` |
| Conversation | 单个 Agent 的私有逻辑连续性；包含 `camp_member` 和 `single_chat` | `conversationId`、`sourceConversationId` |
| Native Session | 外部 Runtime 可替换的原生 Session | `nativeSessionId`、native binding／generation |

公开上下文称 Camp、命令用 `rovai camp`，而 Renderer 已经有 `NewConversationDialog` 等公开对话命名。
因此不能把所有 `Conversation` 先替成 AgentSession；必须按实体含义改名。

当前 Bootstrap 的完整三种主体、可选 Mission／渠道／Codex 段落、动态提示与工具说明原文，均在
[文本附录的“变更前”](conversation-rename-comparison.md)。原文来源包括：

- `context.rs::build_session_charter` 和 `resources/charter-rovai-cli.md`；
- `resources/charter-rovai-single-chat.md`、`resources/single-chat-guidance-v2.json`；
- `context.rs::public_history_hint`、`a2a_guidance_payload`、动态模型投影；
- `team_tool_catalog.rs`、`camp_message_send_teaching.rs` 与相关输入 schema 的描述；
- 17 份有现行 Camp 术语的 Skill Markdown／YAML，逐文件列出完整前后内容。

当前存在两道容易漏掉的实现约束：工具输入先经过封闭 schema 验证，单加 `serde(alias)` 不够；
Antigravity 的绑定身份含真实工具目录摘要，不能只维持 `NATIVE_BINDING_CHARTER_COMPATIBILITY_REVISION`。

## 变更后

### 领域与字段

| 当前 | 新的规范用词／字段 | 兼容边界 |
| --- | --- | --- |
| Camp、CampMember、CampMessage、CampTurn | Conversation、ConversationMember、ConversationMessage、ConversationTurn | 中文采用“对话”；原有单聊仍叫“单聊” |
| 原私有 Conversation、ConversationMessage | AgentSession、AgentSessionMessage | 先迁出私有类型，再引入公开新名，避免类型重名 |
| `campId`／`campIds` | `conversationId`／`conversationIds` | 仅在本来允许这些公开范围参数的入口接受旧名 |
| `campTitle`／`camps` | `conversationTitle`／`conversations` | 新返回值只出新名 |
| 私有 `conversationId`／`sourceConversationId` | `agentSessionId`／`sourceAgentSessionId` | 在对应私有端点识别旧形状，不做任意 JSON 递归替换 |
| `campTurnId` | `conversationTurnId` | 新接口字段；存储列和冻结旧证据保留 |
| 原私有 `kind: camp_member` | 新投影 `kind: conversation_member` | 旧持久枚举继续可读；不批量更新历史数据 |
| NativeSession、AgentRun、Task、Mission、Single Chat、thread | 不变 | thread 仍是对话内的消息回复链，不提升为顶层实体 |

以下 TypeScript shape 用 `?` 表示字段不存在时省略；数组原来为空时省略的规则保持。引用类型继续取当前模型中同名结构，
不是新增可自由扩展的 JSON。模型可见 shape 的改动只有本节明确列出的字段和值。

`SHARED_CONVERSATION` 完整顶层结构：

```ts
// 前
type SharedConversation = {
  campId: string;
  originatingPublicUserMessage?: ModelSharedMessage;
  referenceClosure?: ModelReferenceClosureMessage[];
  recentMessages?: ModelSharedMessage[];
  omittedMessages?: OmittedMessages;
};
// 后
type SharedConversation = {
  conversationId: string;
  originatingPublicUserMessage?: ModelSharedMessage;
  referenceClosure?: ModelReferenceClosureMessage[];
  recentMessages?: ModelSharedMessage[];
  omittedMessages?: OmittedMessages;
};
```

原 `ModelSharedMessage`、距离、引用闭包和遗漏信息不改；公开引用 `source.scope` 从 `camp_messages` 改为
`conversation_messages`，其他引用字段不变。旧快照解码继续接受 `camp_messages`；`current_conversation_messages`
继续表示 Core 解析的当前消息区，不重命名、不变成供应商 transcript。

`RUN_FACTS` 完整顶层结构和受影响子结构：

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
  agentSessionMode?: AgentSessionModeFact;
  taskContext?: TaskContextFact;
  sessionContinuity?: SessionContinuityFact;
  externalEffect?: ExternalEffectFact;
  gather?: GatherFact;
  delegation?: DelegationFact;
};
type AgentSessionModeFact = {
  kind: "single_chat";
  visibility: "principal_only";
  responseDelivery: "agent_session_message";
  operationPolicy: "single_chat_v1";
  conversationPublicationAllowed: false;
  memberDispatchAllowed: false;
  taskMutationAllowed: false;
  memoryMutationAllowed: false;
};
```

`agentSessionMode` 仍只在 Single Chat 中提供；`gather`／`delegation` 保留现有兼容解码，不恢复已退役功能。
各未变子类型由[当前实现](../../../crates/rovai-core/src/context.rs)和[Context Manifest Evidence v31](../../contracts/context-manifest-evidence-v31.md)定义。
公开批次的 `historyHint` 仍必有；只有称谓变化，完整分支见附录 P5。

`A2A_GUIDANCE` 的模型 JSON 仍为 `{"instructions": string[]}`，return 仍五条，forward 仍四条；只改 return 中两处 Camp 用词。
为让旧文本还能被严格校验，内部 Evidence 明确区分文本版次：

```ts
// 前（两个封闭形状）
type A2aGuidanceEvidenceV1 =
  | { schemaVersion: 1; included: false }
  | { schemaVersion: 1; included: true; variant: "forward" | "return"; payloadDigest: string };
// 后（新准备 Run 使用；V1 校验器继续存在）
type A2aGuidanceEvidenceV2 =
  | { schemaVersion: 2; included: false }
  | { schemaVersion: 2; included: true; variant: "forward" | "return"; payloadDigest: string };
```

不允许把 V1 的旧全文与 V2 的摘要混用。Single Chat guidance 的旧 v2 资源保留，新准备输入用 v3 资源。
其余 section 名称、顺序、条件和选择规则不变。

### 单聊双 ID 的完整例子

以 Desktop 的 `single_chat.send` 命令业务体为例，`draftClient` 的既有可信注入规则不变：

```json
{
  "campId": "rvcamp_01h47kvsy5fk1shh6w1g60eecf",
  "conversationId": "11111111-1111-4111-8111-111111111111",
  "body": "解释一下这个改动",
  "draftRevision": 3
}
```

新的同一请求：

```json
{
  "conversationId": "rvcamp_01h47kvsy5fk1shh6w1g60eecf",
  "agentSessionId": "11111111-1111-4111-8111-111111111111",
  "body": "解释一下这个改动",
  "draftRevision": 3
}
```

两种完整形状都接受；归一化结果完全一致。`single_chat.end` 相应接受旧的 `{campId, conversationId}` 或新的
`{conversationId, agentSessionId}`。`single_chat.open` 没有私有 ID，按普通 `{campId, agentId}` →
`{conversationId, agentId}` 处理。编辑排队输入等双 ID 端点采用同一规则。

同时提供三个 ID、只提供新的公开 ID 却遗漏私有 ID、使用 `{campId, agentSessionId}` 混合形状，均在执行前拒绝。
这些规则按端点和字段定义判定，不靠 UUID／`rvcamp_` 前缀猜测。

### CLI 与接口清单

| 旧入口 | 新规范入口 | 处理 |
| --- | --- | --- |
| `rovai camp list\|search\|read` | `rovai conversation list\|search\|read` | 旧命令族保留为输入别名 |
| `rovai app camp create\|send\|open` | `rovai app conversation create\|send\|open` | 同上；App 权限、预算和启动条件不变 |
| `--camp-id` | `--conversation-id` | 仅适用于原本有此参数的操作 |
| `rovai history search --camp-ids …` | `rovai history search --conversation-ids …` | 保留原有重复参数／数组解析规则 |
| `app trace export\|schedule --camp-id …` | 同操作 `--conversation-id …` | 可重复参数规则不变 |
| `app trace export\|schedule --exclude-camp-id …` | 同操作 `--exclude-conversation-id …` | 原排除语义不变 |
| `camp.list`／`camp.search`／`camp.read` | `conversation.list`／`conversation.search`／`conversation.read` | 对外 operation 新名；旧输入映射至同一服务 |
| 对外 `camp.message.send` | `conversation.message.send` | `rovai send` 命令名不变；原持久命令 key 保留 |
| `rovai send`、`single-chat history`、`task`、`member`、`mission`、`memory`、`automation` | 命令族不变 | 同步描述与其中的字段，不趁更名改权限或行为 |

`conversation list` 的行从 `{campId,title,lastVisibleActivityAt}` 改为
`{conversationId,title,lastVisibleActivityAt}`，集合键 `camps` 改为 `conversations`；`truncated` 不变。
search／read／history 的公开 ID 改为 `conversationId`，跨会话搜索标题改为 `conversationTitle`；
`messageId`、`sequence`、`nextCursor`、`threadRootMessageId`、`addressing`、撤回标记与裁剪规则不变。
原封闭结果的其他字段和可选性全部保留，schema 以[现有各输出构造函数](../../../crates/rovai-core/src/team_tool_catalog.rs)为基线。

兼容入口必须按这个顺序实现：

1. 根据 operation 识别普通公开 ID 或单聊双 ID；拒绝重复和混合形状。
2. 将已列出的旧命令、旧 flags、旧字段归一化为新业务输入。
3. 执行封闭 schema、当前 Run／Single Chat operation allowlist、权限和消息可见性检查。
4. 复用现有服务；持久命令的身份编码仍兼容旧 receipt，不因为新对外名称换一个幂等 key。
5. 新执行和新读取结果只投影新字段；已冻结的历史响应与摘要仍按原版验证、保留。

只有输入兼容，不增加所有输出的双字段副本。旧 CLI 名称的 `--help` 可展示同一份新规范用法；顶层 help 简短说明
`camp` 为 `conversation` 的兼容别名，不维护两份教程。不恢复其他已删除操作。

### 提示词改法

完整可替换文本都在[附录](conversation-rename-comparison.md)，主要改法如下。保持既有指令数量，除 CLI Skill 的一句词汇说明外不增加迁移教学段落。

| 位置 | 前 → 后 | 条件 |
| --- | --- | --- |
| 公开 Charter | `Camp objective` → `Conversation objective`；`rovai camp read` → `rovai conversation read` | 新 Native Session |
| 共享 CLI Contract | 命令目录用 `conversation`；公开交付说明中的 Camp 改称 Conversation | 同上 |
| 非批次 Charter | `SHARED_CONVERSATION` 的顶层 `campId` → `conversationId` | 同上 |
| Single Chat Charter | 公开父范围用 Conversation；私有对象明确为 Single Chat，保留禁止公开发言和派活的约束 | 新单聊绑定 |
| `RUN_FACTS.historyHint` | `in this Camp` → `in this Conversation` | 新准备 Run；四个公开分支语义不变 |
| A2A return／Single Chat guidance | 公开交付称谓改变 | 原有 section 条件不变 |
| Mission／渠道文件／Codex final 指引 | 只改称谓 | 不扩大原 Adapter、渠道和 Mission 触发条件 |
| CLI Skill | 增加一句 `Conversation (formerly Camp) is the shared scope; AgentSession is one member's private continuity.` | 只写在 Skill，不在每轮重复 |
| 工具 help／描述 | 新名称、新参数、新结果字段 | 权限、范围、历史边界、成功含义保持 |

旧 Charter 可能仍写 `campId` 或 `camp.read`。旧输入被新版工具接受，新输出用规范名称；没有为旧 Session 注入第二份 Charter
或逐轮迁移说明。新旧混合上下文是否能稳定使用正确 ID，必须以场景 1、5、7、13 的验证收口。

### 哪些文件和模块要动

| 范围 | 主要落点 | 实施内容 |
| --- | --- | --- |
| 领域与公共类型 | `CONTEXT.md`、`packages/contracts/src/index.ts`、Core domain／read model／application transport | 区分公开 Conversation 和私有 AgentSession，改新 API 字段、类型及映射 |
| 公开会话核心 | `camp_*.rs`、`team_tool.rs`、消息发布／附件／成员／Mission／Automation 关联 | 改源代码领域符号和文件名；原 SQL、ID 与目录访问由存储边界适配 |
| 私有连续性 | `single_chat.rs`、运行调度、native binding、私有消息投影 | 私有 ID 改 `agentSessionId`；处理双 ID 和排队输入兼容 |
| 模型上下文 | `context.rs`、`context_contract.rs`、`resources/charter-*.md`、Single Chat guidance、`message_quote.rs` | 采用本文和附录的精确文本与 shape，保存旧校验分支 |
| CLI | `bin/rovai.rs`、`bin/rovai/app_cli.rs`、`builtin_tool_transport.rs`、`team_tool_catalog.rs`、`camp_history.rs`、`camp_message_send_teaching.rs` | 新命令、flags、JSON、输出、别名归一化；Single Chat allowlist 同步 |
| Runtime 兼容 | `agent_runtime_adapter.rs`、`builtin_tool_runtime.rs` | 维持原生绑定兼容身份；运行时仍取得新版 CLI 和当前 lease |
| Desktop／Web | `CampNavigation.tsx`、`CampWorkspace.tsx`、`camp-client.tsx`、`desktop-camp-client.ts`、Main／Preload／Web transport、i18n | 新公共 DTO 与源码符号贯通；已有公开含义的 `NewConversation*` 保持；中文保留自然的“对话” |
| 本地持久状态 | Renderer 草稿、导航／滚动位置缓存、Core SQL 和序列化快照边界 | 读取旧键；优先维持物理键，不因源码更名丢草稿、选中项、历史定位或 Session |
| 渠道与工具使用方 | 飞书／Lark／钉钉、通知、自动化、trace／eval、测试 fixture | Rovai 范围改名，外部平台自己的 conversation／thread 字段保持语义 |
| Skill | `skills/` 下附录 S1–S17；`managed_skills.rs`；打包资源同步 | 更新原受管路径内容，保持目录和 Skill 名称 |
| 当前文档与验证 | 当前 Architecture／Contract／Version Decision 的引用路由、开发示例、测试断言 | 实施时同步当前权威；历史版本、迁移、旧协议样本保留原名并说明归属 |

这是按边界列出的实施范围，不是对所有 `camp` 子串盲目替换的文件列表。真实残留需逐一分为现行名称、兼容名、历史记录或专有名。

### Resume 与版本轴

Bootstrap Evidence 已按 `native_binding_id + generation` 冻结 Charter、平台 Skill 索引和 Memory Entrypoint；直接沿用。
`MEMBER_IDENTITY` 仍按现有机制读取当前身份，因此不声称身份改变后整个 Bootstrap 包逐字节相同。
压缩补投同样读取旧 Evidence，不能从新模板重建旧 Charter。

| 版本轴 | 当前 → 提议 | 目的 |
| --- | --- | --- |
| Session Charter revision | 16 → 17 | 新 Charter 文本可追溯 |
| Native Binding Charter compatibility revision | 16 → **16** | 本次更名不轮换既有绑定 |
| Codex session guidance revision | 1 → **1** | 未改原生启动策略；Charter 文本修订由上方独立版本记录 |
| Native Bootstrap contract／formatter | v5／5 → v5／5 | Evidence 结构与拼接算法不变，只变 Charter 内容版本 |
| 普通 Dynamic formatter／Manifest | 27／27 → 28／28 | 区分新字段、枚举和指导文本 |
| 公开批次 formatter／Manifest | 31／31 → 32／32 | 区分新 historyHint 和公开引用 scope |
| RunFacts | 普通 5 → 6；公开 8 → 9 | 新字段／文本语义留证 |
| Delivery Profile／上下文预算 | 普通 7、公开 10 → 不变 | 未改选择、预算和投递策略 |
| A2A guidance evidence | 1 → 2 | 按原文版次严格验证冻结文本 |
| Single Chat guidance 资源 | v2 → v3，新旧并存 | 旧内容验证仍使用旧资源 |
| Built-in tool contract／CLI command | 32 → 33 | 对外工具名称、schema 与帮助已改变 |
| Agent output contract | 5 → 6 | 新公开结果字段和 operation 名 |
| IPC／结果 envelope／receipt | 2／1／1 → 不变 | 传输与收据外壳不变；业务输出按相应版本处理 |

版本号是相对本基线的提议；实施时若主线已占用这些版本，要先顺延本文并更新 revision，不能复用冲突编号。
当前支持的旧普通 26／27、旧公开 29／30／31 均保留原版冻结恢复路径；不能把“current”常量加一后顺手删掉上一版分支。
不复活原本已不准入的新 Run 旧版本，也不放宽篡改／缺失 Evidence 的拒绝规则。

Antigravity 另有一个小的必要改动：其绑定计算使用**固定的本次改名前工具兼容身份**，即合同 32 和本基线真实目录摘要；
新的工具发现、schema 和结果仍使用合同 33 及真实的新摘要。实现时从基线计算并固定那个摘要，测试要求相同安装与协议下，
升级前后 binding digest 完全相同。此值只用于 Native Binding，不替代真实目录校验，不是“任意旧摘要都接受”。
以后真的改变 Session 不兼容协议时显式提升兼容身份；不建立通用多版本转换矩阵。

Codex、Pi、ACP、Claude 等也逐一比较绑定摘要；保持现有安装、协议和 session-scoped 配置维度，不能为了 resume 忽略真实的不兼容变化。
此处保证的是**本次改名不会使可用的旧 Session 失效**；供应商已删除的 Session 等原有失败路径仍按现有恢复机制处理。
旧 Bootstrap 中调用 `rovai` 的文字由新版随包 CLI 解释，不承诺任意旧 CLI 二进制与新 Core 混用。

### Skill 更新

[现有同步器](../../../crates/rovai-core/src/managed_skills.rs)发布九个 Skill，启动时同步，准备新 Run 时也会同步受管资源。
本稿涉及 17 份提示／说明资产（14 Markdown、3 YAML），全文见附录；包括容易漏掉的 Task、Recovery 两处 `CampMessage`。

继续覆盖受管同名文件、保留未知用户文件。Skill 名称、安装根目录及 `camp-history.md` 路径不动，所以旧 Bootstrap 的路径继续有效；
`campfire` 是工作流名称，保留。新包启动后可读新版文件；新 Run 重新准备附加 Skill 索引，而已经准备的 Run 继续用冻结片段。
平台 Skill 索引随旧 Bootstrap 冻结的行为保留，本次不改平台 Skill 身份或索引描述。YAML 的描述／默认提示随包更新，
不声称所有外部提供者已经缓存的 UI 元数据会立即刷新。

无需重建所有 Session、自动给每个 Session 追加“请重读 Skill”，也不增加后台迁移任务。
同步失败保留现有诊断与重试，不能把失败报告为“已用上最新 Skill”。

## 明确不变

- 不改变用户／Default Lead 权限、Task 归属、消息路由、公开发送条件、Single Chat 隔离、Memory 作用域。
- 不改变 section 顺序、历史边界、预算、截断、引用选择、查历史时机、A2A 调度或结果是否代表完成的含义。
- 不重写旧 Charter、旧 Manifest、投递字节、摘要、已完成工具收据、用户历史消息或旧审计事件；旧证据先按原合同验证。
- 不更换现有公开 ID、私有 ID、nativeSessionId、generation、物理表列、枚举值、目录与附件路径；新创建 ID 也沿用 `rvcamp_` 编码，避免双 ID 格式。
- 不做数据库搬家、实体复制或强制 clean break。新公开字段与旧物理编码由现有边界映射。
- 不批量改历史版本文档、历史 migration 或供应商字段；不把 Skill `NOTICE` 来源归属、`campfire` 等专有名当作漏改。

## 二次确认

状态：**pending，r1 尚未取得实施确认**。本轮仅完成用户要求的调查与前后对比。

[核心模型上下文变更治理](../../development/model-context-change-governance.md#二次确认门槛)要求：
“未取得确认时可以继续调查和编辑提案文档，但不得修改实现、Schema、当前合同或执行 clean break。”
实施前需要用户看过本页与附录，明确同意该 revision；记录实际确认人、时间、消息定位和 `confirmed_revision: 1`。
本文不能继承其他上下文提案的确认，也不能由 Agent 自行标记 confirmed。

## 验证

### 本轮文档验证

只执行文档与来源核对，未运行 App、真实 Runtime 或验证产品 Session resume。

| 检查 | 2026-10-01 结果 |
| --- | --- |
| `pnpm docs:test` | 10／10 通过 |
| `check-doc-decisions.mjs --require-base`，基线为本文开头的 commit | 通过；当前权威、决策路由及历史治理无新增违规 |
| `pnpm docs:check`、`pnpm docs:check:ci` | 未通过；仅本稿缺少二次确认的四项：status、confirmed revision、确认人、确认时间 |
| 原文与工作区核对 | 17 份 Skill 原文逐份匹配源码；158 个本地链接有效，8 个 JSON 示例可解析；变更限于三份文档，`git diff --check` 通过 |

首次新 worktree 的并行命令触发依赖自动安装，其中一次遇到安装竞争；安装结束后重新执行检查，最终结果如上。
确认门禁失败保留为提案状态，不添加专用豁免、不伪造确认，也不据此声称完整 CI 已通过。

### 实施后的必要验证

优先扩展现有 owner，遵循[Rust 测试准入政策](../../development/testing.md#rust-测试准入与退役门槛)，不为词汇替换新增大量镜像测试。

| 验证组 | 必须证明的行为／负向用例 | 现有 owner |
| --- | --- | --- |
| CLI 与 schema | 新旧命令／flags／JSON 得到同一业务输入；新结果只有新字段；重复与混合字段拒绝；未知字段仍拒绝 | `bin/rovai.rs`、`app_cli.rs`、`builtin_tool_transport.rs`、`team_tool_catalog.rs` |
| 单聊 | 旧／新双 ID 对应同一私有会话；open／send／end／排队输入一致；跨会话、不完整输入、公开 send 参数仍拒绝 | `single_chat.rs` 现有服务／权限测试 |
| 幂等与历史 | 升级前后同一请求只产生一次副作用；旧 receipt／Manifest 先验原摘要；新读取投影不修改历史行 | command receipt、context 冻结与恢复测试 |
| Binding／Bootstrap | 各 Adapter 旧绑定摘要一致；旧 Session resume 用旧 Charter；新绑定用新 Charter；压缩补投仍旧证据；坏摘要拒绝 | `context_contract`、`agent_runtime_adapter`、`context::slow_tests` |
| 动态上下文 | 同一旧绑定的新 Run 用新字段；已准备旧 Run 字节不变；新旧 A2A 和 Single Chat 指引各按对应版校验 | `context` dispatch admission／A2A evidence 测试 |
| Skill 升级 | 从旧包资源同步到新包；17 文件更新；旧路径可读；未知用户文件保留；旧已准备 Run 不重渲染 | `managed_skills::tests::synchronization_repairs_owned_files_and_keeps_unknown_content` 与追加 Skill evidence owner |
| DTO 与界面 | Main／Renderer／Web／渠道贯通新字段；旧对话、草稿、选中项、滚动位置和附件仍可恢复 | contracts／desktop／channel 既有测试与隔离环境验收 |

建议的定向入口（在实施完成后执行，不能把此命令列表当作通过证据）：

```bash
cargo test -p rovai-core context_contract::tests
cargo test -p rovai-core managed_skills::tests
cargo test -p rovai-core builtin_tool_transport::tests
cargo test -p rovai-core team_tool_catalog::tests
cargo test -p rovai-core --features extended-tests agent_runtime_adapter::tests
cargo test -p rovai-core --features slow-tests context::slow_tests::newly_bound_session_bootstraps_on_its_current_generation
pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=e41d19dfecd57da0ab17a73c32b3bb7613560839 pnpm docs:check:ci
```

模型上下文与 `cli-operations` 同时变化，按[真实任务 Gate](../../development/evaluation.md#上下文改动-gate)跑通用集：
`context-regression` Suite 2.12.0 的 DEMO-101–112，评分 `generic-task-quality@2.10.0`。
基线固定 `e41d19dfecd57da0ab17a73c32b3bb7613560839`，候选固定实施 commit；新旧使用同样队员、Runtime、模型、权限和预算。
计划上限为一次完整对照 `wallSeconds: 14400`、`maxParallelCases: 2`、`judgeSeconds: 2400`、`repetitions: 1`，
同一 campaign 最多两次；不追加新的通用测评框架。
三位评测队员的实际 Runtime／模型、Judge 配置及产物绝对路径须在执行前写入并冻结真实 plan，目前未选择、未运行。
通过标准为现有完整 Gate 通过，且上述兼容矩阵无失败；证据不足、预算不足或质量退化不能标为通过。

实施顺序：先固定旧版兼容回归 → 私有 AgentSession 与新 DTO → 入口兼容与持久身份 → 新 Charter／动态上下文与 Skill →
UI／调用方／当前文档 → 自动化、隔离升级验收和真实任务对照。任何一步都不通过重建旧 Session 来“修复”测试。
