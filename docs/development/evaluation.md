---
document_type: development-guide
authority: dual-track-evaluation-workflow
last_updated: 2026-09-10
---

# Gate、每周回归与每日分析

本页拥有开发者操作流程。判断规则见 [Execution Evaluation v9](../contracts/execution-evaluation-v9.md)，组件边界见[双轨架构](../architecture/execution-evaluation.md)，实际交付与未完成验收从[当前版本指针](../versions/README.md)进入。Node 使用仓库要求的版本，命令详情由 `pnpm eval:gate --help`、`pnpm eval:daily --help` 和 `rovai app --help` 提供。

## 上下文改动 Gate

1. 按[上下文治理](model-context-change-governance.md)先读取当前权威，保存独立变更方案：完整前后对照、不变边界、版本、Case 范围、通过标准及预算。复用现有 `grill-duo-with-docs` 的文档与确认流程；适用的二次确认由开发者作出，CLI 只核验记录。确认前可以准备评测设施和基线，产品上下文语义按已确认 revision 实施。
2. 保存独立基线 checkout。用 `eval:gate build --source <checkout> --output <new-directory>` 构建基线；实施后用另一新目录构建候选。源码、产品二进制与评测资产分别冻结；运行期间保持两份 checkout 不变。
3. 根据[回归目录](../../qualification/context-regression/README.md)选择影响层级。上下文、共享机制或 `cli-operations` 跑 12 个通用 Case；其他 Skill 跑专属小集，无专属集先补 Case 并通过 `qualification:case admit`，不能空集通过。先冻结标准，再查看候选结果。
4. 按下面配置生成 `eval:gate freeze --config <json> --output <new-plan.json>`，再运行 `eval:gate run --plan <plan.json> --output <campaign-directory>`。规则检查实际合同测试、产物、写入边界、A2A、工具／记忆与预算；Judge 评价语义并引用证据。相同 campaign 保留所有尝试。
5. 提交前打开 campaign 的 `index.html`，从版本、Gate 结论、质量和协作分布进入每次尝试的 `report.html`，核对 `regressions`、`evidenceGaps`、`resourceChanges` 及每个 slot。修复实现偏差后重新构建、冻结并在原 campaign 重跑；方案语义改变时更新 revision 和确认。每个 campaign 最多两次，不能删失败目录、改标准或挑成功副本收口。

配置中的路径均使用绝对路径。以下是结构示例，替换占位项、明确实际 Runtime 模型与预算后才能执行：

```json
{
  "schemaVersion": 1,
  "mode": "gate",
  "suite": "/checkout/qualification/context-regression/suite.json",
  "baseline": "/evidence/baseline/product.json",
  "candidate": "/evidence/candidate/product.json",
  "change": {
    "kind": "context",
    "skills": [],
    "sharedMechanism": true,
    "document": "/checkout/docs/versions/<current>/model-context-change.md",
    "revision": 1,
    "before": "与方案对应的原行为",
    "after": "与方案对应的候选行为",
    "invariants": "与方案对应的不变边界",
    "confirmation": {
      "status": "confirmed",
      "revision": 1,
      "by": "开发者身份",
      "at": "确认的实际 RFC3339 时间",
      "evidence": "已确认该 revision 的会话或记录定位"
    }
  },
  "team": [
    {
      "agentId": "agent_1",
      "adapterKind": "codex-cli",
      "model": {"mode": "explicit", "modelId": "明确的模型 ID", "options": {"reasoning_effort": "medium"}},
      "permissions": {"adapterKind": "codex-cli", "schemaVersion": 1, "values": {"sandbox_mode": "workspace-write", "approval_policy": "never"}}
    }
  ],
  "repetitions": 1,
  "budget": {"wallSeconds": 14400},
  "execution": {"version": 1, "maxParallelCases": 2, "judgeSeconds": 600},
  "judge": null
}
```

通用集需要至少三位队员：为 `agent_2`、`agent_3` 明确配置同等或已固定的 Runtime、模型和权限；三个身份不等于三个独立模型。单队员配置只能用于不要求 A2A 的专项集或单 Case Runner 验证。`kind: skill` 配合 `skills: ["memory-stewardship"]` 或 `review-duo` 使用首批三个专属 Case。

权限必须先验证能在目标主机运行，再用于两个版本。本次 macOS 嵌套执行中，`workspace-write` 在启动命令时被宿主拒绝（`sandbox_apply: Operation not permitted`），Runner 保留了实际产物失败；随后沿用已有 Qualification Codex 配置的 `danger-full-access` 验证兼容路径。该权限不提供操作系统工作区写入隔离，独立目录也不等于独立主机；Core 自身权限边界仍有效。需要严格隔离时使用专用主机的既有 Formal 流程。权限改变属于环境改变，不据此声称质量改善。

