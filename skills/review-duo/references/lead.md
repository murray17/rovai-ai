# Review Lead 指南

用户发起评审，或固定搭档返回 Standards 结果时读取本文件。

Review Lead 负责冻结输入、选择搭档、独立完成 Spec、验证搭档结果并机械组装最终报告。主持职责不授权修改任一轴已经锁定的结论。

## 目录

- [开始前](#开始前)
- [冻结输入](#冻结输入)
- [选择固定搭档](#选择固定搭档)
- [发布启动消息](#发布启动消息)
- [发出 Standards 请求](#发出-standards-请求)
- [独立完成 Spec](#独立完成-spec)
- [等待搭档](#等待搭档)
- [接收 Standards 结果](#接收-standards-结果)
- [检查 freshness](#检查-freshness)
- [组装最终报告](#组装最终报告)
- [完成与迟到结果](#完成与迟到结果)

## 开始前

先读取目标仓库的 `AGENTS.md`、文档路由和与改动路径相关的局部规则。保留用户原始目标、明确排除项和评审交付物，不根据代码反向猜测用户目的。

确认评审目标可以解析为两个成员都可读取的 Git-object-backed 不可变 SHA 范围，或用户已提供的不可变共享 patch/附件。Dirty worktree 没有这类共享 artifact 时不能启动完整 duo。

无法唯一确定目标、base 或 head，且不同选择会改变评审内容时，只提出一个最小问题；不要随意使用 `HEAD~1`、默认分支或最近提交代替用户目标。

空 diff 在进入双轴评审前结束，并说明没有可评审变化。

## 冻结输入

读取 [评审快照](snapshot.md)，形成：

```text
Diff Bundle
Spec Bundle
Standards Bundle
Coverage Manifest
```

记录并展示 base、head、merge-base、snapshot identifier、Spec 状态、Standards 状态和 coverage。启动消息只是用户可读标记，不是 Skill 可以选择的 reply root。

任一轴开始后不得在同一 review 中静默刷新来源。来源发生变化时，将当前结果标记为旧快照结果；用户要求当前代码时，新建启动消息与新快照。

## 选择固定搭档

从当前 Camp 中选择一位不是当前队员、仍在场、可以接收请求、能读取同一 snapshot，并熟悉改动语言、模块、测试或仓库质量规则的成员。

整场使用同一搭档。只有用户明确要求、搭档明确拒绝、搭档已不在场、Delivery 明确失败，或请求尚未建立且发现搭档无法访问 snapshot 时才更换。

仅仅“还没有回复”不构成更换理由。

没有合格搭档时，读取 [降级与失败处理](fallbacks.md)。

## 发布启动消息

使用 [消息与回复关系](messages-and-replies.md) 中的“启动”模板，通过 `rovai send --body <启动正文>` 发布一条普通 public-only 标记，不带 `--to` 或 `--to-user`。

启动消息应让用户看到评审目标、不可变 base/head/merge-base、snapshot、分工、来源状态、coverage 与 duo/solo 模式。

不要在启动消息中加入与评审内容无关的内部信息。

## 发出 Standards 请求

运行：

```text
rovai send --help
```

使用 Core 提供的准确 Agent ID 寻址，不根据显示名猜测。

通过 `rovai send --to <固定搭档 Agent ID> --body <请求正文>` 发送 Standards 请求，不使用 `--to-user`。包含 snapshot identifier、base/head/merge-base、稳定 locator、coverage、Standards 来源、limited/skipped 文件、结果格式和只读边界。Core 会让请求回复当前 Lead Run 的用户触发消息；不要声称它回复启动标记。

不要附带自己的 Spec 判断、推荐或 finding。

当前请求已经成功建立时，不重复发送。`rovai send` 成功只表示 Delivery accepted，不证明搭档已经阅读、开始或完成。

## 独立完成 Spec

发出 Standards 请求后，在本次响应中读取 [Spec 评审者指南](spec-reviewer.md) 和 [Finding 与结果格式](findings.md)。

只使用冻结 Diff 与 Spec：

1. 逐条检查 Requirement；
2. 形成 actionable findings；
3. 记录 coverage 与限制；
4. 轴内处理精确重复；
5. 锁定 Spec；
6. 通过 `rovai send --body <Spec 结果>` public-only 发布锁定结果，不带 `--to` 或 `--to-user`。

不要等待搭档结果后再决定自己的 Spec finding。Spec 缺失时发布 `not_assessed`，不生成虚构 finding，也不写“通过”。

## 等待搭档

Spec 已锁定而 Standards 尚未返回时，可以通过 public-only `rovai send` 发布一次等待状态，随后结束本次响应。

不要 sleep、轮询、重复发送、代写搭档意见、因暂时没有消息自动转 solo，或把 accepted 写成 complete。

## 接收 Standards 结果

只接受：

- Runtime 可信发送者是本次固定搭档；
- 当前触发消息的直接父消息是 current active Standards 请求；
- snapshot identifier 与请求逐字一致；
- 内容确实是 Standards 结果；
- 当前请求尚未接受另一份有效结果。

其它成员的公开意见可以阅读，但不替代固定搭档对当前 Standards 请求的正式回复。重复回复不重复加入。旧请求的迟到结果只作补充，不推进新请求。

格式缺失但语义完整时，可以做不改变结论的结构化整理；若无法确定 finding 边界、严重度或 snapshot，只允许一次格式修正请求，不自行猜测。格式修正创建新的请求消息。

## 检查 freshness

组装前重新解析当前目标和来源。若 PR/branch head、Git identifier、patch bytes、Spec 或 Standards 已改变，将结果标记为 `stale`。

旧结果仍可发布，但必须说明只针对旧 snapshot。不自动映射到新代码，也不在同一 review 中静默重跑。

## 组装最终报告

读取 [Finding 与结果格式](findings.md)。

固定顺序：

```text
Standards
Spec
```

机械组装，不得跨轴合并、去重、改 finding 内容、严重度、置信度或轴内顺序，也不得生成掩盖一轴的 overall pass/fail。

允许显示每轴数量、每轴最高严重度、添加明确的跨轴 Related、标记 duo/solo/partial/stale，以及修复不改变语义的 Markdown。

从 Standards 结果触发的当前 Lead Run 中恢复已经 public-only 锁定的 Spec 结果。若精确结果不在已投递上下文或可验证的 Camp 历史中，不得凭记忆重建；停止组装并说明缺失。

通过 `rovai send --body <最终报告>` 发布普通 public-only 最终报告，不带 `--to` 或 `--to-user`。Core 会让它直接回复当前 Standards 结果；不要声称它回复启动标记，也不要再次唤醒搭档。

## 完成与迟到结果

最终报告发布后 review 结束。

迟到结果不自动重开。用户要求纳入时，说明它属于旧请求；用户要求修复时，先把 review 与写入阶段分开；用户要求重新评审时，创建新 snapshot 和新启动消息。

发布报告不自动创建 Task、Memory、ADR、Issue、PR 或实施动作。
