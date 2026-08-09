---
document_type: production-design
version: v0.51
authority: diagnostics-center-renderer-contract
status: frozen
implementation_status: complete
last_updated: 2026-08-09
---

# v0.51 诊断中心生产设计

本文以用户提供的“诊断与修复” HTML 为交互层级参考，只冻结进入生产的部分。现有设置侧栏、
Arctic Dawn Token、React 组件和 Core 权威边界优先；交互稿状态切换器不进生产。

## 1. 页头与状态顺序

共享设置页头固定为：

```text
Settings / Diagnostics

诊断与修复                    [运行完整自检] [导出诊断 JSON]
检查本地依赖、受管内容和 Agent 运行时，并为可安全处理的问题提供明确下一步。
```

页头后始终显示隐私边界，再按以下顺序显示：当前 Running/Recovery/结果通知、诊断摘要、需要处理
的问题、完整检查结果。不用大面积卡片墙，摘要是单一表面，问题和结果是带分隔的列表。

## 2. 三态摘要与问题

摘要必须同时显示“正常 / 需要处理 / 暂时无法确认”的数量，并用文字、稳定位置和图形表达，
不仅靠颜色。Partial 是合法成功读取：有 attention 或 unknown 时不写“全部正常”。

问题列表只投影 `attention`，每项固定包含：

1. 可读问题名称和安全修复/用户操作标签；
2. 原因与影响；
3. 默认收起的诊断详情，只显示状态代码、非敏感 facts、时间和证据说明；
4. 一个明确下一步。

`unknown` 不进问题列表，但必须在摘要和完整结果保留。问题为零时显示紧凑 Success Empty，同时说明
unknown 仍保留在完整结果。

## 3. 单项操作与复检

- Skill attention：“重新同步 Skill”；
- MCP permission attention：“修复文件权限”；malformed/非普通文件只“前往 MCP 设置”；
- Runtime attention：“前往 Agent 运行时”；Runtime unknown：“重新检测”；
- SQLite/数据问题：“导出诊断 JSON”。

点击会变更状态的单项操作后，所有页头操作和其他修复按钮进入 Disabled，当前行显示正在处理。只有复检
同 ID 返回 `ok` 才显示 Success，并使用新 Report 同步更新摘要、问题与全量列表。仍为 attention
或 unknown 时使用相应的诚实通知，不把 mutation completion 写成 repair success。

## 4. 完整结果与适配

筛选固定为“全部 / 需要处理 / 正常 / 暂时无法确认”，使用 `aria-pressed` 和明确文字。结果按
“本地依赖 / 受管内容 / Agent 运行时”稳定分组，每项可展开同一份诊断详情。

`1440×920` 下摘要主文案与三列计数并排；`1040×700` 下上下排列，问题操作和结果操作移到内容下方。
设置内容可纵向滚动，不得出现整页水平滚动。次级长文不小于 10.5px，所有按钮和 disclosure 至少
28px 可点击，遵循 `prefers-reduced-motion`。

## 5. 状态合同

| 状态 | 生产呈现 |
| --- | --- |
| Loading | 保留页头与隐私边界，显示读取指示，不触发修复 |
| Running | 保留最近报告，顶部明说“严格只读”，所有可冲突操作 Disabled |
| Partial | 正常渲染三态摘要、attention 问题和 unknown 全量结果 |
| Error | 首次无报告时显示局部 Error 和重试，不替换整个设置 Shell |
| Success | 完整自检或单项修复复检确认后显示持久的页内通知 |
| Disabled | 保留按钮文字/当前处理文字，不用不可见 overlay |
| Recovery | 保留最近成功 Report，标注时间、本次失败原因和“重新检查” |

## 6. 禁止项

- 不展示交互稿状态切换器、修复全部或自动修复开关；
- 不在屏幕或 v5 导出中显示绝对 Home、SQLite、Runtime、Skill entry 或项目路径；
- 不在问题列表中显示 unknown；
- 不因完整自检调用 Runtime discovery rescan、Runtime product check、Skill reconcile 或 MCP get/repair；
- 不新增 UI 框架、CSS-in-JS、图标库、动画库或独立状态库。
