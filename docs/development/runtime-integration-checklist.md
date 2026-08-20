---
document_type: development-checklist
authority: development-procedure
status: proposed
last_updated: 2026-08-20
---

# Agent Runtime 接入与准入 Checklist

本清单用于新增 Product Runtime 的研究、实现、真实 Probe 和逐平台准入。

> 可执行文件存在、`--version` 成功、ACP `initialize` 成功或普通对话成功，
> 都不等于 Runtime 已完成准入。

权威边界：

- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [Runtime Platform Admission v1](../contracts/runtime-platform-admission-v1.md)
- [Runtime Launch and Verification](../contracts/runtime-launch-and-verification-v13.md)
- [Runtime 兼容性清单](../runtime-compatibility.md)
- [`AdapterKind::ALL`](../../crates/rovai-core/src/agent_profile.rs)

## 1. 接入记录

- [ ] Runtime 名称及稳定 `AdapterKind` / wire identity
- [ ] 上游版本、build/commit、模型和账号类型
- [ ] 可执行文件 canonical path 与 fingerprint
- [ ] 协议族：ACP / JSON-RPC / stream-json / one-shot / 其他
- [ ] 目标平台：macOS arm64 / macOS x64 / Windows x64
- [ ] Evidence revision
- [ ] 已知限制与未支持能力

## 2. 发现、检查与启动

- [ ] 命令名、显示名、环境变量覆盖键和常见安装位置已定义。
- [ ] PATH、已保存路径和自定义路径均验证为真实可执行文件。
- [ ] 路径、fingerprint 或必要 schema 改变后，旧 Ready 不再直接复用。
- [ ] 轻检有超时和输出上限，不发模型请求、不弹登录、不修改用户配置。
- [ ] 空输出、stderr、非零退出、超时、格式变化和命令不存在均有明确结果。
- [ ] 显式深检只检查用户选择的 Runtime；页面进入和成员选择不自动深检。
- [ ] Discovery、Availability Check、Probe 和 AgentRun 使用不同 launch purpose。
- [ ] Adapter/version/platform 的行为资格与当前机器 Runtime Ready 分开记录；行为 Smoke 不进入
      Availability Check 或每次 Dispatch 的 Ready 前置条件。
- [ ] Availability Check 写入 `ready` 与 Scheduler/Dispatch Preflight 接受 `ready` 使用同一证据合同和
      同一校验函数；不得由较弱检查写入 `ready` 后跳过较强门禁。
- [ ] stdout、stderr、临时目录和私有配置目录均有界且可清理。
- [ ] Runtime 及其后代进程受进程组或 Job Object 管理。
- [ ] completion、failure、cancel、Probe timeout 和 App shutdown 后无残留进程。

### 兼容性分层

每个影响 Runtime 观察结果的输入都必须记录权威 value/digest 及加载阶段：`process_start`、`session_new`、
`session_load`、`session_resume`、`per_prompt` 或 `live_watch`。加载阶段未知时使用更粗的兼容边界，不能假定
Runtime 会刷新。同一输入可以同时约束多层；按真实加载行为分类，不按字段名称猜测归属。

- [ ] Host compatibility 覆盖进程启动时冻结的 executable identity/fingerprint、argv/env、cwd、workspace
      access、process-level config、进程级权限、Built-in IPC、附件授权和其他 Host-scoped 输入。
- [ ] Native Session compatibility 覆盖 `session/new`、`session/load` 或 `session/resume` 时加载的模型、mode、
      MCP、Skill exposure、instruction/config 文件及其他 Session-scoped catalog。
- [ ] Per-Prompt compatibility 覆盖当前 Prompt、结构化上下文、delivery/execution epoch 和其他逐输入资源；
      每次 Prompt 前重新建立或核对，不能依赖旧 Session 快照。
- [ ] 只有 Runtime/version/platform 的可复现证据证明 `live_watch` 后，相应资源才可不进入 Host 或 Native
      Session compatibility。
- [ ] ContextManifest 保存的 Skill exposure identity/digest 可以与建立当前 Native Session 时实际加载的
      exposure 核对；只保存本次 Run 的 digest 不算完成 Session compatibility。
- [ ] Session-scoped 资源改变且没有已验证 live refresh 时，禁止 `ReuseSameHostSession`；根据已确认能力选择
      `session/load`、`session/new` 或重启 Host。新 Session 不等于必须停止 warm Host。

## 3. 协议、事件与 Command Output

