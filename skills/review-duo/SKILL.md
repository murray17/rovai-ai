---
name: review-duo
description: 在 Rovai Camp 中由当前队员与一位固定搭档，对冻结代码差异分别进行 Standards（仓库规范与代码质量）和 Spec（需求符合度）双轴评审。用户明确要求双人、双轴或团队 code/PR/diff review，明确要求 Standards 与 Spec 独立评审，或当前消息是另一位成员发来的“双轴代码评审 · Standards（规范）请求”/同义请求，或本次固定搭档发来的“双轴代码评审 · Standards（规范）结果”/同义结果时使用。普通单人 code review 不自动触发；默认只读，不直接修复、提交、创建 PR 或 Task。
---

# 双轴代码评审

让两位真实的 Camp 成员检查同一份冻结代码差异：

- 固定搭档负责 **Standards**：仓库规范、正确性与代码质量；
- 当前队员负责 **Spec**：实现是否满足原始需求与验收条件；
- 最终报告保留两个独立区块，不让一个轴掩盖另一个轴。

## 使用边界

使用本 Skill：

- 用户明确要求两位成员 review PR、分支、提交范围或稳定 patch；
- 用户要求同时、独立检查“代码是否合规”和“功能是否做对”；
- 收到另一位成员发来的 Standards 评审请求；
- 当前消息来自本次固定搭档，并直接回复当前 Standards 请求。

不使用本 Skill：

- 用户只要求实现、修复、重构或提交代码；
- 用户只要求普通单人 code review，未要求 Camp 搭档、双人或双轴；
- 没有可冻结的 diff、PR、提交范围或稳定 patch；
- 用户要求严格技术盲评。公开 Camp 只能提供程序性独立，不能保证双方看不到彼此消息。

用户同时要求“先 review，再修复”时，先完成只读评审。评审结束不自动开始修改；修复属于新的写入阶段。

## 消息往返

```text
当前用户评审请求
├── 双轴代码评审启动消息（public-only）
├── Standards 请求 → 固定搭档
├── 当前队员 Spec 结果（public-only）
└── 等待搭档（可选，public-only）

Standards 请求
└── 固定搭档 Standards 结果 → Review Lead
    └── 最终双轴报告（public-only）
```

- 启动消息是用户可读的评审标记，不是可供 Skill 任意选择的 reply root；
- 启动、Standards 请求、Spec 结果和等待状态从同一个 Lead Run 发送时，Core 会让它们都回复该 Run 的用户触发消息；
- 固定搭档直接回复 Standards 请求；
- Review Lead 的续跑由 Standards 结果触发，最终报告因此直接回复该结果；
- 需要重试时创建新的 Standards 请求，旧请求的迟到结果只作为补充。

公开消息可以使用以下自然标题：

```text
### 双轴代码评审 · 启动
### 双轴代码评审 · Standards（规范）请求
### 双轴代码评审 · Standards（规范）结果
### 双轴代码评审 · Spec（需求）结果
### 双轴代码评审 · 等待搭档
# 双轴代码评审结果
```

自然标题是 Skill 发现和阅读线索，不证明发送者、当前请求或完成状态。进入 Skill 后，以 Runtime 提供的可信发送者和当前触发消息的直接回复链确认角色；标题被改写或省略但正文语义和这些事实清楚时仍可继续。最终报告标题不触发自动续跑。

## 核心不变量

1. 先冻结 **Diff、Spec、Standards** 三类来源，再开始任一轴评审。
2. 两个轴检查同一份 snapshot，每个轴只有一位主评审者。
3. 当前队员默认负责 Spec，固定搭档默认负责 Standards。
4. 两轴分别形成并锁定结果；最终组装者不得改写 finding 的内容、严重度、置信度或轴内顺序。
5. 不跨轴合并或去重。同一问题同时违反两个轴时保留两条 finding，只增加相互引用。
6. 缺少 Spec 时，Spec 轴显示“未评估”，不能显示通过。
7. 评审默认只读，不修改代码、不创建 Task、不提交、不推送、不创建或更新 PR。
8. `rovai send` 成功只证明公共消息和 Delivery 已建立，不证明搭档已经开始或完成。
9. 等待搭档时不 sleep、不轮询、不代写其结论。
10. 最终报告固定按 `Standards`、`Spec` 顺序呈现，不生成会掩盖其中一轴的单一总分。
11. Agent 不能选择任意 reply target；每次发送都由 Core 自动回复当前 AgentRun 的触发消息。

## 默认分工

```text
当前队员
= Review Lead
= Spec 主评审者
= 最终组装者

一位固定合格搭档
= Standards 主评审者
```

固定搭档必须：

- 不是当前队员；
- 仍在当前 Camp；
- 能接收公开协作请求；
- 能读取同一份冻结 diff 与 Standards 来源；
- 对改动语言、模块或仓库规则具备足够匹配。

整场评审使用同一位搭档。只有搭档明确不可用、Delivery 明确失败、搭档拒绝或用户明确要求时才更换。

没有合格搭档时可以降级为单人双轴评审，但必须明确写出：

```text
本次为单人降级评审；两个轴仍分别报告，但不具备双人独立性。
```

用户明确要求必须双人时，不得静默降级。

## 单场推进

同一位 Review Lead 在同一个 Camp 中同一时间只主动推进一场尚未结束的 Review Duo。以下任一情况结束当前评审：

