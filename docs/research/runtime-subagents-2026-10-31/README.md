---
document_type: runtime-research
authority: research-evidence-only
status: investigated-with-explicit-gaps
observed_platform: macos-arm64
last_updated: 2026-10-31
---

# Native subagent：正文归属、command 与异步结果

本次调查对应 Thread `rvcamp_01m68yaq7reyssfamt52kz066j` 的 Copilot 正文碎片问题，及用户提供的
`rovai_subagent_review.html`。代码基线为 `be7cac82fd878219102c053cafd8d87f22e12024`；当前版本通过
[版本索引](../../versions/README.md)确认。本文是实测和实施建议，不改变当前合同，不表示生产修复已经交付。

## 结论

1. **subagent 启动应显示为带独立 Agent 图标的 command；子代理正文归该委派详情，不进入 RunCard 主正文。**
   参考稿中的主次关系可沿用；保留现有 Rovai 工具行、主题、展开和结果读取方式，不采用参考稿的视觉样式。
2. **同步调用、后台启动回执、子任务结束是不同事件。** 原生 tool 已完成不一定代表子代理已完成。
   结果可能更新原 command，也可能出现在 `read_agent`、`TaskOutput`、`agent_output`、`task_output`
   或独立通知中，不能统一假设为“原 command 的最后一次 update”。
3. **当前只有平铺 command，没有子 command 树。** 已有原生子工具事件可以继续平铺更新；没有暴露的子工具
   无须补抓。第一版不需要递归树、额外子 RunCard 或新 Thread 消息。
4. **Copilot 的问题不只在 UI。** 本机 1.0.105 的 ACP 子代理文本没有任何归属或 message ID；工具事件才带
   子代理标识。原生 Session journal 则保留 `parentToolCallId` 和 `messageId`。仅给 Renderer 增加过滤
   或把碎片拼起来，不能可靠解决这个会话。
5. 当前代码还存在可独立定位的缺口：文本落库没有消费已有的 `runtimeRootOutput=false`；vendor 工具身份
   在通用 ACP 归一时丢失；完成后的 ACP 晚到正文被隔离；详情缓存没有按同一 evidence 的 revision 失效。
   它们需要分别处理，不能归结为一个图标改动。

## 方法与证据边界

范围来自 `AdapterKind` 的 20 个实现，按用户要求排除 Cline、Cursor，共调查 **18 个 Runtime**。
累计 38 次 probe 尝试（含探针修正、失败与对照），不等于 38 次能力通过。
每个都尝试了真实原生协议调用；Pi 另加官方示例扩展对照。Kiro 受当前 shell 原生登录状态阻塞，Grok 受上游响应解析错误阻塞，
这两项不宣称 subagent 实测通过。Hermes 验证到后台 dispatch，未在观察窗口内获得 ACP 子任务结果。

- 通道是自动验收；只启动原生 CLI，在逐次 `mkdtemp` 的新 Git 工作区读一个无敏感信息的 fixture。
  未启动 Rovai App/Core，未修改日常 Electron `userData`、Rovai 数据库、成员或 Runtime 设置。
- 原生 CLI 使用本机已有账号、模型和配置；它们可能在自己的原生 HOME 写入本次新建 Session、日志与缓存。
  **这不是原生 HOME 完全隔离的验收**，也不是生产 Rovai Adapter 端到端验收。ZCode 最终有效探测另设了
  `ZCODE_DATA_BASE_DIR`，但其后台 output 路径仍由原生实现落在 `.zcode/cli/agents`。
- 请求子代理只读 `fixture.txt` 一次，返回唯一 marker；父代理不直接读文件。同步、后台、Copilot 双并发分别测试。
  模型并非严格测试程序：CodeBuddy 额外发送了内部成员消息，Antigravity 额外查询并读取本次子代理 transcript，
  Hermes 曾尝试不存在的 Skill。记录实际行为，不把 prompt 中的约束当作已通过的断言。
- 一般后台 probe 在父 prompt 返回后被动观察 20 秒；ZCode、Hermes 的补充探测观察 60 秒。
  有限窗口未收到结果，只证明该窗口中未见，不能证明 Runtime 永不发送。
- 原始 wire / stderr 仅保存在权限受限的本机临时目录，不入库到 Git，不发布认证信息、完整配置或 reasoning。
  [evidence.json](evidence.json)记录版本、样本摘要、事件形状、归属字段路径和 wire 摘要；IDs 被省略。
