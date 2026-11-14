# 长会话输入性能对照

在仓库根目录运行 `node scripts/benchmark-thread-input.mjs <绝对输出目录>`。
这是生产组件的离线自动验收：Vite production/minify、1440×920，固定混合消息，20/200/1,000 条，
静止/当前 Run 更新/其他 Thread 更新，默认每场景三轮、每轮 80 次普通键盘输入。
每条消息复用固定的文字／列表／表格／代码内容，用户与队员交替；命令步骤另设独立场景。
独立进程、临时 profile；不启动 Core、Runtime 或访问日常数据。

`ROVAI_PERF_SURFACE=desktop` 使用 Electron；默认使用独立 Chrome headless。
二者都只验证 Renderer 组件与执行事件接入，不等同于完整 App/Host/网络延迟验收。
Electron 使用隐藏的隔离窗口与 focus emulation；该数字也不等于真实操作系统窗口的像素呈现延迟。
Fixture 按生产 BusinessApp 是否仍持有执行正文状态选择同语义的事件接入代理；消息组件直接来自当前源码。
事件在 Node 进程按固定时间轴每 32ms 注入，按键间隔 100ms，不等待上一次渲染再继续注入；结果保存实际事件延迟。
这不是生产事件频率的断言。
每场景加载后等待 700ms，先输入一个 `x`，再等待 500ms 才重置计数并采样；输入分位数描述连续输入，
不包含首次空转非空与历史初次挂载。`setup` 单独保留包含上述预热的渲染／解析计数与长任务，不能当作纯加载耗时。

结果区分组件执行、历史项 JSX 创建、react-markdown 实际解析、DOM 挂载和长任务。
输入主指标为 [Event Timing](https://www.w3.org/TR/event-timing/) 的 keydown 到后续渲染完成，
8ms 取整，16ms 以下标为截断值；同时保留输入延迟、处理时间及另一项“rAF 后 task”近似指标。
后者不能当作已呈现文字。`ROVAI_PERF_TRACE=1` 为首轮 1,000 条当前 Run 场景保存带截图的
[Performance 时间线](https://developer.chrome.com/docs/devtools/performance/reference/)，用于核对渲染/呈现延迟。

`ROVAI_PERF_COUNTS`、`ROVAI_PERF_LOADS`、`ROVAI_PERF_ROUNDS`、`ROVAI_PERF_SAMPLES` 可缩小检查范围。
`ROVAI_PERF_CONTENT=long-reply` 在末条消息放入 150 份相同混合 Markdown；`tool-steps` 放入 1,000 个
已完成命令步骤并打开对应 Run 的生产分页执行窗口，确认实际 DOM 窗口与活动尾部更新；夹具只提供相同协议的固定
page/changes 事实，不将完整工具记录作为 Renderer props。默认 `mixed` 的基准样本保持不变。
不同内容场景分别报告，不与默认样本混算。旧完整快照诊断结果不能充当分页窗口的性能验收。
`ROVAI_PERF_REPLY_ARRIVAL=1` 在输入中点发布一条新的大回复，用于区分大正文初次呈现与稳定内容更新成本。
输出记录设备、浏览器、源码提交、样本数与逐轮原始样本；小样本 p99 只作观察，不声称稳定尾延迟。
真实操作系统中文 IME 必须另行验收；CDP 字符注入或合成 composition 事件不能替代该结论。
