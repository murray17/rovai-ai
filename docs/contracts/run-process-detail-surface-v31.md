---
document_type: protocol-contract
contract: run-process-detail-surface-v31
authority: tool-group-and-file-operation-presentation
status: accepted
version: 31
source_version: v1.52
last_updated: 2026-09-07
---

# Run Process Detail Surface v31

完整继承 [v30](run-process-detail-surface-v30.md) 的公开当前指令、Evidence 边界、连续 Tool 分组和 Runtime
Compaction。本版统一 Tool 详情、状态图形、文件操作入口与纯读取 Shell 摘要；不改变 Tool 内容、
Canonical Activity 计数、Diff 内容或渠道卡片文案。

## Run 反馈与工具组边界

本地单聊和执行台共用工具组、工具行、类型/状态 SVG、结果惰性读取和键盘交互。普通排队、等待首段输出及正文后
继续处理显示 `Thinking`；活动工具/Compaction 或未收口的尾组接替该提示，审批、重试、网络恢复和停止保留实际状态。
耗时总结只由 Run terminal 触发，成功使用“工作了 {时长}”并折叠过程；不能由正文首次到达、工具终态或步骤组收口
触发。非终态外层不显示耗时，已激活的工具结果在外层呈现切换时保持挂载。此补充只调整本地反馈与组件复用，
不改变 Canonical、Evidence、Single Chat 的私有投递或渠道卡片。

## 分组摘要与状态

- 终态 Tool 组的可见文案和可访问名称固定为 `完成了 x 个步骤`。`x` 是组内 Canonical Activity 数量；
  一个 Activity 展示多个文件行时仍只计一步。摘要不追加失败、停止、跳过或未知数量。
- 组右侧只有执行中和等待审批显示状态图形。终态保留等宽空槽，不显示成功、失败、停止、跳过或未知图形，
  也不为该空槽生成 tooltip 或辅助名称。
- 执行状态使用形状与颜色共同表达：执行中为外环、旋转弧线和中心点，等待审批为圆形内暂停线，成功为带勾
  圆形，失败为带叉菱形，停止为圆形内实心方块，跳过为带横线圆形，结果未知为圆形内信息标记。排队中的
  圆形时钟只用于存在排队事实的 Run；取消请求等待终态时使用没有中心点的中性旋转弧线。Tool 子行、底部
  执行台、Inspector 头像角标、Run 时间线与单聊工具行复用同一套图形。`forced-colors` 下保留相同形状；
  `prefers-reduced-motion` 下弧线停止旋转但仍保持原轮廓。
- 未执行或被拒绝的 Tool 映射为“已跳过”；Runtime 明确停止映射为“已停止”。取消请求发出但尚未结算时仍是
  运行中事实，状态容器保持透明，不形成整块色条。

## Tool 详情

Shell、Web、Built-in 与普通 Tool 的详情容器统一使用现有 Shell 详情底色和 2px 左外边距。各类型保留已有
内容、顺序、字号、内边距和换行；不增加“指令／结果”标签、分隔线或额外空行。Shell 的 `$`、Web 的
`搜索 ` 前缀以及既有 JSON／文本结果继续由各自 presentation 生成。文件 Diff 的内容与排版不变。

没有展开内容的静态行不提供整行 hover。可展开 Tool 的 summary、可点击文件名和独立 Diff 箭头继续只对自身
动作给出 hover/focus 反馈。

## Shell 多文件读取摘要

一个 Shell Activity 含多条确定的纯文件读取动作时，Renderer 仍只呈现一个可展开命令项，但折叠摘要按不同
文件聚合。优先使用 Runtime 或现有命令投影提供的结构化动作：全部动作都是带非空路径的 `read` 且至少两条时
准入；出现明确非读取动作时必须保持原 Shell 展示，不能用文本回退覆盖结构化反证。

结构化动作不可用时，只允许回退识别由引号外分号连接的 `sed -n '起始行,结束行p' <直接路径>`。整条命令
必须由至少两段这种读取组成；管道、重定向、变量展开、命令替换、反引号、换行分隔、`sed -i`、混入其他
命令、无法直接确定的路径或其他未覆盖语法都保持原 Shell 展示。分类只读取命令或可信结构化动作，不读取输出
内容，也不参与权限放行或安全判断。

展示路径按完整路径精确去重并保留首次出现顺序。同一文件的不同区间只列一次；不同路径的同名文件使用最短
可区分路径。只有一个不同文件时显示 `Read <文件名或可区分路径>`；多个文件时显示 `Read N files`，下面逐行
列出文件名。文件名沿用虚线底线预览入口。展开后继续显示原始完整命令和输出，状态与退出码仍属于整次
Activity；不拆分 Tool Call、Evidence 或步骤计数，也不增加逐文件状态或详情界面。