- [ ] 协议 stdout 全程保持结构化；日志和 banner 只能进入 stderr。
- [ ] 输入 accepted 有 Runtime 原生依据，不从 spawn 或首段输出推断。
- [ ] 每个 Tool 有稳定 ID，并形成唯一的 started → terminal 生命周期。
- [ ] partial/full、重复通知或补发事件不会创建重复 Action。
- [ ] 使用真实 Runtime 执行固定 `printf` marker。
- [ ] marker 出现在对应 `runtime.action.payload.output`，而非只出现在最终回复或日志。
- [ ] stdout、stderr、混合输出、空输出、非零退出和超大输出分别验证。
- [ ] 命令无输出时仍保留安全的 command input，并可在 UI 中展开检查。
- [ ] 只从明确公开字段提取 input/output，不从 Diff、私有日志或未知 metadata 猜测。
- [ ] 未报告结构化 Tool 时，不补造 Tool、命令或文件活动。
- [ ] Session ID 错误、缺少必要字段、非法 JSON、多 final 或未知标准协议 shape 均 fail closed；ACP 自定义
      extension 按下方扩展规则处理。
- [ ] ANSI、绝对路径、凭据、Prompt、文件正文和 Provider 私有字段不进入公开事件。

### ACP Runtime 额外验证

- [ ] `initialize.protocolVersion` 和必要 capability 均符合要求。
- [ ] `session/new` 返回稳定且非空的 Session ID。
- [ ] 模型、mode 和权限目录来自真实 Session 返回。
- [ ] `session/new` response 到达后继续在明确的有界窗口内读取异步消息，并记录首条/末条消息相对
      response 的到达时间、method、`sessionUpdate` variant、数量与字节数。
- [ ] 标准 `available_commands_update`、config/mode/session-info catalog update、Idle usage metadata 和已知
      Runtime lifecycle extension 可以在没有 Active Prompt 的 Session 合法到达；它们不进入 Prompt output，
      也不把 Session 标记为 `ProtocolViolated`。
- [ ] 方法名以 `_` 开头、结构合法、可归属当前 Host、声明为 Session-scoped 时通过 Session/epoch fencing，
      且未突破数量/字节预算的未知自定义 notification 私有隔离或忽略：不进入 Prompt output，不生成 Action、
      Usage、Final 或 Compaction，也不因 parser 尚未识别而把 Session 标记为 `ProtocolViolated`。
- [ ] 方法名以 `_` 开头的未知自定义 request 返回 JSON-RPC `-32601 Method not found`，不自动毒化 Session。
- [ ] 未知标准 method/`sessionUpdate` variant 不冒充 ACP extension；非法 JSON-RPC、错误 Session identity、
      Host/Session/epoch fencing 失败、预算溢出、已知 Prompt output 在 Idle 到达或生命周期不变量被破坏时
      继续 fail closed。“当前 parser 没有识别”只证明 Host 尚未分类，不证明 Runtime 没有提供能力。
- [ ] Session 消息按 Host、Session、Prompt、delivery 和 execution epoch 隔离。
- [ ] Prompt 完成后、旧 Run 和恢复 replay 的迟到事件不会进入当前 Run。
- [ ] Permission request 的 option ID 可以被批准或拒绝并正确返回 Runtime。
- [ ] cancel 返回明确终态，且取消后不会产生延迟副作用。
- [ ] ACP 支持矩阵逐能力记录，不以“支持 ACP v1”代替行为验证。

### ACP 完整消息面枚举

每个阶段都必须分别保存脱敏 shape；不能只记录一次成功 Prompt：

- [ ] `initialize` response 后、`session/new` 前的通知和 extension。
- [ ] `session/new` response 后的有界异步 Session metadata/catalog。
- [ ] 无 Active Prompt 的 Idle Session。
- [ ] Prompt active 期间的 narration、thought、plan、tool、permission、usage、catalog 和 extension。
- [ ] Prompt terminal response 后、下一 Prompt 前的迟到消息。
- [ ] ACP v1 `session/load` response 前的 history replay、response 后迟到 replay 与稳定 quiet boundary。
- [ ] ACP v1 `session/resume` response 前后的 metadata/extension；不得预设 conversation history replay。
- [ ] `session/cancel` 后直到可靠 terminal/cleanup 的消息。

每条消息必须先归入 `PromptOutput | SessionMetadata | LifecycleExtension | Replay | UnknownExtension | Unknown`，
再决定公开、隔离、内部消费或 fail closed；“没有 Active Prompt”本身不是 metadata 违规依据。

### 异步 catalog 状态

- [ ] 首条 catalog update 到达前状态为 `Pending` / `Unknown`，不得提前冻结成权威空列表。
- [ ] 每种 update 的 full replacement、partial update 或 delta 语义来自协议 schema 或当前
      Runtime/version 的明确证据；没有证据时不合并、不猜测。
