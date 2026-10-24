---
document_type: research-note
authority: non-normative
status: pre-implementation
last_updated: 2026-10-24
---

# 原生 Home／共享 Gateway：切换前边界实测

本次落实 User sequence 46 要求的第一步调查。Rovai 基线为
`0279267e6a1dfbe4c2611e84b855508589c50647`；官方 Hermes 为未修改的 0.22.4，
source commit `4d04303818b61bf3aa09278af48356315515965b`，macOS arm64。
这是生产切换前的诊断，**没有修改生产启动路径，也没有完成完整协作接入**。

结论：官方 ACP 的原 Session 恢复、定向取消与连接退出边界可用；但当前官方 ACP 没有将
Rovai 的进程级 CLI 调用上下文带进已有 Gateway 的工具进程。直接替换启动命令会失去内置
`rovai send` 所需身份，不能把普通 ACP 成功当作完整 Rovai Run 已通过。

## 方法与隔离

- 使用[一次性诊断脚本](native-acp-boundary-probe.mjs)，实际执行官方
  `hermes --profile default acp`；不运行 Rovai `host.py`，不修改官方源码或 Python 入口。
- 原生 `HERMES_HOME` 指向临时测试目录中的 `.hermes`；由测试者预先写入仅连接 loopback
  Responses 端点的配置。测试 Home 只复用已准备的 `installs/` 依赖缓存，不复制日常配置、凭据或会话。
  这是测试隔离，不是新的生产 Home 机制；生产固定用户 `~/.hermes` 的启动代码尚未实现或验收。
- 测试先启动一个原生 Gateway，再启动两个官方 ACP 连接和不同 Session。各 ACP 环境具有不同的
  `ROVAI_CLI_CONTEXT`、`ROVAI_AGENT_CLI`、合成 Run 标记；Gateway 环境不含这些标记。
- 固定本地模型响应调用真实原生 `terminal` 工具：读取环境、执行 `rovai --version`、调用真实
  CLI 的 `send`，以及执行可观察的短命令。没有付费模型请求，没有创建 Core 成员、Run 或有效 lease。
- 原 Session 冷恢复时更换 ACP 环境标记再验证一次。此步骤验证传递缺失，不冒充实际 Core lease
  轮换验收。诊断中 `send` 均失败，没有发出公开消息。
- 只比较测试 `config.yaml` 与 `.env` 的前后字节；没有据此宣称所有用户 Hook、插件和指令文件
  均已通过无侵入验收。原始模型 wire 留在本机临时目录，不提交。

## 实际结果

提交版探针已重新执行，结构化脱敏结果见[诊断记录](native-acp-boundaries-2026-10-24.json)。

| 检查 | 观察与结论 |
| --- | --- |
| 两个 Session 普通输入及原生 terminal | 正常完成，Session ID 不同 |
| 原 Session 冷恢复 | 返回原 ID，后继任务正常完成 |
| 三次 CLI 身份检查：A、B、冷恢复 A | `ROVAI_CLI_CONTEXT`、`ROVAI_AGENT_CLI`、Run 标记全部缺失 |
| `rovai --version` | 可找到 CLI，输出 `rovai 0.4.16 contract-v43 ipc-v3`；这不证明它是当前 Run 绑定的 CLI |
| 绝对路径调用真实 CLI `send` | 三次均退出 2，返回 `builtin_tool.cli_error`；没有公开 Send 成功 |
| A 执行中发送官方 `session/cancel`，同时 B 执行 | A 返回 `cancelled`；B 返回 `end_turn` 并写入预期文件；原 Gateway 存活 |
| A 工具执行中关闭 ACP stdin | ACP 退出；已提交工具仍写出完成文件；原 Gateway 存活 |
| A 工具执行中强杀 ACP | 工具仍写出完成文件；原 Gateway 存活 |
| Gateway 不存在时由官方 ACP 自动启动 | 原生 Gateway 的 PPID 是 ACP，PGID 是自身；关闭 ACP 后 Gateway 存活 |
| 测试配置 | `config.yaml`、`.env` 字节未变 |
| 清理 | 本次测试启动的两个 Gateway 已退出；未清理或操作日常 Gateway |

以上取消结果是官方当前请求的明确终态，不是“所有外部效果均已撤销”的承诺。断开连接和杀死 ACP
均不能证明执行停止，也不能据此将已接受输入自动重发。

## 源码解释

