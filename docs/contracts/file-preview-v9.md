---
document_type: contract
contract: file-preview
version: 9
status: accepted
authority: desktop-file-preview-wire
source_version: v1.54
last_updated: 2026-09-07
---

# File Preview v9

## 相对 v8 的变化

完整继承 [v8](file-preview-v8.md) 的来源校验、成功后提交、窗口内 Camp 恢复、具体文件能力、Viewer、watcher、
副作用与失败呈现。本版只收敛 `Files Changed` 卡片的预览路由：有可靠差异时继续读取不可变 Review；没有可靠差异
时直接打开对应当前文件，不再先进入只含空状态的历史 Review。

不新增 Core 方法、IPC channel、字段、持久化、文件来源类型或授权范围，也不使用当前文件补造历史差异。

## Files Changed 预览路由

Renderer 只根据投影中已经冻结的 `presentationKind` 选择入口，不读取文件、Git 或 detail blob 来猜测路由：

- `full_net_diff | exact_mutations | operation_history` 是可审查文件；点击文件行进入对应 Run/epoch 的不可变
  `File Change` Tab，并预选该文件；
- `operation_only` 没有可审查正文；点击文件行直接以该文件的 `run_evidence / open_current` 来源打开普通文件 Tab；
- 卡片至少包含一个可审查文件时，header 保持“查看变化”，打开既有 Review。已打开 Review 仅保留仍可审查的选择，
  否则选择第一个可审查文件，不能让通用入口落到 operation-only 空状态；
- 卡片全部为 operation-only 时，header 改为“查看文件”，并打开卡片顺序中的第一个当前文件；用户点击具体文件行时
  始终打开该行对应文件；
- 只在卡片含可审查文件时允许“查找这次文件变化”，查找仍只遍历不可变差异正文。

当前文件入口复用 v8 的成功后提交通道，固定使用 `commitOnSuccess=true` 与 `previewOnly=true`。只有 Main 完成
`run_evidence / open_current` 身份校验且 Renderer 成功读取首屏后，才创建或激活普通文件 Tab。目录、系统应用结果、
文件删除、移动、无权、不支持预览、类型变化或读取失败都不得切换 Pane、替换已有 Tab、启动外部应用或留下临时资源；
调用方只显示当前页 danger Toast `无法打开该文件`。

普通文件 Tab 表达点击时的当前文件，不是本次 Run 的历史内容。历史 Review 仍只读取不可变 projection/detail；在已经
打开的混合 Review 中显式选择 operation-only 文件时，仍可显示“没有可审查的差异内容”和“打开当前文件”，不得以内联
当前正文填充历史 Evidence 面。

## 验收不变量

- 混合卡片的 header 打开 Review 并选中可审查文件；operation-only 文件排在第一位时也不得成为通用默认选择；
- operation-only 文件行及单文件卡片 header 直接打开普通当前文件 Tab，不创建 `File Change` Tab、不读取 detail blob；
- 全 operation-only 卡片显示“查看文件”，差异查找入口禁用；点击具体行保持 exact evidence file identity；
- 当前文件打开使用 `run_evidence / open_current`、成功后提交与 preview-only；失败只显示统一 Toast，并保留原 Pane、Tab、
  内容、滚动和焦点；
- 当前文件读取结果不进入 AgentRun detail、差异统计、查找索引、CampMessage 或模型 Context。

## References

- [File Preview v8](file-preview-v8.md)
- [File Preview Architecture](../architecture/file-preview.md)
- [Camp 文件预览区](../ui/components/file-preview.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
- [Runtime File Change Observation v3](runtime-file-change-observation-v3.md)