- [ ] authoritative snapshot 按 Host identity、Native Session ID 和 Session generation 隔离；旧 Host、旧
      Session 或旧 generation 的 update 不能覆盖当前状态。
- [ ] 后续 update、`session/new`、`session/load`、`session/resume`、Session close 和 Host restart 均定义
      snapshot 的替换、继承或清空规则。
- [ ] `Runtime advertisement` 与 `Rovai product catalog consumption` 分开记录状态；安全路由并保存 wire
      shape 不等于产品已经实现 command/Skill discovery、展示或调用。

### Runtime command 与 Skill 分层

- [ ] 文件投递层：分别验证受管项目级路径、用户级路径、同名优先级和 Rovai ownership/cleanup 边界。
- [ ] Runtime 发现与加载层：用唯一名称/内容验证 cold Host、warm Host、新 Session、`session/load` 和既有
      Idle Session 的扫描/刷新时机。
- [ ] ACP 公开层：记录 `available_commands_update.availableCommands[]` 的 name/description/input shape，
      分开 Runtime 内建 Slash Command 与由 Skill 转换出的 command。
- [ ] `Runtime advertised command/Skill`、`Runtime 实际加载 Skill` 和 `Rovai managed Skill delivery` 是三个
      独立结论；任一层 Verified 不自动升级其他层。
- [ ] 不修改或覆盖用户现有全局 Skill；只有稳定、可清理且通过真实调用的项目级路径才能新增
      `SkillDeliveryGroupKey`。

## 4. Session Continuation 与 Resume

- [ ] 明确策略：`warm_host`、`exact_resume`、`history_restore` 或 `new_only`。
- [ ] 首次 Run 持久化精确 Native Session ID。
- [ ] 后继 Run 保持同一 logical Conversation。
- [ ] 声称支持 Resume 时，真实 Smoke 必须验证精确 Native Session ID 延续。
- [ ] 不使用“最近 Session”、`AUTO`、模糊匹配或解析私有 Session 文件代替精确 ID。
- [ ] Runtime 返回不同 Session ID 时 fail closed，不静默换绑。
- [ ] Core 或 Host 重启后完成冷恢复验证。
- [ ] ACP v1 `session/load` 的 history replay 在 response 前发生并在当前 Prompt 前完全隔离；response 后只在
      有界 grace/quiet boundary 内接收可证明的迟到 replay。
- [ ] `session/load` replay 不产生公开文本、Action、Approval、Usage、Missing-Send 或副作用，并受时间、
      事件数和字节数限制。
- [ ] ACP v1 `session/resume` 不重放 conversation history，不进入 History Restore settling window；response
      前后的合法 metadata/extension 按普通 Session 路由。
- [ ] Runtime 若在 `session/resume` 下表现出非标准 replay，只作为该 Adapter/version/platform 的独立证据
      和隔离策略记录，不升级为通用 ACP 语义。
- [ ] 恢复失败时记录 continuity lost，停止失败 Host，再至多创建一个新 Session。
- [ ] Host、Native Session 和 Per-Prompt compatibility 分别核对；任一目标层不兼容时禁止对应层复用。
- [ ] Skill exposure 或其他 Session-scanned resource digest 改变后，旧 Native Session 不能直接复用；
      `session/load`、`session/new` 或 Host restart 的选择必须与真实刷新证据一致。
- [ ] Runtime 的 Session lock 和进程级配置行为已通过真实实验确认。
- [ ] `new_only` 不得在产品文案中宣称支持 Resume。

## 5. 权限、Approval 与 MCP

- [ ] 权限默认值映射到 Runtime 的精确原生值。
- [ ] 静态 permission descriptor 不冒充登录或动态能力证据。
- [ ] permission schema drift 会使旧 Ready 失效，不会静默扩大既有成员权限。
- [ ] read-only 或 Core-enforced 工作区会收窄高权限启动参数。
- [ ] allow-once 只产生一次精确副作用。
- [ ] deny 后文件、命令、Git、网络或 MCP 副作用均未发生。
- [ ] Approval 可持久恢复，不只存在于 Runtime 进程内。
- [ ] External MCP 只对当前 AgentRun 生效，不写 Runtime 用户级配置。
- [ ] 同名 MCP precedence、logical name 与 runtime name 映射已经验证。
- [ ] 不同 MCP 集合不会复用不兼容 Host。
- [ ] 未配置 MCP 的相邻 Session 看不到前一 Run 的 Server。
- [ ] Runtime 能实际调用 bundled `rovai` CLI，并通过 Built-in Tool Smoke。

