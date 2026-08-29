---
document_type: contract
contract: run-process-detail-surface-v24
authority: runtime-activity-classification-presentation-and-icons
status: accepted
source_version: v1.29
last_updated: 2026-08-29
---

# Run Process Detail Surface v24（活动分类、中文呈现与图标收敛）

本合同完整继承 [Run Process Detail Surface v23](run-process-detail-surface-v23.md) 的连续 Tool 分组、
live-tail、两级 disclosure、惰性全文读取、执行台位置和四轨布局。v24 只收敛 Canonical Activity 的新写入
分类、Renderer 中文标题、类型图标与公开搜索词；不改变 operation identity、lifecycle、outcome、状态点、
Tool 分组或 Run lifecycle。

## 1. `activity-v2` 分类与版本切换

新 operation 使用 `activity-v2`，顶层 `activityDomain` 只产生 `shell | file | tool | runtime | unknown`。
搜索语义按结构化 kind 明确区分：`file_search → file.search`、`web_search → tool.web.search`、
`search → tool.search`。Claude Code 的 `Grep` 映射为 `file_search`，`WebSearch` 映射为 `web_search`；
Antigravity 的 `grep_search | search | search_web` 使用相同三分法，并兼容既有 `web_search` 别名。标题、命令正文、Runtime 名称与 provider
名称都不能参与分类。

Migration 116 只把当前 Data Contract 切换为 `v1.29 / projection schema 70 / activity-v2`，不扫描、删除、
回填或重新分类任何历史 Canonical row。已经存在 `activity-v1` projection 的 operation 必须继续用 v1
完成后续 phase；没有既有 projection 的 operation 才建立 v2。Read Side 同时读取 v2 与 v1，同一 Evidence
意外存在两版时优先 v2。历史行缺少新公开字段时诚实留空。

## 2. Renderer 拥有中文标题

Core v2 只保留 Runtime 明确报告的 `title` 作为 `presentationHint`，不再生成中文默认标题、Codex
`commandActions` 中文标题或文件 basename 标题。Renderer 按下列顺序生成当前展示：

- Shell：优先公开 command 的完整安全预览；其次非通用 Runtime title、非通用 toolName；最后“终端操作”。
  字面命令 `rovai ...` 仍是 Shell Activity，不能因为命令文本换成 Rovai 图标；
- File：可靠 `runtimeFileOperation.status=available` 的 path，或单文件 available Canonical Diff 的 path，显示
  `修改 <basename>`；否则依次使用 toolName、Runtime title、“文件操作”；
- `tool.web.search`：固定显示“Web 搜索”；其他 Tool 依次使用 canonical toolName、Runtime title、“工具调用”；
- Runtime：Runtime title 或“Agent 运行”；其他/未知历史域：Runtime title 或“系统活动”。

同一 Renderer 规则同时作用于 live 与历史 Evidence；它只改变呈现，不改写持久 Canonical 事实。

## 3. 七类类型图标

Tool 行继续使用统一 16px、`currentColor`、单色 SVG 和既有四轨布局，只保留
`terminal | file | web | tool | rovai | runtime | unknown` 七类类型图标。状态仍由行尾 7px 状态点独立表达。

`rovai` 图标是四向星与弧形地平线，使用 `--rail-logo` 色；它只在 Canonical Activity 同时满足
`activityDomain=tool`、`sourceAuthority=core`、`credibility=core_verified` 且存在经 Catalog 验证的
`toolName` 时出现。`tool.web.search` 优先使用 Web 图标。任何 display title、Tool 文案或 Shell command
都不能证明 Rovai identity。

## 4. 公开搜索词

从 v24 部署后，搜索词只通过 Core-owned `runtimeSearchOperation` typed projection 进入新 Evidence：
`schemaVersion=1 + source=runtime_reported + status=available + searchKind=web + query`。单项 projection 的
`query` 是该字符串；多项 projection 的 `query` 仍保存第一项，并额外保存有序 `queries` 数组，使既有只读方可继续
读取第一项。顶层通用
`payload.query` 与 `item.query` 都不属于公开 Evidence 白名单；Adapter 只能先形成内部 candidate，再由 Core 使用
冻结的 Adapter identity、协议事件和必要的已验证 Runtime 版本准入。

