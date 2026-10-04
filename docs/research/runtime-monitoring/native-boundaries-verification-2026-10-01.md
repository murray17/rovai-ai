---
title: "原生压缩、冷恢复与剩余指标链路验收"
status: "implementation-evidence"
reviewed_at: "2026-10-01"
target_version: "v1.72"
baseline_ref: "8dd51cb1371b7ea70aaaa99c6f52aef83758a2f1"
---

# 原生压缩、冷恢复与剩余指标链路验收

本轮继续 PR #568，补验前轮列出的 Qoder 缓存写、OpenCode 有效窗口、Grok 同次思考范围速度 UI，
以及真实压缩与恢复。产品 Core、Renderer、字符算法和数据库保持基线 `8dd51cb1`；变更是验收入口、
脱敏 fixture、既有测试 owner 和证据记录。v1.72 / schema 129 的数据语义未改变。

采用临时复制的签名 arm64 App、独立 Core data-dir、Skill Library、MCP 和工作区。
每类先完成一个健康 Run，停止 Core，再启动新 Core、比较原投影，然后在同一会话发起第二 Run。
之后停止 Core，用打包 App 打开原 fixture，核对 Context 与完成卡片气泡。日常 App 和数据库保持原状。
这是健康 Run 之间的冷恢复；不等于活跃 Run 崩溃恢复、恢复失败换 Session 或全部并发组合验收。

## 1. 本轮结论与证据范围

| 项目 | 结果 | 限制 |
| --- | --- | --- |
| Codex 0.159.2，原生订阅 / `gpt-6.1-sol` | 两健康 Run、真实原生压缩、Core 冷恢复、App 重开通过；12 组累计消耗不变而 `last.totalTokens` 下降的通知均更新当前投影 | 原生窗口来自通知；hosted search、失败恢复和模型切换未本轮重测 |
| Qoder 1.1.64，sub2api custom / `gpt-6.1-sol` | 两健康 Run、同 Native Session 的新 Host、Core 冷恢复和 App 比例读回通过；正缓存写的受控链路通过 | 真实 Provider 本轮只返回零；journal 的零仍不能区分缺失，Cache Write 继续未知。受控 111 不是实际消耗 |
| OpenCode 1.18.30，`sub2api/gpt-6.1-sol` | 隔离显式 `limit.context` 经原生 loader、ACP Gauge、SQLite、App 闭环；同 Session 冷恢复通过 | 默认目录仍为 context=0；显式配置的有效上限不等于独立实测的 Provider 物理容量。思考、正 Cache Write 未观测 |
| Grok Build 1.0.44（5b807183dd79），sub2api / `gpt-6.1-sol` | 同次正文＋思考范围速度到真实 App；两 Run 冷恢复、真实原生压缩、Context 失效／更新和 App 重开通过 | 窗口仍限定匹配实际模型的显式 native config；内置目录、配置切换与失败恢复未本轮重测 |

字段状态继续使用 `verified_available`、`raw_absent`、`present_not_mapped`、
`mapped_not_projected`、`blocked_unverified`。条件可用需要附条件：不能把受控正值当真实计量，
也不能把配置上限写成独立验证的模型最大容量。

签名 Core SHA-256 为 `d75184b866e623ec4fe68b37e79b476d205c6b6c9a43f515411c05485a1aef9e`。
与工作树 unsigned release Core 的 Mach-O `__text` SHA-256 均为
`95d5bd53d4af0d4de90e6d9e55a4521349c63813fe8959544d326950b4f82981`；签名造成整文件 hash 不同，
没有据此误判为不同实现。App 复制使用 `ditto`，`codesign --verify --deep --strict` 通过。

## 2. Codex：真实压缩不能被累计用量去重丢掉

隔离原生启动使用已安装 CLI 的 `-c model_auto_compact_token_limit=18000`，触发原生自动压缩。
没有替换 `modelContextWindow`。两个 Run 正常结束，公开执行 Evidence 记录 12 次 `native_terminal`
压缩完成及对应开始；恢复后仍记住首轮公开 marker。

[数字 fixture](fixtures/round7-native-boundaries.json) 保留真实通知的必要字段。例如：

