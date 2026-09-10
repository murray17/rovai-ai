---
document_type: implementation-evidence
version: v1.57
status: verified-with-limitations
last_updated: 2026-09-11
---

# 每日 Trace 非空采集与真实分析结果

已完成 Asia/Shanghai 的 2026-09-04 至 09-10 共 7 天实际保留记录导出、曲线生成和独立复算；09-10 的真实 LLM 分析完成并登记。数据存在明确缺口，不能称为全部调用或纯生产总体已覆盖。没有重跑用户任务，没有新增日常数据库字段。

## 问题、复用与改动

此前空库定时链路只证明流程可运行，不能证明真实指标覆盖。本轮复用 Core 原有只读测量入口、Trace export、每日报告、CLI 分析和登记器；新增 feature-gated 的只读导出示例，不增加日常 Agent 命令或后台写入。

修正当日 A2A 群组未结束数与全部保留积压混用、分析样本混入 Core 回放／非 A2A 完成投递、工具 `unsettled` 未在摘要显示的问题。可信稀疏终态表中的标准零值显式展示，未知总体仍为未知。prepared 校验身份和摘要，并生成有限引用 schema；登记继续拒绝无效引用，代码派生引用值便于复核。规则和设计见 [v13](../../contracts/execution-evaluation-v13.md)，冻结范围与单次结构修正预算见[核验计划](daily-trace-verification.md)。

## 实际来源与版本

- 来源为安装版 Core 明确 data-dir 中的持久 SQLite；用 `open_read_only_measurement` 的只读连接和原聚合事务导出，没有启动 Core、迁移、恢复或修改原数据库。各日保存窗口、采集时点、来源摘要与导出二进制摘要。
- 只读导出基于 `818465d94261d0738152dc5f568b66d3325ee8e6` 的既有聚合器；导出示例实现随后提交于 `af3c0fbd`。最终分析与派生报告代码为 `043e4dcdaa3e2b00fbd866982a4b241042400c96`。
- Core definitionVersion=2、报告 reportDefinitionVersion=3、输入 schemaVersion=2、分析策略 `daily-health-analysis-v3`。旧报告和失败分析保留在单独目录，没有连入旧定义趋势或替换历史。
- 本次 scope 的显式排除列表为空，来源标注为保留记录，不能宣称 Smoke／开发记录已被完整排除。正式定时配置应沿用已有 Camp／Automation 排除，分析 Automation 自身由 Host 排除；历史完整 origin 仍未知。

## 09-10 的实际采集情况

采集截至 2026-09-11 04:03:21（Asia/Shanghai）。窗口为 09-10 自然日；Run 成功／失败按窗口内终态，A2A 按当日接纳群组截至采集时状态，两者分母不混用。

| 数据 | 实测 | 覆盖及补齐成本 |
| --- | --- | --- |
| Run | 新建 51；成功 38、失败 1、取消 12；失败率 1/39 = 2.56% | 已有记录可统计，不代表用户任务成功 |
| A2A | 接纳 8；settled 7、cancelled 1；失败率 0/7，终态覆盖 8/8；全部保留未结束积压 0 | 已有状态与等待字段可用；真实本日没有积压，跨日正例由明确标记的测试夹具验证 |
| Core 工具 | 成功 69、失败 4；失败率 4/73 = 5.48% | 当前可观察记录；`message.invalid_input` 2、`message.invalid_task` 2 |
| Runtime 工具 | 成功 1774、失败 120；失败率 120/1894 = 6.34%；另有 unsettled 22、in-flight 1 | 46/51 个所选 Run 有当前 classifier 工具记录，不证明全部调用覆盖；各来源不可相加 |
| Runtime 错误分类 | 120 个失败的结构化原因均未知 | 需要逐 Runtime 补结构化证据适配，不能从状态猜测或可靠回填旧原因 |
| Runtime／模型身份 | Runtime 类型与版本 51/51 可见；模型 ID 48/51 未知 | 优先复用实际 Runtime 观测，历史空值不能用配置冒充实测值 |
| Memory 两计数 | 正文读取、正式修订均 unavailable | 按约定留到记忆治理／成长阶段，需要逻辑调用去重和正式修订证据 |
| 逐 Run build／完整 origin | 不可用 | 若需永久可靠，须设计未来 Run provenance 和写入，本次未加字段 |

09-04 至 09-06 有真实 Run，但当前 classifier 工具记录为零；工具失败率为 N/A，不代表没有调用或零失败。最近 7／30／90 天控件只展示已有 7 天，缺日、零分母与未知不补零；比例和次数分轴，趋势不作为质量分。

## 真实 LLM 分析与核对

模型为 CLI `gpt-5.6-sol / medium`，无工具；使用目录绑定的模型别名，没有不可变服务端 snapshot 证据。首轮模型已真实执行，但省略指标前缀及混淆报告／样本 ID，登记为 failed。修复输出 schema 后仅追加一次调用，最终登记 complete；原始响应、两次用量和首轮失败全部保留。

最终一次耗时约 85.8 秒，输入 15,914、输出 4,354 Token；两次合计输入 27,553、输出 8,303 Token。原始输出与登记内容一致，67 个不同指标引用和 10 个样本 ID 均可解析，统计 JSON 摘要未变。引用检查只验证存在性，以下内容另行逐条核对：

- Run 1/39、取消 12、Core 4/73、Runtime 120/1894 与 22 个 unsettled 均正确；较 09-09 的百分点来自代码变化表。
- A2A 当日群组、全部积压、零分母不能比较，以及 Runtime 分布变化和工具覆盖限制均有说明。
- 显式零没有再被当作缺数据；记忆 null、48 个模型未知和 120 个 Runtime 错误原因未知没有补值。没有推断需求质量、满意度或把下降归因于能力提升。
- 分为 11 条事实、0 条假设、4 条建议；建议未自动执行。正文仍保留较长小数，百分比卡片和曲线提供直接可读数值。“恢复 Runtime 错误码”的建议措辞应理解为接入尚不可用的结构化采集，不证明过去曾有完整覆盖。

## 验证、演示与剩余边界

完整 `pnpm test` 通过：172 个 Vitest 文件、1,742 项；最终 Node 批次 301 项中 300 通过，1 个 Windows 限定跳过。类型检查、文档治理及明确 base 的文档 CI 通过。独立 Python 按实际事实重新计算 7 天数量、分母、去重及样本总体；分析登记前后统计未变；最终 HTML 的 63 个本地链接静态检查通过。没有完成浏览器视觉验收。

本地证据根目录：`/Users/murray.xue/VSCodeProjects/opensource/rovai-evaluation-evidence/daily-trace-audit-20260911-h_zqn93g`。

演示先打开 `reports-final/index.html`，进入 `2026-09-10-80bd3731-2617-4d50-a8c4-821bc85d5b2d/report.html`，依次查看百分比与分母、7 天曲线、完整工具状态、覆盖缺口和 LLM 分析。`report.json`／`trace.json` 是统计及来源；`analysis-status.json` 与 `analyses/` 保存登记和原始内容。根目录 `data-audit-after-analysis.json`、`analysis-audit.json` 与 `source-export-provenance.json` 支持复核，`reports/` 和 `llm-analysis/` 保留首轮失败。

安装版 `rovai` 尚不识别 `app trace`，所以这次只读真实数据验收不能冒充新版 CLI 已部署。本轮证明非空采集、统计和分析正确衔接；既有空库 Automation 验收是另一项证据。集成并安装此分支后仍需用实际定时配置验证部署链路；不因此改动正在使用的 App 或其数据。
