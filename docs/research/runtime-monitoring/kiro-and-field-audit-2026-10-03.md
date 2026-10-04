---
document_type: research-note
authority: non-normative
last_updated: 2026-10-03
---

# Kiro used 与全矩阵空值复核

## 结论与上一轮勘误

本轮重新读取隔离 App 中 15 类 Runtime 的最新成功 Run、SQLite 和实际 Renderer，
另做一次 Kiro 健康原生调用。其余 Runtime 复用原有成功样本并核对原生记录，
不声称本轮重新运行了全部 15 类。代码基线为 `a99a4bf0`，Cursor 排除，测速继续停用。

[上一轮补查](native-source-completion-2026-10-03.md)中「Kiro Context 只有比例和模型」
不准确：旧诊断脱敏器把整个 `breakdown` 对象排除了，遗漏了其中的数值。
本轮改用递归数值投影保留这些字段，字符串正文、文件名、工具内容和凭据不输出。
这修正了诊断证据，但新找到的分类数值仍未通过 used 的语义核验。

## Kiro 为什么仍不能显示 used

实测 `kiro-cli 2.21.1` / `minimax-m2.5`，原生 ACP 加载准确绑定的隔离 Session；
先查询 `_kiro.dev/commands/execute` 的 `context`，再在同一 Session 的新进程中
完成约 300 字、无工具的健康 prompt，查询 `stats` 和 `context`。
Session 文件校验了 Session ID、工作区与模型，窗口独立来自
`rts_model_state.model_info.context_window_tokens=196000`。

| 原始字段 | 加载已有 Session，尚无新调用 | 同 Session 健康新调用之后 |
| --- | ---: | ---: |
| `contextUsagePercentage` | 6.377040386199951 | 8.581632614135742 |
| `breakdown.contextFiles.tokens` | 243 | 243 |
| `breakdown.tools.tokens` | 7103 | 7103 |
| `breakdown.kiroResponses.tokens` | 1231 | 1474 |
| `breakdown.yourPrompts.tokens` | 3922 | 3904 |
| `breakdown.sessionFiles.tokens` | 0 | 0 |
| 分类 token 合计 | 12499 | 12724 |
| 分类合计 / 原生窗口 | 6.3770408163% | 6.4918367347% |

加载后的第一组数字一致，不能证明新调用之后仍然一致。第二组中分类合计是 12,724，
总体比例却为 8.5816%，不能把前者与后者包装成同一份占用观测。
比例与窗口对应的约 16,820 仅用于说明矛盾，**没有保存为 used**；
差值 4,096 也没有被硬编码成补偿常量。

当前安装二进制的静态符号与有限函数反汇编进一步支持这个边界：

- `calculate_message_tokens` 有内容大小累加后除以 4 的本地估算路径
  （arm64 `0x1029accc8` 的 `lsr ... #2`）。它不是独立的模型 Usage 计数。
- `calculate_context_breakdown` 会把总体百分比扣除固定类别后的余量分配到消息类别的
  `percent`，没有同步改写这些类别的 `tokens`。实际回包中各分类百分比之和与总体比例相等，
  分类 token 合计却不同，与该路径一致。
- 上述地址只标识此次审计对象；生产代码不依赖地址、二进制布局或版本白名单。
  没有据此声称已经查明差值 4,096 的完整来源。

同次成功调用的 `/stats` 返回 `input_tokens: null`、`output_tokens: null`，
不是明确报告零。现有原生 metadata 和 Session 保存状态也没有可用的本轮四项计数。
因此仍保留：**原生比例 + 独立窗口；used 和 Run 四项未知**。
分类候选属于「字段存在、语义未验证」，不能再写成「原生完全没有任何数量字段」。

