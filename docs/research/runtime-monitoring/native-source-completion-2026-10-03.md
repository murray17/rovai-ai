---
document_type: research-note
authority: non-normative
last_updated: 2026-10-03
---

# 五类 Runtime 的缺失来源补查

本轮对应 CodeBuddy 窗口、Qoder used/window、Antigravity 用量与 Context、Kiro used/window、
TRAE used/window 五项。沿用同一隔离开发包与 15 成员 Thread，Cursor 不在验收范围。
不恢复测速，不增加指标专用版本门槛。以下结论只覆盖记录中的版本、Provider、模型与实际调用。

## 原生来源与处理

| Runtime | 找到的来源 | 处理及限制 |
| --- | --- | --- |
| Antigravity 1.2.16 / Google Gemini 3.7 Flash Medium | 原生 conversations SQLite 中的 `CortexStepMetadata.model_usage` 与同调用 generator 的 `context_window_metadata` | 已补接四项及 Context；只读当前根 step，逐调用交叉核对 stream 计数和 Session/trajectory/execution/model，不加 Session 累计 result |
| Qoder / custom sub2api gpt-6.1-sol | 根 journal `message.usage.input_tokens/context_usage_ratio`，有效 settings 的精确 provider/model `contextWindow=1050000` | used 与窗口均来自独立原生数值，比例仅校验配对；不从比例反推数量。仅有比例或配置不一致仍是合法未知状态 |
| Kiro 2.21.1 / minimax-m2.5 | `_kiro.dev/metadata.contextUsagePercentage`，准确绑定 Session JSON 的 `rts_model_state.model_info.context_window_tokens=196000` | 已补接窗口，保留原生比例；独立 used 与 Run token 计数仍未找到，不能用比例乘窗口填数 |
| TRAE CLI CN 0.120.52 / GLM-5.3 | 原生 `/context` calibrated used；最近根调用 prompt_tokens；原生 `models --json` 的 context_window=168000 | 原生界面对照证明 used 是最近 prompt，不含 response；已补接。窗口按当前精确模型只读，不硬编码 |
| CodeBuddy 2.133.1 / custom sub2api gpt-6.1-sol | 已有最新根调用 used；原生 resolveSessionContextSize 只读取该模型的 maxInputTokens | 当前模型 catalog 没有 maxInputTokens，models.json 未配置；ACP 因此不发 usage_update。Provider 目录也没提供该模型窗口，继续未知 |

Antigravity 的原生 protobuf 描述符来自当前安装二进制。`input_tokens/cache_read_tokens/cache_write_tokens`
为互斥输入桶；已识别且非占位的 proto3 Usage 消息中，省略标量的原生默认值为零。
不能把不存在的 Usage 消息或未知 JSON 字段视作零。只有同 step 的 input/output/read/thinking
与独立 stream 数值相符才替换原稀疏观测；Input 为三输入桶之和，Output 已含 thinking。
Context 是原生 `estimated_tokens_used/max_context_tokens`，不是 Rovai 估算或 Run 累计。
本地读取跳过正文、思考、工具参数、提示与响应 header，未把这些内容送入指标 IPC 或保存为 fixture。

