---
title: "原生比例、当前占用与 Copilot 重新核验"
status: "implementation-evidence"
reviewed_at: "2026-10-01"
target_version: "v1.72"
baseline_ref: "5f526463f095c80598de56dd263f5fb2d83fa669"
---

# 原生比例、当前占用与 Copilot 重新核验

本轮继续 PR #568，优先接 Qoder 原生 journal、Grok Context 元信息、OpenCode 最新调用占用，
并在用户恢复额度后重新测试 Copilot。独立 `nativeRatio` 接通 Core、SQLite、读取合同与现有圆环；
不从比例反推数量，不改变当前速度位置、Run Card、气泡、算法权重或刷新节拍。
所有真实调用、Core 重启和打包 App 使用逐次隔离的 userData、Skill Library、MCP 和工作区。
没有安装、退出或修改承载当前 Camp 的日常 App，也没有写日常数据库。

本记录更新[前轮原生来源核验](native-usage-context-verification-2026-09-30.md)中的对应四类来源；
其他 Runtime 保留其当时版本、Provider、模型、阶段和未决事项，不视作本轮重测。

## 1. 字段来源、资格与到达时机

`verified_available` 指所列版本与配置的原始数字、解析、保存和读回闭环；Renderer 证据另列。
`raw_absent` 只指健康成功调用的指定通道没有字段；`present_not_mapped` 指原始有但入口未接；
`mapped_not_projected` 指解析后未保存或读取；`blocked_unverified` 指没有健康样本或语义／配置证据。
零样本不能证明正缓存写；稀疏缓存之和不自动成为完整最终用量。未知保持 `null`。

| Runtime／实际版本 | 启动、Provider／模型 | 原始字段／到达时机 | 已验证的语义与限制 |
| --- | --- | --- | --- |
| Qoder 1.1.64 | Managed ACP；原生自定义 Provider 标签与 `gpt-6.1-sol`；端点未独立留证 | 当前根 Session 的 `projects/<cwd-key>/<sid>.jsonl`；assistant `message.usage`，调用完成后追加 | `modelSource=custom` 的输入已经包含缓存；Output 不再加 reasoning。原生非 custom 隐藏路径会归零，不将隐藏值当真实零。Cache Read 有正样本，但零可能是缺字段默认值；Cache Write 本次只有这种零，保持未知。`context_usage_ratio` 独立保存，used/window 未知 |
| Grok Build 1.0.44（5b807183dd79） | Managed ACP；隔离 native config 使用已授权 Claude 同一 sub2api origin；实际 `gpt-6.1-sol` | 根 `session/update.params._meta.totalTokens`；随当前通知到达；终态 `_x.ai/session_notification.turn_completed.usage` 为本 Run 聚合 | 当前占用与累计消耗分开；window 只取 Host 启动时捕获的、与实际模型匹配的显式 `model.<id>.context_window=1050000`。内置模型目录／default 未验证，不猜窗口；终态和逐调用重述不相加 |
| OpenCode 1.18.30 | Managed ACP；原生 `sub2api/gpt-6.1-sol` | 只读原生 `opencode.db` 当前根 Session 已完成 assistant message 的 tokens；每调用结束 | used 是最近调用 input＋cache.read＋cache.write，排除 output/reasoning。原生 ACP 使用有效 Provider/Model `limit.context`；本机 `models sub2api --verbose` 实际返回 context=0/output=0，因此 window 未知，只显示 used |
| Copilot CLI 1.0.83 | Managed ACP；原生订阅默认 Provider，真实调用事件报告 `claude-opus-5` | `github.com/copilot/sessionEvent` 的根 `assistant.usage`，每调用结束；标准 `usage_update.used/size` 提供 Context | input 包含缓存，output 已含 reasoning。ACP prompt 终态是该进程／Session 多 prompt 累计，当前版本由逐调用事件拥有 Run 用量。排除子 Agent、dataOmitted、缺失字段；明确零保留。原生窗口为 200000，不来自猜测 |

