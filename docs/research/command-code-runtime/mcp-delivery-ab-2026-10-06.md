---
document_type: runtime-research
runtime: command-code
authority: research-evidence-only
status: verified-with-limitations
observed_version: 1.74.1
observed_platform: macos-arm64
last_updated: 2026-10-06
---

# Command Code MCP：原生配置与 ACP Session 受控对照

响应 User 消息 `b0c08164-e693-490c-8999-937acc7d0522`。结论是**保持当前原生 MCP 交付，整理上游最小复现；本轮没有切换生产接线**。
四组真实模型实验均连接、发现并搜索到目标 schema，但实际 Provider 请求的 `tools` 数组始终没有目标工具。
换成 ACP Session 交付不能解决本次已观察到的问题。独立 Provider 正向对照完成了真实 MCP 调用，但它不是 Command ACP 或 Rovai Run 验收通过。

脱敏请求、schema 摘要、模型调用、MCP 事件与完整 Session ID 见[机器证据](mcp-delivery-ab-2026-10-06.evidence.json)。
生产代码候选 diff 为 **0**；新增内容限于隔离探针、证据和研究路由。Bootstrap/System、权限、发送、取消、恢复以及自定义模型显式选择、命令数字退出码均未修改。

## 复用与本次新增证据

- 复用[10 月 5 日 ACP 证据](../runtime-monitoring/command-cline-completion-2026-10-05.evidence.json)及
  [10 月 6 日原生配置证据](../runtime-monitoring/command-cline-native-system-2026-10-06.evidence.json)：同一 Command 1.74.1、sub2api/gpt-6-sol，连接/发现成功、实际调用零。
