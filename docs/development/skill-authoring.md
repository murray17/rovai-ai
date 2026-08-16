---
document_type: development-guide
authority: skill-authoring-and-description-routing
last_updated: 2026-08-16
---

# Skill 编写与 description 路由规范

本文定义仓库 `skills/*` 的常青编写约定，重点约束 `SKILL.md` frontmatter 中的
`description`。它拥有写作和验证约定，不拥有 Skill Library、Runtime projection、bootstrap
或执行完整性语义；这些边界继续以
[Skill Projection Reconciliation](../architecture/skill-projection-reconciliation.md)和相关 ADR 为准。

## 目录

- [渐进加载分层](#渐进加载分层)
- [description 固定结构](#description-固定结构)
- [执行细节的归属](#执行细节的归属)
- [界面元数据](#界面元数据)
- [常用模板](#常用模板)
- [审阅问题](#审阅问题)
- [仓库更新与验证](#仓库更新与验证)

## 渐进加载分层

| 位置 | 职责 | 不承担 |
| --- | --- | --- |
| `SKILL.md` 的 `name` 与 `description` | 由 Runtime 投影为相关性元数据，帮助模型判断当前任务是否应加载 Skill | 执行步骤、工具参数和输出协议 |
| `SKILL.md` 正文 | Skill 触发后的共同工作流、路由和完成条件 | 只服务单一角色或分支的大段细节 |
| `references/*.md` | 按角色、操作或分支渐进加载的细节 | 顶层触发判断 |
| `agents/openai.yaml` | Skill 列表、chip 和默认提示等界面元数据 | 模型触发真源 |

`description` 是始终可见的相关性指针，不是正文摘要或压缩后的执行手册。正文和 references
必须自行拥有执行所需的步骤、约束、格式和恢复规则。

更一般的 Agent 文档分层与 context pointer 写法见
[writing-for-agents](../../skills/writing-for-agents/SKILL.md)；Skill frontmatter 的调用取舍见
[Skill mechanics](../../skills/writing-for-agents/SKILL-MECHANICS.md)。

## description 固定结构

默认采用：

> 主触发场景 + 继续使用场景 + 排除边界

```yaml
description: 当用户希望【主要目标和常见表达】时使用。【流程中的相关角色或后续任务】也使用。普通【最相近但不同的任务】、【无关输入】和【已经终止的情况】不使用。
```

### 主触发场景

- 从用户自然表达的目标开始，例如创建、比较、讨论、评估、审查或修改某类成果。
- 合并只是在重复同一意图的近义词，只保留真正不同的触发分支。
- 只有执行特点会直接改变 Skill 选择时才写入，例如“多位成员共同讨论”。
- 不把内部消息标题、命令名、工具名或状态字段作为主要触发条件。

### 继续使用场景

- 说明流程启动后，哪些角色在执行什么任务时继续使用。
- 使用“主持人继续整理讨论”“成员收到本次协作任务”等任务语言。
- 不使用内部完成事件、固定消息标题或阶段编号代替人的任务。

### 排除边界

- 只列最容易误触的相邻任务、无关输入和已经结束的流程。
- 优先说明正确去向；只保留无法用正向表达替代的必要禁止项。
- 不追求穷举所有不使用场景。

## 执行细节的归属

以下内容通常放入 `SKILL.md` 正文或对应 reference，而不是 `description`：

- 要运行的命令及参数；
- 固定消息标题或内部事件名；
- 第一轮、第二轮等执行顺序；
- 要读取的 reference；
- 结果字段、模板和输出格式；
- 错误恢复与 retry 规则；
- 字数、次数、预算和超时限制。

判断标准是：删去这些内部细节后，`description` 是否仍能准确回答“当前该不该加载这个
Skill”。若能，细节就应下沉；若某项特征本身决定 Skill 选择，只保留最短的选择语义。

## 界面元数据

`agents/openai.yaml` 的 `short_description` 是 Skill 列表中的简短用户界面文案，不承担模型路由，
也不复制完整 frontmatter `description`。默认控制在 25–64 个字符，使用自然、可独立理解的一句话，
说明用户能获得什么结果；不要写内部消息标题、工具名、状态字段或分轮实现细节。

`default_prompt` 可以提供一个自然的起步请求，但不能改变 Skill 正文的授权、完成条件或执行边界。
调整 Skill 定位时同时检查这两个字段与 frontmatter 是否一致，但不要求三者使用相同句子。

## 常用模板

普通任务型：

```yaml
description: 当用户希望【创建、分析或修改某类成果】时使用。继续调整、检查或完善该成果时也使用。普通咨询、无关任务和已经完成且没有新要求的内容不使用。
```

多人协作型：

```yaml
description: 当用户希望多位成员共同【讨论、评估或审查】时使用。负责组织和整理结果的人，以及收到本次协作任务的成员，都使用本 Skill。普通单人任务、无关成员发言和已经结束的协作不使用。
```

选择操作型：

```yaml
description: 当当前任务可能需要在【操作 A、操作 B、操作 C】之间选择，或需要组合多个操作时使用。操作已经明确且只需执行一次时，直接使用对应操作，不加载本 Skill。
```

仓库中的多人协作示例见 [Campfire](../../skills/campfire/SKILL.md)，选择操作示例见
[CLI Operations](../../skills/cli-operations/SKILL.md)。

## 审阅问题

1. 用户没有说出 Skill 名称时，能否根据自然语言意图命中？
2. 流程中的其他角色是否知道自己何时也应加载？
3. 能否和最接近的其他 Skill 区分？
4. 删除内部工具名、消息标题和状态字段后，含义是否仍完整？
5. 读完后得到的是“该不该使用”，还是只知道“它大概怎么执行”？

若答案主要是“怎么执行”，把对应内容移入正文或 reference。

## 仓库更新与验证

1. 修改 `skills/<name>/SKILL.md` 的 `description`，并确认移出的执行细节在正文或 references
   中仍有唯一权威位置。
2. 检查 `agents/openai.yaml` 是否仍与 Skill 的用户可见定位一致；确认 `short_description` 为
   25–64 个字符，不要把 frontmatter `description` 原样复制成界面文案。
3. 修改 pinned third-party Skill 时，继续服从其 provenance、许可和有效 ADR 允许的改动面。
4. 使用当前 Skill authoring 工具提供的 validator 检查 frontmatter、名称和目录结构。
5. 运行 `git diff --check`；修改本文或文档导航时再运行 `pnpm docs:test`、`pnpm docs:check`
   和 `pnpm docs:adr:generate -- --check`。
6. 更新相关语义测试时，断言应覆盖自然语言选择边界和排除边界；不要为了让测试通过而把命令、
   固定消息标题或内部完成事件塞回 `description`。
