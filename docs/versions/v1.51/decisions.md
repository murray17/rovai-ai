---
document_type: version-decisions
version: v1.51
lifecycle: current
last_updated: 2026-09-06
---

# v1.51 决定

<a id="v1-51-d01"></a>
## V1.51-D01：用无能力的窗口内 Camp 快照恢复文件阅读 shell

### 背景

文件 Tab 过去完全属于当前 Renderer Camp route；切换 Camp 会释放 Main 能力并清空 Tab，因此用户返回同一 Camp 时
失去刚才的文件集合、顺序、选择和 Pane 状态。直接保留旧 handle 或正文虽然看似快速，却会跨越 Camp capability
release，继续展示已经移动、删除或变化的文件，并把临时 Root Grant、HTML token 或 Blob URL 延长为隐式权限。
把这些状态持久化到 Core、SQLite 或 localStorage 还会制造新的隐私、迁移和多窗口一致性问题。

### 决定

Renderer 在单个窗口生命周期内维护按 Camp ID 隔离的有界 LRU Map。快照只保留稳定 Tab ID、可重验业务 source、
安全文件名／允许显示的相对路径、Tab 顺序、active ID 和 Pane 可见性；File Change 只保留既有不可变 summary 与选择 ID。
handle、reopen token、Root Grant、challenge、asset/HTML token、Blob URL、正文、分页、尺寸、watcher 和 `previewKey`
全部禁止进入快照。临时 child/root source 写成 null，恢复后明确 unavailable。App 重启自然清空；删除 Camp 同步清理，
不建立新的持久化领域对象。

### 后果与被拒绝方案

- A→B→A 可以恢复工作上下文，但所有当前文件事实都重新经 Core/Main 校验；后台 Tab 可以保持 cold。
- Pane 隐藏与 Tab 删除继续是两个动作；前者保留快照，后者移除项目。
- 拒绝缓存完整 `FilePreviewTabModel`：它混入能力、内容和异步状态，无法安全跨 Camp release。
- 拒绝把 Tab session 写入 Core/SQLite/localStorage：当前目标只是短期窗口记忆，没有跨进程恢复承诺。
- 拒绝把 File Change 当前文件与历史证据合并：不可变 diff 与可变工作区文件仍是两个身份。

<a id="v1-51-d02"></a>
## V1.51-D02：自动恢复使用无原生副作用路由与 Renderer/Main 双 generation fence

### 背景

既有 `open` 表示明确用户激活，可以显示目录、启动默认应用、请求可执行文件确认，并在显式目录流程中产生授权
challenge。Camp 切换后的自动恢复没有新的用户激活；复用该路径会在导航时突然弹窗、打开应用或扩大访问范围。
同时只比较 Camp ID 无法区分 A→B→A：旧 A 的慢请求可能在新 A 已绑定后完成，错误地安装内容或执行原生效果。

### 决定

增加 closed `filePreview.restore(RestoreFilePreviewRequest)`。它完整重验消息、工作区、owner-scoped Attachment 或
Run Evidence source，并只允许返回新的应用内 Preview handle；目录、系统格式、确认和授权 challenge 全部 fail closed，
临时 child/root source 在 IPC parser 处拒绝。Renderer 先发起 Main Camp bind，再恢复本地 shell；仅在 bind 成功且 Pane
仍可见时加载 active 文件，其余惰性加载。

Renderer 同时校验 Camp scope generation 与 Tab request generation；Main 为每个窗口的 Camp binding 分配 generation，
并在来源解析后、原生效果前、等待确认后和 handle 注册前复核相同绑定对象。旧 generation 的资源按精确代次释放，
不能因 Camp ID 再次相同而清理新资源。失败内容区只投影错误码映射的一句话和通用文件图标；明确的手动重开仍走
interactive `open`，不会把自动恢复悄悄升级成用户授权。

### 后果与被拒绝方案

- 自动恢复可以读取当前仍有效的支持格式，但不会 reveal、launch、confirm、select root 或签发 Root Grant。
- Late promise 可正常完成清理，却不能改变新 Camp UI、注册 handle 或产生原生效果。
- 拒绝给 `open` 增加可选布尔参数：调用方容易遗漏，且 IPC 审计无法一眼区分用户动作与自动恢复。
- 拒绝只用 `campId` 或只在 Renderer 丢弃 late result：Main 原生效果与资源注册必须在自身权威边界阻断。
- 拒绝在错误正文放重试卡片或内部详情：Tab 已提供文件身份和明确菜单，内容区只需表达当前不可读事实。

当前规范见 [File Preview v7](../../contracts/file-preview-v7.md)、
[File Preview Architecture](../../architecture/file-preview.md)与[Camp 文件预览区](../../ui/components/file-preview.md)。