- 旧记录没有实际出站请求的完整工具名/schema 摘要，不能单独证明搜索后的模型可调用集合。本次补齐这个观测缺口，未重复整套产品包、文件编辑或故障恢复验收。
- 当前实现是**官方 ACP 会话 + Host 私有原生 MCP 配置**，不是“不走官方 ACP”。官方分别说明了
  [ACP 客户端 MCP](https://commandcode.ai/docs/acp)和[原生 MCP](https://commandcode.ai/docs/mcp)入口；是否完成调用以本地固定版本实测为准。

## 固定条件与隔离

| 项目 | 固定值 |
| --- | --- |
| Rovai 基线 | `be9bdd3c06cbdaaf3421a5e73a8361b710700022`，`rovai/mission/052` |
| Command | 官方 npm `command-code@1.74.1`，未修改其可执行文件 |
| CLI SHA-256 | `a0727482bfd108c6bae498bc7ce29938e9d975244ee7776e505a9e61a0fda082` |
| 模型 | Runtime default `sub2api/gpt-6-sol`；出站模型字段均为 `gpt-6-sol` |
| Wire / 选择策略 | 原配置 `openai-completions`；实测 `tool_choice=auto` |
| 权限 | 每组相同的 `bypass`，未修改 Rovai 权限合同 |
| System | 同一现有 `command_code/bootstrap.mjs`，相同 B；每组 ready PID 与 Session 绑定摘要匹配 |
| 工作目录 | 同一个空白隔离工作目录，无项目 MCP 配置 |
| Host / Session | 每组全新私有 Home、PID、Session；无工具目录或历史复用 |
| 测试服务器 | 唯一名称 `rovai_delivery64`，唯一工具 `issue_receipt`，参数 `{}` |
| stdio | Node 和脚本均为绝对路径，不依赖特殊 cwd |
| HTTP | 独立本机端口，最小 Streamable HTTP JSON 响应 |
| 原生组 | 私有 `mcp.json` 仅含该测试服务器，`session/new.mcpServers=[]` |
| ACP 组 | 私有 `mcp.json` 为空，仅在 `session/new.mcpServers` 注入测试服务器 |

四组用户提示完全一致：至多搜索一次、直接调用目标工具一次、只回传本次真实 receipt；不准使用 shell/文件/web 替代。
实际模型仍重复搜索，保留为未遵守次数限制的负例，不因最终 `end_turn` 或工具卡 `completed` 判成功。
服务器只能在收到 `tools/call` 后生成随机 UUID receipt；提示词、描述和初始 schema 没有预置结果。

每组使用相同的本机透明转发观察方式：只将该私有 Home 的 Provider baseURL 指向 loopback，原始 JSON 请求转发到原 sub2api 地址，响应继续流回 Command。
没有重写 tools、tool choice、Prompt 或模型响应，也没有失败后换通道。日志不保存 headers、endpoint、完整消息、工具参数值或 stderr；仅保存工具名/schema 摘要、调用 ID/参数摘要、计数和 fixture receipt。
受控提示词和 B 本身作为探针定义保留在 manifest，和采集原生完整 System/history 不同。
这是原始官方 ACP 探针；`probeRunId` 只标识本次实验，不伪称产品数据库中的 AgentRun ID。

## 真实结果

| 组别 | Provider 请求 | 搜索调用 / 搜索后请求 | 目标进入 tools | 模型目标调用 | Server tools/call | 完整闭环 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| A 原生 / stdio | 4 | 3 / 3 | 0 | 0 | 0 | 未通过 |
| B ACP / stdio | 10 | 9 / 9 | 0 | 0 | 0 | 未通过 |
| A 原生 / HTTP | 5 | 4 / 4 | 0 | 0 | 0 | 未通过 |
| B ACP / HTTP | 9 | 8 / 8 | 0 | 0 | 0 | 未通过 |

四组 initialize、tools/list 均到达服务器。28 次真实 Provider 请求全部返回 HTTP 200，观察器无解析错误；其中 24 次请求已经携带搜索返回的目标 schema 文本。
但所有请求都只有同一组 13 个工具，名称和参数 schema 摘要完全一致：

```text
read_file, write_file, edit_file, read_directory, glob, grep,
shell_command, schedule_wakeup, activate_skill, agent, agent_output,
ask_user_question, search_tools
```

`mcp__rovai_delivery64__issue_receipt` 从未出现。24 个模型搜索调用 ID 均能关联回相同 Session 的 ACP 工具事件；对应 `completed` 带 schema，只能证明搜索完成。
最终四组均回复 `UNAVAILABLE`，服务器未生成任何 receipt。因此没有可进一步验证的产品 Run 工具结果回传，不能宣称“调用成功只是 UI 没显示”。

### 独立 Provider 正向对照

为区分模型/名称/schema 不兼容与 Command 请求组装，另用一个明确标记为 **diagnostic-only** 的最小 MCP Client：
同一 sub2api 配置、`gpt-6-sol`、Chat Completions、`tool_choice=auto`，请求工具数组含服务器实际 `tools/list` 返回的 schema。
这个对照只有一个工具和最小提示词，不属于四组 A/B，不模拟 Command 的完整 System/history。

结果为：模型真实选择 `mcp__rovai_delivery64__issue_receipt`、参数 `{}` → Server 收到一次 `tools/call` →
服务器当场生成 `RCP_5bcc0e3e-d0f7-4480-9fa4-c31cec9a3a62` → 第二次模型请求携带该结果 → 模型原样回传。
两次请求均 HTTP 200。它证明该名称、schema 和服务器可被当前真实模型使用，**不证明 Command ACP 接线已修好**。

## 定位与处理决定

实测将故障边界收窄到：**搜索已返回 schema，后续 Command Provider 请求却没有把它注册为可调用工具**。
这在原生与 ACP、stdio 与 HTTP 中一致，没有证据支持把原生交付方式作为根因，或先切默认再补验。

固定 1.74.1 发布代码与该现象吻合：

- `supportsDeferredTools` 根据模型 canonical ID 的排除集合判断；集合包含裸 `gpt-6-sol`，当前 qualified BYOK ID 进入 deferred 路径。
- `isDeferredTool` 将非 `alwaysLoad` 的 external 工具归为 deferred。
- `createToolCatalog.schemas` 在 deferred 开启时过滤这些工具；`createSearchToolsTool.run` 返回 schema 文本，没有改变后续 `schemas` 的可见集合。
- 原生/ACP 服务器最后都进入相同工具目录；交付入口变化没有改变本轮请求结果。

这些是结合发布代码的定位依据；未补丁修改上游、未伪装模型 ID，也未注册替身工具来冒充原生 MCP 修复。
Rovai 的处理是保持生产原生配置路径，将下述复现交给上游排查 deferred-tool 激活和 BYOK Provider 请求组装。
本轮只准备可提交的复现材料，未向外部仓库发布 Issue。

检查了 `acp.rs` 的 `session/new`、`session/resume`、`session/load` 共用服务器构造路径，Command 当前有意排除 Session 注入。
也确认通用 `external_acp_server()` 没有保留 stdio cwd；第一轮夹具已排除该变量。
由于没有采用 ACP 候选，**没有声称通过** ACP cold 恢复、同名优先级、cwd、字面 env/headers、warm/cold、更新/撤销 fence 矩阵；
任何未来切换仍须完成这些门槛，不能复用原生路径的通过记录冒领 ACP 资格。

## 可复现入口与上游报告

在仓库根目录运行。`--source-home` 使用已有、专门授权的隔离 BYOK Home，`--out` 必须不存在；不要指向日常 userData。
需要 Node 和官方固定版本安装。脚本不安装、不升级 Command，也不修改 source-home。
Provider 正向对照会私下解析配置中既有的 key reference，不打印凭据；当前复现只支持本轮实际使用的 Chat Completions wire。

```sh
node docs/research/command-code-runtime/fixtures/mcp_delivery_probe.mjs \
  --command-cli /absolute/isolated-install/node_modules/command-code/dist/cli.mjs \
  --source-home /absolute/isolated-native-home \
  --out /absolute/new-probe-root

node docs/research/command-code-runtime/fixtures/mcp_provider_control.mjs \
  --source-home /absolute/isolated-native-home \
  --out /absolute/new-provider-control-root

node --test docs/research/command-code-runtime/fixtures/mcp_delivery_probe.test.mjs
```

上游 Issue 可直接使用以下摘要，并附此处的固定版本、探针和脱敏 JSON：

> **Command Code 1.74.1: MCP schemas remain absent from outgoing BYOK tools after search_tools**
>
> With a custom `sub2api/gpt-6-sol` default model using `openai-completions`, both native MCP config and official ACP `session/new.mcpServers` connect and discover the same minimal server. After `search_tools` returns its complete schema, every subsequent provider request still contains the original 13 tools and omits `mcp__rovai_delivery64__issue_receipt`. This reproduces with both stdio and HTTP in fresh isolated processes/sessions (28 requests, 24 post-search requests, zero target calls).
>
> Expected: a successfully discovered/loaded target becomes callable through the provider's supported tool mechanism. Actual: schema is only present as tool-result text; the model repeats search and eventually reports unavailable. A separate direct-provider control with the actual schema in `tools` invokes this MCP server and returns its fresh server-generated receipt correctly. It is a diagnostic control, not an ACP workaround.
>
> Please investigate deferred tool activation and BYOK provider request assembly, including qualified model-ID handling in `supportsDeferredTools`. Neither the Command binary nor production tool arrays were patched. There is no dual delivery or automatic fallback in the reproduction.

所有本轮 Host 均已停止；前轮开发包与日常进程未重启。探针代码/CLI/System Mod 摘要、Session/实验标识均固定在机器证据中。
