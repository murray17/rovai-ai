---
document_type: research-note
authority: non-normative
last_updated: 2026-10-23
---

# Hermes 官方入口验证

**官方入口可以使用。** 已跑通专用官方 Gateway、公开 `hermes acp`、真实模型对话、终端操作，以及
重启 Gateway 后恢复同一个原生 Session。重启后系统指令和终端环境更新，上一轮历史保留。
此前“公开入口无法把实际执行者交给 Fleet”的表述过于绝对：只管理 ACP viewer 不足够，但另行托管
专用 Gateway 可以建立执行所有权。

这不等于直接把当前 launcher 改成 `hermes acp` 就完成接入。官方 ACP 暖会话没有暴露当前 Rovai 所需的
逐 Run 系统输入/CLI 环境重绑定；公开 Gateway RPC 也只在创建时绑定该环境。
**目前实测可行的无原生源码覆盖路线，是按执行所有权隔离 Gateway，每 Run 重启并冷恢复原 Session，
再补齐必要的 Gateway RPC 与事件映射。** 本文记录切换前 Probe；后续 User sequence 18 已授权切换，
当前生产实现与增量验收见 [Hermes 接入记录](README.md)及[当前合同](../../contracts/hermes-managed-runtime-v1.md)。

## 测试边界

- 安装：官方 source distribution 0.22.4，commit `4d04303818b61bf3aa09278af48356315515965b`，源码干净。
  commit 仅标识本次证据；兼容策略仍为最低版本，不增加 commit 或上界 fence。
- 平台：macOS arm64。自动验收通道，独立临时 `HERMES_HOME`、project；不启动 Rovai App/Core，
  不访问日常 Rovai userData，不连接日常 Hermes Gateway。
- 实际入口：`hermes --profile default gateway run --force --no-supervise --external-supervisor`，
  以及独立进程的 `hermes --profile default acp`。核对 Gateway lock 的 Home/PID，进程树由 Probe 回收。
  不使用 `--replace`，不改 installed Python 源码，不调用当前 `host.py`。
- 受控验证：本机 Responses SSE 端点，真实 Hermes 执行器和文件/终端工具。系统层与 `ROVAI_CONTEXT`
  使用假标记；这能证明环境传递是否正确，**不是完整的 Rovai CLI lease/公开 Send 验收**。
- 真实模型：独立私有 Home，只复制已授权 Sub2API provider 的必要配置/凭据，运行 `gpt-6.1-sol` 两轮。
  验证同 Session 的历史连续性、更新后的 system canary 和真实 terminal 环境。临时凭据已移除。
- RPC 对照仅通过官方本地 socket 票据与 Gateway WebSocket 通信。测试客户端借用安装绑定的 Python/bootstrap
  导入原生连接帮助函数，不构造 Agent、不修改服务端、不绕过认证。生产可另实现此连接层。

## 实测结果

| 关注点 | 结果 | 接入影响 |
| --- | --- | --- |
| 独立执行所有权 | 专用 Home 的 Gateway PID 与启动子进程匹配；所有验收进程和取消 worker 已退出 | 可受管，但 Fleet 必须管理 Gateway 与 ACP 两层，不能仅持有 viewer PID |
| 暖会话系统输入 | Gateway 以标记 A 启动；ACP viewer A/B 各带不同系统标记。首轮及重新连接后的暖轮都使用 Gateway A | ACP viewer 的新环境不会传给已有执行者；把新 B 放进 viewer env 不生效 |
| 暖会话终端授权环境 | 同样换了 viewer 环境，终端仍读到 `GATEWAY-CONTEXT-A` | 直接复用 Gateway 会沿用旧 Run 环境，不能据此宣称新 Run lease 已绑定 |
| Gateway RPC 初始绑定 | `session.create(client_env=...)` 的系统标记和允许传递的 `ROVAI_CONTEXT` 均到达真实执行器 | RPC 能补 ACP 未转发的创建字段；它绑定的是 Session |
| Gateway RPC 重绑定 | 同 create request ID 改环境返回 `invalid_params`；携带正确 revision/generation 的 `client_env` mutation 也被拒绝 | 与已验源码中的冻结策略一致；未发现公开的逐轮环境 mutation，不能将创建重试当更新 |
| 每 Run 重启 | 重启专用 Gateway，用新启动环境恢复原 ACP Session ID；新 system 生效、旧 system 不再出现在 system 层，终端读到 B | 可绕开暖绑定缺口，保留原生 Session 历史；代价是每 Run 冷恢复 |
| 原 viewer 取消 | 原 ACP 进程持有活动 admission 时，返回 `cancelled`，真实长运行 worker 退出 | 普通取消可用 |
| 重新连接后取消 | 关闭原 viewer，加载相同 Session，再发 `session/cancel`；worker 仍运行 | 新 viewer 没有原 admission 账本，不能把 ACP 取消视为跨进程恢复取消 |
| RPC 恢复取消 | 独立 RPC viewer 读取同 Session 的活动代次，`session.interrupt` 后 worker 退出 | 公开 RPC 能补控制能力；生产仍需持久记录原 admission/generation，不能误取消后继轮 |
| 插话 | 活动 `/steer` 到达模型；轮结束后 `/steer` 发起了新模型轮 | 不能直接映射 Rovai 的迟到拒绝语义 |
| RPC 插话 | 带已过期 generation 的 `session.steer` 返回 `stale_generation`，没有新模型调用 | 原生有精确拒绝能力；应接 RPC 并保持 Rovai input/admission 账本 |
| 思考强度 | `session/set_config_option(reasoning_effort=high)` 回空选项，wire 仍 low；`/reasoning high` 和正确 fenced RPC mutation 均使 wire 变 high | 官方支持设置；通用 ACP config 方法不是可用桥接点 |
| 错误模型 | 模拟 provider HTTP 404；ACP 先输出含模型错误原文的消息事件，prompt 再返回 `admitted_turn_failed` | 失败没有伪装为成功，详情也未全部丢失；Rovai 需把详情转入错误投影，不能只显示通用 Internal error |
| 不存在的 Session | `session/load` 明确返回 `not_found` | 公开路径没有内部进程内路径曾见的静默新建问题；需映射当前结构化恢复错误 |
| 问卷关闭 | `agent.disabled_toolsets: [clarify]` 后模型工具目录没有 `ask_user`/clarify | 配置可用，不需要自动替用户回答 |
| Usage | 同一个未重建执行器的两次双调用轮，ACP input/output 从 200/20 到 400/40 | 回复 usage 有累计语义，不能直接按 Run 累加；选项 mutation 或重启又可能重置执行器计数 |

