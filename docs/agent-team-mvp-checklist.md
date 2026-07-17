# Lumen AI：Agent Team 产品与 MVP 清单

> 状态：Draft  
> 更新日期：2026-07-17

## 1. 产品目标

打造一个本地优先、状态可恢复、记忆可解释的 Agent Team 控制平面。第一版先跑通一个真实团队闭环，不追求同时支持所有模型、终端和协作方式。

必须坚持以下领域边界：

```text
Conversation != Codex/Claude Session != CLI Process
Message History != Memory
Task Status != Agent 自己口头声明的进度
```

## 2. 开发阶段

### 阶段 0：定义领域模型

- [ ] Workspace
- [ ] AgentProfile
- [ ] Team / TeamMember / Role
- [ ] Conversation
- [ ] NativeSession
- [ ] RuntimeInstance
- [ ] Run / Turn
- [ ] Task / TaskDependency
- [ ] MailboxMessage
- [ ] Fact / MemoryItem
- [ ] ContextManifest
- [ ] ToolCall / ActionReceipt
- [ ] Approval
- [ ] DomainEvent / Outbox

### 阶段 1：跑通单 Agent

- [ ] 创建 Agent
- [ ] 启动 Codex
- [ ] 建立、恢复、重置原生 Session
- [ ] 流式接收输出
- [ ] 规范化 text、thinking、tool、error、finish 事件
- [ ] 停止当前 Turn
- [ ] Tool Approval
- [ ] 保存 Message、Turn、ToolCall
- [ ] 应用重启后恢复未完成任务
- [ ] CLI 崩溃后重建进程并恢复 Session
- [ ] Session 恢复失败时显式创建新的 Session Generation

第一步只接 Codex，不同时接入多种 Agent Runtime。

### 阶段 2：加入 Team 协作

- [ ] 固定 Lead、Worker、Reviewer 三种角色
- [ ] 每个 Team Member 拥有独立 Runtime 和 Native Session
- [ ] Lead 创建、拆分和分配任务
- [ ] Task 支持 owner、status、blocked_by
- [ ] Agent 之间发送持久化消息
- [ ] 消息写入后再唤醒目标 Agent（`persist-before-wake`）
- [ ] 目标 Agent 收到消息后自动唤醒
- [ ] 支持串行和并行任务调度
- [ ] Handoff / Ball Ownership
- [ ] 最大委派深度
- [ ] 重复消息去重
- [ ] Agent Ping-Pong 检测
- [ ] 单 Agent 连续执行次数限制
- [ ] 用户暂停、继续和取消 Team Run

### 阶段 3：加入最小记忆闭环

- [ ] Short-term Working Memory
- [ ] Session Summary
- [ ] 结构化 Fact Store
- [ ] Fact 来源和证据位置
- [ ] Fact 置信度
- [ ] Fact 更新、冲突和失效
- [ ] Project Memory
- [ ] Agent Private Memory
- [ ] Team Shared Memory
- [ ] SQLite FTS5 关键词检索
- [ ] Context Token Budget
- [ ] ContextManifest：记录召回内容及召回原因
- [ ] 用户查看、修正、删除和固定记忆
- [ ] 任务结束后提取事实与经验

MVP 不先引入独立向量数据库，优先使用：

```text
结构化 Fact + SQLite FTS5 + 时间/权威性/任务相关性排序
```

确认关键词召回不足后，再加入 Embedding 和混合检索。

### 阶段 4：扩展 Provider

- [ ] Claude Agent SDK / Claude Code Adapter
- [ ] OpenAI / Anthropic API Agent Adapter
- [ ] Capability Discovery
- [ ] Provider Event Normalization
- [ ] Provider-specific Session Strategy
- [ ] Provider-specific Permission Strategy
- [ ] 模型、模式和 Sandbox 配置
- [ ] 成本与 Token 统计
- [ ] Provider Fallback，但不自动重复危险工具操作

### 阶段 5：产品化

