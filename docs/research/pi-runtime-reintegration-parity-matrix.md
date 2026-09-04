---
document_type: runtime-research
runtime: pi
upstream: earendil-works/pi
authority: research-evidence-only
status: implementation-evidence
last_updated: 2026-09-04
---

# Pi Runtime 重新接入 Parity Matrix

本矩阵记录重新接入后的实现与证据边界。当前主线固定为
`main@991d0cb24b3edc6dd67b823fdf11fe3caa7e2e17`；旧实现只读取
`codex/pi-runtime-integration@3e04b4f3b2555bb488e1df37f306beaae52a8894` 的 Pi 专属协议与安全证据，
不 merge、rebase 或 cherry-pick。上游源码证据来自
`@earendil-works/pi-coding-agent@0.84.4` 的发布包；真实行为 smoke 使用一次性安装的 0.84.4 和隔离
`PI_CODING_AGENT_DIR`，没有把 PATH 上的 0.84.2 结果外推到 0.84.4 或其他平台。

状态词遵循 [Runtime 接入 Checklist](../development/runtime-integration-checklist.md)：只有
`Verified + Implemented` 或“可靠证明上游 Unsupported 且由当前版本接受差异”才能通过。deterministic fixture 只证明
Core parser、fence 和状态机，不替代目标版本真实 Runtime smoke；最后一列因此也是当前阻止 First-Class 平台准入的明确清单。

