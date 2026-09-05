---
document_type: contract
contract: file-preview
version: 8
status: accepted
authority: desktop-file-preview-wire
source_version: v1.52
last_updated: 2026-09-06
---

# File Preview v8

完整继承 [v7](file-preview-v7.md) 的来源校验、具体文件能力、按 Camp 会话恢复、generation fence、Viewer、
失败 Tab 和公开错误映射。本版增加执行过程文件名入口的导航提交边界；不新增 IPC、Main 权限或持久字段。

## Tool file link

可靠 `runtimeFileOperation` 与文件 Diff 行可把 normalized path 作为现有 `camp_workspace` request 交给
现有 preview-only Main 校验路径。Renderer 只显示 basename，完整 path 进入 title 和可访问名称；该入口不扩大
`camp_workspace` 的来源、root、文件类型或读取授权。

这类入口采用成功后提交：

1. 保留当前 active view、Pane 可见性、Tab 顺序、active Tab 和已有 ready 内容；
2. 执行现有 Main preview-only 校验与读取，不触发系统应用、目录 reveal 或目录授权挑战；
3. 只有 Main 返回可预览结果且 Renderer 成功读取首屏内容后，才安装／激活目标 Tab 并显示 Pane；
4. 任何失败都撤销该请求产生的临时资源，恢复请求前状态，并只向调用方返回失败；
5. 同一 ready Tab 的刷新式打开失败时保留原可读内容，不把它替换为 error 页面。

Camp scope、Tab request generation 与 late-result 清理继续遵守 v7。成功前不得用 provisional Tab 改变用户可见
导航；失败不得切换到预览 Pane、创建残留 Tab、替换当前 Tab 或抢焦点。

## 失败反馈

执行过程文件名入口把所有 open 非 preview 结果统一呈现为当前页面的 danger Toast `无法打开该文件`，使用
alert/assertive 语义并自动消失。它不打开 v7 的失败预览页；v7 的失败 Tab 文案仍适用于已经进入预览流程的其他
入口和会话恢复。

## 验收

- 阅读、新增与编辑文件名都复用现有 `camp_workspace` 校验，成功后进入正确文件；
- 文件删除、移动、无权、不支持预览、类型变化或读取失败时只显示红色 Toast，当前页面和已有预览状态不变；
- 失败不留下 provisional Tab／handle／Blob URL，late result 仍受 Camp 与 request generation 拦截；
- 恢复文件后可从同一文件名再次打开；文件名按钮与 Diff disclosure 互不触发。

## References

- [File Preview v7](file-preview-v7.md)
- [File Preview Architecture](../architecture/file-preview.md)
- [Camp 文件预览区](../ui/components/file-preview.md)
- [Run Process Detail Surface v31](run-process-detail-surface-v31.md)
