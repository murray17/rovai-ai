# 分析轴与专题文档

完整架构分析或多篇文档沉淀时读取本文件。定向问题和简短会话报告不需要机械覆盖全部内容。

## 选择分析轴

只选择源码中真实存在、且与用户问题相关的轴。共享同一调用链的主题可以合并；存在独立控制权或数据真源时才拆分。

| 分析轴 | 必须回答的问题 | 优先证据 |
| --- | --- | --- |
| 运行时拓扑 | 有哪些入口或进程，依赖如何装配，核心控制权在哪里？ | binary/package entry、router、factory、registry、process launch |
| 执行与规划 | 一轮如何开始、循环、停下、重试和恢复？计划是否独立存在？ | loop/state enum、scheduler、model request、transition tests |
| 子 Agent 与协作 | 谁能创建或寻址谁？上下文、权限和结果如何隔离与回传？ | spawn/send path、message schema、run linkage、result reducer |
| Task 与进度 | Task 或 plan 是提示文本还是持久对象？谁拥有状态转换和完成权？ | schema、command handler、state machine、cancellation tests |
| 上下文、会话与记忆 | 输入如何物化和压缩？哪些状态跨运行、会话或项目存活？ | context builder、checkpoint、memory store、recovery tests |
| 模型、工具与权限 | provider 如何选择？工具如何注册、调用和授权？ | adapter registry、tool dispatcher、permission gate、receipts |
| Skill 与指令 | Skill 如何发现、选择和装载？它与 Tool、prompt 的边界是什么？ | discovery path、manifest、projection/prompt builder |
| 存储与中间件 | 哪些数据是权威真源？事务、队列、缓存和事件如何组合？ | migration、store、middleware chain、event consumer |
| 可观测与恢复 | 日志、trace、retry、幂等和 crash recovery 到哪里为止？ | event log、receipt、checkpoint、restart tests |
| 设计与扩展 | 稳定接口和扩展 seam 在哪里？新增能力会触及哪些层？ | traits/interfaces、plugin points、conformance tests |

## 架构分类判据

### ReAct 与 Plan-and-Execute

只有看到“产生动作 → 环境执行 → 返回 observation → 同一运行状态再次推理 → 明确终止”的闭环，才判为 ReAct。单次模型 tool call 不足以证明完整 ReAct。

只有看到独立计划结构被执行器消费、执行状态逐步推进，并存在明确的计划修订或重规划触发，才判为 Plan-and-Execute。普通 TODO、UI plan 或提示词步骤不是架构级 planner。

两种结构同时存在时标为混合，并说明终止、重规划和持久化分别由哪一层负责。

### 子 Agent

分别确认：

1. 身份是持久 Agent、临时 worker、模型角色还是工具目标；
2. 创建或选择由谁触发；
3. 输入上下文是复制、引用、摘要还是重新物化；
4. 是否拥有独立进程、session、workspace、权限和取消边界；
5. 结果以原文、结构化结果、摘要、事件还是共享状态返回；
6. 调用者如何知道 accepted、running、completed、failed 或 unknown。

不要把线程池 worker、并行采样或 prompt 内专家角色自动称为子 Agent。

### Context、Session、Memory 与历史

至少分开：

- 当前运行的工作状态；
- 模型可见的上下文物化；
- 原生会话 continuation 或 checkpoint；
- 可跨运行检索的长期 Memory；
- Task、Conversation 等业务历史；
- trace、event log 和审计证据。

说明每类数据的写入者、真源、生命周期、读取入口和权限。存储在同一数据库不代表属于同一语义层。

### Tool、Skill、Prompt 与权限

- **Tool**：可执行操作及其输入输出合同。
- **Skill**：供 Agent 遵循的知识或流程，不自动获得执行能力。
- **Prompt / instruction**：本次模型输入的一部分，不证明运行时实际发现或加载了 Skill。
- **Permission / approval**：允许动作发生的授权边界，不能由 Tool 或 Skill 自我声明获得。

追踪四者的连接点，同时保持职责分离。

## 专题文档目录

遵循目标仓库的文档导航和命名规则。没有现成规则时，使用不会覆盖已有内容的独立目录，例如：

```text
docs/agent-codebase-analysis/
├── index.md
├── runtime-topology.md
├── execution-and-collaboration.md
├── context-memory-tools-and-skills.md
└── storage-recovery-and-extension.md
```

这是可合并的默认结构，不要求固定文件数。稀疏主题合并，独立权威边界再拆分。使用 `index.md` 作为唯一入口，除非仓库规定使用 `README.md`。

## `index.md`

按以下顺序组织：

1. 目标、范围、revision、分析日期和排除项；
2. 五到十条最高价值结论及证据状态；
3. 一张最小运行时拓扑或关键流程图；
4. 专题阅读顺序及每篇解决的问题；
5. 代码—文档一致与漂移摘要；
6. 高价值未知项和继续验证路径。

不要在索引中复制每篇专题的全部摘要。

## 专题文档

每篇使用以下最小结构：

```markdown
# <专题名称>

## 结论
<完整判断，并标注已确认 / 推断 / 未知>

## 端到端流程
<入口 → 装配 → 核心状态 → 副作用 → 恢复或展示>

## 关键职责与权威
<组件、职责、真源和边界>

## 证据
| 结论 | 状态 | 源码与 symbol | 测试或运行依据 | 限制或反证 |

## 设计取舍与扩展点
<为什么这样组合；新增能力会触及哪些 seam>

## 未知与漂移
<缺失证据、平台差异、文档冲突和验证方式>
```

可以删除不适用章节，但不能删除证据状态和未知项。复杂流程使用小型 Mermaid 图；简单调用链用文本即可。

## 引用规则

- 优先使用 `path:line` 和 symbol；行号容易漂移时同时保留 symbol。
- 一条证据只支持它实际证明的范围，不从单元测试推断全部运行时行为。
- 引用生成代码时继续找到生成源，或明确标记为生成物。
- 外部依赖行为只引用锁定版本的官方源码或文档，否则标为边界假设。
- 代码片段只保留理解结论所需的最小范围。

## 交付前检查

- 从每个高层结论反向检查引用的文件和 symbol。
- 确认核心实现已经进入生产装配。
- 检查 feature flag、adapter、平台和 fixture 是否限制结论范围。
- 将“应该、可能、通常、显然”等词改为精确判断或标注证据状态。
- 确认没有重复总览、无依据的设计模式命名或把缺失能力写成已实现。
- 只读任务复核工作区未变化；文档任务确认 diff 只包含授权目录和必要导航。