```text
tokenUsage.total = input 100051 / cachedInput 81152 / output 1112 / total 101163
tokenUsage.last.totalTokens = 20620 → 13262
modelContextWindow = 258400
```

两帧原生累计字段与 turn 身份不变，当前占用下降。12 次下降的目标值均在实际 Session 读取轨迹中
出现，既没有取历史最大值，也没有重加 Run 消耗。既有
`codex_context_changes_independently_of_cumulative_run_usage` owner 回放该真实两帧和重复第二帧，
同时断言 Run 来源只认领一次、Context 来源有两份、used 最终为 13262。

本轮 observer 保留了原生 turn 的匿名身份，但未保留 native threadId。
fixture 的 threadId 由当前 Core binding 匿名化补足，仅用于 parser 重放；不把它称为独立 wire 身份见证。
冷恢复证据包括 Core 的会话／代次连续、原生累计值连续及公开 marker 正确回忆。
后续 probe 已增加 observer generation 与 item type，方便区分新 native 进程和压缩 item。

## 3. Qoder：真实零、缺失和受控正值分别记录

实际 native custom model 使用 `openai-responses`。在只转发既有授权 origin 的隔离 HTTP probe 中，
健康调用的 `response.completed.response.usage.input_tokens_details.cache_write_tokens` 明确返回 0。
两次调用分别为 Input 24107／24667、Output 501／29、Cache Read 0／23936。
不能将“journal 没有 presence”改写为“原始 Provider 没有该字段”。

Qoder 的 journal 归一化会为缺字段补零，Rovai 只读该 journal 时没有 Provider presence。
因此这份真实零样本的最终 Cache Write 仍为 `null`；本轮未放宽生产采集资格。

另一个明确标注 `controlled_positive` 的 probe 只把三个完成响应的
`input_tokens_details.cache_write_tokens` 改为 37，内容照常转发。
安装版本实际将其写入 `message.usage.cache_creation_input_tokens`，Core 保存并读回 111，
重开 App 显示 `0.1k`。Input 73532 已包含缓存，Output 635 已含 `output_tokens_details` 中的 reasoning 10，
没有再加一次；Cache Read 为 62080。
这证明正值资格、逐调用归并、落盘和 UI 链路可用，数字本身是合成验收数据。

两个真实 cold Run 的原生 host 身份不同，但 Native Session、binding 和代次相同。
比例由 journal `context_usage_ratio` 直接保存，数量保持未知；重开 App 为 `— / —，2.7%`。
较早最大推理强度长任务在 480s 验收期限内未结束，保留部分观测，未纳入健康终态结论；
重试任务仍覆盖公开长正文、思考和续轮，不用这个未结束任务证明完整用量。

## 4. OpenCode：验证有效配置，不猜默认分母

实际默认模型目录仍报告 `limit.context=0`。Provider `/v1/models` 没有提供这个自定义模型的窗口
元信息，因此默认路径的 window 和比例保持未知。
本轮将现有 Qoder 同一授权 origin、同一 `gpt-6.1-sol` 自定义模型的显式配置值
context=1050000／output=128000 复制到隔离 OpenCode native config 的 `limit`。
原生配置文件未修改。

原生 ACP 随调用完成实际发送 `usage_update.used/size`：14793／1050000，随后 16150／1050000。
同次根 native SQLite 的最近调用 input＋cache.read＋cache.write 与 used 对上；Output 加 reasoning
只用于输出用量，不进入 used。原生 loader 拥有 Provider／Model 的有效配置合并，Core 没有增加通用
窗口猜测或从其他 Runtime 实时拼接分母。
本结论限定这个显式有效配置，不保证实际 Provider 的物理窗口容量就是该值。

另一个真实 App 长回合显示 `9.9k / 1050k，0.9%`；cold fixture 重开为
`16.1k / 1050k，1.5%`。窗口缺失的默认路径仍保留[前轮](native-context-ratio-verification-2026-10-01.md)的未知结论。

## 5. Grok：同次思考速度 UI 与原生压缩

