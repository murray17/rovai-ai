---
document_type: version-overview
version: v0.75
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-14
---

# Rovai-ai v0.75：显示名 Inline Alias、Review Duo 与 Memory 正确性收口

> 当前状态：显示名 inline alias、Review Duo 结果恢复、Memory correctness closure、Built-in Transport v10
> 与全部治理证据均已发布到 `main`。
>
> 前置版本：[v0.74 Runtime 对齐的协作 Skill 与双轴代码评审](../v0.74/README.md)

## 版本目标

让 Agent 在公共正文中使用当前 Camp 成员的完整显示名完成确定性 A2A 寻址，同时继续把 canonical
`agent_N` 作为唯一持久身份。目标输入是这次真实失效形态：

```text
@爱丽丝 v35 实现完成，基线已冻结，请做只读 CR。
```

Core 在发送事务中把 `@爱丽丝` 解析为对应的 `agent_N`，再复用既有收件人校验、去重、Structured
Content、Delivery、预算、lineage、幂等和 compact output 链路。显示名不进入冻结收件人身份。

## 交付范围

### 确定性 alias 语法

- 新增 `@<当前 Camp 有效成员完整显示名><空白符或正文结束>`；匹配大小写敏感且不做归一化、昵称或
  模糊推断；
- “当前 Camp 有效成员”继续要求 CampMember active、无 leave request 且 AgentProfile present；
- canonical `@agent_<positive integer>` 保持最高优先级；多个显示名前缀可匹配时选择完整字节长度最长者，
  同长歧义时不产生 alias recipient；
- fenced code、inline code、URL token 与反斜杠转义继续按现有 parser 忽略；v1 不接受中文/英文标点作为
  显示名边界；
- `--to` 继续只接受 canonical Agent ID，显示名 alias 只存在于正文。

### Canonical freeze 与投递

- alias 在同一 Core transaction 内先解析为 Agent ID，再进入既有 self、Camp membership、ancestor、
  fanout、depth、Task 与 budget 校验；
- Structured Content 把命中区间写成 `member_mention(agentId)`；CampMessage recipient snapshot、
  Message Delivery 和 Agent output 只保存 canonical ID；
- canonical token、display-name alias 和 `--to` 的并集继续稳定去重；同一目标只创建一条 Delivery；
- accepted output 的 `effectiveRecipients` 是权威后置条件；空数组表示本次没有 Agent 路由或唤醒。

### Agent-facing teaching

- `rovai send --help` 与 `camp.message.send` schema 说明精确 alias 边界，并明确稳定自动化优先使用
  canonical ID；
- `--to` 帮助明确拒绝显示名；发送者必须检查 `effectiveRecipients`，不能只看命令退出成功；
- `cli-operations` Skill 继续把 routine single send 路由到 exact help，不复制 parser 细节。

### Review Duo 结果恢复

- Axis manifest 冻结 expected part count、accepted part message IDs、编号、finding ranges、
  transmitted/total 数量、transmitted severity counts 与 unsent IDs；
- Lead exact-read 全部 parts，验证可信发送者、直接父消息、snapshot、连续 finding IDs、正文汇总和
  `addressing.effectiveAgentRecipients`；
- public-only parts、Spec manifest/pointer 与 final 的 Agent 收件人保持为空，Standards manifest 只寻址
  当前 Review Lead；任一结构或关系缺口都使 assembly 显式降级。

### Memory correctness closure

- Supersession Create 在任何写入前准备 predecessors、successor、cycle 与最终容量；合法 successor 可跨
  Scope/Kind/direction，拒绝不能留下 Revision、keys、FTS、Review invalidation、retire 或 edge；
- Memory Search/authorized Read 返回 Agent-relative immutable Scope identity；Relationship 明确
  counterparty 与 direction，body-free stale/unavailable 结果继续不暴露身份；
- Agent revise 必须复制 deciding Read 的 Scope identity，Core 在 Revision CAS/no-change 前同时验证 mutation
  authorization 与完整 target identity，错误目标统一 `memory.unavailable`；
- 已形成 typed Memory command 的 capacity、quota、Presence、Scope 等可预期领域拒绝全部形成 durable
  command result，状态变化后的同 command identity retry 仍重放首次结果；
- Built-in Tool contract/CLI command/capability 升为 v10，catalog、help、Skill 与 smoke 同步。

## 非目标与冻结边界

- 不支持标点边界、大小写折叠、Unicode 近似、前缀、昵称、handle、slug 或跨 Camp 显示名查找；
- 不把 display name 变成稳定身份，不允许 `--to 爱丽丝`，也不从普通 prose、reply、Task 或 Default Lead
  推导收件人；
- 不修改 CampMessage、Message Delivery、AgentRun、Current User Attention、Renderer 或数据库 schema；
- 不新增私有消息、第二套 Delivery、Renderer-side parser、Runtime Activity 或 Migration；
- IPC、Envelope、receipt 与 Agent Output 版本不变；Memory closed wire shape 使 Built-in Tool contract、CLI
  command 与 Runtime capability 从 v9 升为 v10，Binding compatibility 继续以 version 加 digest fencing；