## Evidence 持久化与模型观察边界

流式正文、公开 thought 与 reasoning summary 继续按 v30 的独立消息块保存，delta 只服务实时展示。
原生 `userMessage` 的无正文 started/completed 生命周期不写 Execution Evidence；用户输入仍由 CampMessage
拥有。Migration 143 从精确 `v1.53/schema 93/activity-v3` 来源原子升级为
`v1.53/schema 94/activity-v3`：只删除同一 Canonical Command 已有后续 terminal
`activity.completed` 且包含 `aggregatedOutput` 时的历史 `command.output.delta`，并删除无正文、无 Blob、
未被 Canonical 或文件投影引用的 narration/reasoning 生命周期空壳。

schema 94 是后续 Migration 144 的精确来源；Migration 144 只发布 current schema 95 的命令结果存储兼容
边界，不再次清理 Evidence。该后续边界见 [Domain Command Result v1](domain-command-result-v1.md)。

迁移在删除前按原数组顺序修复受影响 Canonical `source_evidence_ids_json`，重算首末 Evidence sequence；
任何 Canonical 来源会变空、候选仍被文件投影引用，或删除后存在悬挂来源时整步回滚。Canonical revision
保持不变，因为本次只压缩支持证据载体，不重算语义结论。没有可靠 terminal aggregate 的 command delta、
完整正文/reasoning 块与真实工具开始/完成事实不得删除。迁移不执行 VACUUM，旧库空间回收与 Managed Blob
GC 是独立、显式运维动作。

运行模型观察只用于把 `runtime_default` 从未观察态收敛到首个可信模型。`model.source=explicit` 已由冻结
AgentRun 配置完整拥有，Adapter 启动结果或 `runtime.model.observed` 不提交 `runtime_model.observe`；Gateway
内的显式模型防御仍保留。默认模型观察继续使用原命令身份与幂等结果。

## 文件操作行

`runtimeFileOperation schemaVersion=2` 且 `operationKind=read` 的可靠单文件操作显示为不可展开的
`阅读 <文件名>`，使用阅读文件图标。可靠写入或 Diff 行使用笔图标：operation 或 Diff 明确
`changeKind=add` 显示
`新增 <文件名>`；`update`、path-only write 或无法可靠区分新增／编辑时显示 `编辑 <文件名>`。

动作词与文件名之间固定保留 5px 间距。文件名使用虚线底线按钮并保留完整路径的 title／可访问名称。点击只请求当前 Camp workspace 文件预览；
动作文字、图标与行内空白不可点击。写入行若有 Diff，最右侧独立按钮控制原有 Diff 展开，点击文件名不得切换
Diff，点击 Diff 箭头不得打开文件。缺少可靠路径时不生成文件链接；缺少 Diff 时不生成空展开入口。

文件打开成功后才提交预览导航。打开失败只在当前页面发出 danger Toast `无法打开该文件`，不创建、激活、
切换或替换预览 Tab，也不抢占焦点。

## 验收

- 终态组在成功、失败、停止、跳过和混合结果下都只显示 `完成了 x 个步骤`，并且右侧没有状态图形；
- 七种 Tool 子行状态在正常颜色和单色高对比模式下都能仅凭形状区分；
- 执行台队员项、头像角标、Run 时间线和单聊工具行与 Tool 子行使用同一状态图形；取消弧线在 reduced-motion
  下静止；
- Shell、Web、Built-in 和普通 Tool 详情共享 Shell 底色与左轴，原内容和 File Diff 保持不变；
- 四条纯 `sed -n` 涉及两个不同文件时仍是一个命令项并显示 `Read 2 files`；重复读取同一文件只列一次，
  同名不同路径可区分，混合或未支持语法保持原 Shell 展示；
- read 行不可展开；新增、编辑、path-only write 和无可靠 path／Diff 的回退符合上述规则；
- 文件名和 Diff 箭头可独立键盘操作，失败只产生红色 Toast 且不改变已有预览状态；
- 静态行无假 hover，取消等待不形成色条，底部执行台与 Inspector 复用同一 presentation。
- 历史终态 Command 的 delta 被压缩且 Canonical 来源顺序、首末 sequence 和 revision 正确；无终态部分输出、
  完整正文和真实工具事实保留，迁移失败不留下半更新；
- 新原生 `userMessage` 空壳不落库，显式模型不提交观察命令，`runtime_default` 首次观察行为不变。

## References

- [Run Process Detail Surface v30](run-process-detail-surface-v30.md)
- [Runtime File Change Observation v3](runtime-file-change-observation-v3.md)
- [File Preview v8](file-preview-v8.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