真实模型第二轮返回了新系统标记 `REAL-SYSTEM-B` 和首轮用户记忆标记 `MEMORY-OPAL-8624`；
两轮终端分别读到 `REAL-CONTEXT-A` / `REAL-CONTEXT-B`，恢复 ID 相同。
本机一次真实模型配置下，从启动新 Gateway 到 ACP load 完成约 **5.5 秒**，不含旧进程关闭和模型回复。
受控端点约 2–3 秒。它们是本机样本，不是稳定性能保证，也不能推导“冷恢复一定丢失 provider 缓存”；
真实第二轮仍有 cache-read usage。

## 文件差异证据

公开 ACP 在 `dont_ask` 模式下实际完成新增文件、覆盖文件和 replace patch，最终内容正确。
每次只收到编辑位置、准备说明和成功完成事件，没有完整 before/after，也没有 ACP diff content。
这会使现有完整 Diff 体验退化，不能用“工具成功”冒充完整文件状态。

同时订阅官方 Gateway RPC，实收到了三次成功 `tool.complete` 的 `inline_diff`：新增 `+alpha`、
覆盖 `-alpha/+beta`、patch `-beta/+gamma`；patch 原生 result 还含 unified diff。
这证实**原生有可利用的差异信息，当前公开 ACP 没有转发这些完成字段**。
其来源为 `local_viewer_events.note_tool_start/complete_fields` 的执行前快照和展示渲染，含 ANSI/显示格式。
展示用 diff 不能直接标为 Rovai 的 `full_before_after`。
切换路线需要保留可核对的完整状态采集，或如实提供原生片段；删除、移动、多文件、二进制、超限与失败等
当前受管桥已覆盖的边界，还须针对候选入口重新验证。

## 采用官方路线的实际代价

1. **生命周期**：为 Gateway 增加明确 ownership、启动、就绪、退出与进程树回收。逐轮重启要求
   Gateway 的所有权范围与 Run 相容，不能在多个无关活动会话共用一个进程时重启它。
2. **暖会话**：保留原生历史，但暂时放弃跨 Run 常驻执行器；如果需要暖复用，应推动上游增加带确认的
   system/client-env 重绑定接口，而不是把系统内容混入普通用户消息。
3. **控制协议**：普通交流可保持 ACP；精确 steer、断线恢复取消、receipt 对账等需要 Gateway RPC。
   需要映射持久 admission、generation、重放和 unknown outcome，不能仅匹配提示文案。
4. **体验投影**：复用已有 Rovai UI，但重新接好 reasoning、错误详情、Usage 和文件证据。
   原生有能力不代表当前 Adapter 已通过这条入口取得同等证据。
5. **配置与恢复**：专用 Home 如何使用用户原生 provider/Skills/记忆，MCP 在重启后如何重送并保持同一 assignment，
   都要实现清晰边界。此次干净 Home 不证明这些产品配置迁移已完成。

官方路径的主要收益是减少对内部 `HermesACPAgent(SessionManager())` 和 `AIAgent` seam 的依赖。
本轮已证明它值得作为候选继续实施，不再以“只能内部入口”为理由排除它；尚未证明可无代价替换当前实现。
本次不修改生产 Adapter，也不重新声称 Core/App 的完整验收已覆盖官方路线。

## 复现与来源

```bash
ROVAI_HERMES_BIN=/absolute/path/to/hermes node scripts/smoke-hermes-official-acp.mjs
```

脚本创建全新私有 Home，显式运行官方 `pm repair` 准备本 Home 的依赖，随后使用本机受控模型。
原始 wire/events/log 留在打印的私有 fixture，不提交用户凭据或原生会话正文。
[脱敏结果](official-entry-evidence.json) 记录本次结果；真实模型步骤为相同入口创建会话、执行终端、关闭两层进程、
新环境启动、精确 load、再执行终端并回忆前轮标记，非当前 managed smoke 的替代证明。

- [官方 ACP 集成](https://hermes-agent.nousresearch.com/docs/user-guide/features/acp)：公开入口和工具/模型/会话接口。
- [官方 Gateway local sessions](https://hermes-agent.nousresearch.com/docs/developer-guide/gateway-local-sessions)：原生执行所有权、Session 创建与 durable admission。
- [本次安装源码](https://github.com/NousResearch/hermes-agent/tree/4d04303818b61bf3aa09278af48356315515965b)：
  `acp_adapter/gateway_server.py`、`gateway_commands.py`、`agent/session_client_env.py`、
  `gateway/session_policy.py`、`session_mutations.py`、`local_viewer_events.py`。
