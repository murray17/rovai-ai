---
document_type: contract
name: Camp Member Fast
version: v1
status: accepted
source_version: v1.34
last_updated: 2026-08-31
---

# Camp Member Fast v1

Fast 只支持 Claude Code CLI 的明确 Claude 订阅登录，以及 Codex CLI 的 ChatGPT 登录和原生支持 Fast 的
当前模型。它是当前 Camp 队员的后续执行偏好，不是通用 Runtime 配置或服务等级框架。

## 持久化与冻结

`camp_member_fast_preference` 以 `(camp_id, agent_id)` 为键，保存 `runtime_binding_revision` 和
`fast_override: bool | null`；`null` 继承原生默认，`true` 请求 Fast，`false` 请求 Standard。
表内只使用安全的资格、cwd、executable fingerprint 与 Codex 原生默认缓存，不保存账号响应、凭据或原始配置。
既有 `observed_fast_state` / `unavailable_reason` 列暂时保留，但不再写入运行观测，也不参与 UI 或偏好判断。
Camp/Profile 删除级联清理。

`agent_profile.runtime_binding_revision` 是保存后的绑定代次：仅所选 adapter/installation 或该 installation
保存的 adapter、executable path、auth scope 确实改变时轮换，同时删除旧覆盖。它不是绑定内容 hash；切走再切回仍是新代次。
模型变化只使资格与原生默认缓存失效，所有 Camp 中的覆盖保留；权限变化不修改 Fast 偏好或资格缓存。
重测、同一认证绑定下的认证刷新、目录检查、页面刷新、显示名修改都不轮换代次，也不清除用户意图。

Migration 118 从 v1.33/schema 71 升级到 v1.34/schema 72，为现有 Profile 初始化不同代次，不创建覆盖。
Migration 119 升级到 v1.34/schema 73，只替换错误的失效触发器并使旧资格缓存失效，保留所有三态覆盖和绑定代次；
不增加偏好版本号、Run 状态字段或新表，也不删除既有观测列。此前已被错误删除的选择不能恢复。
旧 Run 的可选 `campFast` 缺失仍可反序列化；不得修改既有 Run 的冻结配置。

新 AgentRun 冻结 `campFast { runtimeBindingRevision, fastOverride }`。Codex 请求档位写入既有
`model.options.serviceTier` 供审计；继承默认但没有可信默认值时不补造 Standard。Fast 参与 Run config digest，
不改变 Host config 或 Native Session binding compatibility digest。异步资格检查必须与当前 Camp、
member、绑定代次匹配；检查结果还校验模型配置、cwd、executable fingerprint、installation generation 和 search generation。
显式检查的队列目标包含既有模型选择快照；执行期资格结果与冻结模型比较，忽略仅用于费用审计的 `serviceTier`。
这些校验不引入新的资格或偏好代次。
Runtime 自动 rebind 保留旧 Run 的冻结偏好及请求档位，不重读当前 Camp 选择；config digest 继续按清空摘要
字段后的完整冻结对象计算。metadata Probe 复用前后 executable file identity 围栏，第一次变化在原 deadline
内最多重试一次，仍变化则 Superseded，不把新文件的结果写到旧 fingerprint。

## 用户命令与只读投影

- `camps.members.fast.set` 接受既有 User Command Envelope，payload 为 `campId`、`agentId`、
  `expectedRuntimeBindingRevision`、`fastOverride`。Core 通过 DomainCommandGateway 的同一事务提交偏好与
  receipt；同 commandId 重放不重复写入，异义复用遵循通用冲突规则。
- Camp scope 不符返回 `camp_scope_mismatch`；旧绑定返回 `runtime_binding_conflict`；成员不活跃、绑定不支持
  或显式覆盖缺少合格资格返回 `camp_member_fast_unavailable`。显式恢复默认不要求资格仍可用。
- `camps.members.fast.check { campId, agentId }` 是 metadata 检查，返回可选 Fast view。
  使用现有 Runtime Check Manager 的队列、同 Runtime 串行和有界进程清理，不新增页面轮询。普通打开 Camp
  只读缓存；用户展开队员浮层后，Renderer 对尚无有效结果的 Claude/Codex 队员静默调用该接口。
  `light_ready` 尚无完整原生能力，检查接口须先复用 `AvailabilityCheck` 补齐能力快照，再检查 Fast 资格；
  不能把轻检中缺失的 Codex 每轮档位能力当成不支持，也不能记录合格后再被只读投影的 `ready` 门槛挡住。
  每位队员至多一个在途请求；支持与不支持的结果均在当前 Camp 工作区缓存，重复展开或切换浮层 Tab 不重测。
  当前绑定、模型或 Installation 检测依据变化时失效旧结果；旧请求先结束，再检测当前绑定，迟到响应不能恢复旧入口。
  请求失败只隐藏入口，下次展开可重试，不显示检测占位、成功通知或错误 Toast。下一次真实执行仍会刷新资格；
  资格暂时不可用不清除覆盖，也不允许从客户端推断官方认证或能力。
