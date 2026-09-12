---
document_type: protocol-contract
contract: run-process-detail-surface-v33
authority: execution-window-and-unredacted-presentation
status: accepted
version: 33
source_version: v1.58
last_updated: 2026-09-12
---

# Run Process Detail Surface v33

继承 [v32](run-process-detail-surface-v32.md) 的 CLI 显示名称、操作身份、四轨 Tool 行、
文件入口与键盘交互。本版替换全量 non-terminal Evidence 读取、收起组的 DOM 挂载和执行内容脱敏规则。

## 执行内容

执行展示中的正文、命令与工具结果按原值呈现；取消命令凭据识别、敏感参数替换、跨整轮收集 secret 后扫描结果、
Send/Gather Shell 正文与静态 stdin 输入省略，以及基于 JSON、patch、base64 或敏感值的结果隐藏。
Core Built-in 语义输入、语义结果不再因敏感值检测而省略或生成隐藏标记。历史已省略的字段无法由显示层恢复。

此规则用于共享执行标题、命令和工具结果，包括 Desktop、本地只读执行视图和使用该共享投影的渠道卡片。
ANSI/控制字符整理、单行格式、结果类型投影、字段白名单、字符/字节/行数预算继续服务展示；它们不是敏感内容
脱敏。不改变 API 身份校验、授权、模型上下文或独立诊断导出规则。

Built-in 与 Shell 沿用 v32 的严格关联与去重，只保留 Core Tool 行。可确认唯一关联时，该行复用已经保存的
Shell command 和 output：标题展示完整命令的单行预览，仅由 CSS 按宽度省略；展开后显示 `$ ` 加完整命令，
下一行连续显示原始 JSON／文本输出。保留正文参数、引号和多行输入，不做内容脱敏或固定字符截断。
`--input-file`、变量和 heredoc 只呈现实际命令，不读取文件补造入参，也不还原变量展开后的 JSON。

分页摘要可复用 Core 已验证的载体标记，但仍须同一 Run、同一 operation、严格嵌套的证据范围及唯一对应，
才能借用当前已载入 Shell 的详情。不确定、跨页缺少载体或没有关联时保留既有 `canonicalInput` 回退：
省略投影辅助事实和由消息面拥有的 Send/Gather 正文；没有可展示字段时为静态行，不借用别次调用的输出。
完整输出沿用关联 Shell 的 Evidence ID 和既有按条惰性读取，不创建新入参存储、字段、表或 Blob 副本。
Core 操作 ID、状态与图标保持不变；关联仅选择展示内容，不改变权限、重放或测量身份。

Desktop 执行台不创建未使用的渠道 `publicResult`；其工具输出在单条展开时读取。渠道卡片继续采用各自输出
预算和渲染类型，但不再对已选定的文本运行内容脱敏。

## 按窗口阅读与 DOM

Camp 执行台与 Inspector 共用 [Camp Open v18](camp-open-projection-v18.md) 的按需分页和相邻页预取。
最新窗口、运行中操作补充、已载入较早页与未读取历史有明确边界；不把一页的步骤数表示成整个 Run 总数。
窗口中的已完成工具组显示“已载入 N 项执行记录”，活动状态及单条操作状态保持原规则。
非分页完整组收口后显示“已完成 N 个步骤”，N 只统计成功的可见逻辑操作；失败、停止、跳过、结果未知
分别显示数量，不计为成功。一次已关联的 Built-in/Shell 调用只计一步；started/result/delta、多文件展示行
不额外计数，独立调用仍分别计数。运行中和等待审批保持现有活动摘要，不提前计作完成。

收起的工具组只挂载 summary，展开后才挂载子行。文件 Diff 只在对应文件行展开后读取与解析；普通工具结果
继续按条展开读取、失败重试。组跨页时按稳定操作身份保留展开意图，翻页保留阅读锚点。关闭 Run 后卸载详情，
重新打开从最新窗口读取；此预算替换旧版无限保留已激活详情的要求。

本次不更换视觉体系：28px 工具行、原生 disclosure、状态图形、文件预览按钮、底部和 Inspector 的独立滚动
继续使用现有组件与主题 token。

## Evidence 持久化与模型观察边界

继续采用 [v31 的持久化与模型观察条款](run-process-detail-surface-v31.md#evidence-持久化与模型观察边界)。
取消展示脱敏不删除历史 Evidence，也不改变原始分页、Blob、操作身份、Context Delivery 或 Runtime classifier。
分页合并仅是读取投影；一条展示操作可关联多条原始 Evidence，原始行数仍可追溯。

## 验收

- Camp 首屏没有执行正文；只有可见展开的 Run 请求一页及相邻预取页，预取不递归；
- 开始/完成不跨页拆散，运行中操作不因较早而消失，CLI 关联跨页仍可证明，错误目标与迟到响应被拒绝；
- 翻页和失败重试保留阅读位置，后台刷新不抢历史位置，回到最新恢复读取；
- 关闭的工具组无子行 DOM，展开组不读取所有结果，展开单条工具或 Diff 才读取其完整内容；
- 测试凭据、Shell 消息正文、JSON/patch 结果保留原值；展示预算和类型边界仍成立；
- 已去重 Built-in 行保留完整命令与对应输出；展开前不读取结果，失败重试仍请求同一 Shell Evidence；
- 混合、重复和不确定载体不误关联；成功、失败、停止和分页数量口径不混淆；
- Day/Night、底部与 Inspector 复用相同交互，原始历史和完整内容仍可按需访问。
