---
document_type: ui-contract
authority: web-connection-recovery-presentation
status: accepted
target_version: cross-version
last_updated: 2026-11-21
---

# Web 连接恢复

Desktop 托管和独立 Server 的 Web 共用一个全屏断线遮罩，宽屏与手机使用同一组件。
连接断开或原提交仍需恢复时暂停页面交互，保持原业务页面、已打开弹窗和草稿挂载。
不增加消息级待核对面板，也不逐个改写业务按钮的禁用逻辑。

遮罩只有一个主操作，不能通过背景点击或 Escape 关闭；焦点留在遮罩内。
全局捕获阶段阻止底层页面快捷键；原页面使用 inert，弹窗层由模态交互边界覆盖。
关闭遮罩不强制把焦点移到其他页面入口。

| 状态 | 标题 | 操作 |
| --- | --- | --- |
| 断线／需要恢复 | 服务连接已断开 | 恢复连接并重试 |
| 恢复中 | 正在恢复连接… | 禁用，显示正在恢复… |
| 恢复未完成 | 仍无法连接服务 | 恢复连接并重试 |

正文只说明页面和草稿保留，以及连接恢复后处理未完成操作。失败时提示确认服务已启动。
使用单一中性浮层、attention 图标与现有 `conversation-action` 主操作 Token；所有配色共享结构，
不得回退到通用蓝色 primary。手机宽度保持边距，短视口允许浮层内部滚动；减少动态效果时停止旋转。
标题、说明、按钮与恢复通知跟随现有界面语言偏好。保留键盘焦点约束，不添加额外的 focus-visible 描边。

服务恢复且没有待处理提交时可自动回到原页面。有未知提交时，自动重连仅核对；
显式按钮才可使用原提交重试。成功和明确失败释放提交中状态；业务失败保留原页面的错误反馈与草稿。
连接已恢复、刷新后又缺少上传文件时，用常驻的中性通知提示重选原文件。恢复通知与连接错误各自关闭，
公告优先级遵循[通用操作提示](components/app-shell-navigation.md#通用操作提示)。
认证失效沿用登录页。领域边界由 [Host Web v4](../contracts/host-web-v4.md#web-断线恢复)拥有。

验证入口为 `pnpm test:host-web-recovery`：独立 Chrome profile、正式传输／遮罩／Dialog 和故障注入 HTTP fixture，
覆盖 SSE 断线、连接失败、弹窗/草稿保留、快捷键、日夜与手机布局、原提交重试及失败解锁。
该用例不启动 Core 或 Runtime，不能作为真实 Host 命令幂等或实体手机网络切换的验收证据。

`pnpm test:host-web-recovery-live` 另验正式 WebEntry／BusinessApp 和真实 Rust Host 的停止、重启、
登录态与 Composer DOM／草稿保留，以及刷新后公共发送成功时编辑器与持久草稿同步清理、后续编辑保留。
同一用例还用正式 ConsoleClient 验证真实 Core 明确失败的 Promise 结算，以及提交后丢响应时只读核对、零重复发送。
它还验证 390px 下的重选文件通知、退出失败的错误提示及两条提示的独立关闭。
运行前构建 WebUI 和 Host；
可用 `ROVAI_HOST_BIN` 指定现有 Host 二进制，报告记录其摘要。测试自行隔离数据、Skills、MCP 与浏览器，
不配置或调用 Runtime。`ROVAI_WEB_RECOVERY_OUTPUT` 可指定两种用例的截图与 JSON 输出目录。
