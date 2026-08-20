---
document_type: runtime-probe-record
runtime: trae-cn-cli
observed_at: 2026-08-20
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
- Session 的 `configOptions` 实际包含 `model` select；当前模型为 `GLM-5.2`，2026-08-20 复核返回 19 个可选模型。
- Session 的 mode catalog 实际包含 `default`、`bypass_permissions`、`plan`。
- 同一真实模型配置通过 `session/set_config_option` round-trip。
- 第二个 Host 对首个 Host 创建的 Session 执行 `session/load` 成功，后续 prompt 能恢复上一轮 marker。

## `session/new` 后的异步 catalog

2026-08-20 基线不在收到 `session/new` response 后立即退出，而是继续读取有界窗口。initialize response 在
约 1001 ms、`session/new` response 在约 1215 ms 到达；约 1727 ms 收到：

```text
session/update
  params.sessionId = <same-session>
  params.update.sessionUpdate = available_commands_update
  params.update.availableCommands[] = { name, description, input: { hint } }
```

即 catalog notification 比 `session/new` response 晚约 512 ms。基线 17 项中，`agent-new`、`init`、`loop`、
`compact` 是 Runtime 内建 Slash Commands；其余 13 项的 name/description 与当时用户已有 Skill 对应：
`code-review`、`codebase-design`、`documentation-lookup`、`domain-modeling`、`feishu-docs`、`grill-me`、
`grill-with-docs`、`grilling`、`handoff`、`improve-codebase-architecture`、`mac-performance-doctor`、`officecli`、
`setup-matt-pocock-skills`。该消息位于 Idle Session，符合 ACP 动态 catalog 语义。旧 Rovai Host 会以
“without an active prompt”将它标为协议违规；当前实现路由为 Session metadata，不进入 Prompt output。

## Skill 路径与扫描时机

所有路径使用不同唯一名称与正文，且没有修改或覆盖真实用户全局 Skill：

| 路径 | Advertisement | 精确调用 | 结论 |
| --- | --- | --- | --- |
| 项目 `.trae/skills` | pass | pass | Rovai managed delivery `Verified` |
| 项目 `.agents/skills` | pass | pass | Runtime compatibility discovery；非 Rovai-owned TRAE path |
| 项目 `.traecli/skills` | pass | pass | Runtime compatibility discovery；未见公开文档，不纳入 managed path |
| 项目 `.coco/skills` | 未出现 | 未执行 | `NotObserved` |
| 隔离用户 `~/.trae/skills`、`~/.trae-cn/skills`、`~/.traecli/skills`、`~/.agents/skills` | pass | 未完成 | discovery/advertisement `Verified`；隔离 HOME 无模型目录，Prompt 在调用前报 `Models is required`，invocation `Unverified` |
| 隔离用户 `~/.coco/skills` | 未出现 | 未执行 | `NotObserved` |

项目 `.trae/skills/documentation-lookup` 与用户 `~/.agents/skills/documentation-lookup` 同名时，catalog description
及真实调用结果都来自项目唯一 marker。扫描发生在 `session/new` / `session/load`：同一 warm Host 新建 Session
可见新加入 Skill；已经建立的 Idle Session 在 5 秒内没有 refresh；cold Host `session/load` 可见。只有
`.trae/skills` 同时具备稳定项目作用域、advertisement 与真实调用证据，因此 Rovai 新增 TRAE delivery group
只映射该路径。本次 `traecli` help/config 检查没有提供足以把其他目录提升为 Rovai-owned canonical delivery
path 的公开合同；特别是项目 `.traecli/skills` 虽有行为证据，仍只记录为 Runtime compatibility surface。

## Compaction 观察

`available_commands_update` 公开 `compact`。手动 `/compact` 的 ACP trace 只出现普通 Session updates 和
assistant 文本 `Compaction Completed`；自动阈值 `0.01` 下触发的重复压缩同样没有标准
`compaction_update`、TRAE 私有 started/completed method、稳定 occurrence ID 或去重依据。文档所述
`pre_compact` / `post_compact` 项目 Hook 在 `acp serve` 下未触发，控制 Hook 也未触发。

因此当前结构化 Compaction signal 为 `NotObserved`，detector 为 `Unverified`，policy 继续
`CompactionDetectorPolicy::Disabled`；不能写成 TRAE 上游没有该 event，更不能用 usage/token 回退、历史变短、
summary 或普通 assistant 文本补猜。

## 2026-08-18 exact-ID Provider Resume 复核

为排除 `--resume string[="AUTO"]` 的可选参数解析歧义，本轮只使用同一次 ACP `session/new` 返回的精确
Session ID，并显式用 `=` 赋值：

| 命令 | initialize 结果 |
| --- | --- |
| `traecli acp serve --permission-mode default` | 约 0.9 秒成功 |
| `traecli --resume=<exact-id> acp serve --permission-mode default` | 30 秒内无 response；stderr 空 |
| `traecli acp serve --resume=<exact-id> --permission-mode default` | 30 秒内无 response；stderr 空 |

两种 resume 进程均保持存活，但不能完成 ACP initialize；没有使用空格赋值、`AUTO`、普通 TUI Session ID 或
最近 Session。当前 `0.120.52` 的顶层 Provider Resume 因而不能与 ACP server 组合，正式实现继续使用
`session/load`，但将其定义为独立、有界的 HistoryRestore，而非普通 Resume。

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

早期结果暴露并修复了非复用 Host 的终态竞态。当前实现进一步允许 TRAE 兼容 Host 在 terminal 后进入
IdleWarm；warm successor 直接复用同一 Host Session。Host 被回收或 Core 重启时，新 Host 在当前 prompt 前
执行受控 `session/load`：历史 replay 不进入 Evidence、Action/Approval、Usage、Missing-Send、Renderer 或
最终输出，失败则记录 continuity lost 并轮换 Binding 后建立新 Session。

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
- TRAE 会读取并通过 ACP catalog 公开多种项目级/用户级 Skill 路径；这是 Runtime discovery/load 能力。
  Rovai managed projection 是另一层，只把已验证且可安全拥有的项目 `.trae/skills` 作为 TRAE delivery group。
- 当前兼容 AgentRun 完成后允许 warm Host/Session 复用；cold continuation 使用 exact persisted ID 的受控
  HistoryRestore。禁止 `--resume AUTO`、最近 Session 扫描和 TRAE 私有 `events.jsonl` 解析。
- Missing-Send Recovery 只接受 `end_turn` 后最后一个无歧义 assistant suffix，并已通过 zero-send、
  accepted-send suppression 与真实 tool→final 三条正式 Smoke；ordinary public output mode 仍为
  `explicit_send_only`。
