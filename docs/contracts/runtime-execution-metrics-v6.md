---
document_type: contract
contract: runtime-execution-metrics
version: 6
status: accepted
source_version: v1.72
last_updated: 2026-10-03
---

# Runtime Execution Metrics v6

v6 继承 [v5](runtime-execution-metrics-v5.md)，替换 Claude Context 必须等整轮 result
且 used/window 同时齐全才采集的条件。读取协议、原生 Run 用量、布局、输入确认和绑定栅栏不变。

## Claude 运行中占用

当前 Session 的根 `message_start` 建立原生 message/model 身份并清空上一调用数值；
根 `message_delta.usage` 确认真实调用用量后，当该调用的 `input_tokens`、
`cache_read_input_tokens`、`cache_creation_input_tokens` 三项均为有效非负整数时，
其和形成最新 `usedTokens`。单项与和均须为 JavaScript 安全整数；缺失分类不补零。
起始暂定零、子 Agent、旧 Session 和整轮 result.usage 不能代替当前调用占用。

该私有 `runtime.context.observed` 数值事件在运行中立即进入现有 Gauge buffer，
`windowTokens` 为 null。经现有周期刷盘及输入确认、Run/epoch/Session/binding 栅栏落盘，
Renderer 沿用 used-only 展示：`xxk / —`、比例未知。它不承诺逐 token 同步的窗口占用。

整轮 result 到达时，仅匹配最近根调用**原生 model ID** 的
`modelUsage[modelId].contextWindow` 可与该调用 used 配对；没有匹配有效窗口时仍保留 used-only。
不得借用上一调用、旧配置或模型别名的窗口，也不得用累计 Run 用量、文本估算或比例反推 used。
used 大于同次有效窗口的矛盾观测不写入。

新观测整体替换旧观测，窗口未知时也清空旧窗口，避免跨模型拼接。失败/取消前已保存的有效
观测继续遵守现有 Session 生命周期。Context 不进入 Input、Output、Cache 或费用累计。
这条链路仅持有既有有界数值状态，不新增数据库迁移、轮询、正文持久化或输出测速。

## Runtime 时机边界

原生模型调用、整轮 Run 终态和输入确认是不同边界。对仍只在 prompt 返回时确认输入的 ACP
Runtime，提前收到的 Gauge 继续有界等待确认；不得为提前显示而放宽投递、恢复或旧 Session
隔离。ZCode 现有终态 session/read、Pi turn_end、Antigravity 已完成模型步骤的采样边界不变。
代码审计、原生字段样本与打包 App 验收分别记录，不能将一类 Runtime 的通过推广为全部支持。
