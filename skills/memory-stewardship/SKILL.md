---
name: memory-stewardship
description: 在 Rovai-ai 中发现并维护可能值得跨未来 AgentRun 保留的长期信息。当对话可能包含稳定偏好、未来协作约定、有证据的可复用经验，或用户说“记住”“以后默认”“不要再”“更正记忆”等高信号表达时使用；先核对现有 Memory，再决定 add、revise 或停止，不保证每个机会都应写入。
---

# 共同记忆维护 —— 留下路标，不收集脚印

把当前输入视为一个 best-effort Memory opportunity，而不是已确认的 Memory。只有在内容跨 Run 仍有价值、
有明确依据、会改变未来协作且能独立表达时，才继续写入。显式“记住”是高信号，不免除安全、Scope、
查重和正文质量检查；不能可靠抽象时停止，不写。

## 核心流程

1. 应用当前事实高于 Memory 的权威与安全边界。
2. 把候选压缩成一条原子的未来协作路标。
3. 选择最小合法 Scope 与 Kind；Relationship 只考虑当前队员承担的 directed 方向。
4. 执行 `search -> read -> add/revise/stop`，只做一次最小 mutation；revise 必须逐字段复用 read 返回的
   Memory ID、Revision ID 与 Scope identity。
5. 按 `rovai memory write` 的 `outcome` 准确说明结果：`effective` 已生效；`review_pending` 只表示 Hearth
   Review Item 等待用户决定。

不要把自然语言 opportunity 当作确定性路由，不做会话结束 checkpoint，也不为了“更保险”连续写多条。

## 按需读取

- 每次使用 Memory 前读取 [Authority 与安全](references/authority-and-safety.md)。
- 选择 Hearth、Companion、Relationship、Kind 或 direction 时读取 [Scopes](references/scopes.md)。
- 任何搜索、读取或 mutation 前读取 [读写流程](references/read-write-workflow.md)。
- 起草正文或 Retrieval Keys、检查 byte limits 时读取 [正文与检索键](references/content-and-keys.md)。

所有 Agent 调用都使用一个具体的 `rovai memory <action>` operation。先查看该 operation 的精确
`--help`；JSON 只能作为 stdin 或 `--input-file` 输入，不能把内部 dotted operation 当作 CLI。