## 6. Narration、Final、Missing-Send 与错误

- [ ] 公开 narration 只来自 Runtime 明确标记的公开文本。
- [ ] thinking、调试信息、内部错误和 Provider metadata 不进入 narration。
- [ ] 已有 streamed text 时，terminal result 不重复发布正文。
- [ ] 没有 streamed text 时，只在可靠成功终态使用明确 final fallback。
- [ ] success、failed、cancelled、timeout 和 interrupted 均有唯一终态。
- [ ] 进程退出或最后一段 stdout 不单独构成 final boundary。
- [ ] Missing-Send zero-send 成功场景可以恢复可靠最终正文。
- [ ] 任意 accepted `camp.message.send` 都会抑制 Missing-Send Recovery。
- [ ] tool → final 只恢复最后一次 Tool 之后的可靠 assistant suffix。
- [ ] 没有可靠 final boundary 时，Missing-Send 保持禁用。
- [ ] auth、rate limit、quota、model、permission、compatibility、environment 和 transient failure 可稳定分类。
- [ ] 用户可见错误经过脱敏和长度限制，不暴露原始 stderr、私有日志、路径、Prompt 或凭据。

## 7. Usage、Token、Cache 与 Cost

本节是可选能力。Runtime 不上报 Usage 不阻断基础准入；未验证字段保持未知。

- [ ] 记录 Usage 的精确事件来源、scope、counter mode 和 Runtime 版本。
- [ ] 明确 `inputTokens` 是总输入、未缓存输入，还是语义未知。
- [ ] 分开映射 uncached input、cache read、cache write、output 和 reasoning。
- [ ] Reasoning 是 Output 子集，不重复累计或重复计费。
- [ ] 缺失字段默认保持 `NULL`；只有版本化证据证明“省略即零”时才归零。
- [ ] 同一 Usage 重发、metadata 补发或累计快照重发不会重复累计。
- [ ] cumulative/gauge 首次建立 baseline；回退视为 counter reset。
- [ ] terminal Flush 与周期 Flush 并发时不会丢失或重复数据。
- [ ] Session cumulative cost 不直接记为当前 AgentRun cost。
- [ ] Cost 必须有明确 scope、amount、currency 和 source，不默认币种。
- [ ] 价格估算只在 Token bucket、模型、tier、日期和版本化价格目录完整时生成。
- [ ] Eligibility 按 `Runtime × version × field` 冻结，并记录 Coverage。
- [ ] 不持久化完整原始 Usage payload、Prompt、Output、Tool 内容或 Native ID。

## 8. Compaction 信号

- [ ] 先检查 Runtime advertised commands 中是否存在 `compact`、`compress` 或等价入口，并优先通过该入口
      分别触发 manual 与 auto 场景。
- [ ] 记录所有 ACP method、`sessionUpdate` variant、Runtime 私有 notification 与 Hook source；普通 assistant
      文本不能充当 signal。
- [ ] signal 必须提供至少一个明确、结构化且可稳定准入的 lifecycle edge，并把 phase 标为
      `imminent_edge | started | completed`；同时具有明确 source、准入边界、稳定 occurrence ID 或其他可证明
      的去重依据，才可接入 detector。
- [ ] `imminent_edge` 允许后续 compaction 失败或取消，Bootstrap redelivery 必须保守、幂等且可重复；
      `completed` 必须证明事件位于压缩完成之后，并处理重复发送、replay 和 Session resume。
- [ ] Hook 必须在实际 Adapter launch 方式下可达；文档声明或普通 CLI/TUI 可达不等于 ACP Host 可达。
- [ ] token/usage 下降、Session usage reset、恢复后历史变短、模型 summary 或正文提到压缩均不得推断
      compaction。
- [ ] 未观察到可靠信号时，Runtime structured-signal evidence 记为 `NotObserved`，Rovai detector implementation
      记为 `Disabled`；只有上游明确不提供且证据充分时，Runtime evidence 才能写 `Unsupported`。

## 9. 必过真实 Smoke

| Case | 通过条件 |
| --- | --- |
| First run | 建立登录、模型、权限和唯一 Session/final |
| Public narration | 普通无 Tool 回复可见，terminal 不重复 |
| Command output | 固定 marker 进入对应 Action output |
| Empty output | 命令仍可检查，且无私有字段泄漏 |
| Approval allow | 一次批准只产生一次副作用 |
| Approval deny | 拒绝后没有副作用 |
| Cancellation | 收敛为 cancelled，之后无延迟副作用 |
| Warm continuation | 按声明策略复用，且不串 Prompt/MCP/权限 |
| Cold continuation | Core/Host 重启后用精确 Session ID 恢复 |
| Restore failure | 错误 ID、非法 JSON、超限 replay 均 fail closed |
| MCP isolation | 只对当前 Run 生效，不污染相邻 Session |
| Missing-Send | zero-send、send suppression、tool→final 均通过 |
| Built-in CLI | 实际调用正式 `rovai` operation 集 |
| Process cleanup | 所有退出路径都无残留进程 |
| Usage（若支持） | 无重复累计，Token/Cache bucket 与原生事件一致 |

