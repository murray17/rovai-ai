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
8ms 取整、16ms 报告阈值。缺失记录不会补成 0：只有观察器完整、eventCounts 与全部捕获按键一致、
事件可信、可见且编辑器有焦点、投递等待低于阈值、收集结束留足时间，并已有更晚事件完成的计时记录时，
才将缺失推断为小于 16ms 的区间；
其余保留 unknown，整组分位数为 null，另列已报告样本的统计。歧义或已占用的计时记录不能作截断推断。
同时保留输入延迟、处理时间及另一项“rAF 后 task”近似指标。
后者不能当作已呈现文字。`ROVAI_PERF_TRACE=1` 为首轮 1,000 条当前 Run 场景保存带截图的
[Performance 时间线](https://developer.chrome.com/docs/devtools/performance/reference/)，用于核对渲染/呈现延迟。

`ROVAI_PERF_COUNTS`、`ROVAI_PERF_LOADS`、`ROVAI_PERF_ROUNDS`、`ROVAI_PERF_SAMPLES` 可缩小检查范围。
`ROVAI_PERF_CONTENT=long-reply` 在末条消息放入 150 份相同混合 Markdown；`tool-steps` 放入 1,000 个
已完成命令步骤并打开对应 Run 的生产分页执行窗口，确认实际 DOM 窗口与活动尾部更新；夹具只提供相同协议的固定
page/changes 事实，不将完整工具记录作为 Renderer props。默认 `mixed` 的基准样本保持不变。
不同内容场景分别报告，不与默认样本混算。旧完整快照诊断结果不能充当分页窗口的性能验收。
`ROVAI_PERF_REPLY_ARRIVAL=1` 在输入中点发布一条新的大回复，用于区分大正文初次呈现与稳定内容更新成本。
输出记录设备、浏览器、源码提交、样本数与逐轮原始样本；小样本 p99 只作观察，不声称稳定尾延迟。
未提交的生产源码差异另记 SHA-256；每轮在断言前保存 raw，保留失败轮次。首个采样按键与回复到达前 100ms
至后 700ms 的窗口分别统计。这里的首个按键仍在预热之后，不能称为冷启动首次输入。
`ROVAI_PERF_NARRATION_CHARS=24000` 增加带序号的长执行文本，用于量化摘要的可见内容判断成本；
`markdownAdmissionMs` 与 react-markdown 正文解析分开报告。
`ROVAI_PERF_COLD_TRACE=1` 另存从页面导航开始的 trace，包含模块加载和编辑器可用前的工作。
`bodyMount`／`replyArrival` 的 `domReadyAt` 是完整正文 DOM 的可用时间，不是像素呈现；
单独的 `afterFrameTaskAt` 也只是近似测点。

大正文样本修订号为 `mixed-v2-separated-fences`：重复片段之间加入空行，并检查实际出现 150 个独立代码块。
此前相邻片段直接拼接，使关闭围栏与下一段文字连在同一行，实际更接近一段很长的代码块；
旧结果继续保留为该旧场景，不能充当 150 组混合正文的验收，也不与修正版混算。
真实操作系统中文 IME 必须另行验收；CDP 字符注入或合成 composition 事件不能替代该结论。

可见原生输入入口为 `node scripts/benchmark-native-ime.mjs <绝对输出目录>`：使用临时 userData，不启动 Core／Runtime。
系统已有拼音输入法下，先原生按一次 A 校准（该次含 65ms 明示人工处理延迟，不计入统计），再 Escape、Command+A、Backspace 开始一轮。
按 100ms 间隔、1ms 持键重复 `ceshi` + Space 30 次，共三轮；每轮保留 180 个按键、30 次提交、完整 60 字。
自动输入必须用原生按键；粘贴、CDP 输入或合成 composition 不符合此场景。关闭隔离窗口后，用
`node scripts/benchmark-native-ime.mjs --analyze <输出目录> --rounds 1,2,3` 分析；若前面做了试采，明确指定正式轮次。
它报告组合期间的 DOM keydown Event Timing，保留 8ms 取整／16ms 截断；候选浮层和物理键盘到像素延迟不在该指标内。
该旧入口默认在 Main 内存缓冲、正常退出时统一落盘；`ROVAI_NATIVE_LOG_MODE=sync` 仅用于与旧的逐事件写盘作对照。
改变采集方式不构成产品性能改善的证据。

## 完整可见 App 的原生对照

按[隔离运行流程](../../../docs/development/local-workflow.md)先构建独立打包产物；不要运行日常数据。

```bash
ROVAI_PERF_APP_PATH='<独立打包 .app 的绝对路径>' node scripts/benchmark-native-app.mjs '<绝对输出目录>' minimal
```

入口先打印本次临时 userData、managed-skill-library、工作树身份和实际 Renderer／Main／Host 二进制摘要。
工作树 SHA 不能代替已有 App 的构建证明；对照时保留对应 package build 日志和二进制摘要。
数据为离线种入的 20／1,000 条合成消息，种入前停止 seed Core，并同步 Thread 消息序号游标。
完整场景通过真实 App、Host、生产执行准入和本地可控 ACP 流经过事件链路；没有调用真实模型或外部账号。

stdin 每次输入一条 JSON：

```json
{"op":"case","name":"short"}
{"op":"case","name":"long-idle"}
{"op":"case","name":"current"}
{"op":"case","name":"other"}
{"op":"case","name":"both"}
{"op":"save","label":"current-3rounds","rounds":[1,2,3],"repetitions":30}
{"op":"quit"}
```

`minimal` 只挂载生产输入组件及插件；其他场景使用完整可见 App。每个 case 重置采样轮次。
同一设备、窗口和系统简体拼音下，每轮 Escape、Command+A、Backspace，再按原生键输入 30 次 ceshi+Space；
每键 1ms、间隔 100ms。先核对 30 次“测试”提交与最终 60 字，再接受统计。普通输入使用 Latin 输入源，
每轮重复 a，save 时增加 `"kind":"plain"`；检测到 composition 的轮次不能作为普通输入。
Renderer 仅在内存记录，save／切换／正常退出时写盘。保存期间检查真实后台 Run 确实在输入窗口内产生事件，
并报告观察到的速率；配置的 32ms 只是夹具上游间隔。

`trace-start`／`trace-stop` 可保存包含 Renderer、input、latencyInfo 与 compositor 的诊断时间线；
采集 trace 或 CPU profile 的轮次单独标注，不与无诊断开销的正式分位数混算。
夹具保留每轮原始日志、未匹配／截断数量、主线程长任务及失败轮次；未完成的必测场景不能由组件测试代替。
