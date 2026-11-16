---
document_type: contract
contract: runtime-usage-monitoring
version: 12
status: accepted
source_version: v1.72
last_updated: 2026-11-16
---

# Runtime Usage Monitoring v12

继承 [v11](runtime-usage-monitoring-v11.md) 的后台采样、范围、保留周期和 MiniMax 有界尾读，
增加 RunCard 的已知消费投影和必要的稀疏快照修正。`monitoring.snapshot` 的页面合同不变。
RunCard 读取/展示由 [Execution Metrics v8](runtime-execution-metrics-v8.md)拥有。

## 可信计数与调用身份

内部 `RuntimeUsageFields.totalTokens` 是 Adapter 已证明的**同消费单位 full total**，不是任意名称含 total 的数字。
同范围 total 覆盖所有输入/输出；它必须不小于已知互斥计数，完整 I/O 有效时须与其和一致。
矛盾 total 不准入，独立有效的桶继续保留。不能把 Antigravity stream 的排缓存 total、Codex Context
数量、Hermes 无计数代次的 Session 累计或 ACP `usage_update.used/size` 填入此字段。

Pi、CodeBuddy、TRAE、DSH 与 OpenCode V2 的已验证 full total 经各自 parser 保留；缺失字段不补零。
Pi 原生全零 placeholder 已丢失 Provider presence 时保持未知；这不影响其他已验证方言的显式零。
OpenCode/Kilo 的普通 output 与 reasoning 互斥：两者存在先合成；缺 reasoning 时仍可保留已知普通输出消费，
缺普通输出时保留原生 reasoning 子集。两桶分批到达时分别合并，不能把已合成 Output 再与 reasoning 相加。
OpenCode V2 的 Input 只由已报告的互斥输入桶构成；缺 reasoning 的普通输出不是完整 Output，
不能用它从 total 反推 Input。原生 full total 独立保留并覆盖已知桶；通用归一化/checkpoint 层不从 total 补造缺失的 Input。
已完成失败调用的有效正计数仍可贡献，失败占位全零没有原始 presence 时排除。
MiniMax 的 error/aborted 记录同样保留已知正消费，不把初始化占位当真实零。不能因桶缺失或失败状态把其他可信数值清空。

新 parser 版本为 6。单调用/Prompt Delta 实际是有身份的计数快照，同单位后到字段按已有 checkpoint
补齐，仅将贡献的变化进入 Run summary。原生 total/含缓存 Input/Output 各自覆盖其子集，不能与子集重复加。
旧稀疏帧重放不能撤回新的有效数值。本轮没有任何数值的 journal frame 不占用后续同调用的去重身份；
恢复 baseline 仍冻结历史消息身份，包括 Kimi 已存在但没有 usage 的根 step。缓存请求命中也按同调用修正，不能每到一个字段增加一次请求数。
JSONL reader 分开保存历史身份和本轮最新数值：历史身份始终排除，本轮非空稀疏快照允许补齐，
仅完全相同的数值、费用和模型快照跳过。OpenCode/Kilo SQLite reader 只处理物理 baseline 后发现的当前根 Session
候选，不回扫历史；非 assistant 退出。成功完成且 U/O/reasoning/R/W 五项均有效的调用读取后立即退出，
不因 Run 仍在执行而复读。已完成但缺字段、失败及无有效元数据的候选，首次读取后最多再补读两次；
预算结束保留已知消费，不重新打开这些 ID 追补迟到字段。当前没有接入消息级可靠变更通知。
尚在进行的 assistant 调用沿用原有等待完成逻辑；所有候选轮转处理，每次 poll 最多执行 64 次逐 ID 数值查询，
候选/已观察身份各有 8,192 上限。没有待查候选时不准备或执行逐调用 Usage SQL，只保留既有游标和 Session 检查。
Run finished 的普通采样继续由 Core 在读取前、后栅栏，不进入 native reader；不以补齐为由延长 Run 生命周期。
Pi 的时间戳与 Provider/模型、Copilot 原生调用时间、Cline native Run/message、DSH seq/turn、ZCode native event
共同提供各方言的稳定来源身份；消费数值变化不是新调用。无独立调用 ID 的 Qwen 当前仍保守使用原生
usage fingerprint，可能少计相同数值的独立调用，不能改用通知序号冒险重复计账。

累计 Session/Run 的首帧只建立 baseline。后续只计算已有基线字段的非负差；任一消费 counter 下降时重建
该来源的整组 baseline，不计 reset 帧。省略字段保留已有基线，不能把迟到的绝对累计归给当前 Run。
已有累计 total、含缓存 Input 或 Output 父基线时，显示贡献沿用该覆盖范围；父字段暂缺不能改计其子项，
待父计数推进后再计差值。显式零也只由该覆盖范围内可比较的不变计数证明。
已验证 Claude 根 message 在本 Run 内从零开始，使用相同的单调用快照修正规则，不能套用 Session 累计首帧语义。
可靠基线后的显式不变计数可以证明已观测区间的零；完全没有可信计数仍为未知。

后台事务继续原子提交 checkpoint、Run summary、hourly；失败恢复有序 batch，不抹旧数值。
纯计量校验无法协调的同调用补充字段局部跳过，保留旧 checkpoint，不阻断同批其他记录；数据库错误仍回滚整批并重试。
终态不清短期 checkpoint，迟到补齐不另收费。原生与 streaming/terminal 来源继续在 Adapter 中择一，
不为显示总量新增原生日志轮询、历史扫描、网络调用或正文保存。

## 持久化与旧 Run

Migration 225 从 schema 174 升到 175，原子增加：

- `runtime_usage_run_summary.display_total_tokens`：nullable 已知消费显示投影；
- `runtime_usage_checkpoint.native_total_baseline`：nullable 同单位原生 full total 基线。

不新增表、索引、任务或原始观察记录。缺少可选用量表时保留 Core 准入，不为本次显示投影重建统计表或扫描历史。
Summary 的稀疏分项与 `usage_quality` 保持内部语义。
显示投影不进入整个监控页面的趋势/分项/覆盖率聚合。

旧 summary 只使用原有持久数值：明确互斥桶按各桶的已知和；其他情况有含缓存 Input 就不再加缓存，
没有 Input 时取可证明不重叠的已知输入桶；Output 覆盖 reasoning。未知和显式零保持区别。
这可以少计尚无法关联的子集，不能推测丢失的逐调用关系或 native total。仅更新已有小型 summary 投影，
不重扫原生历史/Evidence，也不从过期 checkpoint 重建账本。

parser 6 之前已登记的 Run 的显示量固定为迁移时可证明的数值；恢复同一 logical Run 也不把新身份机制
套在缺关系的旧 checkpoint 上。既有原始计数采集和读取继续，但不追加到该旧显示投影。
新登记 Run 按新 checkpoint 实时更新。精确旧来源重放保留旧 durable key，不能因升级产生第二笔已知贡献。

## 选择与验证

统一选择方案 1，接受可归属但上游缺报引起的少计，不接受跨 Run 或重复；不作账单完整性承诺。
[核查矩阵与同样本比较](../research/runtime-monitoring/runcard-token-total-audit-2026-11-15.md)区分源码、协议、
真实旧数值与本轮测试，也记录无法安全归属的来源。准入输入矩阵归最低成本语义测试，事务/迁移与 Renderer
各自只验证持久化及消费 seam；不增加特定 Runtime 的治理检查例外。
