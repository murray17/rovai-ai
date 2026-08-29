---
document_type: architecture
authority: file-preview-components-and-boundaries
status: accepted
last_updated: 2026-08-29
---

# File Preview Architecture

## 组件与权威

```text
Renderer entry
  → typed Preload API
  → Desktop Main sender/camp gate
  → Core source authority
  → Main canonical path + handle + reader + watcher
  → safe metadata/content response
```

- **Core** 拥有 Camp、Message、Attachment、Runtime Evidence、Composer Draft 与当前文件身份映射；
- **Desktop Main** 拥有宿主路径、原生选择器、Root Grant、只读文件能力、reopen token、HTML/asset token、watcher 和系统操作；
- **Preload** 只暴露 [File Preview v1](../contracts/file-preview-v1.md) 的场景化方法；iframe 不获得 Preload；
- **Renderer** 拥有当前 Camp 的 Tab、布局与阅读状态，不解析路径形成 Authority，也不读取磁盘。

任何来源必须先成为封闭 `OpenFilePreviewRequest`。Core 返回的 root/base/candidate 只在 Core↔Main 内部存在；
Main 对 root 和目标分别 realpath，使用平台感知的路径段比较做 containment，并拒绝目录、symlink 越界和特殊文件。

## 窗口文件能力

每个成功预览在 Main 中映射为窗口级句柄。记录包含 `webContentsId + campId + sourceIdentity + canonicalPath +
authorizedRoot + capabilities + contentVersion + contentGeneration`。TTL 为 30 分钟，每窗口最多 64 项；正常读取、
刷新和系统动作延长 TTL，但没有 Renderer heartbeat。

`previewKey` 由已验证来源身份与 canonical file identity 摘要生成，用于 Renderer Tab 去重。`reopenToken` 在 Main
绑定原始来源链；刷新或句柄过期时重新验证来源、realpath 和文件身份并最多自动重试一次。子文件成功打开后获得
独立 token，父 Tab 关闭不撤销子 Tab。

## 读取与 generation

整文件 Markdown/HTML/代码渲染上限为 4 MiB；更大文本使用 generation-bound 分页。每个响应携带当前
`contentGeneration`，旧 generation 的并发结果被拒绝。分页响应携带绝对 byte offset 与绝对起始行，Renderer
不得把上一页末尾半个 UTF-8 code point 拼成新 Authority。

文件没有读取锁。每次刷新、系统打开、reveal、子资源读取前重新校验身份与 containment。刷新开始后 Viewer
继续显示旧 generation；成功时原子替换，失败时旧内容仍为可读真值。

## Root Grant

超出已有来源根的候选可以返回一次性 `pendingOpenId`。用户通过 Main 原生目录选择器选择 root；Main 判断它是否
覆盖原候选，成功后签发绑定 Camp 与窗口的短期 `rootGrantId` 并立即重试原请求。Renderer 从不接收所选绝对路径，
也不能提交任意路径登记为 Grant。

## Root watcher

`RootWatchRegistry` 以 canonical root identity 为键，一个 root 最多一个 `fs.watch(..., {recursive:true})`。
每个打开 Tab 登记窗口、Camp、previewKey 与已验证 relative identity。事件经平台路径归一化后只发布匹配
`previewKeys`；filename 缺失或只报告 root 时保守标记该 root 的全部订阅。

事件不执行 read/stat，不改动 Viewer。最后一个订阅释放时关闭 watcher；Camp 切换、窗口销毁、来源撤销与退出
分别清理自己的引用。watcher 失败后关闭 entry 并记录去路径诊断，不启动轮询。

## HTML 资源

`rovai-preview://asset/<tab-token>/<segments>` 在 `app.ready` 前注册为 secure standard scheme，并在实际窗口 Session
安装 webRequest sender gate 与 protocol handler。token 绑定窗口、Camp、Tab、父句柄和能力；handler 只接受 GET，
逐段解码并每次执行 containment、文件类型、大小和 MIME 检查。

HTML 通过无 `allow-same-origin` 的 sandbox iframe 执行；CSP 在用户文档之前注入，禁止网络、连接、表单、顶层
导航和下载。宿主拦截主/子 frame 导航与新窗口。消息桥只接受 ready、受限高度和本地链接选择三类有界消息，
同时验证 `event.source`、token、字段长度和当前 iframe 实例。

## 资源释放

- Tab 关闭：handle、reopen token、asset/HTML token 与 watcher subscription；
- Pane 隐藏：保留 Tab 与阅读状态，句柄仍受 TTL；
- Camp route commit：释放旧 Camp 全部窗口能力、Grant、challenge 和订阅，再清空 Renderer state；
- webContents 销毁/应用退出：幂等释放对应或全部资源。

不支持格式在来源与本地文件校验后直接交给系统默认应用，并在返回前释放一次性解析材料；它不进入上述长期资源图。
