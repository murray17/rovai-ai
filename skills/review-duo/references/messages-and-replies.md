# 消息与回复关系

Review Lead 发送请求、搭档返回结果、处理重试、重复或迟到消息时读取本文件。

## 目录

- [关联原则](#关联原则)
- [消息链](#消息链)
- [自然标题](#自然标题)
- [启动模板](#启动模板)
- [Standards 请求模板](#standards-请求模板)
- [等待模板](#等待模板)
- [Accepted 语义](#accepted-语义)
- [正式 Standards 结果](#正式-standards-结果)
- [重复与 Retry](#重复与-retry)
- [迟到与错误消息](#迟到与错误消息)
- [无可靠 timer](#无可靠-timer)

## 关联原则

- Agent 不能选择任意 reply target；Core 总是让新消息回复当前 AgentRun 的触发消息；
- 启动消息是用户可读标记，不是可选择的消息根；
- Lead 初始 Run 中的启动、Standards 请求、Spec 结果和等待状态都是用户触发消息的子消息；
- Standards 结果直接回复对应请求；
- Standards 结果触发 Lead 续跑，最终报告直接回复该结果；
- 每次重试都创建新的 Standards 请求；
- 旧请求的迟到回复只作为补充。

## 消息链

```text
用户评审请求
├── 双轴代码评审 · 启动
├── Standards 请求
├── Spec 结果
└── 等待搭档（可选）

Standards 请求
└── Standards 结果
    └── 最终评审结果
```

- Standards 结果必须直接回复 Standards 请求；
- Lead 通过可信发送者、当前消息的直接父请求与 snapshot identifier 识别正式结果；
- 最终报告从 Standards 结果触发的 Lead Run 发送；
- Retry 创建新的 Standards 请求；
- 旧请求的回复不会自动满足新请求。

## 自然标题

推荐使用自然标题作为 Skill 发现和阅读线索。不能仅凭标题判断发送者、请求归属或完成状态；最终报告标题不触发自动续跑。

成员省略自然标题但明确回复当前请求时，可以只做最小格式整理，不要求重新发送完整结果。

## 启动模板

```markdown
### 双轴代码评审 · 启动

**目标**

> <用户原始目标或准确摘要>

**冻结快照**

- Base：`<sha | patch base>`
- Head：`<sha | patch digest>`
- Merge base：`<sha | 不适用>`
- Snapshot：`<snapshot identifier>`

**分工**

- Standards：<固定搭档 | 当前队员（solo）>
- Spec：<当前队员>

**来源状态**

- Standards：<已冻结 N 个来源 | baseline only | conflict>
- Spec：<已冻结 N 条 Requirement | missing | conflict>
- Coverage：<files / hunks / limited / skipped>

**模式**

`duo | solo fallback`
```

Review Lead 通过 `rovai send --body <启动正文>` 发布，不带 `--to` 或 `--to-user`。accepted 之后再发送 Standards 请求和 Spec 结果。

## Standards 请求模板

```markdown
### 双轴代码评审 · Standards（规范）请求

**快照**

`<snapshot identifier>`

**职责**

你是本次唯一 Standards 主评审者。只检查仓库规范、正确性与代码质量，不判断需求是否满足。

**冻结范围**

- Base：`<sha>`
- Head：`<sha>`
- Merge base：`<sha>`
- Files：...
- Hunks：...
- Limited：...
- Skipped：...

**Standards 来源**

- `<source@revision#section>`

**要求**

- 只依据冻结 Diff 与 Standards 来源；
- 每条 finding 包含位置、严重度、置信度、规则、证据、影响与验证；
- 在自己的轴内处理精确重复；
- 不读取或引用 Spec 结果形成结论；
- 不修改代码、不开始实施、不继续委派；
- 直接回复这条请求。

无法访问同一 snapshot 时返回 `blocked`，不要读取实时分支替代。
```

Review Lead 通过 `rovai send --to <固定搭档 Agent ID> --body <请求正文>` 发送，不使用 `--to-user`。请求从当前 Lead Run 发出，Core 会自动回复该 Run 的用户触发消息，而不是上面的启动标记。

## 等待模板

```markdown
### 双轴代码评审 · 等待搭档

Spec 轴已经锁定。Standards 请求已经被系统接受，但这不代表搭档已经开始或完成。
完整评审将在真实结果到达后继续；当前没有最终结论。
```

同一 waiting 状态只发布一次，除非用户主动询问。

通过 `rovai send --body <等待正文>` public-only 发布，不带 `--to` 或 `--to-user`。随后结束当前响应，不 sleep 或轮询。

## Accepted 语义

`send accepted` 只证明公共 CampMessage 已提交、Message Delivery 已建立或被系统接受。

不证明对方已经开始、读完、完成、结果合格或整场 review 完成。不要在 accepted 后轮询或伪造进度。

## 正式 Standards 结果

Review Lead 只接受：

- Runtime 可信发送者是固定搭档；
- 当前触发消息的直接父消息是 current active Standards 请求；
- snapshot identifier 与请求逐字一致；
- 当前请求尚未采用过另一份有效结果。

其它成员的公开意见不能代替固定搭档对当前请求的正式回复。

## 重复与 Retry

同一请求的第一份有效结果生效。重复回复不重复加入、不重新排序、不再次发布最终报告。

只有 send rejected、Delivery failed、结果结构损坏或 snapshot 不匹配时允许 retry。

Retry 创建新的 Standards 请求消息。旧请求后续到达的结果只作补充，不推进新请求。

## 迟到与错误消息

用户已取消、final report 已发布、snapshot 已被新启动消息替换、或结果回复旧请求时，属于迟到结果。

迟到结果可以作为补充阅读，但不自动重开、覆盖锁定结果、更新报告、唤醒其它成员或开始修复。

非固定搭档发来的相似标题作为普通 Camp 意见阅读，不完成 Standards 轴。

固定搭档发来的独立消息若没有回复当前 Standards 请求，也不自动推进。必要时请其回复对应请求，或只作为补充阅读。

Lead 组装完成后，通过 `rovai send --body <最终报告>` public-only 发布，不带 `--to` 或 `--to-user`。这条消息自动回复当前 Standards 结果；不要声称它回复启动标记，也不要再次唤醒搭档。

## 无可靠 timer

Skill 不自行创建倒计时。

没有明确的到期通知时，保持 pending，不写“几分钟后自动超时”。用户可以继续等待、取消或要求 solo；只有请求明确失败时才进入失败处理。