- [probe.mjs](probe.mjs)是收费真实生成的调查工具，不加入默认测试。`failed=false` 只表示 transport 调用结束，
  **不是 subagent 能力通过**。最终结论依据原生工具、归属、结果和生命周期分别判断。

曾有一轮 Codex probe 误把 child `turn/completed` 当作 root 完成，已修正为精确 root thread 匹配并重跑；
旧样本不作完成证据。ZCode 的初始失败来自 probe 未设置官方 Provider Config 路径、误带 `jsonrpc`、
使用旧 `workspace/readState` 或未回应 runtime preferences；修正后同步、后台都成功。它们不归因于产品缺陷。

## 逐 Runtime 实测

下表的“子工具”指本次原生 wire 是否暴露独立工具事件，**不等于 Rovai 已正确接纳全部事件**。
“无正文串入”指所测原生流形态，不是尚未执行的 App UI 验收。

| Runtime / 本机版本 | 实际启动方式与同步/异步 | 正文与归属证据 | 结果和子工具现状 |
| --- | --- | --- | --- |
| Copilot `1.0.105` | `task`；`agent_type`、`description`、`prompt`、`mode=sync/background`；双并发实际使用 background | ACP 文本完全匿名；子工具 `_meta["github.com/copilot"].agentId`；原生 journal 有 `parentToolCallId/messageId` | 同步 task 返回结果；后台先启动成功，后续 `read_agent` 返回结果；子 `view` 独立暴露 |
| Claude Code `2.1.308` | `Agent`；`subagent_type`、`run_in_background` | child message / tool 的顶层 `parent_tool_use_id`，另有 `agent_id` | 同步原 Agent tool_result；后台启动回执后有 `task_started/progress/updated/notification`，以 `tool_use_id/task_id` 关联；子 Read 暴露 |
| Codex `0.165.0` | 本版根事件为 `subAgentActivity(kind=started)`；另有 `collabAgentToolCall(tool=wait)` | 子文本、工具具有独立 `params.threadId`；主线程的完成活动携带 `agentThreadId` | root 完成与 child 完成分离；新 `subAgentActivity` 不能只按旧 collab 形态识别；Rovai 现有路由不向 root 转发未绑定的 child thread |
| OpenCode `2.2.0` | `name=subagent`、`kind=think`；`agent`、`background` | child 文本、工具均有 `_meta["opencode/child-session"]={id,parentID,depth,title}`；文本有 messageId | 同步原工具返回结果；后台 launch 已 completed，但 `rawOutput.metadata.status=running`；子 read 与文本继续到达，观察期未见原 launch 改为子任务终态 |
| Qwen Code `0.26.1` | `_meta.toolName=agent`；`subagent_type`、`run_in_background`，先通过 ToolSearch 获取工具 | 同步 child 文本/工具有 `_meta.parentToolCallId/subagentType/provenance`；后台另有 `_meta.backgroundTask/backgroundTurn` | 同步有 `subagentProgress` 更新；后台原工具返回 background，之后独立完成通知含 `taskId/toolUseId/status`；本次后台完成通知不含完整报告，child 工具也未独立暴露 |
| CodeBuddy `2.133.1` | `_meta["codebuddy.ai/toolName"]=Agent`；`run_in_background` | 同步 child 用 `_meta["codebuddy.ai/parentToolCallId"]`；后台 child 用 `_meta["codebuddy.ai/memberEvent"]`；messageId 不能单独保证 root/child 隔离 | 后台实际成为原生成员任务，经 SendMessage 返回，也可 TaskOutput 读到结果；子 Read/SendMessage 暴露；同一段子正文有重复发送现象 |
| Qoder `1.1.76` | `_meta.qoder.toolName=Agent`；`subagent_type`、`run_in_background` | 前台 child 文本在 ACP 中没有 parent/message 归属；不能依据邻近 Read 事件推断作者 | 前台子 Read 独立暴露、原 Agent 返回结果；后台 launch 返回 async 回执，观察期未见原 command 的结果替换；缺少身份的正文隔离仍有缺口 |
| Kimi `2.3.3` | `Agent`；`subagent_type`、`run_in_background` | 本次 child 正文作为工具结果，不另发 child agent_message_chunk | 前台原 Agent 返回 summary；后台返回 task_id/running，后续 `TaskOutput` 返回报告；未暴露独立子工具行 |
| TRAE CN `0.209.1` | `_meta.traex.type=subagent_control`、`action=spawn_agent`；background 控制 | meta 含 sender/parent/child thread、parentToolCallId；原生 child tool ID 有 subagent namespace | spawn 完成时可仍为 pending_init；后台另有 `subagent:…:lifecycle:…` 工具事件，rawOutput.type=subagent_completion；子执行工具暴露，可另见 close_agent |
| MiniMax Code `0.6.12` | `name=task`；`agent_name`、`run_in_background` | child 正文在原 task 或 task_output 结果中；`rawOutput.details` 提供 task_id、sub_session_id 等 | 前台原 task 的 details.status=succeeded/final_text；后台先 started，再 `task_output` 返回 succeeded；未暴露独立子工具 |
| Command Code `1.88.0` | `agent`；`subagent_type/run_in_background` | child 报告在工具结果中；不能把标题字符串单独当作结构化身份证明 | 前台 agent 结果；后台先返回 handle，后续 `agent_output` 取结果；本次没有独立子工具/child 正文流 |
| DeepSeek Harness `0.2.1-alpha.1` | `subagent`；`description/prompt/run_in_background` | 前台报告在工具结果中；后台 ACP 本次没有 child 身份/正文 | 同步结果通过；后台 launch 完成回执，随后主回复又出现，但观察期没有原 command 的最终子报告；未暴露子工具 |
| Hermes `0.22.4` | `delegate_task(tasks=[…])`；本机 ACP 顶层调用实际后台化，不因请求“同步”就变同步 | ACP title/content 暴露 dispatch，未带结构化 child 关联；原生返回 delegation_id/subagent_ids/live_transcripts | 已验证 dispatched/background；20 秒和补充 60 秒窗口均无 ACP 子报告。源码说明没有晚到结果 consumer 的 one-shot/cron 会 join；不能把另一运行模式当作 ACP 同步证据 |
| Pi `1.1.0` | 默认 RPC 无内建 subagent；显式 `-e` 加载官方示例后得到 `subagent`，支持单个/并行/链式参数 | 示例把 child messages 包在同一工具的 `partialResult.details.results`；不是 root message_update | 默认返回 unavailable；临时项目定义 + 官方示例真实委派成功，有 5 次 tool_execution_update 和最终结果；没有独立 child tool 行。只实测 single，不把源码的 parallel/chain 当实测 |
| ZCode `0.17.0` | app-server `Agent`；`subagent_type/run_in_background` | child tool 的 payload 有 `source=subagent`、agentId、childSessionId、parentToolCallId；本次没有独立 child text_delta | 同步 Agent 返回报告；后台原 Agent 回执后 `TaskOutput` 返回结构化 display.taskStatus/output；child Read 独立暴露。现有 ZCode background owner 机制另有专门通路 |
| Antigravity `agy 1.4.5` | `invoke_subagent(Role,TypeName)`；launch step 很快 DONE，底层 child 异步执行；`manage_subagents` 管理 | step_type 从 tool 变 subagent，subagent_info 给 child conversation_id/log_uri；主 stdout 不转发 child 正文 | child 通过内部消息回到 parent；主 stdout 的 system_message 不暴露该正文。本次精确 child transcript 证实读文件及回传，末段还出现原生安全过滤/重试；不宣称无异常或“原 command 含最终结果” |
| Kiro `2.21.1` | 本机 `kiro-cli acp` 在 initialize 前要求登录 | 无有效工具/文本样本 | 阻塞于未登录；官方说明有 subagents/delegate，但本机 wire 和同步/异步均未验证；没有替用户登录或改实验开关 |
| Grok Build `1.0.70` | ACP initialize/session 成功，prompt 未到工具调用便失败 | 原生报 `serialization error: unknown variant response.metadata` | 上游响应事件解析阻塞；官方源码有 spawn_subagent 等工具，不能据此宣称本机 subagent 行为通过 |