先前本地 LanguageServer 探针 401 只说明那次请求缺少认证。本轮在原生子工具已有授权环境下的
数值查询及原生 SQLite 都取得了相同来源；生产实现只用 SQLite，不依赖额外模型工具或未认证请求。
[官方 headless 文档](https://antigravity.google/docs/cli/headless/)仍用于区分 step 与 Session result；
后者不是当前 Run 用量。

Qoder 当前原生代码的 `SH()` 以 `input_tokens/window` 生成比例。Rovai 分别读取原生 input
和有效模型配置窗口，再校验与原生比例相符。交互式 `/context` 的会话加载后本地估计可能与最近模型
调用不同；本轮接的是最近原生调用观测，不声称每次加入本地条目后都实时同步。
审计时原生 Qoder TUI 自行升级，最终 App 样本版本记录在 fixture，未设置新版本准入门槛。

TRAE 原生长回答对照：

| 最近 prompt | 同次 output | 原生 calibrated 显示 |
| --- | --- | --- |
| 19,670 | 224 | 19.6k / 168k |
| 19,913 | 3,223 | 19.9k / 168k |

第二个样本用于排除 prompt+output 与整轮之和。ACP 中发送 `/context` 未成为原生命令，
该响应不作为数值证据。真实 prompt 前的原生目录只查询一次，沿用受管有界执行器；
查询失败仍执行用户任务，窗口保持未知。

Kiro 补做健康原生调用后查询 `/stats`、`/context` 和 verbose context：stats 中 token 字段为 null，
原生 Session 文件可提供窗口。**同日复核勘误：**此前据脱敏结果判断「Context 只有比例和模型」
有误，旧探针漏掉了 `breakdown` 的分类数值；新健康样本确认分类 token 合计与原生总体比例不同，
尚不能作为 used。旧 fixture 的 `usedAndTokensStatus: raw_absent` 不能再用于判断所有 Context
数量候选均不存在，见[原始数值与勘误](kiro-and-field-audit-2026-10-03.md)。
官方 [ACP 说明](https://kiro.dev/docs/cli/acp/)不能替代实际字段证据；
本结论也不扩展成 Kiro 所有 Provider 永远没有计数。

同日来源标注勘误：上表 Antigravity 版本由早期探针的 1.2.14 更正为该次实际 App Run 的 1.2.16；
原 fixture 与数据库的版本字段已经是 1.2.16，数值不变。

## 实际 App 对照

实际读回、各 Runtime 版本、逐字段可用性、数值原始片段和 UI 文本记录在
[本轮 fixture](fixtures/round11-native-source-completion.json)。空值与空值相同只证明渲染一致，
不算字段采集完整。历史 Run 不回填；新来源以同 Session 的新 Run 验证。

| 当前健康样本 | Input / Output / Read / Write | Context used / window | 实际界面 |
| --- | --- | --- | --- |
| Antigravity / `7a2e0895` | 167096 / 1098 / 113372 / 0 | 48287 / 256000 | 168.2k；18.9% |
| Qoder 1.1.65 / `c261a673` | 125182 / 1616 / 92416 / 未知 | 32339 / 1050000 | 126.8k；3.1% |
| Kiro / `df6fbe25` | 未知 / 未知 / 未知 / 未知 | 未知 / 196000；原生比例 0.0846479606628418 | 无虚构总量；— / 196k，8.5% |
| TRAE / `db9bd250` | 86896 / 1042 / 83328 / 未知 | 22393 / 168000 | 87.9k；13.3% |
| CodeBuddy / `39cf8065` | 99524 / 598 / 73600 / 未知 | 25524 / 未知 | 100.1k；25.5k / —，比例未知 |

Antigravity、Qoder、CodeBuddy 的各 4 个新原生调用分别求和，与 Run summary 一致；
Antigravity 同一 step 到达时部分 generator Context 尚未可见，Core 实际读取时已可用，
终态再按原生 step 对照确认 48287 / 256000。fixture 同时保留到达时和终态只读数值，
没有把后来读到的数值伪称为先前已到达。

最新各队员样本中：Run 总量 **14/15**、上下文比例 **14/15**、used/window 两数齐全 **13/15**、
四项用量非空 **8/15**。15 个 Renderer 卡片/气泡与读回一致，不代表字段全部采齐。
Qoder 的原生适配会为缺缓存桶生成零，故未证明来源字段存在的零仍保留未知；
Cache Read 正值只代表已观测部分，未把它升级为完整覆盖承诺。

Kiro 原来卡头 8%、气泡 7.7% 是两处分别使用整数和一位小数格式导致，
现统一为一位小数。圆环位置、卡片和气泡布局不变。

验证 App 使用独立 userData/Skill Library，日常 App 保持运行。构建通过 macOS arm64 ad-hoc
签名检查；当前 Core SHA-256：`43d017671326597d3e4bc696684d70adbc68bef67c84f4dcf30e99452a4fec53`。
实际终态、落盘、公开读取与 15 个生产 Renderer 的逐项对照完成。

## 自动化边界

- 新增一个 extended SQLite owner `native_database_supplements_only_the_current_completed_call`，
  拥有原生数据库到 stream observation 替换的独立 seam。原 stream-only owner 无法证明原生数据库
  身份配对、重复 generator、proto3 零/缺失区别及正文不扩散；修复前该输入只有稀疏用量、无 Context。
  使用临时数据库，无真实 Runtime/凭据。最小命令为 `cargo test -p rovai-core --features extended-tests --lib native_database_supplements_only_the_current_completed_call`。
- TRAE 既有进程 owner 更名为 `trae_execution_uses_one_session_host_and_a_bounded_numeric_catalog`，
  保留单 Session Host、没有 --version 子进程等原断言，增加显式目录 helper 的有界调用及模型/窗口异常矩阵。
- Qoder/TRAE 扩展既有 native dialect owner；Kiro 扩展既有 native cursor 文件 owner，
  覆盖模型、Session、cwd、路径、缺失、类型、零/负/冲突窗口；未新增平行 fixture owner。
- 保留 Run/Session 归属、去重、恢复基线、配置换代栅栏及原生计量隔离；未新增迁移、UI 轮询或后台目录扫描。
- 定向 `native_` 矩阵 54 项、Antigravity 模块 16 项、Monitoring 12 项、TRAE 进程 owner 1 项通过；
  不以这些有重叠的数量推断兼容完整性。TypeScript 检查及打包通过。
- 通用文档测试、版本/治理和基于修复前提交 `96b8f4b2` 的 diff-aware 门禁通过。

当前规范见 [Usage v7](../../contracts/runtime-usage-monitoring-v7.md) 和
[Execution Metrics v4](../../contracts/runtime-execution-metrics-v4.md)。