`judge: null` 可验证执行与规则设施，但整体只能得到证据不足。真实 Judge 配置为 `{ "adapter": "/checkout/scripts/lib/qualification-api-judge-adapter.mjs", "configuration": "/private/judge.json" }`。该配置复用既有 Semantic Review shape：`provider`、固定 `snapshotId`、`snapshotDigest`、`configurationId`、`decodingParameters`、`retrySchedule`，另设 `api.modelVersionPolicy: pinned_snapshot`、可选 `api.endpoint` 和 `api.keyEnvironmentVariable`。`snapshotDigest` 必须来自可追溯的模型版本声明／部署 manifest 摘要，不能用任意常量冒充权重证明；仓库不验证提供者内部权重。

API 凭据仅通过命名环境变量读取；不写进配置或报告。默认接口遵循 [Chat Completions 官方协议](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)。Process 与 Outcome 各有反序双副本；每次请求禁用模型工具，要求实际返回模型与固定 snapshot 相同。解码参数必须是该模型明确支持的组合，错误后不偷偷降级模型／参数。有效但不理想的评价不自动重试。

耗时门槛冻结在 `POLICY`：同环境、同 Case 的 dispatch-to-terminal 同时增加超过 50% 和 15 秒，记为资源退化；硬预算仍由 Runner/Core 检查。小样本不能证明统计上的非劣性，Token／费用缺少统一 receipt 时明确不可用。固定规则与 rubric 的改动属于新的评测配置，不允许在同一 campaign 内换标准。

### 质量、协作与有界修正

评分配置随 suite 冻结为 `generic-task-quality@2.4.0`。任务质量按目标达成 50、证据一致性 25、边界遵守 25 汇总；Case 验收依据随任务定义，非代码任务不要求代码测试。三个维度中的未知会使该维度和总分未完成，页面保留已有分项与覆盖率。边界分只覆盖 Case 声明且能观察的检查，不能据此声称覆盖全部权限行为。

协作三组保留五个细项的原始 Judge 判定、理由和证据，分母是适用的计划 Case × repetition，未知仍在分母。部分满足不算满足，零分母为 N/A；分组已有不满足时，其他细项的证据缺口也保留。Case 的关键协作项必须满足，不能用高质量分或其他 Case 的改善抵消。

开发 Agent 可以在已授权、已确认的上下文改动范围内执行“运行 → 分析证据 → 修正实现偏差 → 重建／冻结 → 重跑”。CLI 负责冻结、留证与两次尝试上限，不自行编辑代码。停止条件是完整 Gate 通过；证据不足、预算耗尽或两次仍未通过时保留全部结果并停止。改变方案语义必须回到现有 Skill 的确认流程。每周定时观察本身不授权 Agent 修改上下文，不能把追分作为无限编辑理由。

## 每周真实任务回归

用户终端可以运行仓库 CLI，也可以通过已运行的 Desktop 提交宿主 job。旧的“定时 Agent 直接启动 Runner”路径在 macOS 曾遇到 nested `sandbox-exec` exit 71；现在由 App 宿主启动同一 Runner，Agent 读取对应报告。安装与授权边界见 [User Automation v4](../contracts/user-automation-v4.md)。

先通过既有界面创建绑定评测目录的 Automation，然后从用户终端注册执行器并绑定已冻结的 weekly plan。需要 Node >=24、仓库依赖和 Rust/Git 工具链；这些命令不安装软件。

```bash
rovai app eval configure --source /absolute/rovai-checkout --node /absolute/node
rovai app eval schedule --automation-id <id> --plan /absolute/weekly-plan.json --output /evaluation-workspace/reports
rovai app eval status
# 用户终端手动 Gate；同一 job-id 可查询或安全重放，不产生第二次尝试。
rovai app eval gate --job-id gate-change-01 --plan /absolute/gate-plan.json --output /absolute/gate-campaign
rovai app eval status --job-id gate-change-01
```

定时任务 Prompt 使用当前 Camp 身份等待结果，例如：

> 宿主会为这次定时运行执行固定回归。在当前工作区执行 `node reports/wait-for-evaluation.mjs --camp-id <当前上下文中的 Camp ID>`，等待与当前 Camp 绑定的回执。completed 表示执行结束，不代表 Gate 通过；随后读取其 directory 中 report.json/report.html，总结结论、版本、独立 Case 数、计划重复数、失败、未知及证据链接。失败或超时如实报告，不使用上次报告，不执行评测 Runner，不修改实现、Case 或评分标准。

