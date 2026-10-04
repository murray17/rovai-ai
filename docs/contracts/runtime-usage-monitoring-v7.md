---
document_type: contract
contract: runtime-usage-monitoring
version: 7
status: accepted
source_version: v1.72
last_updated: 2026-10-03
---

# Runtime Usage Monitoring v7

v7 继承 [v6](runtime-usage-monitoring-v6.md)，替换其 Antigravity 稀疏输入限制，
补接同一原生调用的 SQLite 数值。其他 Runtime、缺失语义、归属、结算和读取 wire 不变。
不增加数据库迁移、历史回填或 CLI 指标版本门槛。

## Antigravity 同调用补充

仍从当前 `stream-json` 根 `DONE` step 开始；当前输入之前、子 Agent、ACTIVE 快照及
Session 累计 `result.usage` 不进入 Run 用量。最多保留 8192 个已处理 step/call 数字身份。

在该 step 完成时，尝试只读原生命令有效 Home 下的
`.gemini/antigravity-cli/conversations/<native-session-id>.db`。Session 必须为规范 UUID，
数据库必须为普通文件且不是符号链接。一次只读事务按主键读取当前 input step、完成 step
及其 `source_trajectory_step_info.metadata_index` 指向的 generator；不扫描其他 Session 或历史调用。

`trajectory_meta.cascade_id`、两个 step 的 trajectory/cascade/index、执行身份必须相符。
原生当前输入为 DONE USER_INPUT，当前调用为 DONE PLANNER_RESPONSE，没有 subtrajectory。
`CortexStepMetadata.model_usage` 的 model 与 generator model 一致；输入、输出、缓存读以及
已上报的 thinking 必须与同 step 流式回包完全一致，否则保留已有稀疏流式用量。

已识别的 `ModelUsageStats` proto3 方言包含互斥的 `input_tokens`、`cache_read_tokens`、
`cache_write_tokens`；有效消息内省略的计数标量按原生 proto3 零值解释。
必须有非默认 model/provider、非空有效消耗并通过同调用交叉核对；缺少消息本身、初始化空对象、
重复单值字段、错误 wire type、溢出和矛盾数据不能填零。
`Input = input + cache_read + cache_write`；Output 已包含 thinking，不再加一次。
方言为 `antigravity-native-model-usage-v1`，source 沿用 `runtime_private_extension`。

本地补充在进入 Monitoring buffer 前替换该 step 的稀疏 observation，同一 native generator
最多计入一次。不能把补充用量与已发送的稀疏用量再相加。读取失败或格式不符时继续保存流式
Output/Read，Input total/Write 保持未知；不事后重算历史 Run。

单个 protobuf BLOB 上限 2 MiB、每层字段数上限 512，SQLite busy 等待上限 50ms。
只解码需要的数值和 UUID 身份；正文、思考、工具参数、提示及响应 header 作为未知长度字段跳过，
不复制到文本、日志、Blob、IPC 或数值投影中。不读取 Provider 密钥或调用额外模型。

上下文配对与当前可用性由 [Execution Metrics v4](runtime-execution-metrics-v4.md) 拥有。