| 核心能力轴 | 当前 main 的标准 | 旧 Pi 分支做法 | Pi 0.84.4 真实能力 | 本次实现 | 仍未取得证据的能力 |
| --- | --- | --- | --- | --- | --- |
| Auth / Provider / Model | 使用目标 Runtime 原生 auth/provider/default；真实 catalog；显式模型启动后核对；secret 不持久化或公开；drift 精确 fence | 最终 revision 改为继承用户 Pi 原生 Home，通过 `get_available_models`、`set_model`、`get_state` 管理；早期 Claude/MiniMax overlay 已被决定替代 | 原生 OAuth、subscription、API key 与 `models.json`；RPC 提供完整 model catalog、显式 set 和当前 state | 正式 Host 只使用 Pi 官方配置；runtime-default 不发送 sentinel；显式 provider/model 逐 Session set+readback；provider/model/installation identity 进入 binding fence。0.84.4 官方配置的 MiniMax M3 直接请求与所有本机 Pi smoke 成功；secret 未进入仓库/trace | 真实显式 model override、运行中 auth/provider/model drift 后的 Host/Session fence 尚未跑完整矩阵 |
| Host / Fleet / LRU | 明确 Host 策略；可驻留 Runtime 进入统一 Fleet；只复用 healthy、idle、process-compatible Host；失败/取消/漂移停止；统一 shutdown/reap | 独立 Pi JSONL Host 接入 Fleet；后期采用 workspace/process resident、多 Session 串行切换；旧接口落后当前 planned shutdown protocol 3 | RPC 进程可长期驻留；`new_session`、exact `switch_session` 会 teardown/rebind Session runtime；`get_state` 暴露 idle/queue 状态 | `resident_multi_session`；接入当前 owner、lease、LRU、quiescence、deadline reap 与 Built-in process config。复用 identity 为 canonical workspace + process digest，当前 Camp/member invalidation scope 随独占领取更新，其他 Runtime 的 member-scoped 行为不变。真实 A→B→A 跨 Camp 共用 Host、同时并发使用不同 Host，Core planned shutdown 后 Host 与私有 binding 全部回收；MCP Assignment 不进入 compatibility 或 LRU | idle TTL/capacity eviction、packaged App shutdown 与 Core crash recovery 尚未取得真实进程树证据；macOS x64/Windows 尚未验证 |
| Native Session / Continuation | Conversation 稳定绑定 Native Session；warm、Host restart、Core restart 都 exact；恢复失败 continuity lost 且最多一个 replacement；禁止 recent/partial/fuzzy | 保存 full UUID 与 canonical session file；实际 `switch_session(exact file)` 后 `get_state` 核对；完整 locator 仅 Core 私有；Probe 使用独立 session dir | `get_state` 返回 full `sessionId`/`sessionFile`；`switch_session(sessionPath)` 精确加载；Session JSONL 原生持久 | 接入 `New / Compatible / Controlled`，核对 installation/generation、entrypoint、compatibility、binding/generation、expected full ID 与 epoch。真实 Core+Host restart cold exact resume、warm continuation、A→B→A 切回均保持 full Session identity；两个 Session 的算术上下文没有串线；公开面无 locator | 错 locator 后单 replacement 仍是 deterministic coverage；macOS x64/Windows 尚无真实 continuation |
| Bootstrap / Context | Session Charter/Identity/Memory 位于 system/developer 等价高权限层；每 Prompt 绑定冻结 Manifest、Bootstrap、membership、attachments、Skills、delivery、epoch、binding | managed extension 在 `before_agent_start` 追加 `managed_system_prompt`；阻塞 receipt 验证 base/effective prompt、Bootstrap、Skills、native Tools 与 binding digest | 官方 `before_agent_start` 可读取 chained system prompt 与结构化 prompt options，并返回替换后的 system prompt；发生在 provider request 前 | revision 2 已确认并实现：在当前 `PreparedContext` / `PreparedSessionBootstrap` 增加 `ManagedSystemPrompt`；closed receipt 先于请求并与 Input accepted 原子提交。Receipt/binding 不携带 MCP，历史 Manifest MCP 字段在恢复时忽略 | 真实 A→B→A 下 Bootstrap/Skill 不串线与 compaction 后 receipt 尚未完成 Golden Flow |
| Compaction | 明确三选一策略；manual、threshold、overflow+retry、失败/cancel、compact 后 cold resume 都保持 Bootstrap/Skill/permission | 选择 `native_system_prompt_preserved` 候选，但旧分支未完成 Golden Flow，保持 Disabled | RPC 有 `compact`、`compaction_start/end`、`session_compact_failed` 与 retry；Pi 的 system prompt 独立于被压缩 message history | 选择 `native_system_prompt_preserved`；不走 first-payload redelivery；下一 Prompt 仍以新 receipt 证明 effective system prompt；生命周期 parser/fence 已实现 | manual、threshold、overflow+retry、失败/cancel、compact 后 cold exact resume 的 0.84.4 真实矩阵全部尚未完成，因此此轴仍阻止 First-Class 准入 |
| Skills | 复用 Skill Library、delivery group 与 `PreparedSkillExposure`；增删改禁用和同名语义明确；真实模型可见；跨 Session 不泄漏 | `pi -> .pi/skills`；Session activation 重建 ResourceLoader；用 `get_commands` 与 receipt 核对 exact entryPath/modelVisible | 官方 Skills 从 `.pi/skills`、`.agents/skills` 等发现；`get_commands` 返回 source/path；Session switch/new 会重建 resource runtime | 增加 Pi delivery group；每次 activation 重建并核对 exact catalog/path/modelVisible。真实 0.84.4+MiniMax 覆盖导入与调用、Revision update、disable/re-enable、unassign/restore、hard delete、Core restart、project-owned 同名 shadow；全部在同一 resident Host 的不同 Session 上证明无旧 marker 泄漏 | 本机该轴已 `Verified + Implemented`；macOS x64/Windows 仍需重复平台 Golden Flow，compaction 后 catalog 连续性仍随 Compaction 轴待验 |
| External MCP | Runtime 可以明确接受 `Unsupported` 差异；此时不得形成 projection 或隐式依赖 | 旧分支曾实现 Pi 专用 Core bridge，现已整体删除 | Pi 核心没有原生 MCP；官方 Extension 的通用 Tool API 不等于产品必须自建 transport | `Unsupported`；Pi dispatch 在 MCP preparation 前分流，静默忽略保存的 Assignment，不读配置、不启动 Server、不转换/调用 MCP Tool，且 MCP 不参与 compatibility、LRU 或 exact resume；Assignment/UI/其他 Runtime 不变 | 当前版本明确接受差异，不作为 Pi 平台资格缺口 |
| Tool / Action / Command Output | 稳定 native ID；唯一 started→terminal；重放/累计不重复；六类 command output；command 必须进入 Action payload；未知 shape 不猜 | managed extension 报告 Tool；Core bridge approval；旧 bash 曾硬编码 `/bin/zsh -lc` | `tool_execution_start/update/end` 带稳定 `toolCallId`；update 累计、end 权威；Pi shell backend 由用户/平台配置 | managed extension 用 `getShellConfig()` 报告实际 path/args/argv-or-stdin transport；Core 无损映射 `ShellCommand`，否则 fail closed。真实 Bash 在单 Run 覆盖 stdout、stderr、mixed、empty、exit 7 与 >50KB/2500 行输出；每个 Tool ID 只形成一个 terminal Action，大输出 public preview 有界且完整 Blob 可取；write allow/deny/cancel 已跑；replay/unknown/WSL stdin 有 deterministic tests | Windows shell identity 与真实 cumulative/replayed wire 故障注入尚未完成 |
| Narration / Final / Missing-Send | thinking/debug 私有；明确权威 final；stream/snapshot 去重；zero-send、accepted suppression、tool→final；无可靠 final 不启用恢复 | `message_end` 保存 assistant snapshot；只认 `agent_settled` 成功；旧分支 tool→final 不完整 | 0.84.4 的 `agent_settled` 表示 retry、compaction retry、queue 全部收敛；`message_end.message` 是完整 assistant snapshot | delta 只作 live narration，terminal snapshot 去重；唯一 authenticated `agent_settled` 才成功。真实 Pi zero-send、accepted-send suppression 与原生 Read tool→final 三条专项 flow 已通过，Bash matrix 另证实多 Tool 后 final | retry/compaction/queued follow-up/cancel 下 settled 唯一性仍主要为 deterministic evidence；需纳入完整 Golden Flow |
| Permission / Approval / Workspace | 使用已验证 native最高权限默认；Approval 统一到 Action Safety；allow-once 唯一副作用；deny/cancel 无副作用；未知 mutation failure fail closed | Pi 仅 `managed` approval；由 extension 注册受管 native tools；mutation 先 durable approval | 上游无 sandbox、无 permission popup；Extension `tool_call` 可执行前 block，handler error 会 fail-safe block；Tool 使用 Pi 进程 OS 权限 | Pi schema 只有 `managed`；受管 read/write/edit/bash 的 allow-once 绑定 call/digest/epoch。macOS 真实 allow 创建一次、deny 不创建、cancel 1.5 秒 grace 后无文件；未知 mutation fixture fail closed | read-only Run、attachment/temp 边界及 macOS 完整 workspace escape；Windows/macOS x64 均无真实安全矩阵 |
| Built-in `rovai` CLI | 当前 bundled CLI、operation catalog、Charter 与 per-Run lease；真实正式 operation smoke | 通过受管 Bash 与 Fleet builtin process config；旧 smoke 曾受 provider 并发预算中断 | Pi 可通过受管 shell Tool 调用 bundled CLI；无 Pi 专有 Built-in transport | 复用当前 Built-in Tool Runtime/lease/env；真实 0.84.4 完成当前 15-operation full Run 和 resumed/new-lease Run，覆盖三种输入、Gather、exact successor read、conflict 与 lease fencing | 另外两个平台及 packaged shutdown 未验证；本机能力本身已是 `Verified + Implemented` |
| Usage / Cache / Cost | 有结构化 usage 就实现；字段保留 source/scope/counter/input semantics/session/turn；baseline/dedupe；未知保持 NULL；不推价格 | 旧分支因未完成归因而 Disabled | `message_end.message.usage` 是该 assistant response 的权威 usage；字段含 input/output/cacheRead/cacheWrite 与 provider cost；session stats 是全 Session total | 仅 terminal assistant `message_end.message.usage` 形成 `model_call/delta/exclusive_buckets`，按 session+prompt+message digest 去重；session stats/update 不计量。真实 MiniMax Monitoring 观察到 input/output；未知 cache/reasoning/cost 保持 NULL | cache read/write 非零语义、provider cost、retry/compaction/cold resume 去重的真实计量矩阵尚未完成；不消费未证明的 ToolResult/compaction nested usage |
| Retry / Queue / Cancel / Cleanup | accepted 使用 native evidence；不重投；queue/retry/late event fenced；业务 cancelled 先提交，cleanup best effort；host quiescent 才进 LRU | prompt response + managed receipt 作为 accepted；abort+Fleet stop；旧分支早于 Cancellation Settlement v2 | prompt response 明确 accepted/queued；有 `clear_queue`、`abort`、retry/queue events；`agent_settled` 为最终收敛 | receipt 与 accepted 原子提交；cancel 先提交业务终态，再 `clear_queue`+`abort`+bounded reap；late event 被 epoch/binding fence 丢弃。真实 Bash cancel 严格为 `cancelled` 且无延迟文件；Core planned shutdown 后精确 descendant 与 Host config 均为零；cleanup/replay 有 deterministic coverage；Pi 无 MCP cleanup 路径 | crash、invalid JSON、Probe timeout、真实 retry/queue late event、idle eviction、packaged planned shutdown 与 Core crash recovery 尚未完成 |
| Ready / Version / Platform | availability、authenticated Ready、capability、platform qualification 分离；专属 immutable evidence；每 shipped platform独立 Golden Flow | 旧分支有 deep probe/validator，但曾提前把 macOS arm64 qualified；后加 exact switch 与独立 session dir | `--version`、RPC state/catalog/extension handshake 可证明 machine ready，但不能自动证明行为资格 | Pi 专属 deep probe 已在本机 0.84.4 真实通过：创建 Session→full ID/file→replacement→`switch_session(exact file)`→`get_state` ID/file/cwd；Probe 使用临时 `--session-dir` 且无污染；snapshot/dispatch 复检。缺安装时只降级 `runtime.pi`；三平台均以 `preview` 开放 discovery、检查、选择与 AgentRun，Fast 仍 hidden | macOS arm64 尚无完整 Golden Flow/immutable artifact；macOS x64、Windows x64 完全无真实证据。Windows `.cmd/.bat`/interpreter/resolved target/fingerprint/identity 尚待验证 |

