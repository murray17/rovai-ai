---
document_type: protocol-contract
contract: file-preview-v28
status: accepted
version: 28
source_version: v1.72
last_updated: 2026-11-09
---

# File Preview v28

继承 [v27](file-preview-v27.md)。

新增项目目录引用来源，不向文件内容预览器传目录。projectFiles.request 保留已有 action，open 增加可选 targetKind: file|directory，必须符合当前目标；
返回元数据来源为 {kind:project_file,threadId,rawReference,targetKind?:directory}，普通文件省略类型。
目录历史定位的 open 可同时携带 rawReference 与 expectedPathAtSend；Host 从认证 Thread 重取绑定，校验根身份、目录类型、相对路径和冻结主机位置。
expectedPathAtSend 不能脱离 rawReference 单独使用，也不构成权限。目录定位只展开祖先和当前层；文件预览接口保持只读普通文件。
来源元数据的共享 TypeScript 类型为 ProjectFileReferenceSource，独立于 OpenFilePreviewRequest；不得因共用 kind 值把目录传进文件读取。
list 与 search 的返回条目统一按名称升序混排，不对目录赋予优先级；先比较小写名称，再按原始名称打破平局。
搜索 100 条上限与 partial 语义保持，前端沿用 Core 返回顺序。
其他预算、watch/poll、链接与文件编辑行为保持。完整语义见 [项目引用 v2](project-file-reference-v2.md)。

## HTML 诊断分类

既有诊断的 `kind` 增加 `layout`，仅用于已识别的浏览器 ResizeObserver 布局通知。桥接器在原始 `ErrorEvent` 上要求
`isTrusted === true` 且 `error === null`，并将消息去除首尾空白和一个末尾句号后，精确匹配以下两条之一：

- `ResizeObserver loop completed with undelivered notifications`
- `ResizeObserver loop limit exceeded`

该事件特征已由现有 Electron 浏览器夹具验证；不符合条件的事件继续按原有脚本错误处理，不对异步异常做消息过滤。
传输和展示保留原始消息，不新增字段或来源追踪；继续使用既有身份校验、去重键、100 条上限和文档清理机制。
`layout` 不计入页面问题数、不触发脚本错误状态，仍在同一诊断列表的中性详情中可见；分类不保证布局没有问题。
其他诊断类型沿用原有问题口径。资源诊断的独立状态及 CSP 精确归因、停止重试行为保持，状态文案按 `reason: policy` 显示为“受页面策略限制”。
