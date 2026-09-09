---
document_type: development-guide
authority: dual-track-evaluation-workflow
last_updated: 2026-09-10
---

# Gate、每周回归与每日分析

本页拥有开发者操作流程。判断规则见 [Execution Evaluation v1](../contracts/execution-evaluation-v1.md)，组件边界见[双轨架构](../architecture/execution-evaluation.md)，实际交付与未完成验收从[当前版本指针](../versions/README.md)进入。Node 使用仓库要求的版本，命令详情由 `pnpm eval:gate --help`、`pnpm eval:daily --help` 和 `rovai app --help` 提供。

## 上下文改动 Gate

1. 按[上下文治理](model-context-change-governance.md)先读取当前权威，保存独立变更方案：完整前后对照、不变边界、版本、Case 范围、通过标准及预算。复用现有 `grill-duo-with-docs` 的文档与确认流程；适用的二次确认由开发者作出，CLI 只核验记录。确认前可以准备评测设施和基线，产品上下文语义按已确认 revision 实施。
2. 保存独立基线 checkout。用 `eval:gate build --source <checkout> --output <new-directory>` 构建基线；实施后用另一新目录构建候选。源码、产品二进制与评测资产分别冻结；运行期间保持两份 checkout 不变。
3. 根据[回归目录](../../qualification/context-regression/README.md)选择影响层级。上下文、共享机制或 `cli-operations` 跑 12 个通用 Case；其他 Skill 跑专属小集，无专属集先补 Case 并通过 `qualification:case admit`，不能空集通过。先冻结标准，再查看候选结果。
4. 按下面配置生成 `eval:gate freeze --config <json> --output <new-plan.json>`，再运行 `eval:gate run --plan <plan.json> --output <campaign-directory>`。规则检查实际合同测试、产物、写入边界、A2A、工具／记忆与预算；Judge 评价语义并引用证据。相同 campaign 保留所有尝试。
5. 提交前阅读 README 和 JSON 中的 `regressions`、`evidenceGaps`、`resourceChanges` 及每个 slot。修复实现偏差后重新构建、冻结并在原 campaign 重跑；方案语义改变时更新 revision 和确认。每个 campaign 最多两次，不能删失败目录、改标准或挑成功副本收口。

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
  "judge": null
}
```

通用集需要至少三位队员：为 `agent_2`、`agent_3` 明确配置同等或已固定的 Runtime、模型和权限；三个身份不等于三个独立模型。单队员配置只能用于不要求 A2A 的专项集或单 Case Runner 验证。`kind: skill` 配合 `skills: ["memory-stewardship"]` 或 `review-duo` 使用首批三个专属 Case。

权限必须先验证能在目标主机运行，再用于两个版本。本次 macOS 嵌套执行中，`workspace-write` 在启动命令时被宿主拒绝（`sandbox_apply: Operation not permitted`），Runner 保留了实际产物失败；随后沿用已有 Qualification Codex 配置的 `danger-full-access` 验证兼容路径。该权限不提供操作系统工作区写入隔离，独立目录也不等于独立主机；Core 自身权限边界仍有效。需要严格隔离时使用专用主机的既有 Formal 流程。权限改变属于环境改变，不据此声称质量改善。

`judge: null` 可验证执行与规则设施，但整体只能得到证据不足。真实 Judge 配置为 `{ "adapter": "/checkout/scripts/lib/qualification-api-judge-adapter.mjs", "configuration": "/private/judge.json" }`。该配置复用既有 Semantic Review shape：`provider`、固定 `snapshotId`、`snapshotDigest`、`configurationId`、`decodingParameters`、`retrySchedule`，另设 `api.modelVersionPolicy: pinned_snapshot`、可选 `api.endpoint` 和 `api.keyEnvironmentVariable`。`snapshotDigest` 必须来自可追溯的模型版本声明／部署 manifest 摘要，不能用任意常量冒充权重证明；仓库不验证提供者内部权重。

API 凭据仅通过命名环境变量读取；不写进配置或报告。默认接口遵循 [Chat Completions 官方协议](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)。Process 与 Outcome 各有反序双副本；每次请求禁用模型工具，要求实际返回模型与固定 snapshot 相同。解码参数必须是该模型明确支持的组合，错误后不偷偷降级模型／参数。有效但不理想的评价不自动重试。

耗时门槛冻结在 `POLICY`：同环境、同 Case 的 dispatch-to-terminal 同时增加超过 50% 和 15 秒，记为资源退化；硬预算仍由 Runner/Core 检查。小样本不能证明统计上的非劣性，Token／费用缺少统一 receipt 时明确不可用。固定规则与 rubric 的改动属于新的评测配置，不允许在同一 campaign 内换标准。

## 每周真实任务回归

用户侧可直接运行每周 CLI。接入 Rovai 现有 Automation 前，先验证其受管 Runtime 能在目标平台启动隔离 Runner。**本次 macOS 验收发现 nested `sandbox-exec` 返回 exit 71 / `sandbox_apply: Operation not permitted`，因此第一版在该平台的每周 Agent 定时执行受阻。**不解除 Core 的用户 IPC 隔离来获得通过；CLI 的实际执行与定时调度分别记证据。

在通过嵌套执行准入的平台，可复用现有 Automation，绑定专门的评测目录。任务只针对指定源码 checkout，调用隔离 fixture；日报通过 Automation ID 排除该评测任务。任务提示应包括：

> 为当前指定 checkout 创建新的 product 构建证据。基于固定配置生成 mode=weekly 的计划，运行 eval:gate weekly；输出报告、版本、样本数与趋势链接。保留全部结果，受阻写明原因，不修改实现、Case 或评分标准，不重跑用户工作区任务。

每周配置与 Gate 共用 schema，改为 `mode: weekly`，省略 `baseline`、`change`，保留 `candidate`、team、suite、Judge、重复数与预算。`eval:gate weekly --plan <frozen-plan.json> --output <weekly-history-root>` 按 UTC 周一分配 campaign；触发时间由 Automation 的设备本地时区决定，统计时区不改变触发时区。每周第一次尝试形成连续曲线，第二次尝试单列，不以最后一次成功替换失败点。JSON 保存每个版本、数量／分母和比较资格，缺周或环境变化断线。

App 退出／休眠时沿用既有 Automation 补跑与并发策略，不另建常驻调度器。配置不等于真实运行；实际结果只由保留的报告证明。

## 每日 Trace 与分析 Agent

先在现有 Automation 创建每日分析任务，绑定普通目录。日常统计不需要调用真实任务 Runner，也不需要用户评测。用户 CLI 一次性配置 Host 的数据范围：

```bash
rovai app trace schedule --automation-id <analysis-id> --timezone Asia/Shanghai --output /analysis-workspace/reports --exclude-automation-id <weekly-evaluation-id>
rovai app trace schedules --json
```

这是“哪些元数据可以准备给这个工作区”的配置，不是新增审批系统，也不是让分析 Agent 获得用户 IPC。Host 自动排除所有已注册分析 Automation，按配置排除回归、Smoke 和开发任务；隔离 Core 的评测记录天然不在日常数据库里。来源无法识别的旧记录保留 coverage=unknown，不承诺已经全部排除。

Main 先把规则统计、SVG 和分析输入写入指定工作区；每天的 Automation 只执行：

> 在指定仓库执行 `node scripts/eval-daily.mjs prepared --output /analysis-workspace/reports --timezone Asia/Shanghai`。输入必须是前一自然日的完整报告。根据 yesterday、comparableHistory、changes、versions、coverage 和样本解释变化、证据、可能原因及建议，区分事实与假设。引用指标路径或 evidenceId，将分析保存到命令给出的 analysisOutput 并在 Camp 汇报。缺失或陈旧时报受阻，不从全部日志估算比例，不执行原任务或修复。

在后续部署时设置实际时间，建议当地时间 08:00 给 Host 留出准备时间。Host 在 App 内每分钟检查，失败退避一小时；如果当天尚无完整输入，分析应诚实失败，不能把旧报告当成昨天。关闭对应 Automation 即停止准备。当前版本未提供外部后台常驻保证。

离线演示可以使用已实际导出的文件：`eval:daily --config <json> --date YYYY-MM-DD --trace <trace.json>`；在线用户调用省略 `--trace`，配置还需指定 bundled `rovai` 可执行文件。配置为 `{ "timezone": "Asia/Shanghai", "output": "/private/daily", "cli": "/app/bin/rovai", "scope": { "campIds": [], "excludeCampIds": [], "excludeAutomationIds": [] } }`。手工导出入口是 `rovai app trace export`；完整口径见 [User Automation v3](../contracts/user-automation-v3.md)。

## 报告解读与维护

- 日曲线：Run 完成／失败／取消、A2A 失败比例、Core／Runtime 可观测工具失败比例、两项记忆计数。数量与分母在 JSON 中；未知不补零，当前记忆计数保持不可用。
- 工具失败比例为 `failed / (failed + succeeded)`；`denied`、`cancelled`、`not_executed` 等观测状态分别保留，不计入这个分母。应连同这些数量和 coverage 阅读，不能把低比例解释成权限检查或用户任务都成功。
- 值得追查的异常：失败原因集中、A2A pending 等待堆积、先失败再 retry 的增长、工具覆盖降低导致比例看似改善、Runtime／模型版本变化后的异常。已有时间字段可作样本定位，第一版不发布未经定义的延迟或成本曲线。
- `runtimeVersions` 汇总已有 Runtime／模型字段及未知数量，分析输入同时提供历史分布。日曲线按统计口径分组，不把“可比较指标”解释为模型总体一致；分布变化需要连同任务数量一起说明。
- 日报可以引用后续新增回归 Case 的 ID；创建 Case 时在任务说明记录来源 reportId／evidenceId，脱敏并转成可重复 fixture，再独立准入。原始日常任务不自动进入回归集或被重放。
- 报告只描述保留记录。历史 Run 的 Rovai build、精确 Memory 计数、完整 origin 与 native Tool 错误需要额外 provenance 或计数设计；本次不增加数据库字段，不做推测回填。
- `.daily.lock`、`.weekly.lock`、`.gate.lock` 是本地生成器互斥文件。异常退出后先确认对应进程已停止、保留不完整尝试，再移除该输出目录的锁。不要把它们与 Core 的 OS data-dir lease 混淆；Core 锁遵循本地隔离合同。

报告会保存真实执行产物和证据，默认私有。仓库只提交 Case、规则、说明与脱敏验收索引；将报告作为附件分享前按既有 Qualification 导出边界处理。
