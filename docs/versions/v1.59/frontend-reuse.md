---
document_type: implementation-reference
authority: shared-frontend-review-map
target_version: v1.59
status: draft
last_updated: 2026-09-12
---

# 共享前端：组件与调用说明

本页对应 [宽屏对照稿](../../ui/host-web-parity.md)。目标已按用户指令固定；当前仍在交互对照评审，
不代表检查点 A–D 或 Remote 写入已经实现。先贯通 Camp，不先搬动整个仓库目录。

| 目标页面 | 共享生产组件 | 原生依赖如何处理 | IPC/HTTP 共同调用的 Rust 服务 |
| --- | --- | --- | --- |
| Camp | `CampNavigation`、独立提取的 `AppHeader`、`CampWorkspace`、`SafeMarkdown`、执行/任务组件 | Camp 内 request/event/附件动作通过 `CampClient` 注入；App 的 startup/supervisor/desktopSession/窗口与更新留 Desktop 入口 | 既有 Core application 的 Camp/open/message/run/task 服务；通过同一 `CoreService`，HTTP 逐项授权 |
| Composer/私聊 | 原草稿协调器、Mention、pending 与 `SingleChatPanel` | UI/焦点/缓存保留 React；每次 Host/Session 代次更换重新建立客户端作用域；私聊与图片等依赖仍需后续迁移 | 带后端 client/Camp/Conversation 归属的 draft/pending/send；Core 原子消费与 command result，不新增同步服务 |
| 新建/队员 | `NewConversationDialog`、`MembersView`、`MemberRuntimeForm/Parameters` | 原目录选择 callback 变成 Host 授权目录选择；模型目录和 runtime check 接受注入 request；本机安装/认证是受信平台能力 | workspaces inspection/preflight、成员/运行绑定、Runtime 发现与检测；返回授权的 DTO |
| 文件 | `AttachmentCard`、`FilePreviewProvider/Pane/Tabs`、`ImageGallery` | `FilePreviewProvider` 接受显式 `FilePreviewApi`；附件动作区分 native open/reveal 与 Web download；图片和用户头像资源适配尚待补齐 | 复用 Core source refs/managed 产物，补按 owner locator 授权的 Host 资源服务；不把 Main 本地路径 API 直接公开 |
| Task/Memory/Automation | 生产 `TaskPanel`、`MemoryLibrary`、`AutomationWorkspace` 与内部编辑逻辑 | 页内领域 request/event 接入客户端；本机导出/导航留平台适配；不重写为通用 rows | 原任务、Memory、Automation 领域服务；Automation 调度时钟迁 Host，按原恢复语义验收 |
| Skills/MCP/设置 | 原设置工作区、名册分配、必要 settings sections | 逐页拆出原生目录、导入/导出、打开位置、theme/profile/preference 适配；窗口/托盘/更新不进入 Web | 原 library/assignment/config 服务；MCP 私密字段保持受限，客户端偏好不升格为领域权威 |

这次为可点击稿做的最小生产改动：提取 `AppHeader` 并保留旧导出；为 Camp 及相关组件增加
`CampClientProvider`，把当前所需 request/event/附件依赖转为注入；为文件 Provider 增加显式 API 参数，
为 Runtime 模型/检查 helper 增加 request 参数。旧 Desktop 调用仍由 `desktopCampClient` 延迟适配真实桥接。
这个兼容默认值不代表整个 App 已解耦；原生 Session、个人资料/头像、私聊、图片与跨页面状态的完整迁移待 A/D。
一次挂载内保持 client/API 对象稳定；切换 Host 或 Session 时按客户端作用域重挂业务子树，不能只替换对象而
继续使用旧草稿协调器。当前稿不实现生产连接代次和跨页面缓存隔离。

`CampClient` 只是 Renderer 依赖接口，request 沿用当前 `CoreMethod` 类型以保持旧 Desktop 语义；它不是网络
能力清单。当前稿使用枚举模拟调用、未知调用报错。实际 Remote 实现必须逐项映射到 Rust Web operation/DTO，
不能自动透传该接口全部方法，也不能拿 fixture 充当真实 adapter。

检查点 A 的实际接线：Web 认证入口取得短期 Session/clientId → 建立固定 origin 的 Remote 客户端 →
读取同一 Camp 的授权完整 projection → 挂载共享导航/工作区。Desktop 入口保留原生初始化与窗口恢复，
然后给相同业务页面传入 IPC 客户端。当前 `apps/web/src/main.tsx` 的独立 Workspace 在 A 替换，不继续扩展。

网络 SSE 目前只有失效通知，不能伪装成完整 CoreEvent。Remote 客户端需显式重读对应授权 projection，
保持事件/快照水位和连接代次；旧响应不能写入新客户端。现有全局 Camp 阅读位置、图片/文件缓存与
偏好必须检查 Host/client key，不能只因为两个入口共享组件就宣布多客户端正确。

真实 B/C 仍须证明：命令准入后断网不取消，unknown outcome 按原 commandId 查询；两端审批只有一次有效
决议；草稿/附件归属贯穿 queue/send；Desktop 与独立 Server 使用同一 Web 产物；关闭 Web 后执行继续。
安全仅保留[实施计划中的一个待确认决策项](implementation-plan.md#host-protection-decision)，与页面复用缺口分开追踪。