周回归汇总使用根目录 `trend-data.json` 中与本次 week／attempt 对应的 `hardPass`、`hardFail`、`unknown`，它们包含硬性验收与专项规则。若另列原始 `hardOutcome` 数量，须注明它不包含专项规则；不能忽略 `rules[].status = indeterminate`，也不能让 LLM 重新猜测分母。

宿主每次从绑定模板重新构建当前指定源码并冻结实际执行计划；任务集、评分、Judge 和预算仍须与原模板一致。执行器、Case 或标准变化后重新注册／绑定，不悄悄升级标准。定时模板总预算最多 2700 秒，为现有一小时 Automation 留出分析时间。日报通过 Automation ID 排除该分析任务；回归 Core 本身使用独立数据库。

每周配置与 Gate 共用 schema，改为 `mode: weekly`，省略 `baseline`、`change`，保留 `candidate`、team、suite、Judge、重复数与预算。`eval:gate weekly --plan <frozen-plan.json> --output <weekly-history-root>` 按 UTC 周一分配 campaign；触发时间由 Automation 的设备本地时区决定，统计时区不改变触发时区。每周第一次尝试形成连续曲线，第二次尝试单列，不以最后一次成功替换失败点。JSON 保存每个版本、数量／分母和比较资格，缺周或环境变化断线。

App 退出／休眠时沿用既有 Automation 补跑与并发策略，不另建常驻调度器。配置不等于真实运行；实际结果只由保留的报告证明。

## 每日 Trace 与分析 Agent

先在现有 Automation 创建每日分析任务，绑定普通目录。日常统计不需要调用真实任务 Runner，也不需要用户评测。用户 CLI 一次性配置 Host 的数据范围：

```bash
rovai app trace schedule --automation-id <analysis-id> --timezone Asia/Shanghai --output /analysis-workspace/reports --exclude-automation-id <weekly-evaluation-id>
rovai app trace schedules --json
```

这是“哪些元数据可以准备给这个工作区”的配置，不是新增审批系统，也不是让分析 Agent 获得用户 IPC。Host 自动排除所有已注册分析 Automation，按配置排除回归、Smoke 和开发任务；隔离 Core 的评测记录天然不在日常数据库里。来源无法识别的旧记录保留 coverage=unknown，不承诺已经全部排除。

Main 先把规则统计、HTML／SVG 和分析输入写入指定工作区；每天的 Automation 只执行：

> 在指定仓库执行 `node scripts/eval-daily.mjs prepared --output /analysis-workspace/reports --timezone Asia/Shanghai`。输入必须是前一自然日的完整报告。根据 yesterday、comparableHistory、changes、versions、coverage 和样本解释变化、证据、可能原因及建议，区分事实与假设。将结构化 JSON 保存到命令给出的 analysisOutput，再执行 `node scripts/eval-daily.mjs analysis --report <directory> --input <analysisOutput>` 登记结果。引用指标路径或 evidenceId，在 Camp 提供本地报告入口。缺失或陈旧时报受阻，不从全部日志估算比例，不执行原任务或修复。

结构化分析包含 `schemaVersion: 1`、`reportId`、`inputDigest`、`model: { provider, snapshotId }` 和 `facts`／`hypotheses`／`recommendations` 数组。每项为 `{ text, metricPaths, evidenceIds }`，至少引用一个存在的路径或样本 ID；路径示例为 `yesterday.runs.failureRate`、`changes.0.deltaPercentagePoints`。模型身份是提交者声明，不能伪造缺失的版本证据。登记器保留每次原始提交和成功／失败记录，只更新分析状态指针与 HTML，不改写统计 JSON，也不证明解释正确。

在后续部署时设置实际时间，建议当地时间 08:00 给 Host 留出准备时间。Host 在 App 内每分钟检查，失败退避一小时；如果当天尚无完整输入，分析应诚实失败，不能把旧报告当成昨天。关闭对应 Automation 即停止准备。当前版本未提供外部后台常驻保证。

离线演示可以使用已实际导出的文件：`eval:daily --config <json> --date YYYY-MM-DD --trace <trace.json>`；在线用户调用省略 `--trace`，配置还需指定 bundled `rovai` 可执行文件。配置为 `{ "timezone": "Asia/Shanghai", "output": "/private/daily", "cli": "/app/bin/rovai", "scope": { "campIds": [], "excludeCampIds": [], "excludeAutomationIds": [] } }`。手工导出入口是 `rovai app trace export`；完整口径见 [User Automation v4](../contracts/user-automation-v4.md)。

## 报告解读与维护