## 实施结论

- Host 策略固定为 `resident_multi_session`，但同一 Host 任一时刻只允许一个 Active Prompt；并发必须取得另一 Host。
- 统一 Fleet 默认保留 Camp/member-scoped identity；Pi 的显式例外使用 canonical workspace + process digest 复用，当前
  独占 lease 的 Camp/member invalidation scope 随领取更新。可动态刷新的 Session、Prompt、model、Bootstrap、Skill与
  Built-in lease 不进入 process compatibility digest；MCP Assignment 完全不参与 Pi compatibility。
- Pi 是独立 `pi-jsonl-rpc` transport，不进入 ACP storage/init，也不继承 ACP capability 或平台资格。
- Pi 未安装或不在 Runtime search environment 时只把 `runtime.pi` 标成 degraded；Core 与其他 optional subsystem 正常启动。
- External MCP 固定为 `Unsupported`；Pi 静默忽略 Assignment，Core 不为 Pi 建立 transport 或 Tool bridge。
- Compaction 使用 `native_system_prompt_preserved`，不把高权限 Bootstrap 降格为普通 first payload。
- Pi 0.84.4 已有可归因的 model-call Usage，因此不允许继续把整个 Usage 轴标为 Disabled。
- Images、Web Search 与 Fast 在没有 Pi 专属结构化事件/资格前明确 Unsupported；不从正文、路径、MCP 名或普通 query 推断。
- 平台资格和实现完成分开：没有精确平台的不可变真实证据时，Pi 以 `preview` 开放 discovery、成员选择与 AgentRun
  供主动测试，但不得宣称 First-Class/qualified。

本机当前结论是 `Core Compatible / platform preview`，不是 First-Class。已通过的真实 smoke 关闭了多个实现疑问，
但上表最后一列仍有 Checklist 核心轴缺口，不能用 Preview 可运行性或 deterministic fixture 把任何 shipped platform 晋升。

## 上游证据入口

- [Pi RPC mode](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)
- [Pi extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- [Pi security model](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md)
- [Pi skills](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)
- [Pi compaction](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md)
