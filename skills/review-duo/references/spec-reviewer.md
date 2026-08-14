# Spec 评审者指南

当前队员负责 Spec 轴时读取本文件。Spec 轴只回答：

> 冻结代码差异是否满足被冻结的需求与验收条件？

它不负责代码风格、仓库规范或通用质量判断。

## Requirement 来源

允许来源：

1. 用户本轮明确目标；
2. PR 描述与验收条件；
3. linked Issue；
4. 当前版本范围与 acceptance criteria；
5. 明确设计文档；
6. Contract；
7. accepted ADR 中与本次功能直接相关的要求；
8. 用户显式指定的其它需求文件。

Commit message、branch name、测试名和现有实现可以帮助定位来源，但默认不是需求真源。

把来源冻结成原子 Requirement：

```text
REQ-001
- statement：可验证要求
- source：稳定引用、版本与位置
- acceptance：可观察条件
```

任一轴开始后不得在同一 review 中临时新增 Requirement。

## 冲突与缺失

来源冲突时标出冲突 Requirement，引用双方来源，继续检查不受影响部分，冲突部分设为 `blocked`，不选择对实现最有利的一份。

找不到可冻结需求时：

```text
status = not_assessed
```

仍保留 Spec 区块，说明不能判断实现是否正确，也不能显示通过。

不要从代码、tests、commit message、branch name 或常见产品习惯反向创造需求。

## 检查类型

逐条 Requirement 判断：

```text
satisfied
partial
missing
wrong
blocked
not_verifiable
```

重点寻找完全缺失、边界缺失、行为语义错误、验收条件不成立、失败/取消/重试/恢复不符合要求、改变产品行为的 scope creep，以及文档声称完成但生产路径未接通。

Spec finding 必须引用 Requirement，并解释代码如何偏离它。单纯“代码不够优雅”不是 Spec finding。

## 测试的作用

测试可以证明它覆盖的行为，不能自动成为需求来源，也不能证明没有覆盖的行为。

没有运行测试时明确写 `not_run`，不要把静态阅读描述成运行验证。

## Finding 与锁定

读取 [Finding 与结果格式](findings.md)。

在本轴内处理精确重复，再按 severity、Requirement 顺序、Coverage 文件顺序和 finding ID 锁定。

先取得本次已 accepted Standards request 的准确 `messageId`。按 [Finding 与结果格式](findings.md) 计算 UTF-8 byte budget；存在 findings 时，以完整 finding 为边界形成 Spec parts，逐条通过不带 `--to` 或 `--to-user` 的 public-only `rovai send` 发布，保留 accepted `messageId` 并确认 `effectiveRecipients=[]`。

最后 public-only 发布 compact Spec manifest，列出 expected part count、所有 accepted part IDs、编号、finding ranges/counts、transmitted/total 数量、Requirement coverage 和限制，并包含精确行 `Spec source locator <accepted Standards request messageId>`。确认 accepted `effectiveRecipients=[]`。Core 会让 parts 与 manifest 回复当前 Lead Run 的用户触发消息，而不是启动标记。

只有所有预期 parts 与 manifest 都 accepted，且 manifest 中的 IDs、编号、ranges/counts、transmitted/total 数量和 transmitted severity counts 与正文一致，结果才视为完整锁定；部分发送失败、结构不完整或出现非预期收件人时降级为 `partial` 或 `failed`，不得截断后称为 complete。之后收到 Standards 结果时，不为了对齐另一轴而修改结论。

## 只读边界

Spec review 不授权修改实现或测试、更新需求文档、自动补验收条件、创建 Task/Issue/PR/Memory/ADR、提交、推送或开始实施。

建议方向只是评审意见，不是写入授权。