Qoder 未修改未验证的“隐藏计数开关”。当前安装包的 custom 路径已经提供可用数字，其他路径可能
脱敏；没有据此扩大所有模型的支持。读 journal 只构造必要数字 DTO，不复制正文、思考、工具参数、
request ID、端点或凭据。baseline 包含旧 pending message；message.id 去重 Usage，比例按 message.id
与原生观测时间去重。文件重置／容量上限导致停止采集，保留已收到的部分数据。

OpenCode 没有在 Core 重建一套配置合并或模型目录加载器。有效窗口继续由原生 ACP loader 拥有，
有可信 size 时走既有 Gauge；没有 size 时补最新调用 used，数量与分母不跨时刻拼接。
本次 unknown 是实际有效目录证据，不是把解析后的空值写成 Runtime 不支持。

### Copilot 广告模型、累计终态与私有事件

原生 Session 广告的默认模型是 Sonnet，但真实 `assistant.usage.data.model` 是 Opus。
Core 不再用该版本的广告默认值占据首次实际模型观测；默认模式由验证后的调用事件填写实际模型。
最终签名 App 的 Session Context `modelKey=claude-opus-5`，重启后仍一致。显式模型切换、调用中
rerouting、其他 Copilot 版本未据此验收。

订阅方式为 `clientCapabilities._meta["github.com/copilot"].events`，只订阅 `assistant.usage` 与
`assistant.reasoning_delta`。标准 `agent_thought_chunk` 同时包含一次性 intent 和 reasoning 复述，
当前版本不从它计思考；私有实时 reasoning_delta 进入有界临时计数后丢弃，不进入 Evidence 或公共 IPC。
数值身份只用 Session、原生时间与必要计数字段，不哈希伴随的 reasoningSummary。
接收序号只能去重同一 Core 通知的重试；不能宣称已验证任意独立上游 wire 重发。

## 2. 同 Session 两 Run 的原始数字对账

[原生数字 fixture](fixtures/round6-native-context-ratio.json) 包含必要脱敏 raw、逐调用／终态期望解析、
实际最终投影和 Context。四类各两个健康 Run，原生 Session 与绑定代次均保持相同；九个 Qoder 调用、
八个 OpenCode 调用、九个 Copilot 调用及两个 Grok 终态聚合，逐字段与读回一致。
Grok 的两个聚合不是两个模型调用；不把已完成 response 的用量再次加到终态。

数字单位为原生 Token；顺序是 Input／Output／Cache Read／Cache Write，缓存已包含在 Input 中。

| Runtime | 首 Run：原生数字 → 最终读回 | 同 Session 第二 Run | Context 首 → 次 |
| --- | --- | --- | --- |
| Qoder | 6 调用：157657／3770／128256／null | 3 调用：90851／1758／88064／null | 原生比例 2.7348% → 2.9542%；数量始终未知 |
| OpenCode | 5 调用：45766／1827／34944／0 | 3 调用：33177／562／31872／0 | used 10319 → 11338；window／比例未知 |
| Grok | 终态聚合：94028／1918／73344／0 | 终态聚合：62646／579／61056／0 | 20070／1050000 → 21143／1050000 |
| Copilot | 6 调用：180257／4070／147736／32509 | 3 调用：101657／1211／99639／2012 | 25716／200000 → 27586／200000 |

Copilot 第二次 prompt 的原生 ACP 终态实际为 281914／5281／247375／34521，是两 Run 累计，
不是第二 Run 的 101657／1211／99639／2012。新版忽略这份重述，不重复认领历史。
该双 Run probe 在最后广告模型修复之前，数据库标签仍为 Sonnet；fixture 明确保留此限制。
最终 App 的直接原始时间、实际 Opus 模型及五调用对账另见[Renderer fixture](fixtures/round6-native-context-renderer.json)。
较早 Copilot 双 Run probe 只保留了时间字段的形态，没有保留原始值；其 parser fixture 使用明确标注的
脱敏时间，不宣称它是独立 raw 时间见证。最终 App 五调用保留了必要原生 timestamp。

