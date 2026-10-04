---
title: "原生 Usage 与 Context 补接及真实验收"
status: "implementation-evidence"
reviewed_at: "2026-10-01"
target_version: "v1.72"
baseline_ref: "0e23f6fc6f7f6943ce93e4e1f083efb68b453f2b"
---

# 原生 Usage 与 Context 补接及真实验收

本轮继续 PR #568，在合入 #599 后的 `0e23f6fc` 上补可取得的原生数值；没有修改速度位置、
字符权重、刷新节奏、Run Card、用量气泡或上下文圆环布局，没有新增数据库表。
日常 App／数据库没有被替换或降级。所有真实调用和 App 验收均使用隔离 Core、userData、Skill
Library、MCP 和新工作区；只复用用户已经授权的 Provider 配置。

本记录更新[前轮思考流验收](observable-output-v3-verification-2026-09-30.md)与
[第二轮用量记录](execution-metrics-verification-2026-09-29.md)的证据范围。前轮结果保留其当时版本、
Provider、模型和场景，不扩展为本轮重测全部 Runtime。

## 状态与证据阶段

- `verified_available`：所列版本、配置和场景已取得原始数值、解析、持久化和读回；Renderer 另列。
- `raw_absent`：健康成功调用的指定通道中没有字段，不表示其他原生来源一定不存在。
- `present_not_mapped`：原始有字段，当前入口／parser 未接。
- `mapped_not_projected`：已解析，归属／保存／读取尚未闭环。
- `blocked_unverified`：尚无对应健康样本，或缺少计量语义、配置、窗口、身份／独立原始见证。

“可用”只覆盖表中事实；缓存写零不是正缓存写能力，原生估计不是精确窗口。缺失保持 `null`。
测速仍是 `observable-output-heuristic-v3` 的临时显示估算，不能进入任何原生 Usage、费用或 Context。

## 本轮来源、字段与到达时机

必要脱敏原始字段、逐调用期望解析、实际最终读回及 Context 数值见
[真实数字 fixture](fixtures/round5-native-usage-context.json)。它包含 7 类 Runtime、其中 5 类各两次
成功 Run；10 个 Run 的原生唯一调用数值之和逐字段与数据库读回相等。每对 Run 都维持同一原生
Session 与绑定代次 1，第二轮没有认领第一轮历史消耗。

| Runtime／实际版本 | 启动方式、Provider／模型证据 | 原始来源与到达时机 | 归一化与当前边界 |
| --- | --- | --- | --- |
| CodeBuddy 2.133.1 | Managed ACP；本机已授权 sub2api，原生观测 `gpt-6.1-sol` | 当前根 `cli` 的原生 journal，`providerData.rawUsage`，每个调用完成时；ACP 本次不报四项／Gauge | prompt 已含缓存，completion 已含 reasoning；messageId 去重；缓存读部分调用缺失，写未知；原生 API 模型别名已补准入 |
| Kimi Code 2.1.1 | Managed ACP；隔离 provider file 使用 Claude 同一 sub2api／`gpt-6.1-sol`；原生仅回 `__kimi_env_model__` 标签，实际模型未独立由 wire 证明 | 根 `agents/main/wire.jsonl` 的 `context.append_loop_event / step.end`；最后 step 可晚于 ACP 完成；ACP `usage_update.used/size` 提供 Gauge | 三个互斥输入桶齐全才合成 Input；uuid 去重，`usage.record` 重述不加；原生 OpenAI adapter 明确返回 Cache Write=0，正值未验证 |
| OpenCode 1.18.30 | Managed ACP；原生配置 `sub2api/gpt-6.1-sol`，当前模型配置只有 name，没有 limit.context | 原生只读 `opencode.db` 的当前根 Session／已完成 assistant message 数值；ACP terminal 仅最后调用；当前没有 Gauge | 三个输入桶合成，output＋独立 reasoning 一次；排除历史 pending／子 Session，message ID 去重；没有窗口配置时不制造 Context |
| Claude Code 2.1.280 | `stream-json`＋partial events；已授权配置，原生 message/modelUsage 观测 `gpt-6.1-sol` | 根 message_start／message_delta 的逐调用累计；result 的该模型 contextWindow 在完成时到达 | 新 message 首次累计从零计入，终态 Token 聚合不重加；最近调用三项输入配对当前模型 window；起始全零占位不补缺字段，子 Agent 不覆盖根调用身份 |
| Pi 0.84.4 | RPC＋managed host v8；隔离副本 sub2api／`gpt-6.1-sol`／medium，原生 provider/model 由 Host 验证 | 根 assistant message_end 的 Usage；turn_end／session_compact 的原生 `ctx.getContextUsage()` 数值 status | 四项按已验证桶处理；Context 保存 Pi 原生估计，实际模型键已替代 runtime-default 标签；压缩后 tokens 未知只保留 window |
| Qoder 1.1.64 | Managed ACP；Core 原生模型观测自定义 Provider／`gpt-6.1-sol`，端点未独立留证 | 约 109s 健康终态；290 thought、401 body chunk；当前 ACP 四项／Gauge raw_absent | 正文与已交付思考进入 Core；全 Run 35625 思考估算单位不是 Output Token；原生本地 Usage／比例尚未接通 |
| TRAE CLI CN 0.120.52 | Managed ACP；Core 观测 GLM-5.3，Provider 未独立观测 | 约 60s 健康终态；120 thought、34 body chunk；当前 ACP 四项／Gauge raw_absent | Core 思考 196695 单位，先前 8 分钟部分流已补健康终态；原生本地 Usage／Context 仍未验证 |

