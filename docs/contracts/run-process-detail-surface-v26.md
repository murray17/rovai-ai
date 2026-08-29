---
document_type: contract
contract: run-process-detail-surface-v26
authority: runtime-activity-web-search-detail-layout
status: accepted
source_version: v1.29
last_updated: 2026-08-30
---

# Run Process Detail Surface v26（Web 搜索与结果连续呈现）

本合同完整继承 [Run Process Detail Surface v25](run-process-detail-surface-v25.md) 的 Shell `$ command` 连续结果、
主题专属结果面与左侧对齐，并继承 [v24](run-process-detail-surface-v24.md) 的 `activity-v2` 分类、七类图标和 typed
Search Operation。v26 只收敛 Web 搜索 disclosure 的文本格式；不改变 typed query 准入、Evidence 白名单、
Canonical Activity、operation identity、lifecycle、outcome、Tool 分组或其他 Tool detail。

## 1. Web 搜索与结果格式

只有 available `runtimeSearchOperation` 与 Canonical `tool.web.search` 同时成立时，Renderer 才生成搜索首行：

- 第一行固定为 `搜索 ` 紧接 typed query；多项 query 继续按原始顺序使用中文逗号连接；
- 存在非空公开结果时，从下一行立即连续显示完整结果；
- query 与结果之间不插入空白行，也不显示“搜索词”或“结果”标签；
- 没有公开结果，或公开 input 与同一 query 完全相同时，只显示搜索首行，不重复 query；
- 缺失或不合格 typed projection 时不生成 `搜索 ` 首行，继续诚实显示已有公开结果或空态；
- “搜索”只属于 Renderer presentation，不进入 Evidence、不改变 query bytes，也不参与 identity 或恢复。

规范示例：

```text
搜索 Codex command view
找到 3 条结果
```

## 2. 结果面与交互

Web 搜索继续作为普通 Web Tool 使用现有非 Shell 结果面和缩进；它不消费 Shell 专属
`--shell-result-canvas`，也不移动到 Terminal 图标左边界。底部与 Inspector 复用相同 DOM、两级 disclosure、
惰性全文读取、内部滚动、loading/retry、焦点和键盘行为。

## 3. 验收

- typed query 为 `Rovai AI`、结果为 `找到 3 条结果` 时，详情精确为
  `搜索 Rovai AI\n找到 3 条结果`；
- 多项 query 以中文逗号连接在同一 `搜索 ` 首行；没有结果时只显示该首行；
- malformed/unavailable typed projection 不显示 query prefix，不泄露任意顶层 `query` 或私有 input；
- Codex webSearch、Claude WebSearch、ACP web_search 与完整 Evidence 恢复路径使用同一 formatter；
- v25 Shell 文本、Shell canvas/对齐、Web 图标、Tool 分组和 query fail-closed 回归继续通过。

## References

- [Run Process Detail Surface v25](run-process-detail-surface-v25.md)
- [Run Process Detail Surface v24](run-process-detail-surface-v24.md)
- [Runtime Activity Mapping Registry](../runtime-activity/registry.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
