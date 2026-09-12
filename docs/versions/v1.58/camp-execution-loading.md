---
document_type: implementation-record
version: v1.58
status: implemented
last_updated: 2026-09-12
---

# Camp 执行窗口性能

用户要求取消执行展示中的脱敏，并选择“按需分页＋相邻页预取”。本次工作基于 main 的
`afd01d1010639a99ad4862774d1d17c03e1dd19b`，使用独立 `rovai/camp-execution-loading` worktree。

## 原因与实施

初次采样的目标 Camp 包含 1,155 条活动 Run Evidence，属于持久事件数；其中正文 block 27、reasoning
block 325、393 次操作的开始/完成各 393、Core action 8、compaction 9。它们归并后是 429 个展示项，
不能将原始行数等同于可见步骤数。该样本没有旧版大量 `command.output.delta` 回归。

首屏投影约 4.44 MB，执行 Evidence 占约 96%。Canonical 关联查询逐 Evidence 扫描整轮来源数组；
Renderer 又对整轮命令与输出做重复格式化、敏感值扫描。18,743 个 DOM 节点中，关闭的工具组内部占
16,403 个，包括并未展开的文件 Diff。数据传输、全轮计算与隐藏 DOM 都有可以移出的工作。

- Open schema 7 只带业务摘要和 Evidence coverage；执行详情使用 `agentRunExecution.page`。
- 逻辑操作 cursor 合并开始/完成，最新页补充仍活动的操作；完整历史保留按需访问。
- 初始一页加相邻预取，最多两页展示加一页缓存；保持阅读锚点、同方向重试和切换 generation。
- Canonical 来源一次展开索引关联，关闭工具组不挂载子行，Diff 只在单条展开后解析和读取。
- 移除执行内容的敏感值检测、正文省略和结果替换；Desktop 不生成未使用的渠道 publicResult。

## 验证边界

Rust 扩展现有 Evidence 读取 owner，覆盖原始分页与展示分页并存、起止合并、跨 Camp 拒绝、活动操作补充
及跨页 CLI 关联。前端测试覆盖有界缓存、相邻预取、翻页失败、迟到响应和展示原值。
生产 Run 组件的 Electron 夹具验证两种主题、底部与 440px Inspector、锚点保持以及按条读取命令输出和 Diff；
独立 userData，不运行 Core、SQLite、Skill Library 或 Runtime。

性能对照以只读数据库快照及生产 Renderer 重放测量，区分 Core 读取、首屏业务绘制与执行窗口绘制；
历史初次样本和当前固定样本分别记录，不能将运行期间记录数变化当作优化收益。
固定快照保留了 617 条当前活动 Run Evidence，前后都读取同一份快照。11 次 Core 读取取首轮之外的中位数：

| 指标 | 原路径 | 执行窗口路径 |
| --- | ---: | ---: |
| Camp Open | 124.01 ms | 2.35 ms |
| Open 响应 | 1,997,591 B | 183,341 B |
| 首个执行窗口 | 包含在 Open 中 | 24 项，39,140 B，8.58 ms |
| 相邻页预取 | 无独立窗口 | 7.33 ms |
| Renderer 初始 DOM | 8,565 | 1,819 |
| Renderer 预热绘制中位数 | 186.15 ms | 82.70 ms |

Renderer 使用生产 CampWorkspace、适配器与 CSS，1440×920 隔离 Electron，前后各五次切入，去除首次取中位数。
新路径的绘制时间包括首个执行窗口到达后的绘制，恰好两次窗口请求，没有初始工具结果读取。
这不是已安装 App 的端到端切换时延；Core 与 Renderer 分开测量，机器其他负载会影响帧时间。
初次 1,155 行样本与固定 617 行样本属于不同采样时刻，不能直接跨样本计算提升。

本机诊断记录位于 `/tmp/rovai-camp-diag-20260912`，原始内容仅留在本机私有目录，不纳入仓库。
严格 Clippy、桌面构建和 diff-aware 文档门禁已通过；Rust 基础 553 项、CLI 35 项、数据库集成 309 项已验证，
staged 路由的 workspace 验证另覆盖 Core Main 237 项（6 项既有忽略）。合并主线前 `VITEST_MAX_WORKERS=1 pnpm test` 已通过：176 个 Vitest 文件、1,802 项测试；脚本测试 317 项通过、2 项既有平台跳过。
默认并行执行曾触发已有 Supervisor/Evaluation 测试的短时轮询超时；单独复跑 35 项通过，随后完整单 worker 门禁通过，未修改这些既有测试。
最终 Electron 的正文 Blob 重试和执行窗口两项均通过；窗口测试包括屏幕外延迟读取、键盘焦点、跨组边界保留已展开结果、
不重复读取保留结果，以及 Day/Night 两个真实主题。Impeccable detector 执行一次，38 项均为既有 CSS 提示，新增样式行没有命中。

合并主线 `f30024ae76bdeb3534e10a56d0da6a6a8bd56e13` 后再次通过类型检查、严格 Clippy、桌面构建、文档门禁与完整 `pnpm test`：175 个 Vitest 文件、1,794 项测试及 317 项脚本测试。测试数量变化来自主线待发送消息功能的既有测试收口。三项 Electron 验收同时覆盖执行窗口、正文 Blob 和主线待发送消息退回输入框；两个 Rust 退回输入框 owner 与执行分页 owner 定向复跑通过。

## 权威与影响

[Camp Open v18](../../contracts/camp-open-projection-v18.md)、[Run Process v33](../../contracts/run-process-detail-surface-v33.md)、
[Camp Open Architecture](../../architecture/camp-open-read-path.md)、会话 UI 和 CURRENT 同步更新。
无需数据库迁移、历史数据清理、模型上下文变化、Runtime classifier 变化或版本指针变更。
旧数据曾被省略的字段不会反推；展示字段白名单、大小预算和 Built-in 输入用途继续保留。
