---
document_type: contract
name: Runtime Launch and Verification
version: v93
status: accepted
source_version: v1.72
last_updated: 2026-11-14
---

# Runtime Launch and Verification v93

继承 [v92](runtime-launch-and-verification-v92.md)，替换其中 Goose 的原生默认刷新要求。
`runtime_default` 表示 Rovai 不设置 Provider、model 或 effort，不要求每轮重新采用全局原生默认。

## Goose 保留原生会话选择

新 Session 由 Goose 按原生配置初始化；Warm 及精确冷恢复沿用原生 Session 当前保存的选择。
撤销 Rovai 的显式模型覆盖后，也不发送 `provider=goose` 或重设模型／effort。
外部默认配置变化不触发 Rovai 的逐轮刷新；不增加来源标记、状态缓存、文件扫描或监听。

显式选择仍按既有 Provider/model 路由和原生 option setter 生效。
已确认同值时省略设置，不同或未知时设置并消费最新回显；不再为默认别名保留额外例外。
原生 mode、System 投递、Session 历史、Steer、MCP、用量、目录与目标参数查询不变。

## 验证边界

沿既有 live-model owner 验证：新 Session 原生默认零重设、Warm 连续默认零模型 setter、
取消显式覆盖后保留原生选择，以及后续显式改选仍生效。
官方 Goose 的 Core smoke 必须分别确认 Warm 与精确冷恢复使用 Session 已保存的模型和 effort，
即使其不同于全局原生默认；不能只验证请求成功或冷恢复 Session ID 相同。
原 v92 中“清除覆盖就恢复全局默认”的断言随对应产品行为退出，不删除其他恢复、MCP 或取消场景。

本次不提升 Preview 或平台资格。
