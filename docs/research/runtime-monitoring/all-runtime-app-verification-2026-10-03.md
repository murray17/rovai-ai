---
document_type: research
status: verified_with_limits
last_updated: 2026-10-03
---

# 同一会话的 15 类 Runtime 打包 App 验收

> **2026-10-03 验收结论修正：**本文的 15 类数值/UI 对照只证明“已有投影与选定来源一致”，
> 包含 null 与 null 的一致，不能证明必需字段已经齐全。DSH 的 `totalTokens` 和 ZCode 的
> `runtime.contextUsage` 实际存在但未接入。后续修复与逐项缺口见
> [遗漏字段修复核验](missing-fields-verification-2026-10-03.md)。本轮不能被引用为“15 类完整采集通过”。

## 范围

按用户要求，在隔离签名 App 中创建一个 Thread，加入 15 名分别使用不同 Runtime 的技术验收队员，
排除 Cursor。每名队员实际读取两个工作区文件，完成约 350–500 字分析并产生公开结果。
所有 Runtime 均取得成功终态和可读结果；18 次成功终态、5 次配置失败记录保留在同一 Thread 中。
终态成功不等于任务中的每个工具均成功，DSH 的工具错误单列如下。
本轮任务耗时约 33–157 秒，均包含工具调用。没有恢复 tok/s 或其他估算计数。

本轮使用本机已安装 Runtime 和原生配置；daily App 的数据库、成员、配置及运行进程未变更。
构建基线为 `8dee908be685df91fe6f9d6dab33024e7d86029d`，随后修复下文发现的 Grok 采集遗漏并重新打包。
Grok、DSH 在修复后的包中复跑；另外 13 类保留原始调用与持久数据，并在新包中重新逐一检查 UI。

验收 Thread：`rvcamp_01m3ynbhzxe0s9rstfra7x1efm`，名称“15 类 Runtime · 原生指标实测（无测速）”。
本机保留目录为 `~/Library/Application Support/RovaiMetricsAcceptance/all-runtimes-3bff06da/`：
`Rovai Metrics Validation.app`、`user-data`、`workspace`、`evidence` 相互明确隔离。
这不是日常 App 的安装位置。

## 字段级结果

下表使用精确原生 token 数；`—` 表示未知。已列数字均完成原始数值来源 → 归属／数据库 →
`monitoring.execution` → **同次真实调用的生产 Renderer** 对照。
零是本次原生明确上报的零，不代表该字段已取得正值样本。

| Runtime / 实测版本 | Input | Output | Cache Read | Cache Write | 当前 Context |
| --- | ---: | ---: | ---: | ---: | --- |
| Codex 0.159.2 | 93459 | 3490 | 83328 | 0 | 22084 / 258400 |
| Claude Code 2.1.280 | 63773 | 1863 | 0 | 0 | 13634 / 200000 |
| OpenCode 1.18.32 | 75451 | 1380 | 63616 | 0 | 13730 / 200000 |
| Copilot 1.0.83 | 179827 | 1974 | 147964 | **31851** | 24693 / 200000 |
| CodeBuddy 2.133.1 | 114911 | 611 | 90496（部分调用） | — | 23953 / — |
| Qwen Code 0.24.6 | 77112 | 1303 | 56704 | — | 19968 / 272000 |
| Pi 0.84.4 | 46441 | 557 | 26112 | 0 | 10140 / 1050000 |
| ZCode 0.16.9 | 83166 | 1087 | 48128 | — | — |
| DeepSeek Harness 0.1.5-rc.3 | — | 1856 | 154496 | — | 14319 / 262144 |
| Qoder 1.1.64 | 136683 | 3511 | 106368（已观测分类） | — | 原生比例 2.8278%；数量未知 |
| Kimi Code 2.1.1 | 112027 | 839 | 88192 | 0 | 23630 / 262144 |
| Grok Build 1.0.44 | 87447 | 588 | 84096 | 0 | **22409 / 1050000** |
| Antigravity 1.2.14 | — | 3219 | 28457 | — | — |
| Kiro 2.21.1 | — | — | — | — | 原生比例 7.7%；数量未知 |
| TRAE CLI CN 0.120.52 | 104045 | 1214 | 93184 | — | — |