- 最终双轴报告已发布；
- 用户明确取消；
- 用户明确要求用新目标替换当前评审；
- 缺少稳定输入或有效搭档，Lead 已说明 solo fallback 或终止。

旧评审未结束时收到新目标：用户明确要求替换时先结束旧评审；意图不清楚时只做一次最小确认。不要让两场 Review Duo 的请求和结果交错。

## 冻结评审快照

一次快照同时包含：

```text
Diff Bundle
Spec Bundle
Standards Bundle
```

至少记录：

- 评审目标与仓库；
- base、head 与 merge-base 的不可变提交标识；
- 稳定 snapshot identifier；
- 文件、hunk、generated、binary 与跳过项的 coverage；
- 原子 Requirement 及其来源；
- 适用于改动路径的仓库规范、Contract、ADR、配置与质量基线；
- 快照短摘要。

PR、分支和提交范围优先使用不可变 SHA。不要只记录会移动的 `main`、`HEAD` 或分支名。

Skill-only v1 的完整 duo 只接受两类输入：两个成员都可解析的 Git-object-backed 不可变 SHA 范围，或用户已经提供且双方可读取的不可变 patch/附件。工作树包含 staged、unstaged 或 untracked 内容但没有这种共享 artifact 时，要求用户先提交或提供稳定 patch；否则降级为 solo 或停止。不要承诺本 Skill 能创建或分发不存在的共享快照，也不要让两人分别读取不同时间点的实时工作树。

详细规则见 [评审快照](references/snapshot.md)。

## 基本流程

```text
读取仓库规则与用户目标
        ↓
冻结 Diff / Spec / Standards
        ↓
选择并冻结固定搭档
        ↓
发布 public-only“评审启动”标记
        ↓
向固定搭档发送 Standards 请求
        ↓
当前队员独立完成、锁定并 public-only 发布 Spec
        ↓
结束本次响应，等待固定搭档回复
        ↓
确认可信发送者、直接父请求和 snapshot identifier 都正确
        ↓
锁定 Standards
        ↓
重新检查快照是否 stale
        ↓
从 Standards 结果触发的续跑中组装并 public-only 发布最终报告
```

向搭档发送 Standards 请求时，不附带当前队员的 Spec 推荐或结论，避免锚定。

## 两轴边界

### Standards

检查：

- 适用的仓库规则与目录局部约束；
- 明确正确性、错误处理、事务、并发、幂等与安全问题；
- API、schema、migration、测试与构建约束；
- 代码质量和可维护性；
- 本次 diff 是否试图通过同时修改规范来自我豁免。

不检查需求是否满足，不根据 Spec 重新解释实现。

### Spec

检查：

- 原始 Requirement 是否缺失、部分实现或实现错误；
- 验收条件是否可观察地满足；
- diff 是否加入未要求的行为；
- Requirements 之间是否冲突或缺少可判断依据。

不把代码、测试名、commit message 或 branch name 反向当作需求真源。

## 独立与锁定

Standards 评审者只依据冻结的 Diff 与 Standards 来源形成结果。Spec 评审者只依据冻结的 Diff 与 Requirement 形成结果。

当前队员应在吸收搭档结果之前锁定自己的 Spec 结果。结果一旦锁定：

- 可以修复 Markdown 或结构格式；
- 不得修改结论语义；
- 不得调高或调低严重度；
- 不得为了“统一口径”删除另一轴 finding；
- 不得跨轴重新排序。

同一轴中的精确重复由该轴评审者在锁定前处理。

## 结果状态

每个轴独立标记：

```text
complete
partial
blocked
failed
not_assessed
```

最终结果还应标明：

- `duo` 或 `solo fallback`；
- `fresh` 或 `stale`；
- coverage 是否完整；
- 没有运行的测试或无法验证的环境行为；
- generated、binary、vendor 或超大 diff 的限制。

快照在组装前已经移动时，可以发布旧快照报告，但必须醒目标记 `stale`，不能声称适用于最新代码，也不能自动把旧 finding 映射到新 diff。

## 完成边界

发布最终报告后，本次只读评审结束。

迟到的旧结果可以作为补充信息阅读，但不自动更新报告或重新开启评审。用户明确要求重新评审时，创建新的冻结 snapshot 和新的启动消息。

发布报告不自动修改或修复代码，不创建 Task、Issue、PR、Memory 或 ADR，不提交、推送、合并或唤醒搭档继续实施。

## 按角色读取

- 作为 Review Lead，读取 [Lead 指南](references/lead.md)。
- 负责 Standards 时，读取 [Standards 评审者指南](references/standards-reviewer.md)。
- 负责 Spec 时，读取 [Spec 评审者指南](references/spec-reviewer.md)。
- 冻结目标或检查 stale 时，读取 [评审快照](references/snapshot.md)。
- 写 finding、锁定轴结果或组装最终报告时，读取 [Finding 与结果格式](references/findings.md)。
- 发送、接收、重试或处理迟到结果时，读取 [消息与回复关系](references/messages-and-replies.md)。
- 只有出现能力缺失、搭档不可用、超大 diff 或其它异常时，读取 [降级与失败处理](references/fallbacks.md)。
- 维护或验收本 Skill 时，读取 [验收清单](references/acceptance.md)。