[官方 ACP 文档](https://kiro.dev/docs/cli/acp/)提供 commands 扩展入口，
[官方 Context 文档](https://kiro.dev/docs/cli/chat/context/)描述占用百分比与分类；
两者没有保证分类 token 合计等于服务端总体占用。本结论限定于此次版本、模型与通道。

## 其余缺口逐项核对

| Runtime | 仍未知的字段 | 本次复核结果 |
| --- | --- | --- |
| Kiro | used；Input、Output、Cache Read、Cache Write，因此无 Run 总量 | 见上述健康调用；不能使用不一致的分类估算或额度数填充 |
| CodeBuddy | window / 比例；Cache Write | 当前自定义模型没有原生 `maxInputTokens`，没有显式 `models.json`；4 个根调用的 `rawUsage` 也未提供写缓存字段 |
| Qwen Code | Cache Write | 原生根 journal 的 4 次 `usageMetadata` 有输入、输出、缓存读，无写缓存字段；与 ACP、Run 读回一致 |
| ZCode | Cache Write | 4 次原生记录的 write 为归一化后的零；原生聚合会为缺失字段补零，缺少 Provider 字段存在证据，不能当实际零 |
| DeepSeek Harness | Cache Write | 6 次 committed 调用有完整 total/output，写缓存分类未出现；Input 由原生完整 total 减 output 验证，不补缓存零 |
| Qoder | Cache Write | 4 次根调用出现 write=0 及两个 ephemeral 桶=0；原生适配能合成这些零，未取得 Provider 原始存在性证据 |
| TRAE CLI CN | Cache Write | 当前 Run 的 4 次根 `response_meta.usage` 有 prompt/completion/read，没有写缓存字段 |

CodeBuddy、Qoder 的缓存读只有 3/4 次调用取得可采纳的值；DSH 为 5/6。
已经显示的 Cache Read 是收到的有效观测之和，不能将其描述为所有调用的完整分类覆盖。
这与「四项非空」是不同的验收条件。

Qwen journal 中还存在根 Run 结束后的一条子 Agent telemetry，Input 13,811、Output 102。
该记录有 `subagent_id/subagent_name/subagent_type`，没有对应根 assistant 调用；
本轮明确排除它，没有把它误判成根 Run 漏计并加回。

其余八类在当前样本中四项用量均非空、Context 两数可用。
这次没有发现新的「已有合格原始数值却漏到数据库或界面」问题。
真实压缩、换模型、恢复、正缓存写等仍按各轮既有证据限定，不能由这批普通成功回合一并宣称通过。

## 修正的来源标注

- Antigravity 该次实际 App Run 是 **1.2.16**，上一轮文字表沿用了较早探针的 1.2.14；
  原 fixture 与 Run 数据库已正确记录 1.2.16。
- Claude Code 的配置别名为 `opus`，但该 sub2api 实测的原生 `message.model` 与
  `modelUsage` key 是 **gpt-6.1-sol**。不能把别名视作已验证 Anthropic Opus 模型；
  本次 fixture 同时记录配置别名和原生返回模型。窗口仍取同次 `modelUsage` 的 200,000。

## 复核证据与结果

[脱敏 fixture](fixtures/round12-kiro-and-field-audit.json)包含：

- Kiro 原始数值路径、两种场景的分类量/比例、明确 null 的 stats、拒绝映射 used 的原因；
- 6 类剩余缓存缺口共 26 次根调用的原始数值、独立求和期望与最终读回；
- 15 类准确 Run/Session 代次、版本、配置/原生模型、四项与 Context 读回；
- 本轮实际 Renderer 的卡片、四项气泡、Context 文本，以及可用性与一致性两组断言。

复核断言通过：26 次调用的独立聚合与对应 Run 数据相符；Qwen 子 Agent 排除；
15 个 Renderer/数据库/读取投影相符；Kiro 两组分类比例之和相符，但第二组 token 合计不能冒充 used。
界面验证沿用隔离打包 App `Rovai Metrics Validation.app`，日常 App 和数据未改动。

当前可用性仍为 Run 总量 **14/15**、上下文比例 **14/15**、used/window 齐全 **13/15**、
四项用量非空 **8/15**。`overallComplete=false`；界面与 null 读回一致不代表字段完整。
本轮修正文档与验证证据，没有将不合格的候选数值接入生产采集，也没有新增查询或轮询。

通用文档测试 10 项、文档版本/治理和基于实际 merge-base `3bf3cce6` 的 diff-aware 门禁通过。
仓库要求的 `pnpm test:rust:pr` 默认 workspace 回归为 447 项通过、0 失败、1 项既有忽略；
这些自动化结果不扩大上述实际 Runtime 字段的可用性结论。
