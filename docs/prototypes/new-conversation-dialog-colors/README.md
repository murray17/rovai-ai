---
document_type: ui-prototype-readme
status: selected
last_updated: 2026-09-01
---

# 创建新对话 Dialog 下拉框配色候选

这是“创建新对话”生产 Dialog 的局部配色评审稿。C“瓷白钢边”已于 2026-09-01 选定并进入生产实现。
Dialog 主承载面、Header、Footer、Ember 标记、Steel 品牌色和可选配置全部保持当前生产样式，只调整
工作目录、队员与负责人三个下拉控件及其菜单的颜色。

## 查看

[打开 HTML 设计稿](index.html)。设计稿是自包含 HTML，不依赖服务器、外部字体、图片或第三方脚本，
不会连接 App、Core 或 Runtime。

- 当前对照 · 米白：复现生产下拉框的 `surface / muted / line-strong` 组合。
- A · 淡钢蓝：下拉框使用很浅的 Steel 洗色，与当前主按钮自然呼应。
- B · 冷雾灰：去掉米白暖感但不引入明显蓝色，更中性、克制。
- C · 瓷白钢边（已选）：控件保持纯白，通过满足 3:1 非文字对比度的 Steel 灰边界建立层次。

同一个文件支持候选切换、日间／夜间、完整场景／并排比较，以及工作目录、队员、负责人和可选配置
的本地展开交互。无查询参数时默认显示已选 C；URL 查询参数会保存 `palette`、`theme` 和 `view`，
只接受稿内已知值。

## 不变的边界

- Dialog 主承载面、Header、Footer、Ember 标记、可选配置、按钮与整体结构固定为当前生产样式。
- 候选 token 只供工作目录、队员、负责人三个 trigger 及相应 popup menu 使用。
- Steel 继续负责品牌、焦点和主要动作；成功、注意、危险、身份和证据颜色不改职责。
- 三套候选都保留日夜成对设计，不创建第三套生产主题，也不引入字体、图标或 UI 框架。
- HTML 中的目录、队员和提交交互只用于展示状态，不写入偏好或创建 Camp。
- 这是保留候选上下文的视觉评审稿，不是领域合同或验收证据；已选 C 通过生产语义主题 token 落地。

## UI-UX-PRO-MAX 应用

本次只做定向查询，没有重建产品设计系统：

1. `desktop dropdown cool neutral --domain color`：命中知识库／文档工具的冷中性背景、白色卡面和
   灰蓝边界方向；只吸收到下拉控件，拒绝把整块 Dialog 改色，也拒绝紫色 AI 模板与高饱和青色。
2. `keyboard focus modal --domain ux`：保留每个交互控件的 2px 可见焦点、合理 Tab 顺序和不被固定
   footer 遮挡的焦点状态。
3. `dialogs --stack react`：保留生产 Radix Dialog 的焦点陷阱、关闭后焦点返回和 Esc 语义；HTML
   只模拟外观，不替代这些生产能力。

具体候选色值依据现有 Porcelain Day / Steel Night token 手工推导，不冒充资料库成品色板。

## 项目依据

- [全局设计系统](../../../DESIGN.md)
- [创建新对话 surface brief](../../../apps/desktop/.impeccable/surfaces/new-conversation-dialog.md)
- [Porcelain Day](../../ui/themes/porcelain-day.md) / [Steel Night](../../ui/themes/steel-night.md)
- [生产组件](../../../apps/desktop/src/renderer/src/NewConversationDialog.tsx)
- [生产样式](../../../apps/desktop/src/renderer/src/styles.css)

### 已发现的文档—实现漂移

Surface brief 当前写的是 Dialog 距 viewport 四边 72px、最大高度 `min(790px, viewport - 72px)`；
生产 CSS 实际使用宽度 `viewport - 48px`、最大高度 `viewport - 32px`。为了还原“现在的 UI”，本稿按
生产 CSS 呈现，没有在本次配色实现中顺带改变几何或宣称任一侧已修复。后续需要单独确认由 brief
还是现有 CSS 收敛这处差异。

## 验证记录

2026-09-01 完成以下静态验证：

- 内联 JavaScript 语法通过；32 个 DOM ID 无重复，29 个脚本／ARIA／label 引用均有目标；无远程资源。
- 静态断言确认 A / B / C 不覆盖 Dialog 主面、Header、Footer、结构线或 Ember token，只覆盖 picker token。
- 日间四套下拉 surface / menu / hover 上的最小文字对比度为主文字 14.32:1、次要文字 4.56:1、
  faint 文字 4.97:1，图标与 soft fill 为 4.51:1；夜间分别为 10.51:1、6.00:1、5.37:1、6.18:1。
  已选 C 的控件边界对 surface 为日间 3.07:1、夜间 3.95:1。
- 已断言 1040px 桌面场景、1100px / 640px review 页响应式规则、局部横向滚动、2px 焦点环、
  `prefers-reduced-motion` 和无 `transition: all`。
- 生产 token 范围由 Renderer 主题与 New Conversation 结构测试锁定；`pnpm typecheck`、`pnpm test`、
  `pnpm build:desktop`、`pnpm docs:test`、`pnpm docs:check`、Markdown 本地链接和 whitespace 检查通过。

即使用户已在内置浏览器打开本稿，Browser 安全策略仍禁止自动刷新或捕获 `file://` 页面，因此本次
没有伪造浏览器截图或声称完成真实视觉验收。用户可手动刷新当前 HTML 评审；生产实现仍需按
Desktop UI 验收流程检查真实 Electron App、键盘焦点、双主题和 1040×700 / 1440×920 参考窗口。
