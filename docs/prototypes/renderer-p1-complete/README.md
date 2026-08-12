# ROVAI Renderer · P1 Fog 完整交互设计稿

文件：rovai-renderer-p1-complete.html

这是一份不依赖构建工具和外部资源的静态交互原型。它使用 P1 Fog 作为 Sidecar（左侧导航）材质，主工作区继续使用当前 ROVAI 的 Arctic Dawn 语义色，不修改生产 Renderer 代码。

## 页面覆盖

- Quick Chat
- Camp workspace：时间线、Task、Tool Call、Approval Dock、Inspector（Tasks / Context / Approvals / Audit）、Execution drawer、恢复提示、附件预览
- Members：Roster、Identity、Runtime、创建/编辑、头像裁切、移除阻塞
- Memory：Library、scope/filter、详情、Proposal review、创建/修订/接受并编辑/Forget
- Settings：General、Appearance、Notifications、Skills、MCP Servers、Runtime、Diagnostics

## 临时表面覆盖

原型包含 44 个可打开的 overlay surface（dialog、drawer、popover、menu、lightbox），覆盖当前 Renderer 的创建、编辑、审批、删除、恢复、导入检查、高权限确认、诊断导出与修复等流程。右上角的“交互覆盖 43”是设计稿导航入口；其中 43 项是可直接检查的交互状态，覆盖弹窗本身不计入列表。

## 视觉边界

P1 Fog Sidecar token：

- canvas #F3F4F5
- panel #FAFBFC
- text #293239
- secondary #5B6870
- icon #6C7880
- hover #E7E9EB
- active #E9ECEE
- indicator/focus #4F6E89
- divider #D8DDE1

主工作区 token 依据 `DESIGN.md`、`docs/ui/themes/` 与当前 `apps/desktop/src/renderer/src/styles.css`；状态颜色仍使用 success / warning / danger / info 语义，不随 Sidecar 材质改变。

## 交互提示

- 点击左侧页面或 Settings 分类切换页面。
- ⌘K 打开 Command Palette，⌘N 打开 New Conversation，Esc 关闭当前浮层。
- Camp 中的 Inspector tabs、Mention、Attachment、Task、Approval、Execution 均有独立入口。
- Members Runtime 有未保存状态；离开 Identity 或页面时会出现确认。
- 原型动作只显示 toast，不写入 Core、文件系统、系统通知或外部 Runtime。

## 依据

当前版本指针为 v0.52；页面边界与交互命名依据：

- apps/desktop/src/renderer/src/App.tsx
- apps/desktop/src/renderer/src/styles.css
- apps/desktop/src/renderer/src/CampNavigation.tsx
- apps/desktop/src/renderer/src/CampWorkspace.tsx
- apps/desktop/src/renderer/src/MemberManagement.tsx
- apps/desktop/src/renderer/src/MemoryLibrary.tsx
- apps/desktop/src/renderer/src/SkillSettings.tsx
- apps/desktop/src/renderer/src/McpSettings.tsx
- apps/desktop/src/renderer/src/DiagnosticsCenter.tsx
- apps/desktop/src/renderer/src/NotificationCenter.tsx
- apps/desktop/src/renderer/src/NewConversationDialog.tsx
- `DESIGN.md` 与 `docs/ui/README.md`
