---
document_type: implementation-plan
version: v1.72
authority: evaluation-metric-coverage-implementation
status: completed
last_updated: 2026-10-30
---

# 评测指标采集修复

User 在本次 Thread sequence 3 授权独立 worktree、真实评测及按缺口修复后重评，目标是尽可能采齐指标，
不要求满分。实施仅修复评测设施、证据和报告；不修改产品模型上下文、题目、评分权重或既有失败记录。

## 执行边界

- Worktree：`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-eval-metric-coverage`。
- Branch：`rovai/eval-metric-coverage`；基线 `5a229a5994d175cbc7aa6c8e66cdafc00bd75838`。
- 自动验收使用逐 Trial 的独立 Core data、Skill Library、MCP 与工作区；不写日常数据库。
- 证据保存在仓库外 `rovai-evaluation-evidence/metric-coverage-20261029/`，原始失败不删除、不覆盖。
- 固定 Suite 2.12.0、评分 2.10.0，使用当前已安装 Codex CLI 和显式 `gpt-6.1-sol` / medium。
  三位执行队员与 Judge 的模型声明分别冻结；CLI catalog alias 不冒充不可变服务端 snapshot。
- 本轮修复采集设施，使用当前版本单臂回归验证 12 个不同任务；不宣称产品基线非劣或 Formal Gate 通过。

## 验收目标

现有通用集按一次 repetition 固定 112 个适用质量检查、17 个适用协作检查。每项保留来源、判定和理由。
满足、部分满足和不满足都属于已采集；未知、未运行、协议错误及缺失证据不补零；预声明不适用单列。
质量的 50/25/25 权重与协作五项／三组状态统计保持，不新增协作总分。

1. 当前 Core、Runner 的全部 12 项真实 Trial 能收口并保留可读取的评测证据；任务本身可失败。
2. 报告直接给出质量、协作检查的已采集数、适用分母、不适用数及逐项缺口。
3. 所有适用质量检查形成有效判定，质量总分及三个维度可计算；所有适用协作检查形成有效判定。
4. 原生工具失败、任务缺陷和合理扣分仍可见；评分失败与任务失败分开。
5. 若真实必要证据不可观测，保留未知并明确原因，不能修改题目或移出分母达成采集目标。

## 执行与恢复

先做当前构建、合同检查和单项真实验证，再执行完整回归。每次修复绑定新的评测代码摘要及新计划，
每个 campaign 仍最多两次；User 的持续修复授权允许保留旧 campaign 后以明确修订的新配置继续。
不能仅为替换低分创建新尝试。有效判定不得择优替换；同标准协议恢复必须记录源报告和每次恢复证据。
最终验收围绕采集完整性，不以 Gate 验收必须全通过为停止条件。

## 当前发现

- 2026-09-23 旧整轮报告硬性产物通过 12/12，质量覆盖 93.2292%，DEMO-108 的 Judge strict schema 拒绝引号枚举；
  当前主线已有对应修复，不将该历史错误冒充当前复现。
- Suite 2.12.0 指向评分 2.10.0，任务 README 的当前评分入口仍是 2.2，需修正文档路由。
- 当前汇总保留单项协作未知，但整体缺口只纳入关键协作项，缺少所有适用质量／协作项的采集汇总。

## 第一轮真实执行

`campaign-r1/attempt-01/report.json`：12/12 项硬性任务完成；16/16 合同条件通过。
适用协作指标 17/17 采齐、43 项预声明不适用；质量 108/112 采齐，加权覆盖 95.8333%，总分保持 null。
DEMO-101、106 等有效部分得分保留；缺口是 DEMO-102、103、105、112 的声明佐证项。

当前复现与修复：

1. 旧 Runtime 准入等待不会再产生的 ready snapshot，使首个真实预检在派发前失败。改为隔离 Regression
   静态安装准入，仍由 Core 验证真实启动；实际可执行文件独立计算摘要。
2. 两个既有 Rust 测试仍假定迁移 receipt 217／Manifest v40，导致三项合同条件失败。更新到当前 218／
   公共输入 Manifest 常量，并保留历史升级与缺失迁移负例；未新增或退休 Rust 测试。
3. 当前 Core 已改用 lifecycle 载荷，原生补采仍按旧字段形状计算摘要，导致真实回执全部无法关联。
   修复为完整当前形状匹配；仍须验证原生事件、命令、输出和 Core 摘要。
4. 补采 Git／哈希、明确的静默输出，以及可安全分离的验证输出；协作过程信息仍不进入 Outcome。
   修复 JSON 回执脱敏误伤 Python 换行。具体边界见 Execution Evaluation v16。

