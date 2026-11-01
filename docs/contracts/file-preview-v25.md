---
document_type: contract
contract: file-preview
version: 25
status: accepted
authority: desktop-file-preview-wire
source_version: v1.72
last_updated: 2026-11-01
---

# File Preview v25

继承 [v24](file-preview-v24.md) 的阅读、窗口草稿和手动保存，新增当前 Thread 的项目目录浏览。
Desktop 与 Web 共享 `FilePreviewApi.projectFiles`，通过现有 Host 请求通道调用 `projectFiles.request`。
不增加日常浏览授权步骤，不创建工作副本，不更改历史 Run 证据。

## 请求与作用域

请求固定携带 `threadId` 和 `action`；除 `resolve` 外携带 Host 返回的 `scopeId`。返回
`{ ok: true, value }` 或 `{ ok: false, error: { code } }`。

| action | 输入 | value |
| --- | --- | --- |
| `resolve` | 当前 Thread | `scopeId, rootId, name, revision` |
| `list` | `entryId`（根为 `root`）、可选 `offset` | `entries, nextOffset, partial` |
| `search` | `query, queryRevision` | `entries, nextOffset: null, partial` |
| `cancelSearch` | 单调递增 `queryRevision` | 空对象 |
| `open` | `entryId` | `OpenFilePreviewRequest` 的 `project_file` 来源 |
| `watch` | 展开目录的 `entryIds` | `watchFailed` |
| `poll` | 最近观察的 `revision` | `revision, watchFailed` |
| `release` | 当前作用域 | 空对象 |

条目为 `id, name, relativePath, directory, unavailable`。`id` 仅在已签发作用域内访问；显示路径不作为目录访问凭据。
作用域归当前 Desktop/Web client 和 Thread 所有。Core 在短数据库锁中取得当前业务工作目录，所有文件处理移到锁外。
已 ready 的 Mission 工作副本优先于 Thread 项目根；读取入口不准备工作副本。每次访问重新核对绑定和实际根身份。
根身份包含业务工作副本代次、规范化路径和根文件系统对象身份；已删除或替换的根返回不可用，不回退到同名项目文件。

`project_file` 包含 `threadId, rawReference`。后者是 Host 生成的根身份与相对文件定位；解析时必须重新从 Thread
取得根并验证同一代次、路径 containment 和普通文件。不是任意绝对路径授权，也不是跨工作副本重建的永久引用。
关闭目录作用域不撤销已打开文件的独立来源；该来源可进入现有预览、恢复及 v24 编辑流程。历史证据仍只读。

## 边界与变化

- 单层按需读取，每次最多 200 项；`offset` 是当前读取中的偏移，不提供稳定目录快照。单次最多检查 50,000 项、
  约 500ms，单层最多收集 20,000 项；不可读条目或预算截断返回 `partial`。
- 搜索文件名或相对路径，最多 100 条。新查询取消旧查询；`queryRevision` 防止迟到请求取消较新的查询。
  不建索引，不续传。不完整结果不得呈现为确定的“没有文件”。
- `.git` 元数据隐藏；使用 `ignore` 默认规则，普通点文件可见，非 Git 目录同样可用。首版无忽略项设置。
- 目录符号链接不展开，避免环路；指向根外的条目标记不可用，不扩展目录权限。
- `notify` 非递归监听根和展开目录，父目录监听只用于根变化。最多 256 个展开目录，事件只递增失效水位。
  `poll` 最长等待 8 秒，变化合并约 300ms；空闲响应不触发目录扫描。超限或监听失败保留错误恢复动作。
- 关闭、切换 Thread、页面离开释放作用域、搜索和监听。无正常释放的断线 client 在 60 秒闲置后释放；
  这是内存资源期限，不是恢复服务、持久租约或文件状态轮询。
- 每个 Core 最多 64 个浏览作用域，每个作用域最多登记 32,768 个条目；额度不足明确返回 `browse_limit`。

错误码为 `root_unavailable, scope_expired, entry_unavailable, browse_limit, read_failed`；监听失败通过
`watchFailed` 呈现，读取仍可手动重试。界面不得让旧 Thread、旧作用域或旧查询响应覆盖当前结果。

## 不支持预览的文件

从目录打开的二进制/不支持格式以 `unsupported` 阅读内容显示文件信息，Desktop 的系统打开和 Web 的下载仍由
用户主动触发；浏览点击不自动启动系统应用。现有会话链接的具体文件准入和原生动作不改。
