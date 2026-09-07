---
document_type: contract
contract: file-preview
version: 11
status: accepted
authority: desktop-file-preview-wire
source_version: v1.55
last_updated: 2026-09-07
---

# File Preview v11

## 相对 v10 的修正

继承 [v10](file-preview-v10.md) 的文件入口、canonical 路径投影、Tab、系统操作和权限边界，修正其将所有
Attachment 统一隐藏路径的规则。用户 Local Attachment Source Ref 引用实际本地文件；它不是 Managed 或
legacy Attachment。成功预览源引用后，路径与普通文件采用相同呈现。Managed/legacy 附件继续只显示安全文件名。

## Core 与 Main 的内部回执

`camp.attachments.desktopOpenTarget` 的闭合 `DesktopAttachmentTarget` 增加必填字段：

```ts
canShowPath: boolean
```

Core 每次按 exact owner locator 验证来源后签发：Local Attachment Source Ref 为 `true`；Managed v2 与
legacy storage 为 `false`。该字段只在 Core/Main 之间传递，不进入附件卡片 View、数据库或 Runtime 输入。
Main 拒绝缺失字段和非 Boolean 值，不依据文件名、路径前缀、项目归属或 Renderer 提供的值推断存储类型。

## 源附件的成功路径

`canShowPath = true` 的附件完成现有来源、realpath、文件身份与 classifier 校验后，由 Main 生成路径：

- Main 独立读取所属 Camp 的 workspace authority，目标位于 canonical 项目根内时使用 `project_relative`，
  包括项目根文件；不能把附件的父目录当成项目根；
- 项目外目标使用 `external` 与 canonical 绝对路径，主目录内可缩写为 `~/`；没有可用项目上下文时也按
  已解析的绝对目标展示，不阻断有效源文件预览，不扫描或拼接候选位置；
- 原生输入与 pathless bytes 形成的 OS Temp source ref 都以实际打开的源目标为准。Temp 文件不被伪装成
  Downloads 或原始上传位置，也不借此推测缺失的来源信息；
- `canShowPath = false` 或未获明确许可的附件仍使用 `file_name_only`，不公开 Managed/legacy 内部路径。

消息、Composer、Pending、Pending Edit 和 Single Chat 继续使用原有 owner locator；Card/History View 仍然
无路径且 storage-blind。只有成功预览结果包含 Main 签发的显示路径，Renderer 不接收可反向提交的 source path。

## 交互与重验

源附件的现有路径行、hover/focus 完整值、同名 Tab 区分、系统定位和“复制完整路径”沿用 v10 普通文件行为。
复制绝对路径再次验证 exact owner、canonical 身份以及最新 `canShowPath`；撤销路径呈现许可后不得复制旧路径。
Managed/legacy 附件保留“复制文件名”，Main 拒绝 absolute 复制。

显示路径不改变附件的 `allowChildren = false`，不授予父目录、子文件或资源能力。Root Grant、Camp/workspace
绑定、Runtime 权限、附件持久化和临时文件生命周期均不改变。切换 Camp 后按原 owner locator 重验源文件并重新
签发路径；失败不查找替代文件。

## 验收

- 消息源附件 `~/Downloads/rovai-preview-plan-simple.md` 与 `~/Downloads/rovai-preview-simple.html` 成功
  预览后显示完整位置，复制得到 canonical 绝对路径；
- 项目根与子目录源附件分别显示 `README.md`、`docs/guide.md`；无 workspace 的有效绝对源仍显示外部路径；
- Managed/legacy 附件即使存储于项目目录，也没有路径行且不能复制内部绝对路径；
- 原有来源验证、文件缺失反馈、会话恢复和无父目录权限扩张继续成立。

## References

- [File Preview Architecture](../architecture/file-preview.md)
- [Camp Attachment v8](camp-attachment-v8.md)
- [Camp 文件预览区](../ui/components/file-preview.md)
