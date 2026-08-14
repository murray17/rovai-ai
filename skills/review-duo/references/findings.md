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
- [传输预算](#传输预算)
- [Axis Result Parts](#axis-result-parts)
- [Axis Result Manifest](#axis-result-manifest)
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

## 传输预算

`rovai send.body` 的硬上限是 32 KiB（32,768 UTF-8 bytes）。每次发送都在调用前计算完整正文的 UTF-8 byte size，并使用以下工作预算：

```text
hard send limit                 = 32768 bytes
working message limit          = 30720 bytes
reserved structure per part    =  4096 bytes
initial findings payload limit = 26624 bytes
maximum parts per axis         =   128
```

`working message limit` 已留下 2 KiB 安全余量，但仍必须测量最终序列化后的完整正文，不能只按字符数或 finding 数量估算。标题、snapshot、part 编号、coverage、limitations 和 locator 都计入正文。

使用只读、stdin-based 的本地 byte counter / SHA-256 工具计算大小与 digest，不在被评审 workspace 创建结果文件。当前 Runtime 无法可靠计算时，把 transport 标为 `partial` 或 `failed`；不要让模型目测字数或编造 digest。

先按冻结的轴内顺序形成 canonical finding blocks，再以完整 finding 为边界分片。每个 part 的 findings payload 先限制在 26 KiB，加入结构字段后若超过 30 KiB，就把最后一条完整 finding 移到下一 part；不要把一个结构化 finding 从字段中间切开。

单条 finding 本身超过 26 KiB 时，先删减大段代码复述或重复证据，改用稳定代码/Requirement/Standards locator，并在限制中标记 `evidence_limited_for_transport`；不得改变问题、severity、confidence、影响或建议方向。若保留完整语义后仍不能装入一个 part，该轴传输状态为 `failed`，不得静默截断或称为 complete。

为保证 final 能复制核心问题而不重写，锁定前让每条 `**问题**` 保持为一条不超过 1,024 UTF-8 bytes 的完整句子，primary location 行不超过 512 bytes；更长的推理放在证据与影响字段。若一句话无法准确表达，应拆成多个独立 finding，而不是在 final 截断。

超过 128 parts 时停止继续发送，把未传输 finding IDs 和数量写入 compact manifest，并把轴状态降为 `partial` 或 `failed`。超大 diff 的 coverage 状态与结果传输状态分别记录：代码可以完整 review 但结果传输失败，也可以结果完整传输但 coverage 本身为 partial。

## Axis Result Parts

没有 finding 时不创建空 part，直接发布 manifest。存在 finding 时，先计算所有 part 边界和总数，再依次发送。

### Standards Part

```markdown
### 双轴代码评审 · Standards（规范）结果 · Part <n>/<total>

**快照**

`<snapshot identifier>`

**Findings 范围**

`<first finding ID>..<last finding ID>`

<完整 finding blocks，保持冻结顺序>
```

Standards reviewer 对每个 part 使用不带 `--to` 或 `--to-user` 的 public-only `rovai send`。所有 part 都由当前 Standards 请求触发，因此直接回复该请求，但不会分别唤醒 Review Lead。

### Spec Part

```markdown
### 双轴代码评审 · Spec（需求）结果 · Part <n>/<total>

**快照**

`<snapshot identifier>`

**Findings 范围**

`<first finding ID>..<last finding ID>`

<完整 finding blocks，保持冻结顺序>
```

Review Lead 对每个 Spec part 使用不带 `--to` 或 `--to-user` 的 public-only `rovai send`。保留每次 accepted 结果的准确 `messageId`；发送 rejected 的 part 不得列为已传输。

Canonical result digest 固定为：按冻结顺序取每个完整 finding block，统一 LF 换行、去掉行尾空白，以恰好两个 LF 连接，计算其 UTF-8 bytes 的 SHA-256；没有 finding 时对 ASCII `NO_FINDINGS` 计算。分片不能改变这个顺序或 digest。

## Axis Result Manifest

parts 完成后再发送一条 compact manifest。manifest 本身也必须小于 30 KiB，并列出所有 accepted part message IDs；它是轴结果的唯一完成标记。

### Standards

```markdown
### 双轴代码评审 · Standards（规范）结果 · Manifest

**快照**

`<snapshot identifier>`

**Standards 请求消息**

`<当前触发 request messageId>`

Standards result locator <当前触发 request messageId>

**状态**

`complete | partial | blocked | failed`

**传输**

`complete | partial | failed`

**Coverage**

- Reviewed：...
- Limited：...
- Metadata only：...
- Unreviewed：...

**Finding 摘要**

- Total：...
- By severity：...
- Highest severity：...
- Parts：
  - `1` → `<accepted messageId>` · `<first ID>..<last ID>`
- Result digest：`sha256:<64 lowercase hex>`
- Unsent：<没有则写“无”>

**限制**

- <没有则写“无”>
```

### Spec

```markdown
### 双轴代码评审 · Spec（需求）结果 · Manifest

**快照**

`<snapshot identifier>`

**对应 Standards 请求**

`<accepted request messageId>`

Spec source locator <accepted request messageId>

**状态**

`complete | partial | blocked | failed | not_assessed`

**传输**

`complete | partial | failed`

**Requirement Coverage**

- `REQ-001`：satisfied | partial | missing | wrong | blocked | not_verifiable

**Finding 摘要**

- Total：...
- By severity：...
- Highest severity：...
- Parts：
  - `1` → `<accepted messageId>` · `<first ID>..<last ID>`
- Result digest：`sha256:<64 lowercase hex>`
- Unsent：<没有则写“无”>

**限制**

- <没有则写“无”>
```

“没有 finding”不自动等于“所有行为已证明正确”。必须同时看 coverage、运行验证和限制。

Standards manifest 是 Standards reviewer 本次 Run 中唯一带 Agent recipient 的结果消息，使用 `rovai send --to <Review Lead Agent ID> --body <manifest>`；所有 parts 在它之前 public-only 发送。Spec manifest 始终 public-only。任何 part 缺失、rejected、超过预算或 digest 无法形成时，manifest 必须把传输和轴状态降级，列出缺口；不能因 manifest 本身 accepted 就称为完整结果。

## 锁定

Axis Result 只有在所有预期 parts 与最后 manifest 都 accepted，manifest 列出的 message IDs 与实际结果一致且 digest 已固定后才视为锁定。发送被拒绝、part 缺失或 manifest 未返回 Review Lead 时不得假装已经锁定或完成。

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

Review completion locator <current Standards request messageId>

<!-- Solo fallback 省略该行 -->

## Coverage

- Files：...
- Hunks：...
- Limited：...
- Skipped：...
- Tests / checks：...

## Standards（仓库规范与代码质量）

**评审者：** <成员>

**状态：** Complete | Partial | Blocked | Failed

- Findings：<总数；按 severity 计数>
- Highest severity：...
- Core findings：<最多三条，按原轴内顺序复制 ID、severity、location 与问题句；不改写>
- Full result manifest：`<messageId>`
- Parts：`<messageId>`, ...
- Result digest：`sha256:...`

## Spec（需求符合度）

**评审者：** <成员>

**状态：** Complete | Partial | Blocked | Failed | Not assessed

- Findings：<总数；按 severity 计数>
- Highest severity：...
- Core findings：<最多三条，按原轴内顺序复制 ID、severity、location 与问题句；不改写>
- Full result manifest：`<messageId>`
- Parts：`<messageId>`, ...
- Result digest：`sha256:...`

## 评审边界

- 两轴 findings 保持独立，没有跨轴合并或重排。
- 最终报告是有界摘要；完整 finding 正文位于上面引用的 axis parts。
- 本次评审只针对冻结 snapshot。
- 本次只读评审没有修改代码、创建 Task、提交或 PR。
```

固定顺序为 Standards、Spec。最终报告完整正文同样必须在发送前测量并保持不超过 30 KiB；不得跨轴合并、去重、重新编号、改 severity/confidence、改轴内顺序，或用一个 overall pass/fail 掩盖另一轴。核心 finding 只复制冻结结果中最前面的三条，不重新挑选或改写；其余 findings 通过 manifest 与 parts 保持可精确读取。

任一轴的 manifest/part 缺失、digest 不匹配或传输不是 complete 时，最终报告醒目标记 `assembly partial`，只报告可验证内容，不能称为完整双轴评审。`assembly partial` 是组装完整性，不是掩盖两轴状态的 overall pass/fail。
