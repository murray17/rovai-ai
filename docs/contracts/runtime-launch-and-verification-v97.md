---
document_type: contract
name: Runtime Launch and Verification
version: v97
status: accepted
source_version: v1.72
last_updated: 2026-11-16
---

# Runtime Launch and Verification v97

继承 [v96](runtime-launch-and-verification-v96.md)。Goose 目标模型参数查询不初始化无关扩展；
未保存模型／effort 覆盖时沿用原生 Session 的选择，不执行默认值恢复。

## 目标参数 Session

仅在 Goose 目标模型参数探测的现有 `session/new` 请求中增加 `_meta.enabledExtensions: []`，
与 `_meta.provider` 一起发送。使用官方 1.59.0 的显式空扩展选择，不继承内置、用户配置或插件的扩展。
模型及 effort 继续沿现有原生配置选项查询，完整模型目录仍不创建 Session。

正式业务 Session 不传这个空扩展字段；普通健康检查也保留原生扩展环境。
不增加配置副本、探测 Host 池、缓存、预检或重试。临时 Session 删除仍采用 v96 的 500 ms 尽力清理。
正式业务初始化遇到无响应 MCP 的原生限制不由此改变。

## 未覆盖的含义

清除模型或 effort 覆盖只删除 Rovai 对应的配置值，不代表恢复某个全局默认值。
新 Session 使用原生初始选择；已有 Session 可保留当前选择。显式值仍按现有原生 setter 应用。
界面沿现有控件准确表达该意图，具体文案由[队员配置页](../ui/components/member-identity.md#队员配置页)拥有。
不保存默认值快照，也不为清空覆盖增加原生重置、参数查询或状态。

## 验证

沿既有 health owner 区分目标查询的空扩展和普通健康检查的继承；live-model owner 验正式创建不关闭工具。
官方二进制对照确认失联原生 MCP 实际启动并阻塞普通创建，而空扩展查询返回真实 effort、工具为空、零模型生成。
实际 Core 参数查询在配置了失联 MCP 时仍成功，且不启动该 MCP；正式工具及既有故障验收保留。
原控件验证清空覆盖、保存值、两处入口及模型摘要，不用新文案改变执行语义。