### 输入确认前的 Context 竞争

真实 Copilot Gauge 已进入 parser/checkpoint，但 Session 投影为空。定位到部分 ACP 在 prompt 返回
时才确认输入：Gauge 先到时，当前持久化的 accepted 栅栏拒绝它。Qoder 比例也有同类时序。

修复保留接受栅栏，在现有 Usage buffer 每 Run 仅暂存最新的纯数值 Session Gauge，保留原生时刻；
输入确认后按原 Session／Binding／epoch 保存。不暂存 Token Usage，运行中计量照常落盘；不取
最大值，不保存历史 Context。失效绑定、更新 owner、拒绝输入与尚未确认的终态丢弃待确认 Gauge；
Core 重启不恢复未确认临时项。原有最低层 owner 覆盖预确认、最新观测合并、used 下降、同源重试、
拒绝交付与绑定换代，真实双 Run 和最终 App 提供成功时序证据。

## 3. 打包 App 与重启读回

使用临时复制的签名 arm64 App，四个新真实 Run 全部成功，持续约 58–148 秒。
最终签名 Core SHA-256：`d75184b866e623ec4fe68b37e79b476d205c6b6c9a43f515411c05485a1aef9e`。
App 原始数值轨迹、气泡与速度截图在交付目录 `context-round6-20261001/`；完整私有 fixture 不导出。

| Runtime | 正文／思考估算单位 | 实际数字发布／任意 30s 最多 | 最终 Context 与 UI |
| --- | --- | --- | --- |
| Qoder | 87025／48950；同次实际速度携带思考范围提示 | 36／19 | `— / —，2.7%`，圆环默认 3%；未知数量没有反推 |
| OpenCode | 92900／0；本次没有收到思考增量 | 30／21 | `9.3k / —，比例未知`，圆环为 `—` |
| Grok | 90300／750；思考数字已到 App，未与速度提示同时出现 | 32／20 | `19k / 1050k，1.8%`；同次思考范围速度 UI 仍未验证 |
| Copilot | 176485／7125；同次实际速度携带思考范围提示 | 40／20 | `24.9k / 200k，12.4%`，真实模型 Opus |

实际相邻数字发布最短约 994.6ms，全部保持 1Hz 上限；终态立即移除速度。
速度在队员名称行，运行卡片保留耗时，历史卡片不出现当前速度；完成卡片只保留 token 入口，
气泡显示四项和执行耗时。真实回合不用于替代固定回放的字符或时序校准。
四个 App 退出后，用同一签名 Core、各自隔离数据目录再次启动，不调用 Runtime；四项、finalizedAt、
nativeRatio、used/window、实际模型、来源时刻与绑定代次的完整投影均与重启前一致。
这证明 Core 重启持久化；不宣称另做了每类 App 重开后的 UI 验收。

### 私有内容与固定回放

受控 Copilot ACP fixture 通过真实打包 App，七个根私有 reasoning 增量与标准重复 thought 同时投递；
子 Agent、dataOmitted、一次性 intent、完整 thought 和带私有 reasoningSummary 的 Usage 无额外计数。
最终思考 4725 单位，合成私有标记在 Evidence、Renderer、公共 IPC、Blob／日志文件中的匹配为零。
fixture 是合成边界证据，不代替真实 Provider 的字段样本。

同一回放覆盖途中打开先建基线、切历史 Run、工具静默超过 5 秒隐藏、恢复输出预热、单行布局、
终态立即清空与 Run 先结束后 Usage 落盘。终态后气泡成功刷新为 1.5k／0.5k／0.3k／0k 和耗时，
没有因停止活跃轮询永久留在未知。正文／思考数值仍不写入原生 Usage、费用或 Context。

## 4. 当前 16 类字段矩阵

