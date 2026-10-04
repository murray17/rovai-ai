---
document_type: contract
contract: runtime-execution-metrics
version: 4
status: accepted
source_version: v1.72
last_updated: 2026-10-03
---

# Runtime Execution Metrics v4

v4 继承 [v3](runtime-execution-metrics-v3.md) 的 Session 归属、整条观测替换、原生比例、
有效配置、迟到事件栅栏、读取生命周期与界面规则，增加以下原生上下文来源。
用量沿用 [Usage v7](runtime-usage-monitoring-v7.md)。不增加数据库迁移、测速、
UI 轮询或历史 Run 结束上下文。现有圆环数字与气泡统一为一位小数百分比，位置与布局不变。

## Antigravity 原生窗口观测

复用同调用的 SQLite 只读事务，按 `metadata_index` 读取 generator。
其 execution ID、step_indices、model 与当前完成 step 必须一致，排除 injected generator，
且 generator Usage 与 step Usage 一致。只取
`chat_model.chat_start_metadata.context_window_metadata.estimated_tokens_used/max_context_tokens`。
两数必须在同一消息中明确出现，window 为正且 used 不超过 window；只有窗口不能成为 0%。

这是 Antigravity 自身的上下文估计观测，不是 Run 用量或 Rovai 字符估算。使用
`antigravity-native-context-v1 / runtime_private_extension / session / gauge`，
来源身份为当前 native generator index。缺少本次 native Context 时不拼接其他调用的窗口；
新有效观测允许占用下降。原生对象与正文不进入公开链路。

## TRAE 原生校准占用

原生 `/context` 的 `calibrated` 占用使用最近一次根模型调用的 `prompt_tokens`。
Rovai 复用当前 Run journal cursor 的根 message Usage；不使用整个 Run 之和，
也不加该调用的 `completion_tokens`。`message.extra._source_model` 必须精确匹配
ACP 已确认的当前模型，且 used 为正；未知来源模型或初始化零值不产生 Context。

在真实 prompt 发送前，按 [Runtime Launch v46](runtime-launch-and-verification-v46.md)
读取一次原生 `models --json`，只使用精确 `name` 对应的有效 `context_window`；
目录读取沿用同一可执行入口、startup 环境和 workspace；通过既有受管有界命令执行器完成，
2 秒命令期限、stdout/stderr 各 64 KiB、沿用 2 秒 cleanup 上限。这里只查询原生目录，
不建立第二个 Agent Session、不发送模型提示、不保存原始输出；无重试或后台轮询。
重复名称、非法值、超限或失败保持窗口未知，不阻断实际 prompt。缺窗口时可以保留已验证的 used，比例仍未知，
不借用其他模型、内置常量或从 Provider 别名猜测分母。

方言为 `trae-native-calibrated-context-v1`。Gauge 使用原生 message 身份和观测时刻，
与本地逐调用用量分别去重、保存。新 Session、旧 epoch、历史回放、子 Agent 与配置变化
继续受 v3 栅栏约束；原生当前占用不等于每次本地工具结果加入后的实时窗口同步值。

## Qoder 自定义模型的独立数量

仅在原生根 journal 已暴露真实 custom-provider input、当前模型与 message.model 完全一致时，
从有效 Qoder config root 的 settings.json 查找精确 provider/model 的显式 contextWindow。
不读取相似模型或模型名推断值，不改写配置。配置文件只读、拒绝 symlink、上限 1 MiB；
只解析 providers.models 的模型名和窗口，凭据及其他内容不进入投影或日志。

原生 SH() 以 input_tokens/window 产生 context_usage_ratio。used 直接取同次原生 input，
window 直接取当前显式配置；二者与该条原生比例在 1e-9 容差内一致、used/window 均为正且
used 不超过 window，才把数量加入该 Gauge。比例只用于交叉验证，绝不反推数量。
模型、配置、比例不一致或隐藏计数时仍保留原生比例，数量未知。
方言为 qoder-native-call-context-v1；原来只有比例的合法状态继续支持。

## Kiro 原生模型窗口

收到当前根 Session 的 `_kiro.dev/metadata.contextUsagePercentage` 时，可以只读对应
KIRO_HOME/sessions/cli/<session-id>.json 的 rts_model_state.model_info.context_window_tokens。
必须校验 session_id、cwd 及 model_id 与当前原生 Session/模型一致；路径拒绝 traversal、symlink，
文件上限 1 MiB。窗口必须是正整数，失败时仅保留原生比例。
当前协议没有独立 used 数值时 used 继续未知；不会将比例乘以窗口伪装成精确 token。