原生启动选择已安装 CLI 的 `agent --reasoning-effort high`，困难推理加持续公开输出与工具停顿。
真实打包 App 的健康 Run 持续约 293 秒，收到公开正文 310585、思考 5350 个 v3 整数单位。
423 份实际 DOM 观测同时含当前速度与“公开正文与可观测思考增量”提示；例如 `23.7 tok/s` 与
`1分 16秒` 并列，位于队员名称行，速度不可点击。90 次数值发布，任意 30s 最多 25 次，
相邻数值发布最短 999.5ms。终态立即移除速度，完成卡片只有用量入口，耗时在气泡中。

另一个两 Run cold probe 在新 Host 中通过原生 `_x.ai/debug/arm_auto_compact` 验收入口触发真实压缩，
收到 `auto_compact_started/completed`。当前绑定的 completed observation 已保存；压缩后旧 Context
投影清空，后续原生通知更新为 19870／1050000。
Core 公开压缩 Evidence 的 before／after 为 9325／7415；本轮 raw observer 只保留这两个字段名，
未保留它们的数字，所以 fixture 明确将该数值来源标为 Core Evidence。
压缩统计的 after 不替代后续 Session Gauge；新轮启动及新增上下文后最终 used 可以再次增大。
本轮只证明指标状态边界，不宣称验收了所有压缩 bootstrap 重投递策略。

## 6. 用量、冷恢复和 App 重开对账

单位为原生 Token，顺序为 Input／Output／Cache Read／Cache Write。每次 Core 冷重启后的旧完整投影
与停止前相同，再发新 Run。Qoder／OpenCode／Grok 两个 native Host 的 lease 绑定同一原生 Session。

| Runtime | 首 Run | 冷恢复后的 Run | 第二 Run 的 Context／App |
| --- | --- | --- | --- |
| Codex | 160779／1656／135936／0 | 98596／650／75648／0 | 19329／258400；`19.3k / 258.4k，7.5%` |
| Qoder，真实 | 50776／2610／23936／null | 55753／1396／40704／null | 原生比例 2.72295%；`— / —，2.7%` |
| OpenCode，显式 limit | 95729／7653／79872／0 | 47455／822／34816／0 | 16150／1050000；`16.1k / 1050k，1.5%` |
| Grok，显式 window | 92387／1498／72064／0 | 58727／616／53504／0 | 19870／1050000；`19.9k / 1050k，1.9%` |

9 个 Qoder journal 调用（4 真实 cold、2 真实 presence、3 受控正值）与 11 个 OpenCode 调用分别归并，
逐字段与最终读回一致。Grok 终态聚合拥有 Run 数字，不把 response_completed 的重述再次相加。
Codex 第二 Run 只认领恢复后的增量，不把原生 Session 累计消耗认领为该 Run。
四个 cold fixture 与受控 Qoder fixture 均完成真实 App 重开，气泡四项及耗时与读取一致，终态无速度。
截图在交付目录 `context-round7-20261001/`。

## 7. 当前支持范围与剩余项

