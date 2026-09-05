---
document_type: protocol-contract
contract: run-process-detail-surface-v31
authority: tool-group-and-file-operation-presentation
status: accepted
version: 31
source_version: v1.52
last_updated: 2026-09-06
---

# Run Process Detail Surface v31

完整继承 [v30](run-process-detail-surface-v30.md) 的公开当前指令、Evidence 边界、连续 Tool 分组和 Runtime
Compaction。本版统一 Tool 详情、状态图形与文件操作入口；不改变 Tool 内容、Canonical Activity 计数、
Diff 内容或渠道卡片文案。

## 分组摘要与状态

- 终态 Tool 组的可见文案和可访问名称固定为 `完成了 x 个步骤`。`x` 是组内 Canonical Activity 数量；
  一个 Activity 展示多个文件行时仍只计一步。摘要不追加失败、停止、跳过或未知数量。
- 组右侧只有执行中和等待审批显示状态图形。终态保留等宽空槽，不显示成功、失败、停止、跳过或未知图形，
  也不为该空槽生成 tooltip 或辅助名称。
- Tool 子行使用形状与颜色共同表达状态：执行中为动态空心环，等待审批为菱形，成功为带勾圆形，失败为带叉
  圆形，停止为方形，跳过为带横线圆形，结果未知为带问号圆形。`forced-colors` 下保留相同形状；
  `prefers-reduced-motion` 下执行中停止旋转但仍保持空心环。
- 未执行或被拒绝的 Tool 映射为“已跳过”；Runtime 明确停止映射为“已停止”。取消请求发出但尚未结算时仍是
  运行中事实，状态容器保持透明，不形成整块色条。

## Tool 详情

Shell、Web、Built-in 与普通 Tool 的详情容器统一使用现有 Shell 详情底色和 2px 左外边距。各类型保留已有
内容、顺序、字号、内边距和换行；不增加“指令／结果”标签、分隔线或额外空行。Shell 的 `$`、Web 的
`搜索 ` 前缀以及既有 JSON／文本结果继续由各自 presentation 生成。文件 Diff 的内容与排版不变。

没有展开内容的静态行不提供整行 hover。可展开 Tool 的 summary、可点击文件名和独立 Diff 箭头继续只对自身
动作给出 hover/focus 反馈。

## 文件操作行

`runtimeFileOperation schemaVersion=2` 且 `operationKind=read` 的可靠单文件操作显示为不可展开的
`阅读 <文件名>`，使用阅读文件图标。可靠写入或 Diff 行使用笔图标：明确 `changeKind=add` 显示
`新增 <文件名>`；`update`、path-only write 或无法可靠区分新增／编辑时显示 `编辑 <文件名>`。

文件名使用虚线底线按钮并保留完整路径的 title／可访问名称。点击只请求当前 Camp workspace 文件预览；
动作文字、图标与行内空白不可点击。写入行若有 Diff，最右侧独立按钮控制原有 Diff 展开，点击文件名不得切换
Diff，点击 Diff 箭头不得打开文件。缺少可靠路径时不生成文件链接；缺少 Diff 时不生成空展开入口。

文件打开成功后才提交预览导航。打开失败只在当前页面发出 danger Toast `无法打开该文件`，不创建、激活、
切换或替换预览 Tab，也不抢占焦点。

## 验收

- 终态组在成功、失败、停止、跳过和混合结果下都只显示 `完成了 x 个步骤`，并且右侧没有状态图形；
- 七种 Tool 子行状态在正常颜色和单色高对比模式下都能仅凭形状区分；
- Shell、Web、Built-in 和普通 Tool 详情共享 Shell 底色与左轴，原内容和 File Diff 保持不变；
- read 行不可展开；新增、编辑、path-only write 和无可靠 path／Diff 的回退符合上述规则；
- 文件名和 Diff 箭头可独立键盘操作，失败只产生红色 Toast 且不改变已有预览状态；
- 静态行无假 hover，取消等待不形成色条，底部执行台与 Inspector 复用同一 presentation。

## References

- [Run Process Detail Surface v30](run-process-detail-surface-v30.md)
- [Runtime File Change Observation v3](runtime-file-change-observation-v3.md)
- [File Preview v8](file-preview-v8.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)

