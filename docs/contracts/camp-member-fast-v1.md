---
document_type: contract
name: Camp Member Fast
version: v1
status: accepted
source_version: v1.33
last_updated: 2026-08-31
---

# Camp Member Fast v1

Fast 只支持 Claude Code CLI 的明确 Claude 订阅登录，以及 Codex CLI 的 ChatGPT 登录和原生支持 Fast 的
当前模型。它是当前 Camp 队员的后续执行偏好，不是通用 Runtime 配置或服务等级框架。

## 持久化与冻结

`camp_member_fast_preference` 以 `(camp_id, agent_id)` 为键，保存 `runtime_binding_revision` 和
`fast_override: bool | null`；`null` 继承原生默认，`true` 请求 Fast，`false` 请求 Standard。
表内其余列只缓存安全的资格、cwd、executable fingerprint、原生默认、观察状态和公开原因，不保存账号响应、
凭据或原始配置。Camp/Profile 删除级联清理。

`agent_profile.runtime_binding_revision` 是保存后的绑定代次：仅 adapter、installation、model selection 或
permission configuration 确实改变时轮换，同时删除旧覆盖。它不是绑定内容 hash；切走再切回仍是新代次。
重测、认证刷新、目录检查、页面刷新、显示名修改都不轮换代次，也不清除用户意图。

Migration 117 从 v1.29/schema 70 升级到 v1.33/schema 71，为现有 Profile 初始化不同代次，不创建覆盖。
旧 Run 的可选 `campFast` 缺失仍可反序列化；不得修改既有 Run 的冻结配置。

新 AgentRun 冻结 `campFast { runtimeBindingRevision, fastOverride }`。Codex 请求档位写入既有
`model.options.serviceTier` 供审计；继承默认但没有可信默认值时不补造 Standard。Fast 参与 Run config digest，
不改变 Host config 或 Native Session binding compatibility digest。异步检查与原生观察必须与当前 Camp、
member、绑定代次匹配；检查结果还校验 cwd、executable fingerprint 和 installation generation。

## 用户命令与只读投影

- `camps.members.fast.set` 接受既有 User Command Envelope，payload 为 `campId`、`agentId`、
  `expectedRuntimeBindingRevision`、`fastOverride`。Core 通过 DomainCommandGateway 的同一事务提交偏好与
  receipt；同 commandId 重放不重复写入，异义复用遵循通用冲突规则。
- Camp scope 不符返回 `camp_scope_mismatch`；旧绑定返回 `runtime_binding_conflict`；成员不活跃、绑定不支持
  或显式覆盖缺少合格资格返回 `camp_member_fast_unavailable`。显式恢复默认不要求资格仍可用。
- `camps.members.fast.check { campId, agentId }` 是显式 metadata 检查，返回可选 Fast view。
  使用现有 Runtime Check Manager 的队列、同 Runtime 串行和有界进程清理，不新增页面轮询。普通打开 Camp
  只读缓存；显式检测或下一次真实执行刷新资格，资格暂时不可用只隐藏入口，不清除覆盖。
- `CampMemberView.fast` 为可选字段，包含 `runtimeBindingRevision`、`fastOverride`、`runtimeDefaultFast`、
  `observedFastState`、`unavailableReason`。过期、未验证、不合格、已离队和其他 Runtime 不投影该字段。
- 写入或观察后发出 `camp.member.fast.updated`，Renderer 只刷新对应当前 Camp，不触发全局导航重建。

## 原生资格与默认

Claude 使用实际执行的 executable、Runtime environment 和 cwd 调用 `claude auth status`。只接受
`loggedIn=true`、`authMethod=claude.ai`、`apiProvider=firstParty`，且订阅类型明确为 pro/max/team/enterprise。
未知 OAuth 分类、API Key、自定义 Base URL、云 Provider 或环境禁用 Fast 均隐藏。当前已核实的 CLI 版本
门槛为 2.1.219；未知或更旧版本隐藏。不得因为当前模型不是 Opus 而隐藏，由原生 CLI 决定是否切换模型。

Codex 使用原生 `account/read`、`config/read { cwd: actualExecutionRoot, includeLayers: true }` 和分页
`model/list`。账户必须为 `chatgpt`；有效 provider 必须为原生 OpenAI 且没有自定义 endpoint。当前模型
通过显式选择、有效配置或模型目录默认解析，不硬编码模型 ID。目录 `serviceTiers`（兼容 `service_tiers`）
必须含 `priority` 或旧值 `fast`。同时原生导出 schema 必须声明 `TurnStartParams.serviceTierForTurn`；
只有持久 `serviceTier` 的版本不合格。可选 experimental schema 导出失败不影响 Runtime 一般可用性。

Codex 默认依次取 `thread/start` / `thread/resume` 的实际 `serviceTier`、有效 `config.service_tier`、模型
`defaultServiceTier`（兼容 `default_service_tier`）、Standard。未知非空档位保持未知。Claude 不解析完整
settings 优先级；继承时省略 `fastMode`。首次可信原生观察前默认未知，不为初始化 UI 发起模型请求。
任何检查都不直接读取 `auth.json`、`config.toml`、Claude 凭据文件或钥匙串。

## 执行与观察

| 覆盖 | Claude 单一 inline `--settings` | Codex 每次 `turn/start` |
| --- | --- | --- |
| `null` | 省略 `fastMode` | 省略 `serviceTierForTurn` |
| `true` | `fastMode: true` | `serviceTierForTurn: "priority"` |
| `false` | `fastMode: false` | `serviceTierForTurn: "default"` |

Claude 新 `--session-id` 与 `--resume` 使用相同构造路径，合并现有 inline settings 后只传一个 `--settings`。
Codex 不写持久 `serviceTier`，不因切换 Fast 重建 Thread。两者均在执行前复核原生资格；不合格时不下发
Fast 覆盖。点击控件不修改当前 Run、运行中的子进程、Thread 默认或用户全局配置。

`ObservedFastState = unknown | standard | fast | cooldown` 独立于用户意图。Claude 只从当前 Session 的
`system/init.fast_mode_state` / `result.fast_mode_state` 接受 on/off/cooldown。Codex 只接受原生事件明确报告
的档位，不用请求值充当观察值。cooldown 保持 `fast_override=true`，公开原因使用固定安全文案。
只有继承模式下的观察能更新缓存的原生默认；一次强制 Fast 的结果不能成为“恢复默认”后的默认。

费用仍由 [Runtime Usage Monitoring v4](runtime-usage-monitoring-v4.md) 拥有：实际档位优先于请求档位，
未知不补标准价，Claude 原生 `total_cost_usd` 不被覆盖。

## Renderer 合同

沿用成员浮层中的 Fast 胶囊：视觉 20–22px、目标至少 28px、字体至少项目紧凑基线 10.5px。
未知采用中性样式，hover/focus 说明继承与首次运行；开启高亮，冷却保留高亮意图并给出轻量警告。
tooltip 明确只影响当前 Camp 该成员的后续执行；运行中修改给出当前执行不变的提示。
首次开启先确认额外用量风险，并用本机偏好持久记住确认。重测/恢复默认放在成员菜单；DOM、键盘焦点
和草稿保持稳定，保存失败保留旧值；长成员列表滚动，1280×720 下浮层不盖住 Composer。