- 不借本版本修复 v0.74 未完成的 duo dry-run 或既有 Clippy 基线。

## 发布门槛

1. parser 单测覆盖空白/EOF、非边界、标点、最长匹配、canonical 优先、歧义、代码、URL 与转义；
2. Core 集成测试证明 `body="@爱丽丝 ...", to=[]` 冻结 canonical recipient、Structured Mention 且只创建
   一条 Delivery；
3. CLI/schema/help 与 smoke 断言精确说明 alias，并把目标 ID 与 `effectiveRecipients` 做相等检查；
4. Camp Message Send v6、ADR-0182、Architecture、CURRENT、Contract 和 Version 路由一致；
5. Memory Capture v2、ADR-0183、Built-in Tool Transport v10 与实现/Skill/catalog/smoke 一致，原子性、
   anti-oracle、Scope identity 和 durable replay 回归通过；
6. 定向与完整 Core tests、格式、文档治理和 `git diff --check` 通过；
7. Review Duo 通过 Skill validator、official bundle 回归、结果传输残留扫描与独立成品审读；
8. 只有上述证据完成后，才把本版本和实施计划状态改为 `complete`。

上述门槛已完成：最新 `main` 基线上的完整 `rovai-core` 测试通过（lib 430、CLI 11、Core binary 73，另有
3 项既有 manual Runtime smoke 按原标记忽略），文档 21 项单测、Vitest 329 项、Node/benchmark 179 项、
TypeScript typecheck、Clippy `-D warnings`、Rust format、普通治理、真实 base CI、ADR generation check、
smoke/qualification script syntax 与 `git diff --check` 均通过。Memory 实现提交 `91bb0bf5` 已快进发布到
`main`；[实施与验收计划](implementation-plan.md)记录逐项证据。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | [v0.74](../v0.74/README.md)按未完成事实冻结为 historical；v0.75 成为唯一 current，并新增本概览与[实施计划](implementation-plan.md) |
| ADR | 已更新 | [ADR-0182](../../adr/0182-core-resolved-current-camp-display-name-inline-addressing-alias.md)拥有 inline alias；Review Duo 结构校准继续服从 ADR-0181；新增 [ADR-0183](../../adr/0183-scope-identified-agent-memory-revision-targets.md)冻结 Scope-identified Search/Read/revise |
| Contracts | 已更新 | [Camp Message Send v6](../../contracts/camp-message-send-v6.md)保持当前；新增 [Memory Capture v2](../../contracts/memory-capture-v2.md)与 [Built-in Tool Transport v10](../../contracts/builtin-tool-transport-v10.md)，v1/v9 转 historical current-entry |
| Architecture | 已更新 | [Public A2A Message 与 Message Delivery](../../architecture/public-a2a-message-delivery.md)保留 alias；[Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)保留 Review Duo 恢复并升级 v10；[Online Memory Capture](../../architecture/online-memory-capture.md)增加 Scope target、durable rejection 与 atomic Supersession |
| UI | 确认无需更新 | Renderer 继续只消费 canonical Structured Member Mention；不增加输入提示、交互或视觉合同 |
| Runtime Activity | 确认无需更新 | alias 解析不新增 provider event、Canonical Activity domain、semantic kind 或 evidence shape |
| Runtime compatibility | 确认无需更新 | v10 capability 从代码常量生成并强制新 preflight，但本次没有新增真实 Runtime 版本/安装实测结论，兼容性清单不伪造证据 |
| Documentation routing | 已更新 | 文档导航、CURRENT、ADR/Contract/Architecture/Version 索引切换到 ADR-0183、Memory Capture v2 与 Built-in Tool Transport v10 |
| Root README | 确认无需更新 | 项目定位、常青能力和已支持 Runtime 范围不变；根 README 不记录版本局部 parser 规则 |

## References

- [实施与验收计划](implementation-plan.md)
- [ADR-0182: Core-Resolved Current-Camp Display-Name Inline Addressing Alias](../../adr/0182-core-resolved-current-camp-display-name-inline-addressing-alias.md)
- [ADR-0183: Scope-Identified Agent Memory Revision Targets](../../adr/0183-scope-identified-agent-memory-revision-targets.md)
- [Camp Message Send v6](../../contracts/camp-message-send-v6.md)
- [Memory Capture v2](../../contracts/memory-capture-v2.md)
- [Built-in Tool Transport v10](../../contracts/builtin-tool-transport-v10.md)
- [Message Delivery v2](../../contracts/message-delivery-v2.md)
- [Online Memory Capture](../../architecture/online-memory-capture.md)
- [Public A2A Message 与 Message Delivery architecture](../../architecture/public-a2a-message-delivery.md)