- 日曲线分两组：Run 失败率、A2A 失败率及终态覆盖率、Core／Runtime 工具失败率；Run 数量／取消、未结束交接、两项记忆计数。HTML 直接显示比例、分子／分母、可比变化和覆盖，支持最近 7／30／90 天；未知不补零，当前记忆计数保持不可用。
- 工具失败比例为 `failed / (failed + succeeded)`；`denied`、`cancelled`、`not_executed` 等观测状态分别保留，不计入这个分母。应连同这些数量和 coverage 阅读，不能把低比例解释成权限检查或用户任务都成功。
- 值得追查的异常：失败原因集中、A2A pending 等待堆积、先失败再 retry 的增长、工具覆盖降低导致比例看似改善、Runtime／模型版本变化后的异常。已有时间字段可作样本定位，第一版不发布未经定义的延迟或成本曲线。
- `runtimeVersions` 汇总已有 Runtime／模型字段及未知数量，分析输入同时提供历史分布。日曲线按统计口径分组，不把“可比较指标”解释为模型总体一致；分布变化需要连同任务数量一起说明。
- 日报可以引用后续新增回归 Case 的 ID；创建 Case 时在任务说明记录来源 reportId／evidenceId，脱敏并转成可重复 fixture，再独立准入。原始日常任务不自动进入回归集或被重放。
- 报告只描述保留记录。历史 Run 的 Rovai build、精确 Memory 计数、完整 origin 与 native Tool 错误需要额外 provenance 或计数设计；本次不增加数据库字段，不做推测回填。
- `.daily.lock`、`.weekly.lock`、`.gate.lock` 是本地生成器互斥文件。异常退出后先确认对应进程已停止、保留不完整尝试，再移除该输出目录的锁。不要把它们与 Core 的 OS data-dir lease 混淆；Core 锁遵循本地隔离合同。

报告会保存真实执行产物和证据，默认私有。仓库只提交 Case、规则、说明与脱敏验收索引；将报告作为附件分享前按既有 Qualification 导出边界处理。

每个报告目录的 `report.html` 和报告根目录的 `index.html` 可离线打开。Rovai 文件预览能显示自包含内容；相对证据链接如果被预览隔离限制，用系统浏览器打开，不能为报告放宽 App 沙箱。页面只链接报告范围内存在的惰性证据，任务 HTML、脚本、symlink 和越界路径不执行或导航。

**离线报告阅读约定：** 页面沿用 Porcelain／Steel 的开放阅读平面与平台字体；筛选 Case、切换时间窗和展开证据只改变当前阅读视图，数据依据仍是 JSON 与保留证据。趋势点按真实日期间隔定位，跨多日／多周的距离如实保留；可展开数值表核对具体日期。窄屏下，质量与协作明细在表内横向滚动，保留判定列和证据列的可读宽度。

历史 Gate／每周 JSON 可用 `eval:gate render --report <report.json>` 补生成 HTML，保留旧评分语义；该命令不重新评分、不改写 JSON。新旧评分不能连续连线；需要新标准对照时重新生成两侧相同 profile 的 Judge 证据，证据不足则重新执行。


## 预算校准与订阅 CLI Judge

十二个通用 Case 的时间上限已在 Suite 2.2.0 翻倍至 8／10 分钟；任务、评分及 A2A 限额保持。先按实际耗时校准，不能看候选分数后修改同一 campaign 的预算。`execution.maxParallelCases` 可设 1 或 2；基线／候选成对顺序执行，Case 间独立，启动前仍保留完整任务、Judge 和清理余量。定时宿主总预算上限仍为 45 分钟，无法容纳的任务明确 not_run；手动开发者 campaign 可设更长总预算。

没有 API Key 时，可以用已登录的 Codex CLI 准备诊断 Judge：

```bash
node scripts/eval-judge-cli.mjs --executable /absolute/codex --model gpt-5.6-sol --output /private/new-judge-directory
```

将输出 `configuration.json` 与 `scripts/lib/qualification-cli-judge-adapter.mjs` 写入已有 judge 配置，再冻结计划。默认中等推理、每副本最多 240 秒、无自动重试；建议 `execution.judgeSeconds=600`，为双 View 并行和产物登记留余量。实际需要的副本按已冻结适用性调用；不适用的 Process 不调用。

准备会使用本地假 HTTP 接口核验实际请求没有工具，随后所有真实评价只接收指定 evidence pack。CLI 的能力和参数依据[官方配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)及实际命令探测；不依赖提示词单独限制工具。沿用 CLI 自己的登录，不把凭据导出到报告。其目录摘要是模型声明，不是提供者权重；固定 snapshot 未可观测时 Gate 保留证据不足，周回归仍可展示真实诊断结果。

新评分的每项证据范围及一次分歧裁决见 [Semantic Judge Views v7](../contracts/semantic-judge-views-v7.md)。质量覆盖率表示有效判定的权重占比，不表示任务执行率。历史证据重评需独立目录与来源绑定，不能作为新的每周运行样本。