### 来源、配置与到达时机

- Codex：配置 `gpt-6.1-sol`；`thread/tokenUsage/updated.total` 为消耗，`last.totalTokens` / 窗口为 Context。
  Claude：选择 `opus`，sub2api 实际回报 `gpt-6.1-sol`；逐调用 stream Usage 与终态 result 对照，
  Context 为最后调用输入和同模型 `modelUsage.contextWindow`。
- OpenCode：`opencode/mimo-v2.6-flash-free`，完成调用的原生 SQLite metadata 加总六次调用；
  Context 对照原始 ACP `usage_update.used/size`，本次拿到了有效窗口。
- Copilot：原生实际模型 `claude-opus-5`；六个 `assistant.usage` 与终态聚合相等，终态不再次累加。
  本次明确取得正 Cache Write。Qwen：原生模型 `gpt-5.6-sol(openai)`；四次私有 Usage 和 ACP Gauge。
- CodeBuddy：本机 sub2api / `gpt-6.1-sol`；五个 journal root 调用，使用 `providerData.rawUsage`。
  某次调用缺 Read，90496 仅为已收到的有效 Read；未把该次缺失当零。窗口目录未提供当前自定义模型分母。
- Pi：本机原来的 `gpt-5.6-sol` 已不在当前目录，隔离成员选用现有 `sub2api/gpt-6.1-sol`。
  五次 `message_end.usage`，Context 对照受控原生 RPC 数值通知。
- ZCode：`new-provider/gpt-6-sol`；本轮独立读取同 Native Session 的 `model-io` journal 五个
  `response.usage` 数值对象，与 Core 的 native turn 汇总相等，补齐了独立 raw witness。
  原生归一化层可能合成 Cache Write=0，仍不据此认定已观测。
- DSH：本机 sub2api / `gpt-6.1-sol`，14 个原生 `assistant/message.data.usage`。
  只提取压缩 Session journal 中已提交的数值，不加 `data.stream` 重述。
  启动插件的数字 observation 文件补入 Core；ACP stdout 本身只有 Gauge，不能把空 stdout Usage 当成未采集。
  Cache Write 缺失，互斥输入分类不齐，Input 总量继续未知。
  第五轮两次文件读取成功，但 11 次 shell 调用因原生权限参数校验失败；模型正常返回最终文本，
  公开结果走系统缺失发送恢复。该样本也验证了工具失败后保留原生用量，不能宣称 DSH 工具流程全部通过。
- Qoder：初始 MiniMax 路由错误，切到**本机已有**的 sub2api 自定义 `gpt-6.1-sol` 后健康结束。
  五个 root journal `message.usage`，并保留独立 `context_usage_ratio`；自定义 adapter 的缺失缓存默认零
  没有当作已观测零。Kimi：默认 MiniMax 环境返回 end_turn 却没有正文；使用隔离 sub2api 配置后
  五个 root `step.end.usage` 与迟到 ACP Gauge 接通。实际 wire 模型标签仅为 `__kimi_env_model__`。
- Grok：本机 sub2api / `gpt-6.1-sol`；终态原生聚合计入一次，Context 取通知 `_meta.totalTokens`，
  窗口取原生 config 中同一模型的 `context_window`。
- Antigravity：选择 `gemini-3.7-flash-medium`，实际模型未由流独立确认；六个根 DONE step 的 Output/Read。
  Kiro：选择 `minimax-m2.5`，实际模型未独立确认；`_kiro.dev/metadata.contextUsagePercentage`。
  TRAE：选择 `GLM-5.3`，六个原生 root journal `response_meta.usage`，ACP 本身没有四桶。

## 自检发现及修复

