---
document_type: ui-component-contract
authority: renderer-member-identity
status: accepted
last_updated: 2026-08-13
---

# 队员身份与图像

## 队员身份与图像

`AgentProfile.id`、`Skill.id` 与 MCP `serverId` 各自在现有组件中稳定映射
`--identity-1..8`。稳定 ID 决定序号，主题只提供对应可读色值。身份色只进入头像环、名称或小型
身份点，不表示运行、权限、审批、Presence、Lead、Capability 或选中状态。

一个受控 `avatarRef` 同时解析完整 portrait 与紧凑 icon，不增加第二个 Profile 字段。portrait
只用于队员详情、身份编辑和外观预设；圆形 icon 用于名册、详情标题、队员选择、Mention 候选和
消息身份位。两种 rendition 必须来自同一内置或受管复合资产。

未知引用、缺文件、完整性失败或图片加载失败统一回退到由队员名称派生的可读首字母；不能显示
破图、绝对路径或远程 URL。身份资产不得进入命令、Diff、审批、审计、错误、恢复或页面背景。

身份编辑支持圆形取景拖拽、缩放、键盘微调与实际尺寸预览。大图不能成为运行状态或权限判断的
来源。精确资产控制与持久化边界见
[成员投影不变量](../../architecture/foundational-invariants.md#member-projection)。

队员页的当前局部结构见
[`member-workspace` surface brief](../../../apps/desktop/.impeccable/surfaces/member-workspace.md)；
会话内锚定身份卡见[结构化 Mention](structured-mentions.md#锚定人物信息卡)。
