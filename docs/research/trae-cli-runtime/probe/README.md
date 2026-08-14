---
document_type: runtime-probe-record
runtime: trae-cn-cli
observed_at: 2026-08-15
status: verified-local
---

# TRAE CLI CN ACP Probe 记录

本记录补充上一级 Research Brief。所有测试均在临时工作目录中直接启动
`traecli acp serve`，没有启动日常 Electron/Core，也没有修改用户级 TRAE 配置。
模型回复与 Session ID 已脱敏；Capability Snapshot 只记录协议和结构化能力事实。

## 被测构建

| 项目 | 观察值 |
| --- | --- |
| executable | `traecli` |
| version | `0.120.52` |
| build commit | `6756e52a9238b6d493928e55b05127957dbfefb4` |
| build date | `2026-08-12T01:31:30Z` |
| ACP command | `traecli acp serve` |

## Initialize / Session Snapshot

- `initialize` 协商结果为 `protocolVersion: 1`；stdout 全程为合法 JSON-RPC，stderr 为空。
- `agentCapabilities.loadSession` 为 `true`，并返回 Session list 与 HTTP/SSE MCP capability。
- 当前已认证环境返回空 `authMethods`，没有要求交互式登录。
- `session/new` 返回非空稳定 `sessionId`。
- Session 的 `configOptions` 实际包含 `model` select；当前模型为 `GLM-5.2`，本次返回 16 个可选模型。
- Session 的 mode catalog 实际包含 `default`、`bypass_permissions`、`plan`。
- 同一真实模型配置通过 `session/set_config_option` round-trip。
- 第二个 Host 对首个 Host 创建的 Session 执行 `session/load` 成功，后续 prompt 能恢复上一轮 marker。

## System Prompt 实测

当前二进制接受进程级 `--config append_system_prompt=...`。`--print --output-format json`
的真实请求快照显示该内容进入独立的 `role: "system"` message；ACP Host 使用同一配置注入随机
marker 后，Session prompt 能只凭 system message 返回该 marker。含逗号或引号的值必须按 pflag
string-slice 的 CSV 单项规则编码，否则进程会在 `initialize` 前退出。

这证明 TRAE 具备 native system prompt 追加能力，不证明任意模型都会可靠服从冲突指令：一次
system/user 冲突实验中，GLM-5.2 仍选择了 user token。Rovai v0.83 因此把它记录为观察到的
capability，但正式 ACP AgentRun 继续沿用已建立的 `FirstPayload` Charter 路径，不把
`append_system_prompt` 作为唯一正确性边界，也不写用户级或项目级 TRAE 配置。

完整的脱敏结构见 [capability-snapshot.json](capability-snapshot.json)。模型目录由每次
`session/new` 返回动态建立，本文的数量和当前值不是产品静态目录。

## 行为门槛

| 门槛 | 实测结果 |
| --- | --- |
| Prompt 终态 | 普通 prompt 返回 `stopReason: end_turn` |
| Cancel | tool 执行期间发送 `session/cancel`，prompt 返回 `stopReason: cancelled`；延迟检查未产生目标文件 |
| Tool identity | `toolCallId` 在 started/update/terminal 生命周期内稳定 |
| Permission request | 收到结构化 `session/request_permission`；allow/reject option 均带稳定 option ID |
| Approval deny | 选择 `reject_once` 后文件不存在，tool terminal 为失败 |
| Approval allow | 选择 `allow_once` 后仅目标临时文件按预期写入，tool terminal 为完成 |
| MCP additive | Session A 在 `session/new.mcpServers` 追加 fixture MCP 并真实调用；同 Host 的 Session B 不追加时不可见 |
| Session recovery | 跨 Host `session/load` 成功并恢复上一轮 marker |
| Protocol hygiene | 全部 Probe 的 stdout 无非 JSON-RPC 行，stderr 无协议污染 |
| Native system prompt | `append_system_prompt` 形成独立 system message，随机 marker 行为 Probe 通过 |

MCP 结论采用 Rovai 现有 `AdditivePerRun` 语义：保留 Runtime 原生配置，只把本次
AgentRun 的 Definition 放进 `session/new` / `session/load`。不新增 TRAE 专属 Transport、
配置副本或所谓隔离模式。

## 正式 Core 验收

- `ROVAI_ACP_SMOKE_ADAPTER=trae-cn-cli pnpm smoke:acp-runtime` 通过 completion、同一 Native
  Session 的后继 Run、allow-once 精确写入与 Rovai Approval deny；拒绝目标文件不存在。
- `ROVAI_MISSING_SEND_RECOVERY_ADAPTERS=trae-cn-cli pnpm smoke:missing-send-recovery` 通过
  zero-send publication、accepted-send suppression 与带结构化 tool event 的真实 tool→final 协议 fixture。
- `ROVAI_MCP_PROJECTION_SMOKE_ADAPTERS=trae-cn-cli pnpm smoke:mcp-projection` 真实调用
  `rovai_smoke` 并返回 `rovai-projection:trae_cn`，冻结 exposure 为 Ready。

这些结果也暴露并修复了非复用 Host 的终态竞态：TRAE 与 Kiro 一样，必须在 durable terminal
对后继 Run 可见前完成 Host teardown，再由新 Host `session/load` 同一 Native Session。

## 分类结论

- 当前构建和账号：`ready`。
- `initialize` / `session/new` 返回明确登录、credential、unauthorized 或 authentication
  错误时：`authentication_required`。
- ACP v1 未协商、`session/new` 无 `sessionId`、缺少必要 Session/permission/MCP 能力或返回
  不合法 JSON-RPC 时：不可进入 Ready；由 Probe 产生 `missing_capabilities`，上层 Probe
  Attempt 映射为 `incompatible`。
- timeout、I/O 和无法确定身份的 transport 故障保持 `probe_failed` / transient，不冒充不兼容。

没有为了制造未登录样本而登出用户账号；认证与不兼容分支由同一纯分类器的确定性 fixture
覆盖。真实登录态 Probe 只证明当前环境的 Ready 路径。

## 边界说明

- 不传 `--yolo`；默认保存的 native permission mode 为 `default`。
- TRAE 会读取其原生的用户级 instruction 文件。这是 Runtime 自有行为，不构成 Rovai Skill
  projection 证据；第一版 Skill discovery 仍为空且标记 documentation-only。
- 第一版 AgentRun 完成后停止 Host，不声称 warm reuse；Native Session 连续性通过新 Host 的
  `session/load` 保留。
- Missing-Send Recovery 只接受 `end_turn` 后最后一个无歧义 assistant suffix，并已通过 zero-send、
  accepted-send suppression 与真实 tool→final 三条正式 Smoke；ordinary public output mode 仍为
  `explicit_send_only`。
