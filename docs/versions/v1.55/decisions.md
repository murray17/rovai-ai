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
项目相对路径；位于项目外时返回 canonical 绝对路径，canonical 主目录内允许使用 ~/ 缩写。Attachment 继续只签发
authority 提供的安全显示名。

路径仅是成功状态的呈现。reveal、默认应用、重新加载和复制完整路径继续使用 opaque handle，在 Main 重验同一
canonical 文件后执行；显示项目外路径不创建 Root Grant，不授权父目录，也不改变项目或会话工作目录。

### 后果

项目根和项目外普通文件均能确认实际位置，同名 Tab 可以从 Main 签发的路径生成最短唯一后缀。symlink 按实际打开
目标呈现，历史引用不依赖 Renderer 当前项目。Attachment 和失败状态仍不会泄漏内部路径。

### 被拒绝方案

- 项目外文件继续只显示文件名：无法确认位置或可靠区分同名文件。
- Renderer 以当前项目拼接或重算路径：会产生项目切换漂移，并绕过 Main 的来源与 canonical 身份权威。
- 显示路径时同时授权父目录：把呈现行为扩大成持久读写能力，超出单文件打开的用户意图。
