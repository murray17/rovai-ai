---
document_type: runtime-research
runtime: cline-cli
authority: research-evidence-only
status: implementation-in-progress
admission: preview
observed_version: 3.0.3
observed_platform: macos-arm64
last_updated: 2026-10-07
---

# Cline 官方 Runtime 接入

> 2026-10-08 认证后续：User 已授权直接使用本机 ChatGPT 登录。最新实现及逐项资格见[原生账号报告](native-account-auth-2026-10-08.md)；下文此前 BYOK 范围保留为当时证据。

最新产品方向已按 User 消息 80 切换到独立 Native Hub；消息 83 确认没有旧会话，已删除 ACP 后端及兼容逻辑。
当前实现和验收边界以 [Native Hub 产品矩阵](hub-adapter-implementation.md)为准。下文 ACP、shim
和最小 Hub 调查按发生顺序保留，不再将“Hub 尚未实现”作为当前状态。

Principal 在 Camp 消息 `f70e9798-8f5c-4428-821f-bd51ec0b99f6` 选择官方 ACP，在
`292c2ea2-5695-40ca-ad5d-8de31832d8fe` 允许使用 sub2api BYOK。候选入口是独立
`cline-cli` Adapter 调用 `cline --acp`，复用现有 ACP Host/Fleet。User 消息 72 后已授权独立
启动 shim 实验；消息 76 改为验证用户实际安装的原生 Hub；在该研究时点生产入口尚未切换。
本文件记录逐轴的原生实测与 Core 接线进度，不是产品准入决定。macOS arm64 的开发 Preview
由 [V1.72-D17](../../versions/v1.72/decisions.md#v1-72-d17)拥有，其他平台仍为 NotQualified。

切换前的[原生 Hub 验证](native-hub-2026-10-07.md)：同一正常发现的 Homebrew 3.0.3 启动了独立、
可认证且来源一致的 Hub；96 次正式模型对照证实显式 basic 会原生压缩，默认不传与 off 未见压缩。
真实模型报告相同 272000 窗口，压缩后身份/早期记忆保持。Hub 重启后的 attach-only 路径失败；
继续按当前 CLI 自身的 readMessages/start 恢复序列补测，同一 ID、历史、System 和真实后续请求通过。
这是原生 Hub 的 cold 证据；该研究时点 Hub Adapter 尚未接入产品。原生只读 hook 可返回
Run ID 和 System 摘要，不等于现有 managed Rule/observer 或完整合同通过。overflow+retry、
压缩取消、多 Session 交错和其余产品资格仍缺；ACP 及既有最低版本不变。

此前[用户实际安装入口核验](installed-acp-entrypoint-2026-10-07.md)：正常发现选中 Homebrew 3.0.3，
wrapper 实际启动编译后的平台二进制，未找到可验证的 ACP/Core.start 注入入口。原生 ACP 初始化
成功，安装与设置未改；现有 3.0.65 最低版本另使产品保持非 Ready。没有用实验 Runtime 替换，
没有新增生产 shim 或版本限制，自动压缩兼容接入仍阻断。

此前[启动 shim 实验](acp-compaction-shim-2026-10-07.md)：固定 3.0.68 / 官方 Core 0.0.90，
仅补原生 compaction 配置即可观察自动压缩。同版本发布二进制和源码未注入对照均无压缩；
隔离 Rovai Core 的 11 Run 验证保持 Session/Binding、System Rule、工具及 cold 连续性。
这是实验结果，不改变生产官方 ACP 的压缩缺口或 Preview 准入；overflow+retry 尚未验证。

此前源码核对：[3.0.66 / 3.0.67 / 当前稳定版 3.0.68 / 固定 main](upstream-compaction-version-audit-2026-10-07.md)
均未补 `AcpAgent.buildConfig().compaction`，下游仍须显式启用；单纯升级最低版本不能解决该缺口。
该源码核对轮没有运行新版本；随后 3.0.68 的真实实验见上段，下段保留 3.0.65 正式接线负例。

[零干预原生 Compaction 验收](native-compaction-2026-10-07.md)在当前正式接线下
观测到 918,618 input tokens 和真实 Provider overflow，仍无原生 compaction；cold 保持同一
Session 但再次 overflow，结论为 `native_compaction_not_observed`。System 已按
[10 月 6 日验收](../runtime-monitoring/command-cline-native-system-2026-10-06.md)切换到官方
managed System Rule；此前 first_payload 与故意缺失插件阻断的描述属于旧状态。

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
| Bootstrap / Context | 冻结 Charter/Identity/Memory 与每轮动态输入 | 官方 Plugin Rule 承载 `managed_system_prompt`，按 Session 绑定冻结 B；user 只传动态输入 | [System 真实验收](../runtime-monitoring/command-cline-native-system-2026-10-06.md)已观察 System B 一次、user B 零，同 Host A/B/A 和 exact cold 身份/记忆正确；按 User 口径不以人为移除插件阻挡正常加载 |
| Compaction continuity | 原生压缩信号、失败与连续性；未知保持未知 | 保留生产只读 observer 的 manual/auto/overflow started/completed/skipped 数值接线，不用普通模型总结代替压缩 | [零干预真实验收](native-compaction-2026-10-07.md)：最高成功 input 918,618，第 42 批 overflow，原生事件和 sidecar 均未出现；同 Session cold 再次 overflow。分类 C；底层 HTTP retry 次数未知 |
| Skills | 当前受管索引与原生 Skills 并存 | 共享受管索引；Cline 原生 `.cline/skills`、`.agents/skills` | 现行 main 使用平台/工具箱索引与原生文件发现，旧 Library/group 不再投递给新 Run；本轮原生项目 Skill 的 Core 候选发现和真实读取见[差异复核](../runtime-monitoring/command-cline-parity-2026-10-05.md) |
| External MCP | PreparedMcpProjection、追加、撤销、无串会话 | 3.0.65 ACP 忽略 `session/new.mcpServers`；官方 `CLINE_MCP_SETTINGS_PATH` 指向 Host 私有合并文件 | 原生隔离配置调用真实 fixture Tool Verified；Core Host 合并已实现；App 分配、原生调用、更新及未分配成员隔离通过；撤销结果见差异复核，完整并发/HTTP 矩阵未完成 |
| Tool / Action / Output | 原生 ID、唯一生命周期、可靠 command/read/edit 输出 | 终态只带 Tool ID 与 typed rawOutput；Host 配对开始事件的 title/rawInput | 共享 Host 的 read/edit/command、stdout/stderr、非零失败 Action 已通过；修复单文件 location 后，App 两成员 read/edit/read 的准确路径、持久化、点击预览与文件副作用通过；成功 Update 补丁/editor 替换已接 Command 和 Files Changed 的补丁片段；两成员、多文件、连续改回、失败编辑、非零和独立空输出实测通过；editor 原生模型路径及超大输出仍待验收 |
| Narration / Final / Missing-Send | thinking 私有、权威终态、zero-send 恢复 | agent_message_chunk 与 thought 分开；prompt stopReason / JSON-RPC error | App 四轮均 succeeded，且每轮恰一条显式 CLI 公开回帖；zero-send 恢复两轮真实通过，均只有一条公开消息 |
| Permission / Approval / Workspace | 原生权限为唯一权威、allow/deny/cancel | 官方 auto_approve 布尔、plan/act；request_permission 原样往返 | 原生拒绝无副作用 Verified；共享 Core Host 在命令发出后取消，得到 `cancelled` 且 10 秒后无文件副作用；Core allow/deny 与产品审批待验收 |
| Built-in rovai CLI | 每 Run lease 与 bundled CLI | 共享 ACP process config 注入 shell 环境，Run 结束解除 | App first/warm/第二名队员/cold 四轮真实 bundled CLI 回帖通过，cold 使用重启后当前 Run lease |
| Usage / Cache / Cost | 原生结构化字段与稳定归属，未知 NULL | 官方 Plugin afterModel 按 message ID 报 token/cache；Host 按唯一 Prompt lease 归属；原生 models.json 显式窗口以实际 Provider/模型匹配 | 四桶、可选 reasoning、live Context used、去重及 AgentRun 持久化已核验；[窗口补采](../runtime-monitoring/command-cline-context-window-2026-10-05.md)取得 Provider 元数据并在原生配置生效后实测两成员与 warm 的 272k 分母、计算比例和重开；Cost 未知，未新增自动 Provider 发现 |
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
读回和公开回帖。当时窗口未知；随后已完成[原生配置窗口补采](../runtime-monitoring/command-cline-context-window-2026-10-05.md)，真实 App 为 272k，不以压缩预算替代。
随后两名成员都从原生命令输出正确读出实际 `+1/-1`；这证明模型可读取 Diff。apply_patch 的 ACP 终态
不提供可靠完整文件状态；随后已完成可点击的 reported mutation 补丁片段，见[编辑对照](../runtime-monitoring/command-cline-parity-2026-10-05.md)，仍不把输入 patch 当作精确文件状态。

已按 [Runtime 接入 Checklist](../../development/runtime-integration-checklist.md) 逐轴记录进度；
当前分支已加入 closed identity、Host/发现/Skill 接线与 Migration 184/schema 134；macOS arm64 开发 Preview
已验证上述主路径，完整产品资格与 First-Class 尚未完成。