`rejudge-preflight-r2/` 从第一轮保留副本验证上述四项的真实 Judge 重评，不算新任务样本。
第一轮原始记录不覆盖。

## 最终真实验证（2026-10-30）

三轮均为真实 Codex CLI 0.165.0／`gpt-6.1-sol` medium 的任务执行与独立 LLM Judge，
每轮完整执行同一组 12 项，单次 repetition、两个并发 Case；使用隔离 Core，不写日常 App 数据。
评分始终为 2.10.0，适用分母与权重不变。历史副本重评仅用于诊断，不拼入下面的整轮结果。

| 整轮 | 质量已采集 | 协作已采集 | 未知指标 | 硬性产物验收 | 质量总分 |
| --- | --- | --- | --- | --- | --- |
| campaign-r1 | 108/112 | 17/17 | 4 | 12/12 | 不可计算 |
| campaign-r2 | 111/112 | 17/17 | 1 | 12/12 | 不可计算 |
| campaign-r3 | 112/112 | 17/17 | 0 | 11/12 | 95.8333/100 |

第二轮唯一缺口来自 DEMO-106 把静默检查、差异统计、状态输出与发送用分号相连。
修订补采器保留验证前缀及真实输出，并继续要求独立输出佐证；`rejudge-preflight-r3/` 中两个真实 Judge
都判为部分满足，未将整条 shell 退出成功当作静默子检查成功。随后重新冻结 `plan-r3.json` 执行全套。

最终 `campaign-r3/attempt-01/report.json` 的 `conclusions.evaluation=complete`，
`evaluationFailures=[]`、`evidenceGaps=[]`、`collection.gaps=[]`。全部 12 个 Trial 有有效终态与评分。
质量三个维度为目标 92.7083、依据 97.9167、边界 100；加权质量覆盖为 100%。
协作另有 43 项冻结的不适用项，不进入 17 项适用分母。协调、交接分组均为 4/4 满足；
整合分组为 3/4 满足、1/4 不满足，不构造协作总分。

真实扣分与失败保留：

- DEMO-105 未交付要求的 `report.json`，质量 56.25，Lead 整合不满足，硬验收失败。
- DEMO-106 产物通过，但声明佐证部分满足，质量 93.75。
- 其余 10 项质量为 100。本轮 `status=degraded`、`acceptance=failed`、退出码 1 对应上述验收结果；
  采集目标已完成，因此不再重跑以追求通过或满分。

这是当前版本的单臂采集验收；`regression=not_compared`。没有产品基线非劣结论或不可变服务端模型
snapshot 证明，CLI catalog alias 按真实身份记录。

## 验证与交接

- `pnpm test`：通过；Vitest 259 文件、3022 passed、2 个既有 skip；末尾 Node 批次 365 passed、2 个平台 skip。
- `pnpm test:rust:pr`：workspace 477 passed、1 个既有 ignored。Rust 只更新既有
  `current_migration_state_admission_matrix`、`v172_preserves_historical_context_rows_and_gates_new_writes`、
  `database_contract_preflight_admits_current_and_rejects_future_store` 与历史升级矩阵的当前输入；
  无新增／退休测试函数，缺失 receipt 218 仍被拒绝。真实合同检查 16/16 通过。
- 原生证据、声明审计、回执与 Judge 脱敏定向测试 44/44 通过；包含摘要／argv／输出篡改、错误工作区、
  null 与显式空输出、发送尾部混合、伪造引用及过程信息隔离负例。
- `pnpm typecheck` 通过。报告 HTML 测试包含采集计数、低分和旧报告；浏览器访问 Host 不可用，
  未完成桌面／窄屏截图复核。
- 文档通用门禁、固定 base 的 CI 文档门禁和 `cargo fmt --all -- --check` 均通过。

最终计划／报告均保留在证据根目录，HTML 为 `campaign-r3/attempt-01/report.html`。
计划文件 SHA-256：`bd33f8322101afdbf3a7cf677aa2c19664db38e520458a518a2881372b956977`；
报告文件 SHA-256：`7bccf2f4673a1ad59effeaf49fc41ab139438c62b10dfa41f3cf31a1cd5e0ad7`。
冻结产品基线仍为 `5a229a5994d175cbc7aa6c8e66cdafc00bd75838`，源码内容摘要为
`778e5a9b87b7d6fe3a7f7426639789d997c6a2d4b1b98e7717795fb30e4a3216`。
修复在独立分支交付；未合并，不创建 PR，不安装日常 App。
