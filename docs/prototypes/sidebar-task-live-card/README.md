# 侧栏字重与 Task 实时卡交互稿

入口：[`index.html`](index.html)

这份原型只验证两项已确认的 Renderer refinement，不修改生产代码，也不连接 Core：

1. Project 与 Camp 的侧栏字重层级；
2. 同一个 Task 在创建位置读取当前快照并原地更新的五态呈现。

## 侧栏拟采用字阶

- Project：`12.5px / 560`，作为目录锚点；
- Camp：`12px / 400`；
- Selected Camp：`12px / 450`，不靠变黑变粗表达位置；
- 选中仍由中性底色与 `2px` Steel rail 主导。

右上角“对照当前字重”可在拟采用方案与当前生产值之间切换。

## 会话密度与状态点

- 同一项目内的会话改为连续 `28px` 行，不再额外叠加 `2px` 行间距；
- 项目组之间保留 `8px`，让组边界仍然比会话边界更清楚；
- 左侧保留 `8px` 状态槽位以维持标题对齐，但普通会话不绘制圆点；
- 圆点只在运行中、需处理或未读等真实状态出现。本稿仅给“可靠退出收口”的运行中状态显示蓝点。

## Task 实时卡状态

领域五态：`pending / in_progress / blocked / completed / cancelled`。工具栏中的“未分配变体”仍是
`pending + assigneeAgentId: null`，用于验证合法恢复变体，不创造第六种状态。

- `pending`：显示等待负责人开始；
- `in_progress`：只说明正在推进，不伪造验收条件完成进度；
- `blocked`：显示必需的 `blockedReason`；
- `completed`：显示必需的 `completionSummary`；
- `cancelled`：显示必需的 `cancelReason`，并与失败区分；
- terminal 状态明确不可再修改。

点击状态只是在同一张卡上切换 Read Side 快照，不代表任意状态转移合法。“播放”按钮使用合同允许的
`pending → in_progress → blocked → in_progress → completed` 路径。