OpenCode 当前安装版是 1.18.30；前轮记录的 1.18.32 不作为当前二进制来源。
Claude 与 Pi 本轮原始流分别捕获 158／86 个 thinking_delta，均有同次 Core 思考数值正样本。
CodeBuddy、Kimi、OpenCode 本轮未收到思考增量，不描述为模型没有思考。

### 逐 Run 对账

数字为 Token，顺序为 Input／Output／Cache Read／Cache Write；不是 tok/s，也不是 Context。

| Runtime | 首 Run：原生唯一调用→最终读回 | 同 Session 第二 Run | Context 首／次观测 |
| --- | --- | --- | --- |
| CodeBuddy | 5 调用：111660／1308／87680／null | 3 调用：72419／525／70912／null | 未知；首 Run 缓存读只观测到 4/5 调用 |
| Kimi | 4 step：83865／560／61824／0 | 3 step：66877／502／65408／0 | 21597／262144 → 22576／262144 |
| OpenCode | 5 调用：43922／1248／33664／0 | 3 调用：31316／525／20352／0 | 当前配置不具备有效窗口，ACP 无 Gauge |
| Claude | 4 调用：48123／2118／5888／0 | 3 调用：42322／1208／18048／0 | 12819／200000 → 14507／200000 |
| Pi | 4 调用：34177／658／24576／0 | 3 调用：29651／503／28288／0 | 原生估计 9211／1050000 → 10165／1050000 |

Claude 第二轮 `modelUsage.inputTokens` 是累计值，不用于当前 Context；最新调用输入不是整轮 Input。
Pi Native 窗口来自实际 provider/model，不从自定义模型名称猜窗口。

### Kimi 终态写入竞争

独立对账发现：第二 Run 的 ACP 已结束，最后一条原生 step 刚写入，立即 terminal Flush 漏掉它。
修复前读回为 45004／543／43904／0，实际三 step 为 67958／596／66432／0。必要原始数字与
错误读回保存在[终态竞争 regression](fixtures/round5-kimi-terminal-gap.json)。

当前 reader 在同一 Run 的序列化 Flush 中先读，保留 cursor 等待固定 400ms，再读尾部，之后才准许
下一 prompt 建立 baseline。确定性 owner 在终态读取开始后 75ms 写入新 step；真实同 Session 两 Run
复测匹配全部七 step。超过 400ms 的任意文件延迟仍未验证；没有用固定等待声称任意场景完整。

### Pi 数值事件交接身份

最终检查发现 Pi 私有 Context 事件在校验后曾重新读取实时 owner；若中间发生 Run 交接，
旧事件可能被包装成新 Run 身份。修复后数值 packet 沿用已校验的 Run／epoch／Session 与当时
prompt／delivery 身份，Core 继续按完整绑定拒绝旧事件，不把数值重新归属给后继 Run。
这是代码审计发现的竞态；已有数值 DTO owner 扩展了交接后的 packet 身份断言，不宣称真实调用
已稳定复现该时间窗口。

