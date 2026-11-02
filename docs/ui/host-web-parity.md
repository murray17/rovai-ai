---
document_type: ui-platform-guidance
authority: renderer-desktop-web-parity
last_updated: 2026-10-30
---

# Desktop 与 Web 共用界面

Desktop 与宽屏 Web 共用 `BusinessApp`、会话、Composer、文件预览和管理页的生产组件、主题 Token 与交互状态。
平台能力通过显式依赖注入；共享页面不依赖原生全局对象，也不复制业务状态机。
Host 授权与运输边界由 [Host Web](../contracts/host-web-v4.md)和[统一 Rust Host](../architecture/unified-rust-host.md)拥有。
手机布局另见 [Mobile WebUI](host-web-mobile.md)。

## 共享行为与客户端状态

- 页面结构与业务动作遵循对应[组件合同](components/README.md)和[页面指引](README.md#页面局部-brief)。平台适配不能取消权限、版本校验、可用动作或秘密过滤。
- 公屏与单聊草稿分别遵循 [Public Composer](../architecture/camp-composer-draft.md)和[Single Chat](../architecture/single-chat.md)。不同客户端的编辑、附件和输入焦点互不覆盖，公共与私有内容不串用。
- 外观、导航与阅读位置按客户端保存；业务事实来自 Host。迟到读取不能覆盖新的页面选择或草稿。
- 提交中阻止重复操作；未知结果使用原 commandId 核对，不重新派发。断线、认证过期及重新登录保留编辑和原提交，使用[共享连接恢复](host-web-connection-recovery.md)。
- 审批保留 Runtime 原生选项和权限；文件能力按来源授权，拒绝越权与路径穿越。未知附件绑定结果先核对，不误删文件。

## 平台差异

| 交互面 | Web 适配 |
| --- | --- |
| 窗口、导航、缩放 | 浏览器 History 接入共享离开检查；使用浏览器缩放。原生拖拽区、窗口、托盘与 Desktop 更新留在 Desktop 能力内。详见 [App Shell](components/app-shell-navigation.md) |
| 选择工作区 | 浏览 Host 有权访问的目录，提交前成功读取并通过相同 Core 项目校验；失败保留输入。详见[远程连接](host-remote-connection.md) |
| 附件、文件、Memory 导出 | 浏览器上传/下载适配原生选择、打开和保存；保留原对象身份与授权。发送失败或移除引用不删除用户源文件 |
| 文件预览 | 共用 Viewer、源码与查找；HTML 宿主策略和相对资源能力遵循文件预览合同。详见[文件预览](components/file-preview.md) |
| 队员与 Runtime | 检测、认证与模型目录由 Host 提供；浏览器本机可执行文件不代表 Host 安装。冲突或失败保留编辑，秘密不因共用表单而公开 |
| Skills、工具箱与 MCP | 沿用[当前能力页面](components/README.md)及逐项授权操作；文件选择面向 Host，不公开完整内部 RPC 或原生秘密 |
| Automation | 调度由 Host 时钟驱动，关闭浏览器不停止调度；重启、错过计划与执行重叠遵循原合同 |
| 设置与更新 | 客户端偏好与 Host 业务设置分别保存；Desktop 托管与独立 Server 的能力由 Host 投影，见[设置工作区](surfaces/settings-workspace.md) |

## 验证

按[全部配色矩阵](qa/theme-matrix.md)对照相同页面、数据、状态和视口；验证主要操作位置、键盘、缩放与失败恢复。
`pnpm test:host-web-parity` 使用独立 Chrome/Electron profile 验证共享组件，不启动 Core/Runtime；缺少浏览器的跳过不计通过。
`pnpm test:host-web` 验证授权、附件与回执边界，`pnpm test:host-web-live` 验证实际 Desktop/Web 页面。
具体隔离要求见 [UI 验收流程](../development/ui-acceptance.md)。

真实 Host 验收覆盖双客户端草稿隔离、断网后原命令核对、审批竞争、文件来源授权和重启恢复；
Automation 另验证无浏览器时的调度。模拟 API、组件截图或两个独立 iframe 不能代替这些证据。
真实 Runtime、原生窗口、实体手机和平台安装升级分别按对应验收流程确认。