## 10. 自动化与证据

- [ ] 为 parser、缺字段、重复事件、错误 ID 和输出边界增加确定性 Fixture。
- [ ] 增加子进程持有 stdio 的进程树清理测试。
- [ ] 增加真实 Runtime Smoke；Fixture 不能代替本机实测。
- [ ] 新 Runtime 纳入 Runtime Activity、诊断、planned shutdown 和 Built-in CLI 验收。
- [ ] 运行 `pnpm typecheck`、`pnpm test` 和适用的 Rust 门禁。
- [ ] 记录 Runtime 版本、模型、平台、fingerprint、日期和仓库 revision。
- [ ] 一次实测不外推为其他版本、模型或账号均兼容。
- [ ] 已知限制和未支持能力写入 [Runtime 兼容性清单](../runtime-compatibility.md)。
- [ ] 每项 Runtime 能力证据使用且只使用一个状态：`Verified`（当前 Adapter/version/platform 有可复现行为
      证据）、`DocumentationOnly`（只有上游文档）、`Unverified`（有候选 surface 但未完成行为证明）、
      `NotObserved`（已按记录窗口/场景查找但未看到）、`Unsupported`（上游或结构化负证据证明不提供）。
- [ ] 每项 Rovai 产品接入使用且只使用一个独立实现状态：`Implemented`、`Disabled`、`NotImplemented` 或
      `Blocked`。不得用 `NotObserved / Unverified` 这类组合值，也不得以 Runtime evidence 代替产品实现状态。

## 11. 硬性阻断条件

出现任一情况，不得标记为正式支持：

- [ ] 固定 command marker 无法从对应 Action output 取得。
- [ ] Tool ID 不稳定，或 started/terminal 无法可靠配对。
- [ ] Prompt 完成后或恢复期事件污染当前/下一 Run。
- [ ] 声称支持 Resume，但精确 Native Session ID 没有延续。
- [ ] Approval deny 或 cancel 后仍发生副作用。
- [ ] Probe、Run 或 shutdown 后存在残留进程。
- [ ] 浅检成功被当成认证、模型、Session 或完整协议 Ready。
- [ ] 旧 Probe 失败覆盖当前成功证据。
- [ ] permission schema 改变后静默保留 Ready 或扩权。
- [ ] final 依赖进程退出、最后 stdout 或语义猜测。
- [ ] 原始日志、路径、凭据、Prompt 或私有字段进入公开事件。
- [ ] Usage 缺少来源、scope、counter mode 或版本证据却被声明为支持。
- [ ] Usage 重发会重复累计，或 Session cost 被误记为 Run cost。
- [ ] 只有 `initialize` 或一次普通回复成功，没有完整行为 Smoke。
- [ ] Availability Check 与 Dispatch Preflight 对同一 Adapter/version/fingerprint 使用不同 Ready requirements，
      或 persisted `ready` 无法通过当前统一 Ready validator。
- [ ] 合法 Idle Session metadata 被投影为 Prompt output、被标记为无 Prompt 泄漏或使 Session 协议违规。
- [ ] Session-scanned resource 已改变，但旧 Native Session 仍被直接复用，或 ContextManifest exposure 与
      Native Session 实际加载 exposure 没有可核对 identity/digest。
- [ ] 结构合法、可归属当前 Host/Session 且在预算内的未知 ACP `_...` extension notification，仅因 parser
      没有 handler 就使 Session 协议违规。

## 12. 准入结论

```text
Runtime:
AdapterKind:
Platform:
Admission: qualified | not_qualified | unsupported
Evidence revision:
Verified version/model/account:
Host compatibility inputs:
Native Session compatibility inputs:
Per-Prompt compatibility inputs:
Session refresh strategy:
Runtime evidence (`Verified | DocumentationOnly | Unverified | NotObserved | Unsupported` per item):
Rovai implementation (`Implemented | Disabled | NotImplemented | Blocked` per item):
Async catalog ownership/state:
Unknown extension policy:
Machine Ready contract:
Adapter behavior evidence:
Known limitations and parser gaps:
Reviewer:
Date:
```