公开资料与实测互相校核：Claude 的[前后台 subagent](https://code.claude.com/docs/en/sub-agents)、
Qwen 的[Agent 工具](https://qwenlm.github.io/qwen-code-docs/en/developers/tools/task/)、
Qoder 的[subagent 配置](https://docs.qoder.com/cli/subagent)、CodeBuddy 的[sub-agents](https://www.codebuddy.ai/docs/cli/sub-agents)
均说明相关能力；精确事件字段以上述版本的 wire 为准。
Kiro 的[官方入口](https://kiro.dev/docs/cli/chat/subagents/)已重定向到新文档；Grok 的
[上游 subagent 文档](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/16-subagents.md)
也不能代替当前机器上的成功调用。Codex 的[官方 app-server 文档](https://developers.openai.com/codex/app-server/)
与[subagent 文档](https://developers.openai.com/codex/subagents/)用于区分原生 thread 和工具生命周期。
ACP 的 [SubAgent ToolKind 讨论](https://github.com/orgs/agentclientprotocol/discussions/690)是协议建议/讨论，
不是当前所有实现已统一采用的合同；本次实际仍混用 other、think、execute 与各家 `_meta`。

## 指定 Copilot 会话的原因

前一 Thread 的诊断记录：目标 Run `ba31a093-13cf-4bed-85ab-cff3a7a86665`，3 个 child；
原生 11 条非空 assistant message（8 root、3 child）对应 Rovai 的 64 个匿名 block，其中 39 个不超过 25 字符。
第三份报告的 2,966 个字符与 24 个碎片按顺序拼接一致。这些是前次记录中的事实，不在本轮修改历史数据。

本轮新建同步、双并发 Session 的 raw ACP 进一步确认：

- `agent_message_chunk` 的 params、update、content 都没有 root/child 归属和 messageId；
- child 工具有 `_meta["github.com/copilot"].agentId`，但这个身份不能安全外推到相邻匿名文本；
- 精确本次原生 `session-state/<sessionId>/events.jsonl` 的 assistant.message、subagent.started/completed、
  tool 记录仍有 `parentToolCallId/messageId/toolCallId`。

因此不能用“最近启动的 Agent”“工具开始到结束之间的所有字”“短块合并”“文本相似度”归属正文。
同步、并发、后台 parent 都可能同时说话，都会击穿这种推断。

建议为 Copilot 评估**精确 Session、只读、增量的原生消息观察器**：仅接纳已绑定 Session 的结构化 message 和
parent 证据，root 消息进主正文，child 报告进对应 command；该模式下不再把同一匿名 ACP 流另写一份正文。
必须先验证 journal 可用性、增量边界、重连/重复、路径与 Session 身份，不能扫描用户全部历史或按文本找“最像”的报告。
若 journal 不可用，则该版本没有充分证据同时保留实时 root 文本并准确排除 child；应明确降级，而不是宣称完全支持。
Qoder 的匿名 child 文本也需要独立补证，不能直接套用 Copilot 的文件路径和格式。

## 当前代码怎样更新 command 与正文

| 层 | 当前实现事实 | 对本任务的影响 |
| --- | --- | --- |
| 原生归一 | [application.rs](../../../crates/rovai-core/src/application.rs) 的 normalize_acp_event_with_completion 只保留 update/content.messageId；工具名称只取 update.toolName | OpenCode/MiniMax 的 name、Claude 以外的 vendor meta，以及 child/task 关联需要在丢弃私有 payload 前解析 |
| root 判断 | [runtime.rs](../../../crates/rovai-core/src/runtime.rs) 的 is_root_output 检查若干平面字段；并非所有 vendor namespace 都被检查 | CodeBuddy、Copilot 等元数据不应靠通用递归“见到 parent 就拒绝”；TRAE 根 spawn 自己也带 parentToolCallId |
| 文本存储 | [execution_text.rs](../../../crates/rovai-core/src/execution_text.rs) 的 observe 未按 runtimeRootOutput 拒绝 child text；匿名 block 在 thought/tool 等边界结束 | 已识别 child 仍可进入 RunCard；匿名并发文本还会被切碎。root/child 必须在正文聚合前分流 |
| Claude 生命周期 | [claude.rs](../../../crates/rovai-core/src/claude.rs) 会给 child 归一 payload 标记 runtimeRootOutput=false；当前没有把 task_* system 生命周期完整投影为委派状态 | 现有 flag 可解决部分正文归属，但不足以证明后台结束或结果已就绪 |
| ACP 父轮结束 | [acp.rs](../../../crates/rovai-core/src/acp.rs) 的 route_session_message 在 PromptCompleted 后只放行有限 metadata/context，其余消息 quarantine 并标记协议异常 | 原生能晚到不等于 Rovai 能晚到；不能将新消息默认绑到“最近 Run”。ZCode 专用 background 路由不代表其他 ACP Runtime 已支持 |
| Codex 路由 | [codex.rs](../../../crates/rovai-core/src/codex.rs) 按已注册 thread/turn owner 转发；未知 child thread 没有 root owner | 保留这个隔离，不为获取子工具而把所有 child 事件广播进 root；先支持 root 上的 Agent 启动/完成证据 |
| Canonical Activity | [runtime_activity_mapping.rs](../../../crates/rovai-core/src/runtime_activity_mapping.rs) 当前 classifier 为 activity-v4；collab 仍是普通 tool.call，无统一 Agent 语义 | 增加 Agent 分类应在 Core 完成并遵守 classifier cutover，Renderer 不按任意 title 包含 Agent 来猜 |
| 工具行 | [execution-presentation](../../../apps/desktop/src/shared/execution-presentation/index.ts) 按 operation/tool identity upsert step；[ExecutionToolGroup](../../../apps/desktop/src/renderer/src/ExecutionToolGroup.tsx) 展示平铺列表 | 已有 child tool 如被转发，就是普通平铺 command；同 ID update 更新同一行，尚无父子树 |
| 展开正文 | ToolCallDetail 的 retained key/reset 只以 resultKey、evidenceId 为依据；inline detail 可随 props 更新，加载后的 deferred result 不按 revision 失效 | 若同一 evidence 后续补结果，已打开详情可能继续显示旧内容。这是代码审查发现的风险，尚未用 App UI 重现实测 |

当前单条 tool output 持久化预算是 **7.5 KiB UTF-8**，见
[Execution Record Storage v3](../../contracts/execution-record-storage-v3.md)。详情的“完整结果”只能指已保存内容；
被上游或持久化预算截掉的部分不能从 UI 恢复。原型的完整长报告不能作为已有存储能力的证明。

## 建议的交互和数据边界

### 一条 Agent command

沿用[会话组件合同](../../ui/components/conversation-workspace.md)的工具行结构：固定位置的 **16px Agent 类型图标**、
任务描述、现有状态/耗时、展开入口。建议用现有线宽的“分支节点/委派”图形，类型图标与运行 spinner/成功状态分开；
使用主题语义色，不增加彩色卡片、头像或成员名牌。主正文只保留主代理的公开进度和最终答复。

展开显示实际可得的任务输入、子代理公开进度、结果；不暴露 private reasoning。原生只有最终结果时就只呈现结果，
没有结果时显示当前空状态，有读取失败则使用已有重试。保持键盘展开、焦点恢复与长内容滚动，不因内容更新自动收起或抢焦点。

子工具继续使用现有平铺方式。第一版不需要拉取缺席的子工具、不解析 prose 伪造 command，也不把 native subagent
注册为 Rovai 队员、Task 或 Mission。后续是否做树状展示是独立范围。

### 三个独立事实

建议委派内部至少区分以下事实；字段名称在正式合同设计时确定，不能只增加一个 running Boolean：

| 事实 | 示例 | UI 应表达 |
| --- | --- | --- |
| 启动调用 | Agent tool_result 成功，child 尚在跑 | 已启动 / 执行中；不能显示子任务“已完成” |
| 子任务状态 | 原生通知 completed、failed、cancelled，或尚未获得终态 | 按真实 task 状态更新；未观察到结束就保持未确认 |
| 结果可用性 | 结果在原 command、通知、另一个 TaskOutput，或未公开 | 有内容才可展示；完成但未公开结果是合法状态 |

关联键建议由 `Runtime + Host generation + Native Session + parent tool/operation + child/task ID` 组成，
消息身份还须包含作者/child 范围；不能仅依赖 messageId 或 tool 标题。前台/后台是调用模式，不是作者。
后续 read_agent/TaskOutput 是独立真实 command；仅当结构化身份可以精确关联时，才允许原 Agent 详情引用同一结果，
不复制成额外正文。不能把任意 Bash 后台进程、团队管理工具或用户命名为 Agent 的 MCP 工具都分类为委派启动。

### 晚到结果与刷新

父 prompt 完成后，只有已登记且身份匹配的 background task 可以更新原有委派记录；不重开旧 Run，不把晚到
消息归入下一个用户输入，也不触发没有 Rovai 输入所有者的生成轮。失败、停止、Host 退出或身份丢失时如实保留
结果缺失/状态未确认。共享 ACP 当前的隔离规则有防串线作用，实施时应扩展精确 background owner 通道，而非整体放开。

结果详情建议以 `evidenceId + revision/changeSequence` 做缓存失效和过期请求拒绝，继续保留展开、滚动和焦点状态。
去重应使用原生事件/message/task 身份；CodeBuddy、Qwen 的重复通知不能靠比较显示文本去重。

## 实施顺序与验收要求

1. **先完成归属与启动身份。** 为各 Adapter 建立经过本次样本验证的 typed delegation 解析；root/child/unknown
   在文本聚合前区分。Copilot 的 journal 路径先做独立可恢复验证；Qoder 明确保留未解决项。
2. **再接 Activity 与现有 UI。** Agent 类型及独立图标、单条 command 详情、保留平铺 child tools。
   遵循[活动映射门禁](../../runtime-activity/README.md)，更新正式合同和当前版本决定；历史记录不按新标题规则重分类。
3. **按 Runtime 接异步结果。** 原工具结果、独立通知、后续读取工具分别绑定，补充精确 background owner 与 revision 刷新。
   同步能力和异步能力分开验收，不以同步通过替代异步。
4. 在现有测试 owner 中覆盖：两个 child 并发交错；root 在 child 运行中继续输出；child 完成后 parent 继续；
   launch 成功但 child 失败；completed 无公开结果；父轮结束后晚到；下一轮已开始时旧结果到达；重复/乱序/重连；
   同 evidence revision 更新、慢请求过期；截断、多字节字符、结果读取失败与重试。
5. 使用生产组件做日夜主题和键盘验收；真正的 App/Core 端到端验收另走[隔离流程](../../development/local-workflow.md)。
   本次只完成协议调查与源码路径核对，未把真实 native probe 冒充生产链路通过。

## 重放

每次命令产生新的临时 workspace，调用真实模型并可能计费；不是无副作用的单元测试。使用本机原生配置，
不修改模型/认证设置，不安装扩展。示例：

```sh
node docs/research/runtime-subagents-2026-10-31/probe.mjs copilot parallel
node docs/research/runtime-subagents-2026-10-31/probe.mjs claude background
node docs/research/runtime-subagents-2026-10-31/probe.mjs qwen background
SUBAGENT_PROBE_IDLE_MS=60000 node docs/research/runtime-subagents-2026-10-31/probe.mjs hermes background
```

Pi 对照通过 `SUBAGENT_PROBE_PI_EXTENSION=<本机官方示例 index.ts 的绝对路径>` 显式加载，脚本只在本次临时
workspace 建立 `.pi/agents/probe.md`，不修改用户扩展安装。ZCode 要按官方 App 安装提供
`ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` 和已有 `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` 的精确绝对路径，
脚本以临时 `ZCODE_DATA_BASE_DIR` 创建新 Session，使用 0.17 的 Provider Registry 协议。

读取 console 中的 fixture 路径，再在本机检查 `summary.json`、`wire.jsonl` 和 `stderr.txt`。
原始文件可能含原生配置、任务正文与 reasoning，不能直接作为公开附件或提交到仓库。

## 本次交付校验

- `node --check probe.mjs` 通过；脱敏 JSON 解析与 18 个 Runtime / 38 次样本计数检查通过。
- `pnpm docs:test` 的 10 项治理测试通过。
- `pnpm docs:check` 和以 `be7cac82fd878219102c053cafd8d87f22e12024` 为 base 的
  `pnpm docs:check:ci` 在包含本次文件的干净临时 clone 中通过。
- 原工作区全量文档门禁仍被 Git 忽略的 `docs/prototypes/` 本地素材断链/仓库外链接阻塞；没有删除这些素材，
  没有给 checker 加例外。临时 clone 首次并行运行触发 pnpm 自动安装竞争，docs:test 入口失败一次，
  安装结束后重跑通过；这个失败不是文档测试断言失败。

本次 Git 交付仅包含报告、脱敏证据与调查脚本，未修改生产 Core/Renderer；没有 Rust 或 App UI 通过声明。
