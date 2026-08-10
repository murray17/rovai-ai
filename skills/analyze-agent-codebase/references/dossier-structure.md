# Agent 代码库专题文档合同

只有在用户要求多文档沉淀，或需要完整分析轴判据时读取本文件。定向问题和简短会话报告不需要机械套用全部结构。

## 选择专题

先根据源码存在性和用户问题选择专题。内容稀疏或共享同一调用链的专题应合并；一个专题内部存在多个独立权威边界时才拆分。

| 专题 | 必须回答的问题 | 优先证据 |
| --- | --- | --- |
| 运行时拓扑 | 有哪些进程/入口，依赖如何装配，核心控制权在哪里？ | binary/package entry、router、factory、registry、process launch |
| 执行与规划 | 一轮如何开始、循环、停下、重试和恢复？计划是否独立持久、何时重规划？ | loop/state enum、scheduler、model request、transition tests |
| 子 Agent 与协作 | 谁能创建或寻址谁？上下文、权限、进程和结果的隔离/回传边界是什么？ | spawn/send path、message schema、run linkage、result reducer |
| Task 与进度 | Task/plan 是提示文本还是持久领域对象？谁拥有状态转换和完成权？ | schema、command handler、state machine、cancellation tests |
| 上下文、会话与记忆 | 当前输入如何物化？截断/压缩如何发生？哪些状态跨 Run、Session 或项目存活？ | context builder、checkpoint、memory store、compaction/recovery tests |
| 模型、工具与权限 | provider 如何选择？默认工具如何注册和调用？schema、审批、sandbox 谁拥有？ | adapter registry、tool dispatcher、permission gate、receipts |
| Skill 与指令 | Skill 如何发现、选择、投递和加载？它是否只提供指导，还是错误地绕过能力边界？ | discovery path、manifest、projection/prompt builder、conflict tests |
| 存储与中间件 | 哪些数据是权威真源？transaction、queue、cache、hook 和 event 如何组合？ | migrations、repository/store、middleware chain、event consumers |
| 可观测与恢复 | 日志、trace、evidence、retry、idempotency 和 crash recovery 到哪里为止？ | event log、receipt、checkpoint、restart tests |
| 设计与扩展 | 稳定接口和 deep-module seam 在哪里？新增 adapter/tool/agent 需要改哪些层？ | traits/interfaces、plugin points、conformance tests、fan-out sites |

## 架构分类判据

### ReAct 与 Plan-and-Execute

只有看到以下闭环，才把系统判为 ReAct：模型或策略产生动作，执行环境返回 observation，同一运行状态再次进入推理，直到明确终止。单次“让模型输出 tool call”不足以证明完整 ReAct。

只有看到以下分界，才把系统判为 Plan-and-Execute：计划作为独立结构产生并被执行器消费；执行状态能够逐步推进；失败、观察或约束可以触发明确的重规划或计划修订。普通 TODO 文本、UI plan 或提示词中的步骤不等于架构级 planner。

同时存在逐步 tool loop 和独立计划状态时标为混合，并指出哪个层拥有终止、重规划和持久化权威。

### 子 Agent

分别确认：

1. 身份是持久 Agent、临时 worker、模型角色还是工具目标；
2. 创建/选择由谁触发，是否受任务或成员资格约束；
3. 输入上下文是复制、引用、摘要还是重新物化；
4. 是否拥有独立进程、session、workspace、权限和取消边界；
5. 结果是原文、结构化 receipt、压缩摘要、事件还是共享状态；
6. 调用者如何知道 accepted、running、completed、failed 或 unknown。

不要把线程池 worker、LLM 并行采样或 prompt 内专家角色自动称为子 Agent。

### Memory 与上下文

至少分开记录：

- 当前 turn/run 的 working state；
- model-visible context materialization；
- native session continuation/checkpoint；
- 可跨运行检索的长期 Memory；
- Task/Camp/Conversation 等业务历史；
- trace、event log 和审计 evidence。

说明每类数据的写入者、真源、生命周期、检索入口和权限。相同数据库不代表相同语义层。

### Tool、Skill、Prompt 与权限

- Tool：可执行 operation 及其输入/输出合同。
- Skill：供 Agent 遵循的可复用知识或流程，不自动授予 operation。
- Prompt/instruction：本次模型输入的一部分，不证明 Runtime 实际发现了 Skill。
- Permission/approval：允许动作发生的授权边界，不能由 Tool 或 Skill 自我声明取得。

追踪四者的连接点，但保持职责分离。

## 文档目录

遵循目标仓库的文档路由和命名规则。没有现成规则时，使用不会覆盖已有内容的独立目录，例如：

```text
docs/agent-codebase-analysis/
├── index.md
├── runtime-topology.md
├── execution-and-collaboration.md
├── context-memory-tools-and-skills.md
└── storage-recovery-and-extension.md
```

这只是合并后的默认形态，不要求固定文件数。用户点名多个彼此独立的主题时可以拆开；稀疏主题应合并。使用 `index.md` 作为唯一入口，除非仓库规定必须使用 `README.md`。

## `index.md` 合同

按以下顺序编写：

1. 目标、范围、commit/branch、分析日期和排除项；
2. 五到十条最高价值结论，每条带证据状态；
3. 一张最小运行时拓扑或端到端流程图；
4. 专题阅读顺序及每篇解决的问题；
5. 代码—文档一致/漂移摘要；
6. 高价值未知项和继续验证路径。

不要在 `index.md` 复制每篇专题的全部摘要。

## 专题文档合同

每篇专题使用以下最小结构：

```markdown
# <专题名称>

## 结论
<先给完整判断，并标注已确认/推断/未知>

## 端到端流程
<入口 → 装配 → 核心状态 → 副作用 → 恢复/展示>

## 关键职责与权威
<组件、职责、真源、边界>

## 证据
| 结论 | 状态 | 源码与 symbol | 测试/运行依据 | 限制或反证 |

## 设计取舍与扩展点
<为什么这样组合；新增能力会触及哪些 seam>

## 未知与漂移
<缺失证据、平台差异、文档冲突及验证方法>
```

可以删除不适用章节，但不得删除证据状态和未知项。流程复杂时使用小型 Mermaid 图；简单调用链直接用文本，避免为装饰绘图。

## 引用规则

- 首选 `path:line` 加 symbol；行号可能漂移时同时保留 symbol。
- 一条证据只支持其实际证明的范围，不从单元测试推断全部 Runtime。
- 引用生成代码时继续找到生成源或明确它是生成物。
- 外部依赖行为只引用锁定版本的官方源码/文档，或标为边界假设。
- 代码片段只保留理解结论所需的几行，不复制完整函数。

## 交付前检查

- 从每个高层结论反向点击引用，确认文件和 symbol 存在。
- 用反向引用确认核心实现已进入生产装配。
- 检查 feature flag、adapter、平台和测试 fixture 是否限制结论范围。
- 搜索文档集中的“应该、可能、通常、显然”等词，给出证据状态或改为精确表述。
- 确认没有重复总览、无依据的设计模式命名或把缺失能力写成已实现。
- 对只读分析复核工作树未变化；对文档输出复核 diff 只包含授权目录和必要导航更新。