- [ ] Team 工作台
- [ ] Agent 状态和当前动作
- [ ] Task DAG / 看板
- [ ] Agent 间消息时间线
- [ ] Run / Turn 执行轨迹
- [ ] Tool Approval 面板
- [ ] Memory Inspector
- [ ] Context Inspector
- [ ] 崩溃恢复提示
- [ ] Agent 配置与模板
- [ ] MCP / Skill 管理
- [ ] 日志导出与诊断

## 3. 核心功能模块

| 模块 | 主要职责 | MVP |
| --- | --- | --- |
| Control Plane | 管理 Team、Run、Task 和状态机 | 必须 |
| Agent Runtime | 启动和监管 Codex、Claude、API Agent | 必须 |
| Session Manager | start、resume、reset、fork、generation | 必须 |
| Event Normalizer | 统一不同 Agent 的流事件 | 必须 |
| Team Coordinator | 分工、委派、handoff、终止条件 | 必须 |
| Task Engine | owner、依赖、状态和重试 | 必须 |
| Mailbox / Router | Agent 间可靠消息传递 | 必须 |
| Context Builder | 按预算组装当前上下文 | 必须 |
| Fact Store | 保存可验证的结构化事实 | 必须 |
| Memory Service | 提取、召回、更新和遗忘 | 简化版 |
| Tool Gateway | MCP、工具调用和权限控制 | 必须 |
| Action Ledger | 记录外部副作用，避免重复执行 | 必须 |
| Recovery Manager | Lease、重启恢复和僵尸清理 | 必须 |
| Audit / Observability | 解释谁在何时做了什么 | 必须 |
| Scheduler / Cron | 定时和长期任务 | MVP 后 |
| Plugin Marketplace | Agent / Skill 模板市场 | MVP 后 |
| Distributed Runtime | 跨机器部署 | 暂不做 |

## 4. 推荐 MVP 闭环

```text
用户提交编码任务
  -> Lead 分析并拆分任务
  -> Coder 使用 Codex 修改代码
  -> Reviewer 检查结果
  -> 不通过则退回一次
  -> Lead 汇总并结束 Run
  -> 系统提取项目事实和经验
```

MVP 限制：

- 单用户、本地运行；
- 单 Workspace；
- 固定三个 Agent；
- 只实现一个 Codex Adapter；
- 只使用 SQLite；
- 单个 Control Plane 进程；
- 不使用 Redis；
- 不使用独立向量数据库；
- 不支持动态无限创建 Agent；
- 最多一次自动返工；
- 所有文件写入、命令执行和外部操作可审计；
- 危险操作必须人工确认。

## 5. MVP 验收清单

- [ ] 用户能创建 Lead / Coder / Reviewer Team
- [ ] Lead 能生成并分配结构化任务
- [ ] Agent 能互发可靠消息
- [ ] Task 状态与 Agent 消息相互独立
- [ ] 每个 Agent 都有独立原生 Session
- [ ] CLI 进程重建后能恢复原 Session
- [ ] Session 无法恢复时生成新的 `session_generation`
- [ ] 中途杀掉应用，重启后能继续 Run
- [ ] 同一个 ToolCall 不会因重试执行两次
- [ ] Reviewer 能触发一次返工
- [ ] 新任务能召回上一次产生的项目事实
- [ ] 用户能看到召回了什么以及为什么召回
- [ ] 用户能删除错误记忆
- [ ] 所有状态变化都有审计事件
- [ ] Team 能明确进入 completed、failed 或 cancelled，而不是无限运行

## 6. 初始技术基线

```text
Node.js 24 + TypeScript
Fastify
SQLite WAL + FTS5
React Web UI
SSE / WebSocket 事件流
Codex SDK / app-server 优先
Codex CLI JSONL 作为 fallback
MCP SDK
```

先实现 Headless Control Plane，再增加桌面壳。第一阶段不同时承担 Electron、移动端、云同步和多用户权限。

## 7. 待确认的首个产品选择

第一版选择一条真实闭环作为验收场景：

1. Planner -> Coder -> Reviewer 的软件开发团队（推荐）
2. Researcher -> Writer -> Reviewer 的研究报告团队
3. 通用自由组队的个人生产力助手