明确协议身份允许 Codex `item/started | item/completed` 的 `item.type=webSearch + item.query`、Claude
`assistant.tool_use.WebSearch` 及其 matching `user.tool_result` 的 `input.query`，以及 ACP effective kind 精确为
`web_search` 的 `rawInput.query`。当前实测的模糊 ACP wire 只在以下冻结组合下允许：Copilot `1.0.79`、Qoder
`1.1.28`、Kiro `2.18.1` 的 `kind=search + rawInput={query}`，以及 CodeBuddy `2.133.1` terminal
`kind=fetch + rawInput={query}`；`{query}` 必须是唯一字段。版本缺失、版本改变、相邻字段出现或 tuple 不匹配时，
candidate 以 unavailable 结算且不保存 query，原始 `search/fetch` 也不升级成 Web 搜索。稀疏 terminal update
可以从同 ToolCall 的当前 Prompt 观察继承 candidate。Antigravity `1.1.22` 的 Web 工具事件是
`step_update + step_type=tool + tool_name=search_web`，只获得 Web semantic，不从私有 parameters 或文本猜 query。

已准入来源的 `query` 可以是一个非空字符串，或非空、元素全部为非空字符串的数组；数组为空、包含空字符串或
非字符串元素时整体 fail closed。每项按用户实际输入原样保存，不做敏感词识别、关键词过滤、去重或内容替换；
相邻未准入字段仍不进入公开 Evidence。Renderer 只有在 projection available 且 Canonical Activity 同时为
`tool.web.search` 时，才在展开详情第一行直接显示 query，不增加“搜索词”标签；多项按原顺序使用中文逗号连接，
存在公开结果时再显示“结果”。只含旧 `query` 的 projection 继续显示单项；历史 Evidence 不回填，缺失 typed
projection 时不显示空占位。Web 搜索仍是普通 Tool item，必须计入其所在连续 Tool 组的“已执行 N 项操作”，组内
展开行继续使用 Web 图标与上述详情。

## 5. 验收

- `web_search`、`search`、`file_search` 分别得到 `tool.web.search`、`tool.search`、`file.search`；
- Claude `Grep` 使用 File 图标，Claude `WebSearch` 使用 Web 图标；搜索词 started→terminal 保持精确一致；
- 单项 query 在详情第一行直接显示且没有“搜索词”标签；多项 query 按顺序用中文逗号连接，`query` 保持首项；
- Web 搜索与相邻 Tool 一起计入“已执行 N 项操作”，展开后仍使用 Web 图标；
- Core Catalog 验证的 `camp.read` 使用 Rovai 图标，字面 Shell `rovai camp read ...` 使用 Terminal 图标；
- 可靠 file-operation path 显示 `修改 <basename>`，没有可靠 path 时不从 output 或标题猜路径；
- `activity-v1` 历史仍可读取，Migration 116 前后的旧 row bytes 不被重写，新 operation 使用 v2；
- 七类图标在 Day/Night、底部/Inspector 与 hover/focus 下保持 `currentColor` 和既有四轨尺寸；
- 搜索词包含 `password`、`token` 等普通字样时仍原样进入新 Evidence 与 disclosure，相邻私有字段不泄露。
- 普通 `database.execute/vector.lookup/dynamicToolCall.query`、ACP 文件搜索 `{pattern}` / `{path,pattern}` /
  `{output_mode,path,pattern}` 与未验证新版本都不能生成 available Web 搜索 projection。

## References

- [Run Process Detail Surface v23](run-process-detail-surface-v23.md)
- [Runtime Activity Mapping Registry](../runtime-activity/registry.md)
- [Evidence 与 Canonical Activity](../architecture/foundational-invariants.md#evidence-canonical-activity)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
