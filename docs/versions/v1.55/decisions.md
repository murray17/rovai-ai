---
document_type: version-decisions
version: v1.55
lifecycle: current
authority: decision-rationale
last_updated: 2026-09-07
---

# v1.55 版本决定

<a id="v1-55-d01"></a>

## V1.55-D01：成功打开后由 Main 签发 canonical 目标路径，路径呈现不授予目录能力

### 背景

过去项目外普通文件只显示文件名，项目根文件也隐藏路径行。用户无法确认已经打开的实际位置，同名文件也难以
区分。Renderer 若根据当前项目或可见引用重建路径，会让历史链接随项目切换漂移，还可能暴露 Attachment 的内部
存储位置。

### 决定

Main 只在既有打开流程完成来源校验并得到 canonical 普通文件后签发路径：目标在 canonical Camp 项目根内时返回
项目相对路径；位于项目外时返回 canonical 绝对路径，canonical 主目录内允许使用 ~/ 缩写。用户源附件采用相同
路径呈现；Managed/legacy Attachment 继续只签发 authority 提供的安全显示名。Core 明确签发是否可展示源路径，
不把所有附件入口等同于受管存储，也不要求 Renderer 从路径猜测存储类型。

路径仅是成功状态的呈现。reveal、默认应用、重新加载和复制完整路径继续使用 opaque handle，在 Main 重验同一
canonical 文件后执行；显示项目外路径不创建 Root Grant，不授权父目录，也不改变项目或会话工作目录。

### 后果

项目根和项目外普通文件均能确认实际位置，同名 Tab 可以从 Main 签发的路径生成最短唯一后缀。symlink 按实际打开
目标呈现，历史引用不依赖 Renderer 当前项目。Managed/legacy Attachment 和失败状态仍不会泄漏内部路径。

### 被拒绝方案

- 项目外文件继续只显示文件名：无法确认位置或可靠区分同名文件。
- Renderer 以当前项目拼接或重算路径：会产生项目切换漂移，并绕过 Main 的来源与 canonical 身份权威。
- 显示路径时同时授权父目录：把呈现行为扩大成持久读写能力，超出单文件打开的用户意图。

<a id="v1-55-d02"></a>

## V1.55-D02：只接纳 Pi 成功 edit 的 path-bound 原生 patch，并以 activity-v4 隔离新映射

### 背景

Pi 0.84.4 的成功 `edit` 终态在 `result.details.patch` 提供包含 old/new 文件头和 hunk 的统一 Diff，足以证明具体
新增与删除行；`write` 终态没有等价的 before state 或 patch。此前 Core 已保留两者的路径级 Tool operation，
但没有消费 edit patch，因此 Files Changed 无法显示本来存在于原生事件中的 `+ / -`。

### 决定

Pi JSONL RPC v1 只有在事件为成功 `tool_execution_end`、toolName 精确为小写 `edit`、同一 `toolCallId` 已观察到
非空 `args.path`，且 `result.details.patch` 的 `---`／`+++` 文件头都与该路径完全一致并至少包含一个 hunk 时，
才发布 Diff Evidence。路径非法、header 冲突、缺 hunk、零变化、失败 edit 和 `write` 均 fail closed；不得读取
当前磁盘或使用 replacement input、`details.diff` 等相邻字段补造差异。

新 operation 使用 `activity-v4` 映射，只有 v4 把该 Evidence 绑定为 canonical `file.write`。Migration 147 必须在
Notification Single Chat Migration 146 已登记后，从精确的 `v1.54 / schema 96 / activity-v3` 来源原子推进到
`v1.55 / schema 97 / activity-v4`。既有 v1、v2、v3 row 和已建立 operation 保持原 classifier，不做历史 replay
或平行 reprojection；Read Side 依次兼容 v4、v3、v2、v1。

### 后果

Pi edit 可以显示来源可证明的逐行 Diff 与可靠增删统计，write 仍诚实显示为无计数的路径级编辑。迁移失败时 marker
与 receipt 一并回滚，部分或未来状态继续拒绝准入；Pi 启动、权限、模型、Session、Extension 和平台资格不变。

### 被拒绝方案

- 用 edit replacement 文本或当前文件反推 before/after：会把推测当作 Runtime 事实，并受并发文件变化影响。
- 把 `details.diff` 或任意同名 Extension 字段视为等价来源：字段权威和路径绑定未经证明。
- 让 activity-v3 直接识别新 Diff 或回填历史：会改变已冻结 operation 的语义，破坏可重放性。
- 为 write 构造全文件新增：无法区分覆盖、创建和并发变化，增删统计不可信。