“可用”只覆盖列出的版本、模型、通道与场景；前轮证据未本轮重测，完整来源与 Provider 见
[前轮字段表](native-usage-context-verification-2026-09-30.md#16-类-runtime-字段矩阵)。

| Runtime／证据版本 | Input | Output | Cache Read | Cache Write | Context used／window／比例 | 速度与阶段／主要剩余项 |
| --- | --- | --- | --- | --- | --- | --- |
| Codex 0.159.2，前轮 | 可用 | 可用 | 可用 | 可用 | 可用：last＋同通知 window | 正文＋摘要到 App；hosted search、真实压缩／恢复边界未完 |
| Claude 2.1.280，前轮 | 可用 | 可用 | 可用 | 可用，零样本 | 可用：最新调用＋匹配模型 window | 数字到 App；同次带思考范围的速度 UI、真实压缩／恢复未完 |
| OpenCode 1.18.30，本轮 | 可用 | 可用 | 可用，正样本 | 可用，零样本 | used 可用；window／比例 blocked_unverified：有效目录缺上限 | 正文、用量、used 到 App 并重启读回；思考、有效窗口与正缓存写待补 |
| CodeBuddy 2.133.1，前轮 | 可用 | 可用 | 条件：部分调用缺失 | 未验证 | ACP raw_absent；本地来源未验证 | 原生用量到 App；思考、Context／缓存写待样本 |
| Qwen 0.24.6，前轮 | 可用 | 可用 | 可用 | 未验证 | 可用：原生 Gauge | 正文到 Core；压缩／恢复／重放与 App 待补 |
| Pi 0.84.4，前轮 | 可用 | 可用 | 可用 | 可用，零样本 | 条件可用：原生估计＋实际窗口 | 正文＋思考、用量／Context 到 App；真实压缩／恢复待补 |
| ZCode 0.16.9，前轮 | 可用 | 可用 | 可用 | 未验证 | 未验证 | reasoning_delta 到 Core；独立完整 raw、Context 待补 |
| DSH 0.1.5-rc.3，前轮 | 条件：分类不全时未知 | 可用 | 已测未上报 | 已测未上报 | Gauge 已读，窗口有效性未验证 | 当前完整块排除测速；完整输入分类与有效窗口待补 |
| Qoder 1.1.64，本轮 | 条件可用：custom | 条件可用：custom | 条件：正值／部分调用 | blocked_unverified：原生默认零无 presence | 原生比例可用；used／window raw_absent 于当前 journal | 正文＋思考、用量／比例到 App 并重启读回；其他 Provider、正缓存写与恢复待补 |
| Kimi 2.1.1，前轮 | 可用 | 可用 | 可用，正样本 | 条件：adapter 明确零，正值未验证 | 可用：ACP Gauge | 用量／Context 到 App；真实思考与压缩／恢复待补 |
| Grok 1.0.44，本轮 | 可用 | 可用 | 可用，正样本 | 可用，零样本 | 条件可用：原生 used＋匹配显式 model window | 正文／思考数字、用量／Context 到 App 并重启读回；思考范围 UI、内置模型目录与配置切换待补 |
| Antigravity 1.2.12，前轮 | 未验证 | 未验证 | 未验证 | 未验证 | 未验证 | 当前只有终稿，排除测速；结构化／本地来源待审计 |
| Kiro 2.21.1，前轮 | 未验证 | 未验证 | 未验证 | 未验证 | 未验证 | 正文到 Core；原始数字来源、真实思考与 App 待补 |
| TRAE CN 0.120.52，前轮 | ACP raw_absent | ACP raw_absent | ACP raw_absent | ACP raw_absent | ACP raw_absent，本地未验证 | 健康正文＋思考到 Core；本地数字／App 待补 |
| Copilot 1.0.83，本轮 | 可用 | 可用 | 可用，正样本 | 可用，正样本 | 可用：原生 Gauge | 正文＋思考、四项／Context 到 App 并重启读回；显式模型、真实压缩／恢复待补 |
| Cursor Agent | 排除 | 排除 | 排除 | 排除 | 排除 | 按用户要求，不纳入当前支持 |

## 5. 自动化、迁移与剩余工作

数据库保持 v1.72：Migration 178 建立 schema 128 的当前 Session 投影，新增 Migration 179 将已安装
schema 128 原子升级至 129，只添加 nullable REAL 比例。已有 used/window 和业务数据保留，不重写
178，也不回填历史比例。原有迁移 owner 覆盖 127 → 128 → 129、128 记录保留、179 收据失败回滚
字段／receipt／marker，以及非法比例被 SQLite 拒绝。

既有 Rust owner 扩展 Qoder 原生数字／隐藏值／比例、baseline／半行／重置、OpenCode 最新占用、
Copilot 逐调用／稀疏字段／原生身份与 Grok Gauge；两份真实数字 fixture 回放到原 parser 和 SQLite seam，
不只保存最后投影。准入理由见[测试记录](../../development/testing.md#原生-usagecontext-测试准入2026-09-30)。
未新增、删除、合并或停用 Rust owner。

本轮默认 workspace Rust 448 项通过、1 项忽略；更新后的 native owner 3 项和 monitoring owner 11 项通过。
Vitest 223 文件／2414 项通过，TypeScript 与 arm64 release/package/signature 通过。通用文档门禁及
当前 main base 的 diff-aware 门结果随本轮交付记录，不用测试总数替代逐字段支持证据。

剩余工作按缺少的证据推进：

1. OpenCode 有效窗口：需该实际 Provider／模型的可信 `limit.context`，再验证原生 ACP used/size；
   现有目录为零时不能配置一个猜测上限。正 Cache Write 和思考流仍需独立样本。
2. Grok 内置 catalog／配置切换：当前只验证显式 native model window。需要原生内置模型目录的版本
   与有效选项证据；同次思考范围速度 UI 还没有正样本。
3. Qoder 非 custom、缓存写、恢复／压缩：隐藏零值不具备真实计量资格；需返回前 presence 或正值、
   当前 Runtime 明确支持的设置和连续 Session 边界，不启用臆测开关。
4. Copilot 显式模型／rerouting、真实压缩／恢复失败换 Session、取消及所有并发组合：本轮证明默认
   健康长任务、同 Session 两 Run 和 Core 重启；不升级为这些场景全部通过。
5. CodeBuddy Context／Cache Write、Claude 同次思考 UI、ZCode 独立 raw、DSH 分类／窗口，以及
   Kiro／TRAE／Antigravity 本地来源继续按前轮缺口审计。当前成功 ACP 未报字段不能统一归为不支持。
6. JSONL 终态尾读沿用固定 400ms；超过该延迟、超出短暂 owner 保留期的迟到数据仍未验证。
   不以固定等待声称任意时延或异常路径完整。

### 原生依据与权威边界

- [OpenCode v1.18.30 usage.ts](https://github.com/anomalyco/opencode/blob/v1.18.30/packages/opencode/src/acp/usage.ts)：contextTokens 取最近调用的输入与缓存，输出和 reasoning 分开。
- [OpenCode v1.18.30 service.ts](https://github.com/anomalyco/opencode/blob/v1.18.30/packages/opencode/src/acp/service.ts)：有效 Provider/Model 上限缺失时不发送 Usage Gauge。
- Qoder 1.1.64 实际安装包的 custom Usage 归一化与隐藏路径、Copilot 1.0.83 实际加载 `app.js` 的事件订阅／累计终态／usage_info、Grok 1.0.44 原始通知与隔离原生配置是本轮本机证据；没有用第三方实现替代实际核验。

字段与归属由 [Runtime Usage Monitoring v4](../../contracts/runtime-usage-monitoring-v4.md)、
[Runtime Execution Metrics v1](../../contracts/runtime-execution-metrics-v1.md) 拥有；本文只记录实现证据与限制。
