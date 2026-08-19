---
document_type: renderer-contract
contract: run-process-detail-surface-v13
authority: agent-process-detail-placement-and-complete-tool-result-surface
status: accepted
last_updated: 2026-08-19
---

# Run Process Detail Surface v13（稳定执行台与完整 Tool 结果）

本合同完整继承 [Run Process Detail Surface v12](run-process-detail-surface-v12.md) 的 Agent 过程分组、
Run stage、Evidence chronology、Runtime failure、Recovery Blocker、planned shutdown、取消活动、
AgentRun 直接停止与实际 Runtime 模型语义。v13 只替代 v8 的超长 Tool 结果预览/复制
边界，并收紧执行台移动、指令行轨道、类型图标和队员入口。Core Evidence wire、
Camp open 投影与 Managed Blob 存储合同不变。

## 1. 单一执行台的稳定移动

底部与 Inspector 只能有一个 Renderer-owned ExecutionDrawer。位置切换必须移动同一个
已挂载 DOM 容器，不得通过条件分支卸载后重建 Drawer。移动前后必须保留：

- 当前 Agent 和精确 Run selection、已展开 Tool disclosure 及加载/错误状态；
- Drawer 外层与每个完整结果区域的阅读位置；容器尺寸变化时按可滚动范围比例恢复；
- 同一 Drawer 和结果节点的 DOM identity，避免移动导致读取位置、焦点返回目标或
  已读 Managed Blob 内容丢失。

位置切换控件仍按 v6/v12 取得焦点。隐藏 Inspector 不改变执行台位置或内部
读取状态。

## 2. 指令行与队员入口

每个 Tool 行使用相同四列：`16px 类型图标 / minmax(0, 1fr) 标题 / 16px 状态轨 /
20px disclosure 轨`。不可展开行仍保留隐藏的 disclosure 占位，不得让状态点因
内容长度或展开能力漂移。底部和 Inspector 复用同一行组件。

类型图标只取自 Shell、File、Git、Network、Permission、Runtime、Plan、Tool 和 Unknown
九个 `16 × 16` 单色线性 SVG。图标仅表达 Activity domain；运行状态继续由独立的
7px 小状态点、`aria-label` 与 `title` 表达，不把字符图标或状态文案混入指令名称。
Disclosure 使用原生 `<details>/<summary>` 名称计算；不得写入会随 open state 过期的
静态“展开/收起” `aria-label`。

每个队员入口只显示头像、最多两行名称和状态标记，不再显示“当前正在执行”等
可见状态文案。按钮保留包含队员和状态的 `aria-label`/`title`，状态标记保留自身
`aria-label`/`title`。除颜色外，运行为实心点加外环、等待为空心圆、完成为实心圆、
失败/停止为菱形、仅记录为短横；Forced Colors 下形状仍可分辨。

## 3. 完整 Tool 结果

用户展开精确 Tool 行后，该行必须在原位展示完整的公开结果，不再显示 10 行/
2,000 scalar 预览，不再提供 Tool 结果复制按钮，也不添加独立“查看完整工具调用”。

- 当 Renderer 已持有完整的公开结果时，disclosure 直接渲染全文；
- 当 Evidence 只有截断投影/Managed Blob 引用时，关闭行不读取全文；首次展开才以
  精确 `campId + evidenceId` 调用 `agentRunEvidence.getContent`；
- 全文仍只从 Built-in `result/error`、Runtime 公开 `output/input`、command output 或 file patch
  字段提取；Envelope wrapper、request/receipt、canonical input、digest、lease 和 IPC 字段不得进入 DOM；
- 读取中在原 disclosure 显示局部 loading；失败显示精确错误和原位“重试”，不混入部分
  结果；重试成功后焦点进入结果区域；
- 一旦用户显式展开并读取成功，全文可在当前 Drawer/Agent selection 会话内保持挂载，
  以保留 disclosure 和阅读位置；切换 Agent、关闭 Drawer 或卸载 workspace 后不持久化。

这是对 v8 “全文不进入 Drawer DOM”的显式局部替代；不改变 Camp open 有界投影、terminal
Evidence 分页或 Managed Blob 按需读取。无法关联 Canonical Tool identity 的截断 Evidence 仍保留在
Core，不以 standalone raw payload 绕过 Activity 边界。

## 4. 完整结果的滚动与键盘

完整结果使用具名、可聚焦的 `role=region`，文本全量渲染在固定最大高度内，超出后只在
该区域内垂直滚动。文本换行与 `overflow-wrap:anywhere` 必须防止 200% zoom、Inspector
紧凑宽度或长 token 制造页面级横向滚动。

结果区域必须支持 Arrow Up/Down、Page Up/Down、Space/Shift+Space、Home 和 End；
Escape 只把焦点返回对应 Tool `summary`，不关闭 Drawer。底部与 Inspector 使用相同的结果
组件、加载状态、滚动行为和焦点规则。

## 5. 验收

- 九类 Activity domain 均渲染同一 16px monoline SVG 家族，指令行均是四个稳定轨道；
- 不可展开行保留 disclosure 占位，可展开 summary 不挂过期的展开/收起名称；
- 队员入口只有头像、最多两行名称与非颜色形状状态，完整状态仍可由辅助技术读取；
- 8,000 行以上的 Managed Blob 结果只在展开后读取，首/中/末 marker 全部进入同一结果
  region，没有截断提示或复制按钮，也没有 Envelope 泄漏；
- 结果区域可用键盘滚动，Escape 返回 summary，读取失败可原位重试且成功后恢复焦点；
- 底部↔Inspector 移动前后 Drawer/结果 DOM identity、展开态、外层和结果阅读位置保持；
- Day/Night、Forced Colors、keyboard-only 与 200% zoom 下无页面级横向溢出。

## References

- [Run Process Detail Surface v12（历史）](run-process-detail-surface-v12.md)
- [Run Process Detail Surface v8（历史）](run-process-detail-surface-v8.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
- [Camp Open Projection v5](camp-open-projection-v5.md)
- [v1.15 决策记录](../versions/v1.15/decisions.md#v1-15-d02)
