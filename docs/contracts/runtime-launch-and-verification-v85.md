---
document_type: contract
name: Runtime Launch and Verification
version: v85
status: accepted
source_version: v1.72
last_updated: 2026-11-11
---

# Runtime Launch and Verification v85

继承 [v84](runtime-launch-and-verification-v84.md)，按 User sequence 75 将 Kilo 完整模型目录切换到官方 CLI。
本次只改变目录来源，不改变实际 Run 的 ACP、模型/effort 设置、Bootstrap、Formatter、Manifest、
Input Delivery Evidence、权限、MCP 或生命周期。

## Kilo 单次 CLI 目录

完整目录只调用选定官方安装的 `kilo models --verbose`，沿用 Runtime 环境和受管有界进程，
在临时工作目录加载 Kilo 自己的用户/环境配置。标准输出上限复用共享协议容量，不使用较小的诊断输出预算
截取完整目录。读取非零退出、截断、空目录或损坏格式失败，沿既有目录刷新失败/LKG 路径处理，
不回退 ACP 扫描，不将部分前缀写成完整成功。

逐条读取原生 ID 行和 JSON 对象，只投影模型 ID、名称与 `variants` 键名；不保存完整模型元数据。
模型 ID 保留完整 Provider 路由，不按斜杠或模型后缀合并。每个模型的非空 variants 映射为原生 `effort`
枚举；无 variants 就没有强度选项。没有档位推断、固定 low/high 表、逐模型切换、恢复 RPC 或新缓存。

CLI 目录没有 Session 当前值，不标记某个模型为原生默认，也不把某个 variant 标成默认值。
产品的“跟随原生默认值”继续由运行时原生 Session 决定；已保存的显式模型及 effort 原值继续通过 ACP 设置。
实际 Run 的当前配置照常消费 ACP 返回，不为目录额外发起第二套查询。

目录集合遵循官方 CLI 的 `Provider.list()`。`hide_prompt_training_models` 是原生 ACP Provider 路由额外应用的
过滤，当前 CLI 不应用；采用 CLI 后，Rovai 目录也会包含它未隐藏的模型。Rovai 不额外查询 ACP 集合或复刻
原生配置过滤器，不修改用户的隐藏设置；实际模型能否选择/执行仍由 Kilo 接受或拒绝。

## 健康与缓存

普通健康检查继续 ACP 握手及当前模型观察，既不执行 CLI 目录命令，也不遍历模型。
Kilo 的健康结果永远不证明完整目录成功，不能覆盖已保存的完整目录或推进其成功时间。
目录刷新成功不证明账号可用、余额、模型生成或 Machine Ready；沿用共享意图合并、身份复核和 LKG。

此前逐模型扫描与其失败后恢复要求由本合同的单次目录命令替代，正常执行中的 ACP 模型设置错误边界保持。
各平台资格不因来源切换自动改变。本机原生和生产 Core 的验证范围见
[批量目录实施记录](../versions/v1.72/kilo-bulk-models-probe.md#user-sequence-75生产切换)。
