---
document_type: protocol-contract
contract: run-process-detail-surface-v32
authority: builtin-input-and-carrier-presentation
status: accepted
version: 32
source_version: v1.58
last_updated: 2026-09-12
---

# Run Process Detail Surface v32

继承 [v31](run-process-detail-surface-v31.md) 的执行过程、四轨 Tool 行、状态图形、文件入口、普通工具结果惰性读取和 Evidence 持久化边界。本版只替换 Rovai Built-in 的显示名称、详情来源和重复 Shell 载体展示；内部 operation、receipt、Canonical Activity、数据库和历史 Evidence 不变，不执行数据迁移。

## Built-in 名称与入参

执行台和本地单聊共用此规则。Core-owned 且存在于 Built-in CLI catalog 的操作，使用对应 CLI 名称；内部 operation 继续用于协议、授权、幂等和历史读取。

| 内部 operation | 显示名称 |
| --- | --- |
| `camp.message.send` | `rovai send` |
| `team.gather` | `rovai gather` |
| `member.create` | `rovai member create` |
| `team.create_task` / `team.get_task` / `team.list_tasks` / `team.update_task` | `rovai task create` / `get` / `list` / `update` |
| `camp.list` / `camp.search` / `camp.read` | `rovai camp list` / `search` / `read` |
| `single_chat.history` | `rovai single-chat history` |
| `history.search` | `rovai history search` |
| `memory.view` / `memory.search` / `memory.read` / `memory.write` | `rovai memory view` / `search` / `read` / `write` |
| `automation.list` / `get` / `create` / `run` / `close` / `update` / `delete` | `rovai automation list` / `get` / `create` / `run` / `close` / `update` / `delete` |

详情只使用同一 operation 的 Core 公共 `operationProjection.canonicalInput`，以既有等宽 JSON 详情面展示。执行中、完成、失败、等待审批、停止、跳过和已记录七种状态使用相同的入参规则，状态仅由既有状态图形及可访问名称表达。详情不展示成功结果、错误说明、结果链接、Envelope、request/receipt 或摘要；不读取结果 Blob，也不从 raw input、Shell 或结果反推入参。

公共输入中的计数、摘要、脱敏/截断标记等投影辅助事实不进入详情。`recipientAgentIds`、`mentionsCurrentUser` 和 `requestedStatus` 分别显示为输入名 `to`、`mentionUser`、`status`。保留实际参数的 `false`、`0` 和数组值；已脱敏字段整项省略，不显示占位。Send/Gather 的 `body` 整项省略。其他工具的公开语义入参按原投影保留。

没有公开输入、旧 Evidence 缺少输入投影，或省略后为空时，只展示名称和状态；不出现箭头、空对象或原因说明。Core 现有公共投影没有提供的参数不会被补造。

## Shell 载体与正文省略

一条完成的纯 Rovai CLI Shell 只有同时满足以下条件，才从本地展示列表折叠到已有 Built-in 行：

- 属于同一 AgentRun，CLI 操作相同；
- Core Catalog 已验证且可信的 Built-in 起止 Evidence sequence 严格位于该 Shell 的起止范围内；
- Shell 成功输出是完整 JSON，精确等于该操作既有 Agent Result Projection；
- 对应 Core invocation 和 Shell carrier 均唯一。

帮助、版本查询、提前失败、没有对应 Core 记录、输出不完整、关联不确定、重复返回值以及混合独立命令均保留 Shell。命令替换、未知重定向等不能作为可折叠纯载体。支持直接命令、Shell 包装、环境赋值及既有 `npx`/`bunx` 包装；已完整省略的静态 stdin 输入可作为纯载体的一部分。

折叠只改变显示列表，保留底层 Evidence 和 Canonical 身份。组内步骤数量按折叠后的可见操作计数，一次已关联的调用计一步；不改写审计或工具测量计数。

仍展示的 Shell 中，`rovai send/gather --body VALUE`、`--body=VALUE` 以及旧位置正文整体省略；不再留下 `--body` 或 `[已隐藏]`。Rovai 的 heredoc/here-string JSON 输入载体在单行格式化前整体省略，后续独立命令保留。其他凭据继续使用原有敏感参数脱敏规则。共享公开 command 与名称会同步到使用它们的只读渠道视图，渠道结果策略保持既有合同。

## 视觉与交互

沿用 28px 工具行、16px 类型图标、16px 状态轨、20px 箭头轨及 10px 等宽详情，不增加标签、错误说明或空态提示。Day/Night、底部执行台和窄 Inspector 使用同一组件。有效入参才提供原生 disclosure；首次展开前不挂载详情，展开后的可聚焦区域支持既有滚动键和 Escape 返回摘要。普通 Shell/Web/Tool 的结果读取、失败重试和文件 Diff 行保持 v31。

## Evidence 持久化与模型观察边界

继续采用 [v31 的 Evidence 持久化与模型观察条款](run-process-detail-surface-v31.md#evidence-持久化与模型观察边界)，本次没有存储、模型上下文、CLI Transport 或历史迁移改动。

## 验收

- 显示映射与 Core 的 23 项 CLI catalog 一致，内部身份不变；
- 七种状态只显示公开入参，缺失/省略后的空输入没有展开入口，结果 Blob 不被读取；
- 唯一嵌套的纯载体计一步；混合、未匹配、跨 Run、时间范围外和歧义情况保留；
- 引号、等号形式、多行 body、stdin JSON 与混合 Shell 不泄露省略正文，也不吞掉独立命令；
- 生产组件在两种主题、底部与 Inspector 内保持原有几何、滚动和键盘交互，普通工具仍可读取完整结果。
