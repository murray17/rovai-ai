---
document_type: protocol-contract
contract: run-process-detail-surface-v51
authority: conversation-run-presence-surface
status: accepted
version: 51
source_version: v1.72
last_updated: 2026-10-13
---

# Run Process Detail Surface v51

继承 [v50](run-process-detail-surface-v50.md) 的位置、单行原文推进、停止、重试与读取恢复。
本次按 User 确认的 4.8 秒与执行行右键方案，调整运动反馈及真实启动阶段文案。

## 高亮与减少动态效果

会话执行行、RunCard 与其他 RunningText 消费处共用 4.8 秒周期，保留原高亮宽度、轨迹与停顿比例。
文字与行几何静止；不增加左侧转圈，不移动文字。系统 reduced-motion、外观“始终减少”或
forced-colors 时隐藏高亮层，状态、源换行与实际增量继续更新。静态终态及停止反馈保持原规则。

## 执行行操作

内容左键继续打开精确 Run 的执行详情。右键、触摸／笔长按、Shift+F10 或 ContextMenu 键打开
已有样式的菜单，只有“查看执行过程”和“减少动态效果…”两项；停止区仍使用原确认入口。
长按松手不误选菜单项，Esc 关闭并恢复执行行焦点；不增加常驻提示或占位按钮。

“减少动态效果…”通过现有设置导航进入外观，并滚动、聚焦已有选择器。选项仍为
“跟随系统”和“始终减少”，保存沿用 Appearance owner。保留离开保护、草稿与返回会话路径；
快捷入口不改写普通设置入口记住的分类，不新增设置项或提示横幅。

## 无正文时的阶段反馈

- running 且 waitReason 为 runtime_initializing：显示“正在连接智能体…”。初始化优先于重连前
  遗留的正文或命令，不将旧 Evidence 当成新输入已受理。
- Core 按现有输入受理事实清除此状态后，没有可见内容时显示“正在处理你的请求…”。不以耗时、
  Renderer 计时器或是否已产生 Token 猜测连接成功。
- 有可见正文、命令或合法原生思考短标题时沿用已有投影；无标题思考仍显示处理兜底，不展示思考正文。
- 失败、停止请求和等待优先保留各自反馈；排队仍不创建执行行。

只消费既有 Run / Evidence 字段，不修改模型上下文、后端生命周期或数据库结构。

## 验收

连接 → 受理 → 实际正文／命令及重连旧 Evidence；等待、失败和停止优先级；两主题和窄窗口中
右键菜单与键盘焦点、长按不误触、设置定位与返回；会话行和 RunCard 同步为 4.8 秒，
系统／应用减少动态效果及强制颜色关闭高亮，增量与既有锚点、单行、停止及重试不退化。
