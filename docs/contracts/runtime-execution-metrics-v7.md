---
document_type: contract
contract: runtime-execution-metrics
version: 7
status: accepted
source_version: v1.72
last_updated: 2026-10-04
---

# Runtime Execution Metrics v7

v7 继承 [v6](runtime-execution-metrics-v6.md)，替换 Context 等待输入确认、每条观测清空省略窗口、
ZCode 只在 prompt 收口采样的规则。原生用量、输入投递和失败重试语义不变；不恢复测速。

## 当前 Session 观测

Context 使用现有 `runtime_session_context_latest`、`monitoring.execution` 和界面。
通过已有 Host/Run epoch/根 Session 路由后，以 delivery 中冻结的绑定 ID/代次与当前 Conversation
匹配确认归属。delivery 的 `prepared`、`delivery_unknown` 或未收到 prompt 最终响应不构成等待条件。
指标代码不修改 delivery 状态或重试资格；失败、取消也不自动撤销该 Session 的有效观测。

旧 Session、旧绑定、旧执行代次、已有新 Run owner 的迟到事件和历史回放不能覆盖当前值。
Context 不参与 Run 的 consumption checkpoint、归一化、完整性或费用结算；保留一个 latest 行。
去重使用实际接收身份，不能用历史数值集合阻止压缩下降、返回曾出现过的值或新的同值观测。
同源相邻重复可合并；原生更新时刻用于新旧排序与新鲜度，不能替代 Session 归属。

## 窗口与实际模型

每次观测独立携带 used/window/native ratio；有一项有效即有展示资格。used 与 native ratio 不从
旧观测补齐，也不从比例反推 token。window 是可复用的容量，不是一次调用的消耗。

同一 Native Session、绑定代次、Runtime 和有效 Host 配置下，已确认的实际模型一致时，省略的
window 可复用原生报告或明确生效配置中的旧窗口。同时比较 Host 配置摘要与 Run 冻结的模型选择（包括 Provider、模型选项和显式窗口配置）；
已有 Runtime 绑定/Host 路由继续处理原生配置兼容。实际模型来自原生观测，不能以 `opus`、`default`、`auto` 等配置别名代替。消息省略模型身份时，
可继承当前绑定和配置中已确认的实际身份；不能凭配置别名初次建立这个确认。
Claude 私有 Context 必须保留根 message 的 `modelId`；最近调用的输入桶计量沿用 v6。

实际模型或有效配置改变时不继承旧分母。used 超过任何拟使用窗口时保留 used，撤下 window/ratio，
不截断 used 或显示 100%。明确无效的窗口不是“省略”。新 used 没有携带 ratio 时不沿用旧瞬时比例。

| 有效字段 | 显示 |
| --- | --- |
| used | `xxk / —`、比例未知 |
| used 与可信 window | `xxk / xxk`、used/window |
| native ratio | 比例可用，数量仍按独立字段显示 |
| window | `— / xxk`，不推导 0% |
| 全未知 | 未知，不补零 |

## 运行中采样与刷新

原生 Gauge 和独立值经既有 4 秒低频 flush 写入；提交后用已有 `monitoring.changed` 失效通知刷新
可见面板。面板隐藏时不发 UI 查询，重开立即读；读请求 single-flight，稳定历史不永久轮询。
仅观测时间改变时，Renderer 沿用原显示对象；最新观测时间仍在 Core 读取接口中。

普通 ACP 使用相同的 Session 归属规则，不建立指标版本白名单。Pi 的原生 `getContextUsage()`、
Antigravity 同 generator 数值和 ZCode 原生快照均独立承接 used/window；不要求补齐另一项才准入。
Kiro 原生比例仍不用于反推精确 used。

ZCode 由当前根模型调用结束、压缩完成事件触发原生 `session/read`。重复触发合并，每 Session
只保留最新待读序号，返回快照已覆盖的触发不再补读；bridge 同时最多一个 snapshot RPC，读取不阻塞事件/响应 reader。运行中请求使用
`messageLimit: 1`，避免返回完整聊天；不支持此可选参数时本次实时补采失败，终态仍使用原有参数收尾。
读取结果再次验证 Session/input owner，只提取数字、模型和
revision；请求失败不改变 prompt 结果。终态既有快照仍负责收尾，bridge 退出取消读取任务。
不新增定时器、额外模型调用或 Context 历史，不把原生实现内部查询成本称为零。

## 验证边界

运行中通过必须同时证明同一 Run：新原生观测已读回、Renderer 匹配、prompt 最终响应仍未返回。
终态截图、持续显示旧值或全未知一致不能替代。字段可得、运行中更新、终态及冷恢复分别记录。
来源、支持范围、时间与资源证据见 [2026-10-04 验证](../research/runtime-monitoring/live-context-usability-2026-10-04.md)。
