---
document_type: implementation-plan
version: v1.30
authority: implementation-and-acceptance-status
status: in_progress
last_updated: 2026-08-30
---

# v1.30 Camp 文件预览实施计划

本计划记录实现和可复核验收事实；设计结论由 [File Preview Architecture](../../architecture/file-preview.md)、
[File Preview v1 Contract](../../contracts/file-preview-v1.md)和[文件预览区 UI](../../ui/components/file-preview.md)拥有。

## 1. 版本与合同

- [x] 建立 v1.30、决定、Architecture、Contract、UI 与路由；
- [ ] 文档门禁通过并保持唯一 current version；
- [ ] TypeScript/Rust 公共类型与合同字段一致。

## 2. Core/Main/Preload

- [ ] Core 验证 Camp workspace、消息、Attachment 和 Run Evidence 来源；
- [ ] Main 完成 realpath/containment/regular-file、类型检测、窗口级句柄、generation、TTL 和上限；
- [ ] 完成整文本、分页、行定位、二进制读取与自动重开一次；
- [ ] 完成 Root Grant challenge、原生目录选择和一次性消费；
- [ ] 完成一个 root 一个 watcher、事件匹配、合并和所有生命周期释放；
- [ ] 完成 HTML CSP、短期协议、调用窗口 gate、导航阻断与 token 撤销；
- [ ] 完成公开错误归一化，不泄漏 canonical path 或内部能力状态。

## 3. Renderer

- [ ] 完成 Camp-keyed reducer/context、共享顶栏、File Tabs、路径行和三种容器布局；
- [ ] 完成 Code/Text/Paged、Markdown、HTML、Image/SVG 与 Patch Viewer；
- [ ] 完成消息 Markdown、inline-code、裸路径、附件与子链接入口；
- [ ] 完成外部更新提示、保留旧内容的主动刷新和并发信号保护；
- [ ] 完成 Tab 上下文菜单、系统打开/显示位置/复制安全路径和平台文案；
- [ ] 完成文件选区 Draft/Message/History/Agent input 投影；
- [ ] 不支持格式只走默认应用且不改变 Pane 状态。

## 4. 验证

- [ ] Parser 覆盖 Unix、Windows、UNC、Home、file URI、行列、范围、标题和拒绝 scheme；
- [ ] Main 覆盖 containment、symlink、句柄复用/上限/回收、分页 generation 与公开错误；
- [ ] watcher 覆盖 root 复用、精确/目录/缺失路径、刷新竞态、无轮询和引用归零关闭；
- [ ] Renderer 覆盖 ARIA Tabs、键盘、焦点恢复、路径中部省略、紧凑返回与 unsupported no-op state；
- [ ] HTML 覆盖 CSP 先行、网络/导航/窗口/表单/下载阻断、资源 token 和释放；
- [ ] `pnpm typecheck`、相关 Vitest、Rust 定向测试、`pnpm docs:check` 与 `pnpm build:desktop` 通过；
- [ ] 隔离开发 App 完成日/夜、宽/中/紧凑、macOS 与 Windows 投影验收；Windows 真机项单独记录。

## 交付阻断条件

- Renderer 可以读取任意路径，或响应/日志泄漏 Attachment canonical path；
- 文件变化自动覆盖 Viewer，或使用定时轮询；
- 不支持格式创建 Tab、handle、token 或 watcher；
- 刷新先清空旧内容，失败时销毁 Tab；
- HTML 能访问 Preload、网络、任意 IPC、顶层导航、新窗口、下载或授权 root 外资源；
- Files Changed 当前文件按显示 path 猜身份或改写历史 Evidence；
- Camp 切换短暂显示旧 Camp Tab、选区或错误；
- 键盘无法操作/关闭/恢复文件 Tab，或关闭按钮只在 hover 下可达；
- 路径行出现宿主绝对前缀或横向滚动条。