Grok 真实原始事件中，最后的 `available_commands_update` 携带 Context **19724**，但旧包数据库
仍为最后正文块携带的 **19636**。原因为 Core 把整个 catalog notification 提前归为 Session metadata，
没有让已有 Context parser 读取它，属于 `present_not_mapped`。

修复只让当前 Prompt 的合格根 Context 经过数字采集；随后仍在 Evidence / Renderer IPC 前丢弃目录内容。
其他 Runtime、没有数字、负数、字符串、子 Agent 的目录事件仍按原 metadata 路由处理。
目录数字不设置 prompt activity，避免把执行前拒绝误记为已接受输入。
History Restore 仍先隔离，未放宽旧 Session / Run / 代次归属。

新包独立真实调用最后原始 used=**22409**，数据库与 UI 均相等；原始 Gauge 不再停在上一正文块。
该 Run 的 event_log 和 Execution Evidence 中 `available_commands_update` 内容计数均为 0。
本次没有扩展 Prompt 完成之后任意 catalog event 的迟到采集资格，该边界仍单列为未验证。

## 自动化和真实界面

- 15 / 15 Runtime 的成功终态样本数值来源与持久读回一致，15 / 15 当前 UI 用量及 Context 断言通过。
- 生产 App 中逐个点击队员、展开真实 Run、打开用量和 Context 气泡，比较原生读回后的 k 格式及百分比。
  包含比例但数量未知、只有 used、部分桶、全无 Usage（只显示耗时入口）及原生零。
  未改组件或注入模拟数据；自动检查在窗口遮挡时使用 CDP focus emulation，截图来自真实 Renderer。
- App 多次正常重开，旧 13 类成功 Run 及对应 Session 投影保留；该过程不代替各 Runtime 的完整原生 resume 验收。
- 扩展既有 `grok_turn_usage_reaches_active_prompt_without_poisoning_late_idle_route` owner，
  覆盖本次真实 catalog 数值和无效／子 Agent／其他 Runtime 边界，无新增 Rust test owner。
- 定向 `idle_session_metadata_stays_out_of_prompt_output_and_preserves_the_session`、
  `runtime_parsers_emit_sparse_usage_without_antigravity_inference` 及
  `prompt_error_after_activity_keeps_input_accepted_while_early_rejection_does_not` 同时通过；4 项实际执行，0 失败。
- `pnpm package:mac` 成功，复制到隔离目录后 `codesign --verify --deep --strict` 通过。
  新包 Core SHA-256：`cdf9c3d703546221eeef0183056306d7e07e1dc60cd20ea19b5921d7210783cd`。

[脱敏字段与实际 UI fixture](fixtures/round9-all-runtime-app.json) 包含版本、模型、调用时刻、
原始数值、归一化预期、最终读回、界面文字和 Grok 修复前后对照。
本机 `evidence` 还保留每类原始数字 witness、每类用量／上下文截图和完整自检 JSON。

## 未决字段

本轮的“通过”表示本机这些健康样本的数据链路与显示正确，**不表示每个 Runtime 都返回全部字段**。

- **已测来源缺失**：CodeBuddy 的有效窗口／Cache Write，Qwen 的 Cache Write，ZCode 的可信 Context，
  DSH 的 Cache Write，Antigravity 的 Cache Write／Context，Kiro 的四项用量与精确 used/window，
  TRAE 的 Cache Write／Context，均未取得可信原始值；其他本地来源仍未验证。
- **计量语义未证实**：Antigravity 的含缓存 Input，ZCode／Qoder 归一化零是否来自 Provider；保留未知。
- **部分观测**：CodeBuddy、Qoder 的缓存字段仅保留实际可证实的分类，不能据此声明每次调用缓存数据完整。
- 正缓存写只有本次 Copilot 有真实正值；其余返回零的 Runtime 不能据零样本扩大正值场景结论。
- Context 分母来自本次原生通知／有效配置，不等于另行测量 Provider 的最大容量。
- 所有 Provider／所有版本／真实压缩、断线恢复、取消时序等完整组合不在本次 15 类健康长任务的覆盖声明内。