## 16 类 Runtime 字段矩阵

`可用`对应上述 verified_available；`条件`明确限制；`未上报`只指所列健康通道的 raw_absent；
`未验证`包含 blocked_unverified 和欠缺原始／配置证据。标“前轮”的原始证据与具体模型见
[前轮 Runtime 表](observable-output-v3-verification-2026-09-30.md#16-类-runtime-来源表)及
[四项原生证据](execution-metrics-verification-2026-09-29.md)。本轮没有把它们升级为重测通过。

| Runtime／证据版本 | Input | Output | Cache Read | Cache Write | Context used／window | 速度与阶段／主要剩余项 |
| --- | --- | --- | --- | --- | --- | --- |
| Codex 0.159.2，前轮 | 可用 | 可用 | 可用 | 可用 | 可用：last／同通知 window | 正文＋摘要到 App；hosted search、真实压缩／恢复边界未完 |
| Claude 2.1.280，本轮 | 可用 | 可用 | 可用 | 可用，零样本 | 可用：最新调用＋匹配模型窗口 | 正文、Usage／Context 到 App；末尾思考已读取，带思考范围的速度显示尚待长样本 |
| OpenCode 1.18.30，本轮 | 可用 | 可用 | 可用，正样本 | 可用，零样本 | 当前 ACP 未上报；本地占用未验证 | 正文到 App、多工具与终态归并；配置有效窗口后的 Gauge／正缓存写未完 |
| CodeBuddy 2.133.1，本轮 | 可用 | 可用 | 条件：部分调用缺失 | 未验证 | 当前 ACP 未上报；本地来源未验证 | 正文与原生 Usage 到 App；思考、Context／缓存写待样本 |
| Qwen 0.24.6，前轮 | 可用 | 可用 | 可用 | 未验证 | 可用：原生 Gauge | 正文到 Core；真实压缩／恢复／重放与 App 待补 |
| Pi 0.84.4，本轮 | 可用 | 可用 | 可用 | 可用，零样本 | 条件可用：原生估计＋实际窗口 | 正文＋思考、Usage／Context 到 App；真实压缩／恢复待补 |
| ZCode 0.16.9，前轮 | 可用 | 可用 | 可用 | 未验证 | 未验证 | reasoning_delta 到 Core；独立完整原始帧、Context 待补 |
| DSH 0.1.5-rc.3，前轮 | 条件：分类不全时未知 | 可用 | 已测未上报 | 已测未上报 | Gauge 已读，窗口有效性未验证 | 当前完整块正确排除测速；完整输入分类与有效窗口待补 |
| Qoder 1.1.64，本轮 | ACP 未上报 | ACP 未上报 | ACP 未上报 | ACP 未上报 | ACP 未上报，本地未验证 | 健康正文＋思考到 Core；本地用量／比例与 App 待补 |
| Kimi 2.1.1，本轮 | 可用 | 可用 | 可用，正样本 | 条件：adapter 明确零，正值未验证 | 可用：ACP Gauge | 正文、Usage／Context 到 App；真实思考与压缩／恢复待补 |
| Grok 1.0.44，前轮 | 可用 | 可用 | 可用 | 可用 | 未验证 | 正文＋思考到 Core；正缓存、多调用、Context／窗口待补 |
| Antigravity 1.2.12，前轮 | 未验证 | 未验证 | 未验证 | 未验证 | 未验证 | 当前只有终稿，正确排除测速；结构化／本地来源待审计 |
| Kiro 2.21.1，前轮 | 未验证 | 未验证 | 未验证 | 未验证 | 未验证 | 正文到 Core；原始数值来源、真实思考与 App 待补 |
| TRAE CN 0.120.52，本轮 | ACP 未上报 | ACP 未上报 | ACP 未上报 | ACP 未上报 | ACP 未上报，本地未验证 | 健康正文＋思考到 Core；本地数值／App 待补 |
| Copilot CLI | 暂缓 | 暂缓 | 暂缓 | 暂缓 | 暂缓 | 按用户要求，本轮不调用 |
| Cursor Agent | 排除 | 排除 | 排除 | 排除 | 排除 | 按用户要求，不纳入当前产品支持 |

## 打包 App、内容边界与自动化

真实 App 在临时复制的签名 arm64 bundle 启动，不从 dist 运行，不使用日常 Electron userData。
正文持续接收，不节流正文；App 的 MutationObserver 记录的是数值实际变化，状态切换另计。
证据包 `metrics-followup-20260930/` 保存原始字段形态、数字轨迹、气泡与速度截图，仓库保留
[实际 Renderer 数字 fixture](fixtures/round5-native-usage-renderer.json)；完整临时夹具
含私有配置，不导出。Renderer 的选择按本次 Native Run 所属面板定位，历史点击确认按钮可见。

| 实际 App Runtime | 正文／思考数值正样本 | 数字发布次数 | 真实 Usage／Context UI |
| --- | --- | --- | --- |
| Pi 0.84.4 | 原思考正样本：正文 87675、思考 10525 单位；最终候选正文 89200、本次无思考 | 32；最终候选 31 | 四项、原生 Context 估计、终态与当前模型对应 |
| Kimi 2.1.1 | 正文 92500；本次无思考 | 38 | 四项、Gauge、终态完成卡片 |
| CodeBuddy 2.133.1 | 正文 89775；本次无思考 | 37 | 原生 Input／Output／Cache Read，Cache Write 显示未知 |
| Claude 2.1.280 | 最终候选正文 81490、思考 10710 单位；此前正文样本 82460 | 43；此前 42 | 四项、最新根调用 used＋窗口；思考只在末尾约 2s 到达，App 读取数字但未实际显示思考范围速度 |
| OpenCode 1.18.30 | 正文 91650；本次无思考 | 36 | 本 Run 逐调用四项，Context 不补值 |

以上全部健康终态，任意相邻数值变化间隔至少验收门槛 850ms，持续固定状态下源码节拍为 1Hz。
五类首次 App 正样本的最短实际间隔为约 997.5ms，任意 30s 窗口最多 20～22 次数字变化；
固定回放另行验证稳定连续输出的发布上限，不用两次随机模型回答校准体验。
速度位于队员头部同一行，运行卡片保留耗时，终态立即无速度；完成卡片不单独展示耗时，四项和
耗时只在可见气泡内。Pi 真实 App 思考正样本使用尾读修复前的候选（Pi 路径与尾读无关）；
Kimi／CodeBuddy／OpenCode 和首个 Claude 样本使用包含 400ms 修复的候选，签名 Core SHA-256 为
`f0a87df5a7999e5bf72546ffab119d1c480a78166f5ba8ce196885679fa0c6f9`；Pi 实时样本的原签名摘要未独立
保留，按未知记录。补充 Claude 同次思考使用含起始零／子 Agent 硬化的候选，签名 Core SHA-256
为 `2d38e5dcaaf070065f0503071253d91780de51bb32428a103c60f7317bff0a9c`。
五类 App 的隔离 Core 再次启动后，四项、finalizedAt 和已有 Context 的 used／window／实际模型／
绑定代次均与重启前一致；重新打开完成卡片并等待气泡布局后再取截图，避免隐藏按钮或尚未定位的
Portal 被误计作交互通过。

Pi 交接身份修复后的最终签名 Core SHA-256 为
`5f50b291bbd79ff9b60624fdcbff1d156fd38815c6c3cef37821bf9a7ed4416b`。同一签名 App 的新健康 Run
持续 68s：四项为 34513／851／16768／0，Context 原生估计为 9374／1050000；31 次数字发布，
最短间隔约 995.6ms、任意 30s 最多 22 次。重启后数值、当前模型／绑定与可见气泡读回一致。
本次未收到思考，严格思考门槛未满足；保存的轨迹只通过正文、布局、用量／Context 与重启读回断言，
不写成最新候选已通过同次思考显示。此前 Pi 思考 UI 正样本仍单独保留。

补充 Claude 图论长任务在 480s 验收截止时仍在第三段正文输出：正文最高读到 180245 单位，没有
思考数值正样本，未取得健康终态。因此记录为部分执行，不把 `finalizedAt` 未到误报成 Usage 未上报。
短健康回合的思考虽已进入 App 数值读取，但没有任何速度发布同时携带思考范围提示；Claude 思考
UI 仍是未验证。真实 App 的严格思考验收现在同时要求 Core 来源、实际速度和相应可访问范围说明，
不能只凭计数大于零宣布通过。

本轮自动化：workspace 默认 Rust 448 项通过、1 项忽略；真实 journal owner 3 项、Claude 模块
33 项、monitoring owner 11 项定向通过。Vitest 2414 项和 Node 328 项通过（2 项平台跳过），
TypeScript、fmt、workspace check、文档 10 项测试、通用／当前 main base 的文档治理门与 arm64
App 签名均通过。Rust 准入清单保留全部原断言，Pi extension owner 仅随新增数值 hooks 更新命名和版本。

Core 私有路径没有新建正文／思考存储通道。本地 Runtime 自己已持有的 journal 仍由其拥有，Rovai
只读数值 DTO／SQL 元数据；不复制 journal、part、正文、思考、工具参数或内容哈希到监控。
Pi status 的额外内容字段被拒绝；Claude 私有数值事件在 Evidence／IPC 分发前消费。

最低层 owner 与准入理由见[测试记录](../../development/testing.md#原生-usagecontext-测试准入2026-09-30)。
真实 JSONL／SQLite 数字回放扩展对应 owner，终态尾读、历史 baseline、文件重置、重复事件、缺失／零、
子 Session、Host／Run／模型／绑定 fence 均有确定性断言。真实调用不能代替失败、取消、恢复和并发
所有组合的自动化，也不能把总测试数量作为字段支持依据。

## 未决事项与下一步方法

1. CodeBuddy Cache Write 与 Context：当前健康 ACP 不给；需审计同版本原生日志中的准确独立字段，
   再取得正缓存写／占用样本，不能从 prompt tokens 或整轮用量推断。
2. OpenCode Context：原生 sendUsageUpdate 在有效 `model.limit.context` 缺失时不会发送 Gauge。
   当前 `sub2api/gpt-6.1-sol` 没有该配置；需已确认的实际窗口配置后重测，不能硬编码一个猜测窗口。
3. Qoder／TRAE／Kiro／Antigravity：当前通道证据之外，本地来源、准确 Session 归属、比例语义／
   用量脱敏开关仍未审计完成；不能把健康 ACP 缺字段统一称为 Runtime 不支持。
4. Claude／Pi／Qwen／Codex：同 Session 多 Run 已在本轮五条来源取得证据，真实压缩、恢复失败换会话、
   模型切换、子 Agent、多 Provider 与所有失败／取消组合仍须各 Runtime 实际样本。
5. ZCode 独立完整 raw witness 与 DSH 输入分类／有效窗口：沿用前轮缺口；DSH 当前完整块不可测速。
6. 三条本地 reader 限于本次实际版本，路径／格式／上报语义改变需新样本；文件重置停止后保留部分观测。
   400ms 之后才写入、运行结束之后超出 owner 保留期的 Gauge 仍可能缺失，不宣称全面覆盖。

### 原生依据

- [OpenCode v1.18.30 ACP service](https://github.com/anomalyco/opencode/blob/v1.18.30/packages/opencode/src/acp/service.ts)：prompt result 取 latestAssistant；sendUsageUpdate 检查模型 limit.context。
- [OpenCode v1.18.30 Usage](https://github.com/anomalyco/opencode/blob/v1.18.30/packages/opencode/src/acp/usage.ts)：输出与 reasoning、输入与缓存桶的方言关系。
- [Claude Code statusline](https://code.claude.com/docs/en/statusline)：当前占用使用最近调用的三项输入，累计 input/output 不等于窗口占用。
- Pi 0.84.4 安装包 `dist/core/agent-session.js::getContextUsage` 与官方 extension types：原生 context estimate、压缩后未知状态；未调用远端计数接口。

字段归属与实际协议由 [Usage v4](../../contracts/runtime-usage-monitoring-v4.md)及
[Execution Metrics v1](../../contracts/runtime-execution-metrics-v1.md)拥有；本文只记录实现证据和限制。
