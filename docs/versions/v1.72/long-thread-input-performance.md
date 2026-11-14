---
document_type: implementation-plan
version: v1.72
authority: version-implementation-and-acceptance
status: in_progress
last_updated: 2026-11-14
---

# 长会话输入性能实施与验收

目标是长会话中保持即时输入，稳定历史不随纯执行增量重复构建。按 User 确认的顺序独立交付执行隔离、
公共历史虚拟化，以及仅在复测仍有瓶颈时实施的大内容优化。复用现有执行协议、存储与读取接口。

- Work item：长会话输入反馈；Owner：爱丽丝。
- Worktree：`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-long-thread-input`。
- Branch：`rovai/long-thread-input`；Base：`origin/main@a283eb05213fec5734f1d0b0e3096c0f2c4a40f6`。
- Governance：none；Renderer 内可逆的局部订阅调整，不涉及模型上下文、数据迁移或协议；同一变更更新当前架构和 UI。
  不满足版本决定的高变更成本准入条件，不新增决定。
- Status：active；第一批完成隔离与三轮生产组件对照（PR #1092），第二批在独立分支验证公共历史虚拟化。

## 固定基线

基准脚本与样本固定于 `929cf64602f93c1056161f00096b327c9e314aae`，使用
[`benchmark-thread-input.mjs`](../../../scripts/benchmark-thread-input.mjs)。
[运行与测量口径](../../../scripts/fixtures/run-presence/PERFORMANCE.md)说明独立浏览器、生产构建、固定负载、
Event Timing 的 8ms 精度／16ms 截断、近似指标与真实系统 IME 的区别。

Web Chrome 生产组件基线：20/200/1,000 条混合历史 × 静止／当前 Run／其他 Thread × 三轮，
每轮 80 次输入、按键间隔 100ms、执行事件间隔 32ms，由浏览器外固定时间轴注入。
1,000 条当前 Run 三轮 Event Timing p95 为 160/176/88ms，p99 为 208/192/168ms；
工作区执行 109/115/150 次，历史项 JSX 创建 109,109/115,115/150,150 次，Markdown 解析均为 0。
因此本轮证据指向工作区／历史构建与布局，不将组件重新执行等同于 Markdown 重新解析。

原始结果与首轮校准 trace 保存在本次 Thread 的附件输出目录 `perf-baseline-web/`。
20 条 idle 首轮与一次短 Desktop 探针重叠，不用于性能比较；其余正式采样期间没有并行性能任务。
小样本 p99 是观察值，未证明稳定尾延迟；Chrome 组件结果不等同于 Web SSE／完整 App 端到端验收。

## 第一批：执行更新隔离

- `RunLiveEvents` 只按已订阅的 Thread/Run/epoch 接纳预览，复用原 32ms 合批与事件版本归并。
  有界尾部随最后一个订阅释放，正文不再积累进 BusinessApp；Core 与 ExecutionWindow 继续拥有完整记录和补读。
- 活动行、Run disclosure、启动状态与地图各自订阅实际运行；工作区普通消息数据不接收高频正文。
- 终态先 flush 已到达批次、停止当前 epoch 后继接纳；没有等待完整历史或新增终态协议。
- 第一轮 1,000 条 smoke：当前／其他 Run 的工作区执行、历史 JSX 创建、Markdown 解析均为 0，
  活动行确认更新，24 个输入字符全部保留。当前 Run Event Timing p95 为 40ms；该小样本仅验证实现方向。
- 已通过：`pnpm typecheck`；Run live events、原 buffer、事件归并及消息 Markdown 47 项定向 Vitest。
- 三轮正式对照：同一台 Apple M5 / macOS 25.6.0，1,000 条混合历史、当前 Run 每 32ms 更新，
  每轮 80 次按键。Web p95 从 160/176/88ms 降至 56/40/56ms；Desktop Electron 从
  88/88/88ms 降至 48/48/56ms。其他 Thread 更新时 Web p95 为 48/40/40ms，Desktop 为 48/48/48ms。
  修改后的 54 个 Web/Desktop 场景中工作区执行、历史 JSX 构建和 Markdown 解析均为 0，
  1,000 条历史仍全部挂载；上述 1,000 条当前／其他 Run 场景的主线程长任务均为 0。
  每个场景均验证字符全部保留和活动预览实际变化，原始数据为附件 `perf-isolation-web/`、
  `perf-isolation-desktop/`，基线为 `perf-baseline-web/`、`perf-baseline-desktop/`。
- 第一批满足执行更新隔离的结构验收；p95 偶有 56ms，尚未达到每轮均不高于 50ms 的拟定最终门槛。
  三轮各 80 个样本的 p99 只作观察，不声称稳定尾延迟。真实系统中文 IME 和完整 App/Host 端到端尚待验证。
- 已完成默认 Rust workspace（484 pass / 1 ignored）、TypeScript、文档门禁和 277 文件 Vitest。
  合入最新主线后 Vitest 为 3,286 pass / 2 skipped；Node gate 中既有 Cline 观测测试的宽泛
  敏感词正则误命中 `.999Z` 时间戳，单独重跑通过；远端 CI gate 通过。未更改 Cline 逻辑或弱化其断言。
- 38 个执行状态、六种视口及停止／重试／来源／详情交互通过；回复分栏拖动通过。
- 首次交互回归发现模型未记录入口的旧断言与当前主线不符，已按当前 UI 校正；回复定位在
  `929cf6460` 的未改动生产源码上同样于 `scroll-after-opening` 用例失败，单独记录，不宣称本批回归全通过。

## 后续批次

公共历史虚拟化必须保留动态高度、320px 同作者分组、阅读锚点、定位与真实可见来源确认；
overscan 不视作已读。消息数据与复制／导出保持数据驱动，焦点和原生选区保留项单独计量。
大内容优化只依据虚拟化后的主线程记录定位实施，不预先改变解析器、调度频率或执行协议。
