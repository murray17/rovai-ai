---
document_type: research-record
authority: non-normative-runtime-evidence
status: pre-implementation
last_updated: 2026-11-12
---

# Goose 官方 ACP 研究与原生探测

结论：可以沿共享 ACP/Fleet 接入，推荐入口是官方 `goose acp`。
Goose 已有按 Session 追加 System 指令、带原生 Run ID 的 Steer 接收回执和逐消息／累计用量通知，
这三处可以比 Kilo 更薄。MCP 恢复的追加语义、write 缺少完整前像、压缩用量范围是必须正面处理的差异。

当前仅完成研究和真实官方二进制的受控探测；Rovai 产品目录、Schema、实现和当前合同均未增加 Goose。
[实施及模型输入提案 R1](../../versions/v1.72/goose-acp-proposal.md)已由 User sequence 117 确认，正式实现与验收继续在原 worktree 进行。
以下 `Verified` 指原生能力，不代表 Rovai 已接线、真实账号已登录或目标平台已取得产品资格。

## 固定基线与复现

| 项目 | 本轮范围 |
| --- | --- |
| 上游 | `aaif-goose/goose`；原 `block/goose` 已跳转到该仓库 |
| 发布 | [v1.59.0](https://github.com/aaif-goose/goose/releases/tag/v1.59.0)，2026-11-10 发布 |
| 固定源码 | `5d03ef6ed07ba59826328f1aff18d9a754ff8ad2` |
| 本地平台 | macOS arm64；不据此提升 Intel、Linux 或 Windows 的资格 |
| 原生程序 | 发布附件 `goose-aarch64-apple-darwin.tar.gz` 中的完整独立 CLI；未全局安装 |
| 实际入口 | `goose acp`，默认带 developer；没有另启 HTTP 服务 |
| Rovai 研究分支 | `rovai/goose-acp`，基线 `c7295e2b0b4667a5434c855cd2dd456bcf637e4c` |
| 环境 | 自动验收通道；独立 HOME、XDG、`GOOSE_PATH_ROOT`、工作目录、Skill 与本地假 Provider |
| 模型与密钥 | 全部为受控 loopback 响应和 `fixture-key`；未用真实账号、订阅或付费模型 |
| 证据 | [白名单结果](native-probe-1.59.0-macos-arm64.json)、[可执行探测](../../../scripts/probe-goose-runtime.mjs) |

```bash
ROVAI_GOOSE_BIN=/absolute/path/to/goose node scripts/probe-goose-runtime.mjs
```

脚本要求固定的 1.59.0 版本，每次创建新临时根，保留原生帧和合成 Provider 请求供本机检查。
可用绝对 `ROVAI_GOOSE_PROBE_ROOT` 指定这些新临时根的父目录。
脚本里的 Node 是探测驱动和明确声明的 MCP 夹具依赖，不是 Goose 产品启动依赖。
本轮使用 POSIX shell 夹具，不能把在 Windows 拒绝运行此脚本算作 Windows 不支持 Goose。
清理器关闭 stdin，并在期限后回收本次拥有的进程组；这不能代替正式 Core 的取消、租约和关停证据。

官方另发小型 `goose-acp` 程序，其[入口](https://github.com/aaif-goose/goose/blob/5d03ef6ed07ba59826328f1aff18d9a754ff8ad2/crates/goose/src/bin/goose-acp.rs)
调用同一 ACP server，但没有完整 CLI 的 `configure` 操作。本次只选完整 CLI，避免同时维护两种产品安装身份。

## 14 轴 Parity Matrix

最接近的生产基础是 Kilo/OpenCode 的共享 ACP Host；模型档位按当前 MiniMax/DSH 的目标模型按需路径处理。
表中接入策略均为提案，不是已批准的产品差异。

| 核心能力轴 | 上游能力及本轮证据 | 最小接入策略 | Runtime evidence / Rovai implementation |
| --- | --- | --- | --- |
| Auth / Provider / Model | 原生配置、keyring、Provider inventory；本地 OpenAI 可发现三个合成模型；当前模型有 `thinking_effort` | 保留原生认证；配置可用 Provider 的官方目录；仅查询选中模型的档位 | 目录／setter `Verified`；真实认证 `NotObserved` / `NotImplemented` |
| Host / Fleet / LRU | 常驻 stdio，多 Run 可用同 PID；普通取消及子代理取消后继均成功 | 一个 Binding 一个 Host，接共享 Fleet/LRU 和兼容判断 | 原生复用 `Verified`；Core 租约 `NotObserved` / `NotImplemented` |
| Native Session / Continuation | `session/new`、精确 `session/load`；不存在 ID 返回 -32002；冷恢复保留历史 | 保存完整原生 ID 与数据根；不猜 Session，不依赖 recent/list 自动挑选 | `Verified` / `NotImplemented` |
| Bootstrap / Context | 原生 keyed append System API；首次／warm／cold／88,099 字节完整读取和 Session 隔离 | 每 Run 设置冻结 B，成功后只发送冻结 P；无文件、插件或握手 | `Verified` / `NotImplemented` |
| Compaction continuity | 阈值自动压缩、一次真实 overflow 错误触发摘要和重试；之后普通生成及冷恢复保留更新后的 B | 由 Goose 压缩，复用现有 compaction 通知和 context gauge | `Verified` / `NotImplemented` |
| Skills | 项目 Skill 被模型实际读取，同 Host 更新后读取新正文，删除后原生拒绝；用户和插件根见源码 | 原生 Skill 继续由 Goose 加载；Rovai 平台／工具箱索引与路径读取沿共享 B/P | 项目加载 `Verified`；完整 Core 分发 `NotObserved` / `NotImplemented` |
| External MCP | stdio 模型实调；冷恢复 A→B→空仍有 A+B；原生 list/remove 后冷恢复不再出现 | 现有分配投影加稳定归属名；只移除不再分配的 Rovai 项；不同 cwd 复用 bundled launcher | stdio／撤销 `Verified`；HTTP 与跨 cwd `DocumentationOnly` / `NotImplemented` |
| Tool / Action / Command Output | write→shell cat→edit；stdout/stderr、exit 7、空输出、9,000 字节；delegate 原生元数据 | 共享 Action/输出预算；映射原生结构；不重复执行文件操作或伪造前像 | `Verified`；标准完整文件 Diff／覆盖前像 `Unsupported` / `NotImplemented` |
| Narration / Final / Missing-Send | 标准 agent chunks、`end_turn`、`cancelled`；辅助标题生成可单独发生 | 保留 narration/final/公开 CLI 消息分工；合法空终态不造回复；沿用 Missing-Send | 原生流与终态 `Verified`；公开发送 `NotObserved` / `NotImplemented` |
| Permission / Approval / Workspace | 原生四 mode；approve 的 allow_once 有一次文件效果、reject_once 无效果；不支持表单的客户端收到原生取消降级 | 默认 auto，保留原生 mode；共享审批原选项；不增加权限规则求值器或问卷自动答案 | 审批／问卷取消 `Verified`；强制 readonly `Unsupported` / `NotImplemented` |
| Built-in `rovai` CLI | developer shell 可以执行本地命令；正式 Run 凭证和公开发送尚无 Goose Core | 复用已有 bundled CLI、环境、Run/epoch/lease 和公共回执 | shell `Verified`；正式 CLI 交付 `NotObserved` / `NotImplemented` |
| Usage / Cache / Cost | 官方累计和逐消息通知；cache-inclusive 输入，估算费用带 provenance；自动压缩未见逐消息用量 | 共享累计基线及 checkpoint；逐消息补缓存，不双记；缺失缓存保持 partial | 受控数值 `Verified`；所有 Provider 账单 `NotObserved` / `NotImplemented` |
| Retry / Queue / Cancel / Cleanup | 双 Steer 提前回执，错 Run 拒绝；普通／子代理取消后同进程后继成功 | 共享 Delivery/epoch、期限和 Fleet；accepted/unknown 不自动重投 | 原生 `Verified`；Core 隔离及崩溃 `NotObserved` / `NotImplemented` |
| Ready / Version / Platform | 真实初始化 ACP v1、agentInfo 1.59.0；官方多平台附件 | 共用发现、轻检查、安装版本及平台准入；不把握手当登录 | macOS arm64 原生 `Verified`；其他平台 `NotObserved` / `NotImplemented` |

## 比 Kilo 更简单的部分

### 原生 System 追加，无需私有 instructions 文件

官方 API：

```json
{"method":"_goose/unstable/session/system-prompt/set","params":{"sessionId":"native-id","mode":"append","key":"rovai-session-bootstrap","text":"完整冻结 B"}}
```

响应为 `{}`。同一 key 替换旧值，空正文清除；`set` 模式会替换原生 base，因此提案只使用 `append`。
其内容保存在原生 Session 中，每次生成由 Goose 组装到 Additional Instructions。
已验证：首次、同 PID warm、精确 cold、自动／overflow 压缩后普通请求、压缩后再次 cold、第二 Session 隔离。
测试检查了实际 Provider 请求中的完整 B，而不是只看 setter 返回。

原生辅助标题与摘要请求有自己的 System，不保证包含 B；原生子代理使用专用 System，
本轮证实它**不继承父 Session 的 B**。接入承诺是父 Session 的普通业务生成；不另造子代理身份或偷偷补一份 B。
Goose 自己会给用户消息追加时间／cwd 的 turn-context，并清理 Unicode tag；这些是原生行为，Rovai 不另改 B/P。
来源：[类型](https://github.com/aaif-goose/goose/blob/5d03ef6ed07ba59826328f1aff18d9a754ff8ad2/crates/goose-sdk-types/src/custom_requests.rs#L192)、
[Session handler](https://github.com/aaif-goose/goose/blob/5d03ef6ed07ba59826328f1aff18d9a754ff8ad2/crates/goose/src/acp/server/manage_sessions.rs#L48)、
[Prompt manager](https://github.com/aaif-goose/goose/blob/5d03ef6ed07ba59826328f1aff18d9a754ff8ad2/crates/goose/src/agents/prompt_manager.rs)。

### 原生 Steer 有独立接收回执

```json
{"method":"_goose/unstable/session/steer","params":{"sessionId":"native-id","expectedRunId":"active-run","prompt":[{"type":"text","text":"冻结的补充输入"}]}}
```

返回 `{"runId":"active-run","messageId":"steer_…"}`，同一 messageId 之后出现在原生消费消息中。
`activeRunId` 来自 `session_info_update._meta.goose.activeRunId`；结束后可为 null。
本轮按住父模型响应，先拿到两条不同 messageId，确认原始 prompt 仍未结束，再放行并看到两条补充输入进入模型。
错误 expectedRunId 在接纳前返回 -32602。局部毫秒耗时只用于记录，不能承诺真实网络／模型响应时间。

因此不用复制 Kilo 的第二个 `session/prompt` 及多 prompt 收口路径，也不用等 `end_turn` 才确认插话。
原始输入仍按共享接收规则确认；仅得到 activeRunId 不代表初始 P 已被处理。
来源：[请求／回执](https://github.com/aaif-goose/goose/blob/5d03ef6ed07ba59826328f1aff18d9a754ff8ad2/crates/goose-sdk-types/src/custom_requests.rs#L220)、
[接纳处理](https://github.com/aaif-goose/goose/blob/5d03ef6ed07ba59826328f1aff18d9a754ff8ad2/crates/goose/src/acp/server.rs#L2328)。

### 前台子代理由原生等待

`delegate` 工具先返回“Delegated to subagent …”及 `subagentSessionId`，这不是子代理结束证据。
1.59.0 的状态机已移除后台子代理，使用 ForegroundSubagentRunner。
本轮按住子代理模型响应，父 prompt 一直未结束；放行后父模型实际收到子代理的 final-output 报告。
另一次在子代理被按住时取消，父 prompt 返回 cancelled、子代理 HTTP 请求断开，随后同 PID/Session 正常执行。
正式 Core 仍需验证自己的旧回调、租约、epoch 和进程管理，不能由这条原生结果替代。
来源：[原生前台等待](https://github.com/aaif-goose/goose/blob/5d03ef6ed07ba59826328f1aff18d9a754ff8ad2/crates/goose/src/agents/state_machine/ops_subagent.rs)。

## 必须保留的薄适配

### 模型目录、档位与原生认证

`_goose/unstable/providers/list` 的 entries 包含 Provider 身份、configured、available、models 等原生信息。
标准 configOptions 的 provider 下拉包括未配置 Provider，不能全当可执行模型；本轮返回 90 个 Provider 选项。
inventory 的模型有 reasoning 标志，**没有每个模型的完整 effort 枚举**。
`providers/supported-models/list` 也只返回模型 ID。
另核对了 catalog/list、catalog/template 和 canonical-model-info：前两者服务于 Provider 安装模板，
后者给上下文、价格和 reasoning 标志，也没有完整档位枚举；不能因为名称含 catalog 就当成全部模型参数。

推荐一次读取原生 Provider inventory，界面正常使用已配置且可用的模型；目标模型的 `thinking_effort`
沿 MiniMax/DSH 现有按需查询获取，不扫描整个目录，也不按名字补 low/high。
本轮选择合成 `gpt-6.1-sol` 并设 high 后，真实官方程序发送 OpenAI Responses 的
`reasoning.effort=high`；不是 Rovai 代发请求或改写 Provider 参数。
来源：[Provider DTO/API](https://github.com/aaif-goose/goose/blob/5d03ef6ed07ba59826328f1aff18d9a754ff8ad2/crates/goose-sdk-types/src/custom_requests.rs#L1761)、
[原生 setter](https://github.com/aaif-goose/goose/blob/5d03ef6ed07ba59826328f1aff18d9a754ff8ad2/crates/goose/src/acp/server/dispatch.rs#L153)。

原生 `goose configure`、用户／项目配置、keyring 或原生 secrets 文件继续由 Goose 负责。
probe 关闭 keyring、重定向 HOME 的隔离做法不能进入产品启动环境。
configured/available 和 ACP 握手不证明 API Key、OAuth、订阅刷新或 Sub2API 实际可生成。
标准 ACP authenticate 在此版本直接返回空成功，没有执行 Provider 登录；该 ACK 不能投影成登录成功。
官方 providers/readiness/check 仅面向嵌套 ACP Provider，也不能拿来当普通 API Provider 的统一验密入口。
这些均待官方 CLI 配置完成后的独立真实模型验收。
来源：[官方配置说明](https://github.com/aaif-goose/goose/blob/5d03ef6ed07ba59826328f1aff18d9a754ff8ad2/documentation/docs/guides/config-files.md)、
[authenticate handler](https://github.com/aaif-goose/goose/blob/5d03ef6ed07ba59826328f1aff18d9a754ff8ad2/crates/goose/src/acp/server/dispatch.rs#L38)、
[ACP Provider readiness](https://github.com/aaif-goose/goose/blob/5d03ef6ed07ba59826328f1aff18d9a754ff8ad2/crates/goose/src/acp/server/providers.rs#L532)。

### MCP 不能只换 Host 或传空列表

官方会把 ACP 分配写入 Session extension_data；恢复时新列表按 name 追加／替换，空列表不删旧项。
已经用 A→B→空的精确 cold load 证实 A+B 同时存在；新 Host 不等于删除旧 MCP。
原生 `session/extensions/list` 返回 extensionKey，`session/extensions/remove` 删除后再次 cold 仍不再出现。

提案用已有 server_id 生成稳定的 Goose 归属名，放在共享投影现有 runtime_name 中；
只列出并删除不再分配的 Rovai 归属项，保留用户原生及其他扩展。不是每 Run 换名藏旧工具，
也不增加配置镜像、dirty 标志、版本队列或 MCP 管理器。
实际保存行为与 Kilo 一致：只保存，下次 Run 准备时处理，不打断当前冻结的工具集合。
remove 发生在原生 load 之后、业务 P 之前；load 可能已短暂恢复旧 MCP 的连接，不能承诺撤销项从未启动。
来源：[恢复追加](https://github.com/aaif-goose/goose/blob/5d03ef6ed07ba59826328f1aff18d9a754ff8ad2/crates/goose/src/acp/server.rs#L1117)、
[原生增删接口](https://github.com/aaif-goose/goose/blob/5d03ef6ed07ba59826328f1aff18d9a754ff8ad2/crates/goose/src/acp/server/extensions.rs)。

标准 ACP stdio 配置没有独立 cwd；复用 [bundled Rovai cwd 入口](../../../crates/rovai-core/src/runtime_mcp.rs)
即可，不解析 python/node 命令里的路径，不假定安装 Node。远程 HTTP MCP 不启动本地进程，不经过这个入口。

### 文件、命令与子代理展示

原生工具启动携带 `_meta.goose.toolCall.toolName/extensionName`，参数保留在 rawInput。
write 使用 path/content，edit 使用 path/before/after，shell 使用 command。
write/edit 完成只返回文本与 locations，没有完整 before/after 或标准 ACP Diff；完整覆盖前像在此传输中不可得。
edit 的确切片段可在原生参数详情中展示，但未知行号不能自行补齐为标准文件补丁。
只有原生确实给出合法 patch 时才交共享 normalizer；当前默认工具缺少整文件 Diff，显示真实操作结果，
不读修改后的文件伪造旧内容和整文件增删数。

shell 的完成 rawOutput 有 stdout、stderr、exit_code；exit 7 对应 failed。
原生 9,000 字节输出未被 7.5 KiB 限制；Rovai 仍必须沿共享持久化输出预算截断，不能另做一份 Goose 预算。
streaming toolNotification 与完成快照可能重复，继续由共享输出 owner 去重。
不打开原生 toolCallLabelEnrichment；默认元数据足够映射，不为工具标题另加模型生成。
delegate 映射已有子代理卡片；只展示原生给出的任务、child Session 和状态，不扫原生历史伪造逐步执行。
来源：[工具转换](https://github.com/aaif-goose/goose/blob/5d03ef6ed07ba59826328f1aff18d9a754ff8ad2/crates/goose/src/acp/server/tool_calls/conversion.rs)、
[developer](https://github.com/aaif-goose/goose/tree/5d03ef6ed07ba59826328f1aff18d9a754ff8ad2/crates/goose/src/agents/platform_extensions/developer)。

### 累计用量与逐消息缓存不能混算

开启官方 customNotifications 后可同时收到标准 usage_update 和
`_goose/unstable/session/update`。后者有：

- usage_update：used、contextLimit、accumulatedInputTokens、accumulatedOutputTokens、可选 accumulatedCost。
- message_usage：messageId、input/output/total、可选 cacheRead/cacheWrite、cost、costSource、生成耗时。

输入含缓存，缓存是输入的子集；estimated 成本只能标成既有 `runtime_estimate`，不能冒充 Provider 实际账单。
本轮实际自动压缩有开始／结束通知和摘要 Provider 请求，累计数值也增长，
但未观察到逐消息 `isCompaction=true` 用量。只加普通 message_usage 会漏摘要。

推荐共享累计源在 dispatch 前建立 Session 基线：new 明确 0，cold 用 load 的累计快照，warm 用该 Host 已观察的末值。
再由既有 checkpoint 求差；不能拿生成后的第一条累计值作基线。
逐消息仅补充缓存／来源，不能把它的 input/output/cost 再叠加；压缩缺失的缓存保持 partial。
历史回放必须经过 LoadingHistory 隔离，不给新 Run 记账；标准与 custom 重复来源只选一个累计计数源。
不再为 Goose 建 SQLite 历史扫描器，不调用包含整段上下文的 report API 来轮询数值。
来源：[通知结构](https://github.com/aaif-goose/goose/blob/5d03ef6ed07ba59826328f1aff18d9a754ff8ad2/crates/goose-sdk-types/src/custom_notifications.rs#L76)、
[缓存语义](https://github.com/aaif-goose/goose/blob/5d03ef6ed07ba59826328f1aff18d9a754ff8ad2/crates/goose-provider-types/src/conversation/token_usage.rs#L96)、
[现有数值 owner](../../../crates/rovai-core/src/monitoring.rs)。

### 问卷与 native Skills

默认 17 工具没有问卷工具；MCP 仍可请求 form elicitation。
原生在 ACP client 未广告表单能力时会取消而非代填。本轮真实 MCP 夹具已收到 action=cancel，
没有生成 choice，后继 prompt 成功；接入不广告尚未实现的问卷 UI。
普通 allow_once/reject_once 审批独立转交，不把问卷降级变成自动允许。
来源：[原生问卷取消](https://github.com/aaif-goose/goose/blob/5d03ef6ed07ba59826328f1aff18d9a754ff8ad2/crates/goose/src/acp/server/elicitation.rs)。

原生 Skill 搜索项目 `.agents/skills`、`.goose/skills`、`.claude/skills` 和用户／启用插件目录。
没有核实到通用的额外 Skill 路径环境变量，不应为了接入虚构一个。
现行 Rovai 平台 Skill 及工具箱以共享 B/P 中的真实路径索引交付，可由原生 shell 阅读；
正式接线后必须验证实际读取、更新和移除，不把“原生支持 Skill”当作 Core 分发已验收。
来源：[发现顺序](https://github.com/aaif-goose/goose/blob/5d03ef6ed07ba59826328f1aff18d9a754ff8ad2/crates/goose/src/skills/mod.rs#L298)。

## 失败记录与未验证范围

探测器迭代中保留的失败不是产品缺陷证明：最初把辅助标题请求当普通请求、把 Responses 误当 Chat、
把 `load` 误当文件读取、期待 delegate 完成帧直接附带子报告，均已通过固定源码和真实帧修正。
后续断言分别要求普通请求完整 B、真实 Responses assistant chunk、文件调用零失败、
子代理被按住时父请求未结束，以及报告真正进入父模型输入；没有删除这些场景来凑通过。
自动压缩“没有逐消息用量”则是本轮明确保留的观测限制。

仍未验证：真实 OAuth/订阅/BYOK/Sub2API、正式 Core 的新 lease/epoch 与 public send、
Goose 在无响应／断连／迟到审批时的 Core 清理、不同 cwd helper、远程 MCP、完整 Skills 选择投递、
Renderer 的 7.5 KiB 和 Diff、Intel/Linux/Windows 资格。不能用本轮原生夹具宣称 First-Class。
实施验收按 [接入清单](../../development/runtime-integration-checklist.md)的 14 轴和 9 Golden Flows 继续。
