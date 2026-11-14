---
document_type: protocol-contract
contract: file-preview-v28
status: accepted
version: 28
source_version: v1.72
last_updated: 2026-11-12
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

桥接器仅在原始 `ErrorEvent` 上严格识别浏览器 ResizeObserver 布局通知，要求
`isTrusted === true` 且 `error === null`，并将消息去除首尾空白和一个末尾句号后，精确匹配以下两条之一：

- `ResizeObserver loop completed with undelivered notifications`
- `ResizeObserver loop limit exceeded`

该事件特征已由现有 Electron 浏览器夹具验证；不符合条件的事件继续按原有脚本错误处理，不对异步异常做消息过滤。
符合全部条件时直接跳过向 Rovai 预览诊断列表上报，保持原始事件、其他监听器和原生控制台行为，不调用 `preventDefault()`；这不保证布局没有问题。
既有 `layout` 合法值和问题计数兼容逻辑保留，当前桥接器不再为这些通知生成该记录。
其他错误继续使用既有身份校验、去重键、100 条上限、文档清理机制及问题口径，不新增字段或来源追踪。
资源诊断的独立状态及 CSP 精确归因、停止重试行为保持，状态文案按 `reason: policy` 显示为“受页面策略限制”。

## 打开失败的预览页

本节覆盖继承版本中“当前文件首次失败仅 Toast、不提交标签”的 Renderer 呈现规则；Main、Core 与 wire shape 不变。
消息文件引用、Skill、附件和有可靠来源的执行文件打开失败时，进入既有文件预览区，以普通文件标签承载无内容状态。
正文统一显示“无法打开文件 / Could not open file”，不输出内部路径、权限挑战或底层异常，不新增消息／附件旁错误行。
Web 原有 unsupported／decode_failed／file_too_large 的下载降级保留。当前安全错误码映射仍供诊断及附件可用性消费。

Renderer 的 open outcome 区分 `preview`（成功预览）、`preview_error`（含 tabId 与安全 error 的失败预览）、
`system`、`evidence_review` 和 `error`（未形成预览页）。调用者对 `preview_error` 不再显示第二条全局提示，
也不能把失败标成附件 available。缺少可定位的文件来源、资源准入失败与原生系统动作保留既有安全反馈。

需要首屏读取后提交的入口仍先完成来源校验与初读；失败时只提交失败标签，不授予文件能力。重复失败复用同一来源标签，
其他可读内容与标签顺序保留。成功前取得但未提交的候选句柄释放，失败不修改历史 Evidence、附件事实或原始请求权限。
后台或已有更新导航意图的迟到结果不激活目标；scope generation 变化或 session 销毁后不能重建标签。
同来源并发请求复用在途操作，最新一次显式点击仍可激活该结果；不新增后台队列或自动授权分支。
