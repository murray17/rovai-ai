---
document_type: contract
name: Camp Member Fast
version: v3
status: accepted
source_version: v1.72
last_updated: 2026-10-06
---

# Camp Member Fast v3

本版替换 [v2](camp-member-fast-v2.md) 及其继承的资格、默认推断和控件准入流程。
配置表达 User 意图，真实 Runtime 应用参数，当前 Run 的原生反馈描述实际结果。
[Runtime Launch v48](runtime-launch-and-verification-v48.md) 的初始化、权限、显式模型、身份、会话与输入去重边界不变。

## 持久化、绑定与冻结

沿用 `camp_member_fast_preference`，以 `(camp_id, agent_id)` 和保存的 `runtime_binding_revision` 绑定偏好。
`fast_override` 继续为可空布尔值，不增加表、schema、偏好版本、健康状态或跨会话能力缓存。
旧 `eligible`、cwd、fingerprint 及观察列可以保留兼容，但不授权保存或执行。带诊断 fingerprint 的旧默认值不作为当前显示来源。
绑定切换或 installation 的保存路径/账户身份变化继续轮换代次并清理旧偏好；模型或权限变化不删除用户选择。

`threads.members.fast.set`（兼容 `camps.members.fast.set`）沿用 DomainCommandGateway 原事务与 receipt。
首次保存以 INSERT/ON CONFLICT 写入同一张表；旧绑定、离队、移除、其他适配器或跨 Thread 请求仍按现有错误拒绝。
同 commandId 重放不覆盖后来的选择。投影对活跃 Claude/Codex 绑定直接返回
`{ runtimeBindingRevision, fastOverride, runtimeDefaultFast }`，没有保存记录时偏好为 null。
投影、保存均不读健康快照，不启动 CLI。`runtimeDefaultFast` 复用现有列保存真实 Host 初始化返回的显示初值，
不改变 `fast_override` 的写入、绑定或冻结语义，也不改变作用域为 Native Session。
Codex 从正常 `thread/start` / `thread/resume` 顶层 `serviceTier` 读取；Claude 从正常 control initialize 响应的
`fast_mode_state` 读取。fast/priority/on/cooldown 映射 true，standard/default/off 映射 false；缺失或未知为 null。
初始化记录不带诊断 fingerprint；投影忽略旧诊断记录，且不使用这些列作为执行身份或健康证明。
仅接收当前活跃 Run/epoch、当前成员绑定和模型选择仍匹配、且本次没有冻结 Fast 覆盖的初始化值；
记录不得覆盖已保存的用户选择。
重复相同值不刷新界面；新初始化缺字段可清除旧显示值。普通 Run 观察不更新此初值。
旧 `threads.members.fast.check` 仅作为只读投影兼容入口保留，不再进入 Check Manager。

新 Run 冻结现有 `campFast`，切换不修改已经创建的 Run、Native Session 或其他队员。自动 rebind 仍保留 Run 已冻结意图。
Codex 显式请求档位继续进入现有费用审计；继承时不补造标准档位。Fast 不改变 Host 或 Session 兼容摘要。

## 实际参数与启动屏障

| 偏好 | Claude 私有临时 `--settings` | Codex `turn/start` |
| --- | --- | --- |
| 尚未覆盖/null（内部状态） | 省略 `fastMode` | 省略 `serviceTierForTurn` |
| 开启/true | `fastMode: true` | `serviceTierForTurn: "priority"` |
| 关闭/false | `fastMode: false` | `serviceTierForTurn: "default"` |

Claude 新建和恢复会话使用同一临时文件路径，文件沿现有生命周期私有写入与清理。
Fast 文件不包含权限设置；权限与显式模型参数及初始化验证继续使用原路径。不写全局或项目配置。
正常路径不运行 Fast 专用 `--version`、最低版本判定或 `auth status`。

Codex 保留单 Turn 参数，不以持久 `serviceTier` 替代，不修改用户 `config.toml`。
不执行 Fast 专用 schema 导出、元数据 Host、账户/配置/模型资格请求；普通认证、恢复配置和显式模型验证照常执行。
通用诊断 schema 能力函数继续保留，但不再被 Fast 运行路径调用。

“保证关闭”指在已验证支持的参数路径上明确下发关闭值，不能被资格过滤，也不能用省略参数替代。
不要求每次运行确认可选 Fast 状态、历史成功或健康记录。开发回归核对接受、拒绝及缺失反馈时的行为；
不承诺任意旧 CLI 都识别新字段。真实 Runtime 拒绝要求时保留局部错误；没有 Fast 兼容重启或任务重放。
输入尚未发送的初始化失败结束启动，输入已发送或是否被接收未知继续原有保守结算，不重试正文。

单 Turn 字段语义见固定版本的 [Codex 0.159.2 协议定义](https://github.com/openai/codex/blob/rust-v0.159.2/codex-rs/app-server-protocol/schema/typescript/v2/TurnStartParams.ts)；
Claude settings 与反馈字段见 [原生 Fast 文档](https://code.claude.com/docs/en/fast-mode)。来源核对与合成回归不等于真实账户、版本或实体 Windows 验收。

## 当前 Run 观察与界面

Claude 的 `system/init` / `result` 反馈只接受 on/off/cooldown；缺失或未知值保持 unknown。
原生 `fast_mode_disabled_reason` 沿现有 Runtime 错误脱敏边界限长后展示，不推测账户、套餐或版本原因。
Codex 在真实 turn/started、turn/completed、usage 中报告的 service tier 才是实际档位；turn/started 缺字段记录 unknown。
缺失可选反馈不延迟任务，不从请求值构造 Fast/标准已生效。

沿用 `runtime.fast.observed` 和当前 Run/epoch Execution Evidence，Codex 实际档位沿既有 Usage 路径记录。
观察行描述该时刻的原生反馈，不宣称整次 Run 始终使用同一档位；不进入 Canonical Activity 或模型上下文。
普通运行观察不写成员偏好、初始化默认或资格缓存；冷却/标准回退后下一次仍消费用户保存的选择。

两处控件共用偏好与按 Thread/member 隔离的保存状态，直接显示，不再有“检查 Fast”前置步骤。
控件只有开/关，文案固定为 Fast；不提供默认菜单或 mixed 第三态。`fastOverride ?? runtimeDefaultFast ?? false`
只决定显示；首次真实运行前和缺字段时先不高亮，不表示已经确认标准模式，也不生成关闭覆盖。
用户点击只保存明确布尔值；真实初始化的显示值不进入 Run 冻结或单次档位参数。
失败保留旧选择，只阻止同成员的重复保存；迟到回执不能恢复旧绑定或覆盖其他队员。
保存期间仅初值变化的刷新不能丢掉保存回执；较新用户选择和绑定变化仍使旧回执失效。
实际反馈放在对应 Run 内容中，与表达后续执行偏好的按钮分开；未知只显示“Fast 实际状态未确认”。
不添加费用推断、资格通知、后台探测或刷新调度器。详细呈现见[会话工作区](../ui/components/conversation-workspace.md#成员-fast-响应模式)。
