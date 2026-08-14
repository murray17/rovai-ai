---
document_type: ui-component-contract
authority: renderer-structured-mentions
status: accepted
last_updated: 2026-08-14
---

# 结构化 Mention

## 不得回退的交互合同

可解析的队员 Mention 在 Composer 与历史消息中默认显示为无底色、无边框的蓝色行内文字；
Hover、Focus 或信息卡打开时只使用 8% mention feedback。它是 Core Structured Content 的身份
投影，不从普通 `@文字` 猜测身份。

从候选选中队员或所有队员后，Composer 在 Mention 后补一个普通空格并把光标放到空格后；已有
空白时复用，不重复插入。编辑时 Member Mention 是不可拆分的原子单元。`@所有队员` 的 Composer
信息卡读取当前可提及队员，历史消息读取发送时冻结的收件人 ID。

点击当前可寻址 Agent 消息的“回复”是一个明确 Mention 来源：Core 在设置 Draft reply target 的同一
revision mutation 中把该 Agent 的 canonical Member Mention 插入正文开头；已有相同 Mention 或
`@所有队员` 时复用，不能重复。该规则只把用户手势转换为可见 Structured Content；reply relation
本身永远不参与发送寻址。

原作者已 `away`、退出 Camp、被移除或不可解析时，不得生成该作者的 Mention lookalike 或失效 token。
Composer 保留引用并要求用户显式选择新的有效 Mention；发送前后都不得把失败的显式意图忽略后回退
Default Lead。Snapshot 后才失效的 token 使用既有 unavailable 样式与 Core error，替代选择移除原作者
失效 occurrence 后再插入新 token。取消引用不删除已经可见的 Mention。

“继续发给”是第二个受控 Mention 来源：它只投影最近 accepted user message 的唯一非 Lead 显式接收者，
不是正文 token 或 reply relation。只有发送事务确认 frozen source 与对象仍有效时，Core 才在消息开头物化
canonical Member Mention；历史中看到的 Structured Content、address snapshot 与真实投递因此一致。
continuation 对象失效且 Draft 已有正文/附件时，必须阻断并显式选择新成员，不能忽略失败来源后使用
Default Lead。用户手动改址后，即使删除全部 Mention，也不再从同一来源自动生成 Mention。

## 锚定人物信息卡

单击、Enter 或 Space 在原 token 附近打开非模态人物信息卡，并保持当前 Camp。信息卡宽 392px，
采用“布局 2”：左侧 128px 受控 4:5 portrait，右侧依次显示名称、团队角色、Presence、Agent
运行时、专业职责、工作准则和性格底色。它不是队员页链接、Dialog 或全局 Toast。

点击外部或 Esc 关闭。键盘打开后，Esc 关闭必须把焦点返回原 Mention。Popover 不设 focus trap；
人物卡内可操作项遵守自然 tab 顺序。拖选形成文本选区时不得误触发打开。

已移除、离开或不可解析队员按复制时/消息中可见文字静态显示，不可打开信息卡。队员头像和显示名
在身份仍可操作时可复用同一卡片，降级规则一致。

## 复制与粘贴

整条用户消息的复制入口同时写入当前可见纯文本与 Rovai AI 私有结构化身份。粘贴回 Composer 时，
只恢复目标 Camp 中当前仍可提及的 Member Mention；其他内容按可见文字降级。普通系统选区复制和
外部纯文本 Paste 不反向猜测身份。

## Current User Mention

只有 Core Structured Content 能生成历史消息中的 `@当前用户`。它与 Member Mention 使用相同
行内色彩语言，但不可交互、不进入 tab 顺序、不打开信息卡；其可访问名称包含当前显示名称。
Agent 消息中的 Current User Mention 保持为 Markdown 正文之前的行内结构化前缀；其余权威
Structured Content 继续通过 sanitized GFM 呈现。正文里的 Agent Mention 在该路径只投影可见文本，
显示名必须先按 Markdown literal 转义并折叠换行，不能注入链接、标题、代码或表格结构。

## Authority and regression

| 层级 | 权威入口 |
|---|---|
| Core identity、耐久内容、失效校验与派生寻址 | [ADR-0096](../../adr/0096-core-owned-structured-mentions-and-derived-addressing.md) |
| Draft continuation 来源、物化与无 fallback | [ADR-0187](../../adr/0187-durable-composer-recipient-continuation.md)与[Camp Composer Draft v2](../../contracts/camp-composer-draft-v2.md) |
| Renderer 视觉、Popover、键盘、拖选与复制粘贴 | 本文 |
| 自动化与打包 App 回归 | [结构化 Mention 门禁](../../development/ui-acceptance.md#结构化-mention-门禁) |

改为全局角色 Toast、页面跳转、模态 Dialog 或其他信息架构属于产品变更，必须同步更新本文、
Renderer 测试和真实 App 验收。原型只记录已确认选型，不是生产真源：
[Mention Popover 原型](../../prototypes/mention-popover/README.md)。
