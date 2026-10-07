---
document_type: contract
name: Camp Member Fast
version: v2
status: accepted
source_version: v1.72
last_updated: 2026-10-05
---

# Camp Member Fast v2

继承 [v1](camp-member-fast-v1.md) 的三态偏好、绑定代次、精确资格、默认值、费用与执行观察边界。
本版替换自动检查与历史 Ready 依赖，服从 [Runtime Launch v47](runtime-launch-and-verification-v47.md)。

普通 Thread、执行台和队员列表只读已保存投影。未知资格显示“检查 Fast”主动按钮；点击才调用
`threads.members.fast.check`。打开/切换界面不发起检查，不重试失败，不轮询；两处共享在途状态和身份围栏。
检查失败说明默认响应模式仍可运行；显式再次点击可重试。成功后复用原 Fast 胶囊和保存命令。

检查直接读取所选 Installation，不先升级为 AvailabilityCheck，不要求 ready snapshot。
Claude 的明确订阅资格仍使用原生 auth/status；Fast 版本未知时允许此显式兼容性检查查询版本，失败仅令 Fast 资格未知。
Codex 使用当前原生 account/config/model 信息；每轮档位字段没有独立在线能力查询，只有主动 Fast 检查和显式覆盖
需要有界 schema 导出验证 `serviceTierForTurn`，不依赖冻结的历史 capabilities。普通执行不导出 schema。

新 Run 继续冻结偏好。只有覆盖非空才复核 Fast 资格；Claude 的 auth/status 与 Codex 的 schema 检查属于
该可选特性的最小兼容性例外，Codex account/config/model 使用真正执行的 Host。
没有覆盖时不启动 Fast 元数据进程、不拉取 Fast 模型目录、不把“未检查”写成不合格。
不合格仍按既有合同省略覆盖且保留用户意图；不创建通用 Ready 门槛或健康快照。
