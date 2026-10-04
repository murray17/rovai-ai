---
document_type: runtime-research
runtime: cline-cli
authority: research-evidence-only
status: implementation-in-progress
admission: preview
observed_version: 3.0.65
observed_platform: macos-arm64
last_updated: 2026-10-05
---

# Cline 官方 ACP 接入

Principal 在 Camp 消息 `f70e9798-8f5c-4428-821f-bd51ec0b99f6` 选择官方 ACP，在
`292c2ea2-5695-40ca-ad5d-8de31832d8fe` 允许使用 sub2api BYOK。候选入口是独立
`cline-cli` Adapter 调用 `cline --acp`，复用现有 ACP Host/Fleet；没有切换 SDK Host 的授权。
本文件记录逐轴的原生实测与 Core 接线进度，不是产品准入决定。macOS arm64 的开发 Preview
由 [V1.72-D13](../../versions/v1.72/decisions.md#v1-72-d13)拥有，其他平台仍为 NotQualified。

固定调查对象：[CLI 3.0.65](https://github.com/cline/cline/releases/tag/cli-v3.0.65)，
commit `9131e36429314ea614491bf749678adbacb3d3cb`。本机全局 CLI 3.0.3 没有被升级；真实 Probe
使用临时目录安装的 3.0.65、独立 Home/workspace，并强制官方 local session backend。
最接近的生产路径为共享 `AcpHost`（会话、权限、重放、取消），私有只读 observer 可参考
DeepSeek Harness，不能把该 Runtime 的证据借给 Cline。

| 能力轴 | Rovai 标准行为 | 上游能力面与接入策略 | Runtime evidence / Rovai implementation |
| --- | --- | --- | --- |
| Auth / Provider / Model | 官方原生配置、default/显式模型、凭据变化 fence | Cline 原生 providers/models 文件；ACP 使用 `CLINE_PROVIDER`、`CLINE_MODEL`、`CLINE_API_KEY`；按实际 catalog 核对模型 | sub2api/gpt-6-sol 的原生默认配置通过四轮真实 App AgentRun；Host 摘要和模型核验已接线；显式模型切换及凭据变化矩阵待验收 |
| Host / Fleet / LRU | 统一进程所有权、空闲复用、隔离 | 官方 stdio ACP 常驻；resident_multi_session，MCP/配置差异必须 fence | 真实共享 Host 首次、warm、A→B→A 通过；App 两成员与空闲后受控关闭通过；Fleet LRU、运行中关闭及 Core crash 待验收 |
| Native Session / Continuation | 精确 ID、warm/cold、重放隔离 | new/load 返回原生 ID；load 会重放历史，并重取 provider/model/权限默认值；必须重设冻结值 | 共享 Host exact load/replay quarantine 通过；完整 App/Core 重启后 Session ID、Binding ID、generation 精确保留，真实回帖通过 |
| Bootstrap / Context | 冻结 Charter/Identity/Memory 与每轮动态输入 | 当前 staged `first_payload` 仅是普通用户 Prompt；官方 Plugin Rule 可进入 System Prompt，拟改用既有 `managed_system_prompt` | 静态／函数 Rule 在真实 ACP 的 `beforeModel.request.systemPrompt` 均已观察到；[revision 1 方案](model-context-change-v1.70-proposal.md)待二次确认，Core 字节级投递与前置失败关闭未实现 |
| Compaction continuity | 完成信号、补发、失败/取消与恢复 | ACP 不转发 compaction；官方 Plugin status-notice 可观测 completed | Plugin/Host 完成事件桥已接线；真实 ACP 发送 `/compact` 仍进入模型调用且没有压缩事件，manual 入口未闭合；auto/overflow/cold resume 未观测 |
| Skills | 当前受管索引与原生 Skills 并存 | 共享受管索引；Cline 原生 `.cline/skills`、`.agents/skills` | 现行 main 使用平台/工具箱索引与原生文件发现，旧 Library/group 不再投递给新 Run；本轮原生项目 Skill 的 Core 候选发现和真实读取见[差异复核](../runtime-monitoring/command-cline-parity-2026-10-05.md) |
| External MCP | PreparedMcpProjection、追加、撤销、无串会话 | 3.0.65 ACP 忽略 `session/new.mcpServers`；官方 `CLINE_MCP_SETTINGS_PATH` 指向 Host 私有合并文件 | 原生隔离配置调用真实 fixture Tool Verified；Core Host 合并已实现；App 分配、原生调用、更新及未分配成员隔离通过；撤销结果见差异复核，完整并发/HTTP 矩阵未完成 |
| Tool / Action / Output | 原生 ID、唯一生命周期、可靠 command/read/edit 输出 | 终态只带 Tool ID 与 typed rawOutput；Host 配对开始事件的 title/rawInput | 共享 Host 的 read/edit/command、stdout/stderr、非零失败 Action 已通过；修复单文件 location 后，App 两成员 read/edit/read 的准确路径、持久化、点击预览与文件副作用通过；成功 Update 补丁/editor 替换已接 Command 和 Files Changed 的补丁片段；两成员、多文件、连续改回、失败编辑、非零和独立空输出实测通过；editor 原生模型路径及超大输出仍待验收 |
| Narration / Final / Missing-Send | thinking 私有、权威终态、zero-send 恢复 | agent_message_chunk 与 thought 分开；prompt stopReason / JSON-RPC error | App 四轮均 succeeded，且每轮恰一条显式 CLI 公开回帖；zero-send 恢复两轮真实通过，均只有一条公开消息 |
| Permission / Approval / Workspace | 原生权限为唯一权威、allow/deny/cancel | 官方 auto_approve 布尔、plan/act；request_permission 原样往返 | 原生拒绝无副作用 Verified；共享 Core Host 在命令发出后取消，得到 `cancelled` 且 10 秒后无文件副作用；Core allow/deny 与产品审批待验收 |
| Built-in rovai CLI | 每 Run lease 与 bundled CLI | 共享 ACP process config 注入 shell 环境，Run 结束解除 | App first/warm/第二名队员/cold 四轮真实 bundled CLI 回帖通过，cold 使用重启后当前 Run lease |
| Usage / Cache / Cost | 原生结构化字段与稳定归属，未知 NULL | 官方 Plugin afterModel 按 message ID 报 token/cache；Host 按唯一 Prompt lease 归属 | Host 与 App 四轮 17 次调用通过；四桶、可选 reasoning、live Context used、去重及 AgentRun 持久化已核验；Renderer 展示 toks/Context，窗口、比例和 Cost 未知 |
| Retry / Queue / Cancel / Cleanup | accepted fence、迟到事件隔离、整树停止 | session/cancel、ACP EOF shutdown；固定 local backend 防止逃逸到共享 hub | 原生工具与共享 Host 发命令后取消无 10 秒副作用；App 空闲受控关闭后所记录 11 个进程全部退出；Core crash、运行中关闭、队列及网络恢复待验收 |
| Ready / Version / Platform | 安装、认证、能力资格分离 | CLI 与 initialize 均报告 3.0.65；只测 macOS arm64 | App 普通 Startup Settings/Installation 深检为 Ready，两个成员可配置发送；macOS arm64 Preview，其余 NotQualified，没有借用通用 macOS qualification |

## BYOK 实测结论

官方 `openai-compatible` 的默认模型目录不自动吸收 `providers.json` 的 `model`。单独设置
`CLINE_MODEL=gpt-6-sol` 会回退到 catalog 的 `gpt-4o`，因此必须先配置官方 `models.json`，
然后在生成前核对 `session/new.models.currentModelId`。本次实际目录仅包含 `gpt-6-sol`，首次和
warm prompt 均返回指定 marker；没有用普通回复证明其他能力轴。自定义 provider ID 虽能出现在
目录，当前 ACP 的生成路径仍可报 `Unknown or disabled provider`；已验证方案使用内置
`openai-compatible` 搭配 sub2api 的原生 base URL 与自定义模型。

`CLINE_DATA_DIR` 指数据目录本身，默认是 `~/.cline/data`，不同于普通 CLI `--data-dir` 的 root 语义。
ACP 的启动分支早于普通参数的 data-dir 处理；本次通过环境变量隔离，并显式指定
`CLINE_PROVIDER_SETTINGS_PATH`。验收密钥只存在隔离原生配置和子进程环境，没有进入仓库、命令参数
或公开证据。产品不读取 Command Code 的配置来配置 Cline。

## ACP 压缩入口边界

在同一隔离 Home、官方 ACP 3.0.65、真实 BYOK Session 内，首轮普通 Prompt 后经
`session/prompt` 发送文本 `/compact`。第二轮产生 `run_started → model_completed →
run_finished` 和 `agent_message_chunk`，没有 Plugin `compaction` status-notice；这次输入
被当作普通模型请求处理，不能用它证明手动压缩。固定版本的
[ACP Agent](https://github.com/cline/cline/blob/cli-v3.0.65/apps/cli/src/acp/acpAgent.ts)
将 Prompt 文本直接交给 Session `send`，`session/new` 也未公布手动压缩命令。原生 Core
存在压缩流水线，但目前尚未证明官方 ACP 路径如何调用手动压缩。继续调查官方 Plugin API
或其他 ACP 可用入口；在找到并实测之前，此能力轴仍为 `NotObserved / NotImplemented`，
不能将 `/compact` 普通回复误认作压缩成功。

## 固定来源

- [官方 ACP 使用说明](https://docs.cline.bot/usage/acp)
- [ACP Agent 3.0.65](https://github.com/cline/cline/blob/cli-v3.0.65/apps/cli/src/acp/acpAgent.ts)
- [事件转换](https://github.com/cline/cline/blob/cli-v3.0.65/apps/cli/src/acp/session-updates.ts)
- [权限回调](https://github.com/cline/cline/blob/cli-v3.0.65/apps/cli/src/acp/permissions.ts)
- [原生存储路径](https://github.com/cline/cline/blob/cli-v3.0.65/sdk/packages/shared/src/storage/paths.ts)
- [模型配置注册](https://github.com/cline/cline/blob/cli-v3.0.65/sdk/packages/core/src/services/providers/local-provider-registry.ts)
- [原生 MCP 配置](https://github.com/cline/cline/blob/cli-v3.0.65/sdk/packages/core/src/extensions/mcp/config-loader.ts)

2026-10-04 合入主干后，逐模型消费与独立 Context Gauge 已适配 Usage v8 / Execution Metrics v7，
详见[真实字段和数字](../runtime-monitoring/command-cline-verification-2026-10-04.md)。私有数值源复用已有
4 秒 Flush，不把 Context 累计进 Run 用量；reasoning 省略仍未知，没有从模型名猜窗口。

随后按 User 的开发包请求完成[打包 App 真实发送验收](app-send-verification-2026-10-04.md)：
四轮 AgentRun、两名队员、warm/cold 续接、bundled CLI、持久化指标与 Renderer 入口均取得证据。
该主路径证据不会补齐未测试的能力轴，也不确认独立的 Plugin Rule 模型输入提案。

[文件名、编辑和窗口复核](../runtime-monitoring/command-cline-files-context-2026-10-04.md)进一步确认原生
路径存在，修复了 read_files 与 apply_patch 的标准 location 投影；两名成员各自完成真实读取、编辑、
读回和公开回帖。当前 sub2api/gpt-6-sol 配置未提供可信窗口，继续保留未知，不以压缩预算替代。
随后两名成员都从原生命令输出正确读出实际 `+1/-1`；这证明模型可读取 Diff。apply_patch 的 ACP 终态
仍不含可靠内容 Diff，编辑行内展开尚未完成，不把输入 patch 当作已应用差异。

正式完成按 [Runtime 接入 Checklist](../../development/runtime-integration-checklist.md) 逐轴闭合；
当前分支已加入 closed identity、Host/发现/Skill 接线与 Migration 184/schema 134；macOS arm64 开发 Preview
已验证上述主路径，完整产品资格与 First-Class 尚未完成。
