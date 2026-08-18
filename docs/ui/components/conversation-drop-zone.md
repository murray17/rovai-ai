---
document_type: ui-production-contract
authority: camp-conversation-drop-zone
status: accepted
design_direction: porcelain-day-steel-night
implementation_status: complete
last_updated: 2026-08-18
---

# Camp 会话区文件与文件夹拖放

## Scope

ordinary Camp 的附件放置命中面是主会话列的完整两行：消息时间线、空状态、Agent 执行台、
Approval/Runtime Recovery Dock 和 Composer。左侧导航、右侧 Inspector、Execution Drawer、Dialog、
Popover、设置和 Quick Chat 首页不接收；相关菜单结构与行为不因本功能改变。

拖放只修改当前 Core-owned Draft，不发送消息、不移动宿主文件管理器中的原项目，也不改变光标、Mention/Skill
候选或 Inspector 状态。Execution Drawer 或 Popover 打开时底层接收面关闭。

## Drag feedback

- 只有 `DataTransfer.types` 含 `Files` 时进入接收态。统一接收层从消息时间线顶部连续延伸到 Composer
  底部，主会话列内收 10px（窄屏 7px）显示不中断的 1.5px Steel 虚线框和低透明 Steel wash；Inspector
  与导航保持原色。
- 原时间线、Agent 执行台与 Composer 输入内容保持可读，不 blur、不重排、不隐藏。居中浮层使用
  308×92px 紧凑卡，主文案固定为“松手添加到当前消息”。
- 单个目录能由 Chromium entry 明确识别时，次文案为“文件夹将保存为只读快照，原文件不会移动”；
  其他 payload 使用“支持文件与文件夹 · 将安全复制到附件队列”，不猜测。
- Composer 使用 Steel 边框和 focus ring，并在顶缘显示“将添加到这条消息”；Composer 整体不得浮在
  统一接收层之上而截断 wash 或虚线框，也不得用不透明遮罩覆盖正文、Mention 或已有附件。
- 指针进入 Inspector 或其他非接收面时立即退出；主会话列子节点之间移动使用短延迟边界收敛，
  不闪烁。外部拖放被系统取消且 Chromium 未派发 `dragleave` 时，Drag feedback 必须在有界的
  drag-over 心跳超时后自行清除。Overlay 必须 `pointer-events: none`。
- `aria-live="polite"` 宣告已进入当前消息附件区域；视觉状态不能只依赖颜色。

## Prepared cards

- 放下后 Drag feedback 立即消失，附件队列按宿主文件管理器提供的顺序出现 preparing 卡；任一 preparing/error
  继续阻止发送。
- 普通文件沿用现有文件/图片卡。目录卡使用文件夹图标，preparing 文案为“正在创建只读快照…”。
- Ready 目录卡固定显示“`{fileCount} 个文件 · {byteSize} · 只读快照`”，计为一个顶层附件。
- symlink、特殊节点及各类超限使用原位有界错误；不显示绝对路径，不用 Toast 代替附件卡状态。

## Layout and themes

接收层永远只占 `.workspace-grid` 第一列的两行；Inspector 的 310/260px、自适应收起和 2K 阅读宽度
不改变命中语义。Day/Night 使用同一 DOM 和现有 Porcelain/Steel tokens。1040×700 及以上不得产生
页面横向溢出，提示卡不得遮住 Inspector 或 Composer 归属提示；reduced motion 下取消进入动画。

## References

- [方向原型](../../prototypes/conversation-drop-zone/rovai-conversation-drop-zone.html)
- [设计说明](../../prototypes/conversation-drop-zone/PROJECT_DESIGN.md)
- [Camp Attachment v1](../../contracts/camp-attachment-v1.md)
- [ADR-0169](../../adr/0169-core-owned-directory-attachment-snapshots.md)