本表只更新本轮四类；其他 Runtime 的版本、Provider、原始字段和 UI 阶段沿用
[前轮 16 类矩阵](native-context-ratio-verification-2026-10-01.md#4-当前-16-类字段矩阵)，不视为重测。

| Runtime | 本轮后的主要状态／剩余证据 |
| --- | --- |
| Codex | 四项、last/window、正文＋摘要 App 已接；本轮真实压缩、健康 cold resume 与 App 重开通过。hosted search、异常恢复／换代和配置变化仍未验证 |
| Claude Code | 最新调用＋匹配窗口与数字 App 证据保留；同次思考速度 UI、真实压缩／恢复待补 |
| OpenCode | 四项、正缓存读、正文到 App；显式有效 limit 的 Gauge／UI 与健康 cold resume 本轮通过。默认上限、思考、正缓存写仍未验证 |
| CodeBuddy | 原生四项中的缓存读部分可用；Context、思考与缓存写仍待样本 |
| Qwen Code | Input／Output／Cache Read、原生 Gauge 和正文证据保留；缓存写、压缩／恢复／重放与 App 待补 |
| Pi | 四项、正文＋思考和原生估计 Context 到 App；真实压缩／恢复仍未验证 |
| ZCode | Input／Output／Cache Read、reasoning 到 Core；完整独立 raw、Context／缓存写仍未验证 |
| DeepSeek Harness | 分类不全时 Input 未知，Output／Gauge 可读；完整块不测速。完整缓存分类和有效窗口仍未验证 |
| Qoder | custom Input／Output、正缓存读、独立比例到 App，健康 cold resume 本轮通过。Cache Write 正值为条件可用且仅有受控样本；真实正值、非 custom 隐藏路径、真实压缩仍未验证 |
| Kimi Code | 四项、正缓存读、Gauge 到 App；正缓存写、真实思考与压缩／恢复仍未验证 |
| Grok Build | 四项、显式 Context、同次思考速度 App、健康 cold resume／原生压缩本轮通过；内置窗口目录、配置切换与异常恢复仍未验证 |
| Antigravity | 当前只有终稿，排除测速；结构化／本地数字来源仍未验证 |
| Kiro | 较长正文到 Core；原始用量／Context、思考与 App 仍未验证 |
| TRAE CLI CN | 健康正文＋思考到 Core；当前 ACP 原始用量／Gauge 未报，本地来源与 App 待补 |
| Copilot CLI | 前轮额度恢复后四项、正缓存写、正文＋私有思考和 Gauge 到 App；显式模型、rerouting、真实压缩／异常恢复仍未验证 |
| Cursor Agent | 按用户要求排除 |

字段没有样本时继续未知。默认窗口需要实际 native catalog／有效配置；Qoder 真实正缓存写需要授权
Provider 自然返回正值；其他异常场景需要对应 Runtime、模型与明确的故障注入，不能从一次健康恢复
推导全部通过。

## 8. 自动化与可复现入口

本轮 fixture 同时包含必要 raw、期望 parser 数字、实际 SQLite 读回和 App 结果。
既有 `monitoring` Codex 来源 owner 扩展真实降值／重复；既有 ACP parser owner 回放 Grok 终态与 Gauge；
既有 `native_usage` DTO owner 回放真实／受控 Qoder，OpenCode SQLite owner 回放 11 调用。
未新增、删除、合并或停用 Rust owner。准入与最低命令见[测试记录](../../development/testing.md#原生-usagecontext-测试准入2026-09-30)。

```bash
ROVAI_OBSERVABLE_COLD_RESTART=1 \
ROVAI_OBSERVABLE_PROMPT_FILE=<长任务文件> \
ROVAI_OBSERVABLE_FOLLOWUP_PROMPT_FILE=<续轮文件> \
node scripts/probe-observable-output.mjs <runtime-kind>
```

该入口拥有临时 Core 与数据目录；Grok 增加 `ROVAI_OBSERVABLE_GROK_COMPACT_AFTER_RESTART=1` 可在
健康 cold resume 后触发上述原生压缩验收入口。显式 `ROVAI_<RUNTIME>_BIN` 可指向隔离的原生选项
wrapper，不被 PATH 的默认二进制覆盖。observer 只保存数字、形态和匿名游标，不保存正文或思考内容。
`observerGeneration`、`itemType` 与压缩数字白名单是本轮结束后完善的入口字段，不回填成已捕获的 raw。

本轮默认 Rust workspace、更新后的 monitoring／native owner、脚本语法、文档三门均通过；具体命令
和结果在交付 `verification.json`。真实 Renderer 验收使用基线签名 App，产品二进制未改；此前固定
回放、Unicode 分片、隐私和迟到用量验收保留[前轮证据](native-context-ratio-verification-2026-10-01.md#私有内容与固定回放)。

原生阈值选项参考[Codex 官方配置定义](https://github.com/openai/codex/blob/main/codex-rs/config/src/config_toml.rs)，
有效 OpenCode Gauge 参考[已安装版本 service.ts](https://github.com/anomalyco/opencode/blob/v1.18.30/packages/opencode/src/acp/service.ts)。
本记录只拥有实测证据；归属、字段和显示规则仍由
[Runtime Usage Monitoring v4](../../contracts/runtime-usage-monitoring-v4.md) 与
[Runtime Execution Metrics v1](../../contracts/runtime-execution-metrics-v1.md) 拥有。
