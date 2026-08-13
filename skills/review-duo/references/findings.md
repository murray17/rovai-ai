# Finding 与结果格式

两位评审者形成 finding、锁定轴结果以及 Review Lead 组装最终报告时读取本文件。

## 目录

- [Finding 准入](#finding-准入)
- [ID](#id)
- [Severity](#severity)
- [Confidence](#confidence)
- [Location](#location)
- [Standards Finding](#standards-finding)
- [Spec Finding](#spec-finding)
- [重复](#重复)
- [Axis Result](#axis-result)
- [锁定](#锁定)
- [最终报告](#最终报告)

## Finding 准入

finding 必须是可证伪、可定位、可解释影响的完整判断，回答：

1. 观察到了什么；
2. 违反了哪条 Standards 规则或 Spec Requirement；
3. 证据在哪里；
4. 会产生什么实际影响；
5. 如何验证；
6. 修复方向是什么。

不要报告纯个人风格偏好、没有实际影响的观察、没有 Requirement 支持的 Spec 猜测，或不能指向冻结 snapshot 的问题。

## ID

```text
STD-001
STD-002

SPEC-001
SPEC-002
```

ID 在轴结果锁定后稳定，不因最终报告组装而重新编号。

## Severity

```text
blocker
无法安全合并；会造成严重数据损坏、明确安全破坏、核心需求完全失败，
或违反不可绕过的发布边界。

high
会导致主要功能错误、持久状态不一致、关键需求缺失，或高概率线上故障。

medium
影响次要行为、重要边界、可维护性或测试保障；通常应在合并前处理。

low
局部质量、清晰度、轻度边界或未来维护成本问题。

note
可操作但非缺陷性的改进提示。
```

严重度表达影响，不表达证据确定性。

## Confidence

```text
high
冻结代码、明确规则或可复现证据直接支持。

medium
证据充分，但存在未验证分支、环境差异或合理替代解释。

low
有值得关注的信号，但信息不足；必须说明需要什么证据确认。
```

置信度表达判断可靠性，不调整影响严重度。

## Location

允许：

```text
range
file
symbol
global
```

PR finding 默认定位 head side。没有具体行时不要伪造行号。

## Standards Finding

```markdown
### STD-001 · High · High confidence

`path/to/file.rs:118-136` · `symbol_name`

**问题**

<可证伪的完整句子>

**规则与证据**

- `<Standards 来源>`
- `<代码、测试、schema 或调用链证据>`

**影响**

<为什么值得处理>

**验证**

<如何确认问题>

**建议方向**

<最小修复方向；不是修改授权>

**Related**

`SPEC-002` | 无
```

## Spec Finding

```markdown
### SPEC-001 · High · High confidence

`REQ-004` · `path/to/file.rs:118-136`

**问题**

<实现如何偏离 Requirement>

**需求证据**

- `REQ-004`
- `<稳定来源>`

**实现证据**

- `<代码、测试、schema 或调用链证据>`

**影响**

<对用户、兼容性或验收条件的影响>

**验证**

<如何确认需求是否满足>

**建议方向**

<最小修复方向；不是修改授权>

**Related**

`STD-001` | 无
```

## 重复

同一轴在锁定前处理精确重复：相同根因和影响只保留一条，选择最具体 primary location，并在证据中列其它位置。

跨轴不去重。同一行为可能同时是 Standards 违规和 Spec 失败，保留两条 finding，最终组装者只能添加相互 `Related`。

## Axis Result

### Standards

```markdown
### 双轴代码评审 · Standards（规范）结果

**快照**

`<snapshot identifier>`

**状态**

`complete | partial | blocked | failed`

**Coverage**

- Reviewed：...
- Limited：...
- Metadata only：...
- Unreviewed：...

**Findings**

<按稳定轴内顺序输出；没有时写“没有发现达到 finding 准入标准的问题。”>

**限制**

- <没有则写“无”>
```

### Spec

```markdown
### 双轴代码评审 · Spec（需求）结果

**快照**

`<snapshot identifier>`

**状态**

`complete | partial | blocked | failed | not_assessed`

**Requirement Coverage**

- `REQ-001`：satisfied | partial | missing | wrong | blocked | not_verifiable

**Findings**

<按稳定轴内顺序输出>

**限制**

- <没有则写“无”>
```

“没有 finding”不自动等于“所有行为已证明正确”。必须同时看 coverage、运行验证和限制。

## 锁定

Axis Result 通过对应 `rovai send` 命令 accepted 后视为锁定；发送被拒绝时不得假装已经锁定或完成。

允许修复 Markdown、补齐已经存在但格式丢失的字段、添加不改变语义的稳定引用。

禁止改写 finding、改 severity/confidence、删除或合并 finding、调整轴内顺序，或因另一轴意见改变当前轴结论。

## 最终报告

```markdown
# 双轴代码评审结果

## 评审快照

- 目标：...
- Base：...
- Head：...
- Merge base：...
- Snapshot：...
- 模式：Duo | Solo fallback
- Freshness：Fresh | Stale

## Coverage

- Files：...
- Hunks：...
- Limited：...
- Skipped：...
- Tests / checks：...

## Standards（仓库规范与代码质量）

**评审者：** <成员>

**状态：** Complete | Partial | Blocked | Failed

<锁定的 Standards findings，保持原顺序>

## Spec（需求符合度）

**评审者：** <成员>

**状态：** Complete | Partial | Blocked | Failed | Not assessed

<锁定的 Spec findings，保持原顺序>

## 评审边界

- 两轴 findings 保持独立，没有跨轴合并或重排。
- 本次评审只针对冻结 snapshot。
- 本次只读评审没有修改代码、创建 Task、提交或 PR。
```

固定顺序为 Standards、Spec。不得跨轴合并、去重、重新编号、改 severity/confidence、改轴内顺序，或用一个 overall pass/fail 掩盖另一轴。