官方 [ACP new_session](https://github.com/NousResearch/hermes-agent/blob/4d04303818b61bf3aa09278af48356315515965b/acp_adapter/gateway_server.py#L269)
将 cwd、editor MCP、编辑审批和原生启动标志传给 `session.create`；没有收集或转发 `client_env`。
[恢复路径](https://github.com/NousResearch/hermes-agent/blob/4d04303818b61bf3aa09278af48356315515965b/acp_adapter/gateway_server.py#L340)
同样不携带这份环境。CLI/TUI 的
[client_env_policy](https://github.com/NousResearch/hermes-agent/blob/4d04303818b61bf3aa09278af48356315515965b/hermes_cli/gateway_chat.py#L51)
不能推导为 ACP 已经具备同一运输能力；其
[原生默认名单](https://github.com/NousResearch/hermes-agent/blob/4d04303818b61bf3aa09278af48356315515965b/agent/session_client_env.py#L23)
也不包含 `ROVAI_*`。

Rovai 当前通过 [BuiltinToolRuntime](../../../crates/rovai-core/src/builtin_tool_runtime.rs)
给 ACP 进程注入 CLI 路径和上下文文件位置，真实 CLI 的
[load_context](../../../crates/rovai-core/src/bin/rovai.rs) 必须读取 `ROVAI_CLI_CONTEXT`。
原生 Gateway 没有继承后，工具中偶然能找到同名命令也不能取得当前 Run/成员/Binding/epoch 身份。

官方 [cancel](https://github.com/NousResearch/hermes-agent/blob/4d04303818b61bf3aa09278af48356315515965b/acp_adapter/gateway_server.py#L440)
定位当前 Session 的 admission；
[aclose](https://github.com/NousResearch/hermes-agent/blob/4d04303818b61bf3aa09278af48356315515965b/acp_adapter/gateway_server.py#L1165)
关闭连接与本地观察任务，不停止 Gateway 或等同取消执行。
Rovai [ManagedProcess](../../../crates/rovai-core/src/managed_process.rs) 当前会捕获并清理后代，
所以只依赖原生 Gateway 的独立进程组还不够：未来切换必须明确只拥有 ACP 连接进程。
本次没有用生产 Fleet 整树清理去杀测试 Gateway；该生产保护仍待实现和回归。

## 尚未通过的范围

- 完整 Core 的两成员公开 Send、准确 Run/epoch 归属、下一轮真实 lease 更新：**未通过前置运输条件**。
- 生产 Fleet 的连接级回收、退出／更新／崩溃清理：未实现，不把原生进程行为当作生产保护通过。
- 原生 MCP 新建、恢复、Gateway 重启及撤销语义：本次未测。
- 旧私有 Binding 切换、首次规则／真实更新／取消压缩补发：本次未实现或回归。
- 原生 Memory、Skills、用户 Hook、指令文件完整矩阵及其他平台：本次未测。

本轮不通过私有 Home、逐 Run Gateway、全局环境、按 cwd 猜身份或临时 MCP 桥接绕过 CLI 缺口。
如果保持本方案全部边界，当前 0.22.4 只能证明普通原生 ACP 能工作；完整协作仍需经过验证的
会话级 CLI 身份运输。是否继续交付能力受限的接入，不能隐含为“协作已完成”。

## 可重复执行

```sh
node docs/research/hermes-runtime/native-acp-boundary-probe.mjs \
  /absolute/path/to/hermes \
  /absolute/path/to/prepared/hermes-home \
  /absolute/path/to/rovai
```

第二个参数只提供现成的 `installs/`。脚本生成新测试目录和本地模型端点，不启动 Core，也不读取
现有 CLI lease。它把“内置 CLI 环境没有传递、Send 失败”作为被检查的当前事实；脚本退出 0 表示
复现这些边界成功，**不代表完整接入验收通过**。上游修复后该断言应失败并重新评估，不能继续沿用旧结论。

新的输入策略完整提案见 [R2 待确认对照](first-input-r2-proposal.md)。它尚未替代已确认 R1 或当前合同。

本轮检查：提交版原生探针、Node 语法检查、`git diff --check`、`pnpm docs:test`（10 项）、
`pnpm docs:check`、以 PR base `cd3cc99119c45f8ee47e55fe763bab773447a75c` 运行的
`pnpm docs:check:ci` 均通过。本次只有研究文档和诊断脚本，未修改生产代码，未重跑 Rust 全量、
真实付费模型、MCP、完整 Core 协作或平台矩阵。