- `CampMemberView.fast` 为可选字段，只包含 `runtimeBindingRevision`、`fastOverride`、`runtimeDefaultFast`。
  过期、未验证、不合格、已离队和其他 Runtime 不投影该字段。Claude 的默认始终返回未知。
- 保存偏好或刷新资格后发出 `camp.member.fast.updated`，Renderer 只刷新对应当前 Camp，不触发全局导航重建。
  Runtime 实际状态不触发成员偏好更新。

## 原生资格与默认

Claude 使用实际执行的 executable、Runtime environment 和 cwd 调用 `claude auth status`。只接受
`loggedIn=true`、`authMethod=claude.ai|oauth_token`、`apiProvider=firstParty`。套餐字段缺失、为空或出现新值
不阻止入口；官方 `setup-token` 登录可只报告 OAuth 分类。套餐、额外用量和组织授权由 Runtime 执行时判断。
未知认证分类、API Key、自定义 Base URL、云 Provider 或环境禁用 Fast 均隐藏。当前已核实的 CLI 版本
门槛为 2.1.219；未知或更旧版本隐藏。不得因为当前模型不是 Opus 而隐藏，由原生 CLI 决定是否切换模型。

Codex 使用原生 `account/read`、`config/read { cwd: actualExecutionRoot, includeLayers: true }` 和分页
`model/list`。账户必须为 `chatgpt`；有效 provider 必须为原生 OpenAI 且没有自定义 endpoint。当前模型
通过显式选择、有效配置或模型目录默认解析，不硬编码模型 ID。目录 `serviceTiers`（兼容 `service_tiers`）
必须含 `priority` 或旧值 `fast`。同时原生导出 schema 必须声明 `TurnStartParams.serviceTierForTurn`；
只有持久 `serviceTier` 的版本不合格。可选 experimental schema 导出失败不影响 Runtime 一般可用性。

Codex 默认依次取 `thread/start` / `thread/resume` 的实际 `serviceTier`、有效 `config.service_tier`、模型
`defaultServiceTier`（兼容 `default_service_tier`）、Standard。未知非空档位保持未知。Claude 不解析完整
settings 优先级；继承时省略 `fastMode`。Claude 默认保持未知，不从任何 Run 观察推断默认，不为初始化 UI 发起模型请求。
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

Runtime 状态与用户偏好完全分离。Claude 只从当前 Session 的 `system/init.fast_mode_state` /
`result.fast_mode_state` 接受 on/off/cooldown；Codex 只接受原生事件明确报告的档位，不用请求值充当观察值。
`runtime.fast.observed` 只保存到对应 AgentRun/epoch 的安全 Execution Evidence；Codex 实际 service tier
继续写入该 Run 的 Usage monitoring。它不产生 Canonical Activity，也不进入模型上下文。
这些结果不写 `camp_member_fast_preference` 的任何字段，不改变 override、原生默认或资格缓存；
fallback/cooldown 后下一次 Run 仍消费原三态偏好。既有 Run/epoch 隔离即可，不增加偏好版本号或观察 Run 关联字段。

费用仍由 [Runtime Usage Monitoring v4](runtime-usage-monitoring-v4.md) 拥有：实际档位优先于请求档位，
未知不补标准价，Claude 原生 `total_cost_usd` 不被覆盖。

## Renderer 合同

沿用成员浮层中的 Fast 胶囊：视觉 20–22px、目标至少 28px、字体至少项目紧凑基线 10.5px。
按钮只表达后续执行偏好。未知默认采用中性样式，可访问名称说明继承；开启高亮表示请求 Fast，
不宣称已生效，不显示实际状态、cooldown 或请求不一致警告。Codex 可信原生默认可用于继承时的初始显示。
`fastOverride ?? runtimeDefaultFast ?? false` 仅用于视觉，不得用于原生参数；`null` 必须省略覆盖。
按钮不显示悬浮或焦点提示框，保留可访问名称与键盘焦点样式。
点击直接切换并保存偏好，不显示费用提示、二次确认、保存成功或运行中切换提醒。
成员菜单不提供手动检测或恢复默认项；DOM、键盘焦点和草稿保持稳定，保存失败才显示错误并保留旧值；
长成员列表滚动，1280×720 下浮层不盖住 Composer。
