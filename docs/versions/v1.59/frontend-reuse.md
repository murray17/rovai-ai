---
document_type: implementation-reference
authority: shared-frontend-review-map
target_version: v1.59
status: active
last_updated: 2026-09-12
---

# 共享前端：组件与调用说明

本页对应 [宽屏对照稿](../../ui/host-web-parity.md)。目标和交互对照方向已获用户批准，现进入实际 A–D 收敛；不再扩展模拟稿。
已将实际 Web 入口切换到提取的生产 BusinessApp；真实写入与双入口验收仍在实施。先贯通 Camp，不先搬动整个仓库目录。

| 目标页面 | 共享生产组件 | 原生依赖如何处理 | IPC/HTTP 共同调用的 Rust 服务 |
| --- | --- | --- | --- |
| Camp | `CampNavigation`、独立提取的 `AppHeader`、`CampWorkspace`、`SafeMarkdown`、执行/任务组件 | Camp 内 request/event/附件动作通过 `CampClient` 注入；App 的 startup/supervisor/desktopSession/窗口与更新留 Desktop 入口 | 既有 Core application 的 Camp/open/message/run/task 服务；通过同一 `CoreService`，HTTP 逐项授权 |
| Composer/私聊 | 原草稿协调器、Mention、pending 与 `SingleChatPanel` | UI/焦点/缓存保留 React；Host/Owner/编辑客户端更换才切换编辑作用域；认证和连接代次独立更新；私聊依赖仍需后续迁移 | Camp draft/pending/send 已带后端 client 归属；Conversation 范围待接入；Core 原子消费与 command result，不新增同步服务 |
| 新建/队员 | `NewConversationDialog`、`MembersView`、`MemberRuntimeForm/Parameters` | 原目录选择 callback 变成 Host 授权目录选择；模型目录和 runtime check 接受注入 request；本机安装/认证是受信平台能力 | workspaces inspection/preflight、成员/运行绑定、Runtime 发现与检测；返回授权的 DTO |
| 文件 | `AttachmentCard`、`FilePreviewProvider/Pane/Tabs`、`ImageGallery` | `FilePreviewProvider` 接受显式 `FilePreviewApi`；附件动作区分 native open/reveal 与 Web download；图片缓存按客户端对象隔离；用户头像、相对资源及分页仍待补齐 | 复用 Core source refs/managed 产物，补按 owner locator 授权的 Host 资源服务；不把 Main 本地路径 API 直接公开 |
| Task/Memory/Automation | 生产 `TaskPanel`、`MemoryLibrary`、`AutomationWorkspace` 与内部编辑逻辑 | 页内领域 request/event 接入客户端；本机导出/导航留平台适配；不重写为通用 rows | 原任务、Memory、Automation 领域服务；Automation 调度时钟迁 Host，按原恢复语义验收 |
| Skills/MCP/设置 | 原设置工作区、名册分配、必要 settings sections | 逐页拆出原生目录、导入/导出、打开位置、theme/profile/preference 适配；窗口/托盘/更新不进入 Web | 原 library/assignment/config 服务；MCP 私密字段保持受限，客户端偏好不升格为领域权威 |

实际共享入口由原 `AuthoritativeApp` 提取为 `BusinessApp`；导航、Camp 切换、消息刷新、发送与审批协调代码共用。
`App.tsx` 保留原生启动/关闭壳层；Desktop 显式注入 `desktopBusinessEnvironment`，Web 注入 `createCampAdapter`。
`CampClientProvider` 与 `FilePreviewProvider` 不接受浏览器缺省桥接。主题、导航与一般展示偏好解析从 Main 提取为纯共享模型，
两端沿用相同校验规则；浏览器持久存储只保留展示偏好，不保存 Draft、命令、Token 或编辑恢复证明。
私聊、头像编辑及部分管理页内部仍有原生依赖，属于后续 B/D 缺口；不能把它们写成永久平台差异。
一次 Host/Owner/编辑客户端作用域内保持 client/API 稳定。网络重连与同页面同 Owner 重新登录只更新认证和连接代次，
保留业务子树、未提交编辑与原命令 ID；Host/Owner 改变才更换编辑与缓存作用域。后端验证页面恢复证明，
不能仅凭 clientId/draftId 访问另一标签页草稿。认证 Token、恢复证明均只在页面内存，不落 URL、日志或浏览器持久存储。
生产 Web 缺少客户端或资源适配立即报错；Desktop 旧路径的延迟默认值仅用于迁移兼容。客户端 platform 来自
浏览器设备；Host OS/Runtime 准入来自真实 health 投影，不能沿用 fixture 的固定 darwin。

`CampClient` 只是 Renderer 依赖接口，request 沿用当前 `CoreMethod` 类型以保持旧 Desktop 语义；它不是网络
能力清单。实际 Remote 用明确操作集合映射到 Rust Web enum/DTO，未知方法明确报错；不能自动透传该接口全部方法。
认证前核对 Host Web 协议 2，Session 变化保留编辑 scope，Core 通过独立恢复证明关联原草稿。

检查点 A 的实际接线：Web 认证入口取得短期 Session/clientId → 建立固定 origin 的 Remote 客户端 →
读取同一 Camp 的授权完整 projection → 挂载共享导航/工作区。Desktop 入口保留原生初始化与窗口恢复，
然后给相同业务页面传入 IPC 客户端。`apps/web/src/main.tsx` 已只负责认证、连接和显式适配，登录后挂载与 Desktop 相同的 `BusinessApp`。
旧独立 Workspace 已移除；页面协调代码来自原 `AuthoritativeApp`，不是复制 Review fixture。

网络 SSE 仍只有失效通知，未伪装成完整 CoreEvent。实际 Remote 收到 resync/invalidate 后调用共同的导航、
活动 Camp 和队员刷新协调器，重读授权的执行/消息 projection；请求响应在 body 解码后仍核对连接代次。
刷新不重挂业务子树，编辑 scope 与认证 generation 分开。实际浏览器已观测运行/工具/审批/停止/终态更新，并验证
Composer DOM/输入未重建；图片缓存按 CampClient 分开，Markdown 无 preview-asset 能力时读取安全文本并沿用共享渲染。
更多历史阅读、相对资源和媒体类型仍须逐项验收，不能只因为两个入口共享组件就宣布全部多客户端场景正确。

真实 B/C 仍须证明：命令准入后断网不取消，unknown outcome 按原 commandId 查询；两端审批只有一次有效
决议；草稿/附件归属贯穿 queue/send；Desktop 与独立 Server 使用同一 Web 产物；关闭 Web 后执行继续。
安全仅保留[实施计划中的一个待确认决策项](implementation-plan.md#host-protection-decision)，与页面复用缺口分开追踪。
