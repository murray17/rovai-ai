---
document_type: qualification-record
version: v1.72
authority: thread-rename-qualification-evidence
status: in_progress
last_updated: 2026-10-01
---

# Thread 更名：实施与验证

已实现 Principal 确认的 [r2](model-context-change-thread-rename.md)，完整提示词与 Skill 文本见[前后对照](thread-rename-comparison.md)。
分支 `rovai/thread-rename`，实施基线 `b534c16f6c8c7c37dcd03d18e6112e88fcd23620`。本记录不宣称完整真实任务 Gate 通过。

## 交付范围

- 公开模型、Desktop/Web DTO、英文界面、CLI 与模型上下文统一用 Thread／threadId；内部私有 Conversation 与供应商原生字段保留。
- 新入口 `rovai thread`、`rovai app thread`、`--thread-id`、`--reply-chain`；旧 camp 拼写与 read 的 `--thread` 在既有端点兼容。重复别名拒绝，结果只出新字段。
- 兼容窗口还原、浏览历史、草稿、首次引导、渠道旧 Outbox、trace 筛选及旧评测记录。ID、SQL 表列、附件目录、localStorage key 不迁移。
- Native Binding 的 Charter compatibility 保持 16。新绑定使用 Charter 17；旧绑定的 resume／压缩补投继续取冻结 Charter，不用新模板重建旧证据。
- 受管 Skill 保持原文件路径和同步流程，新包覆盖其拥有的文件，用户新增文件保留。模型历史中已读过的旧 Skill 文本不会被回写。
- Migration 178 / schema 128 只扩展 Context 格式准入。旧命令与工具证据先按原始摘要验证，再投影当前字段；新旧拼写重试复用同一结果。

## 验证环境与边界

macOS arm64，Rust 1.98.0、Node 26.10.0。独立 worktree、构建目录、Core 数据库、Skill Library、MCP 配置与 Electron userData。
没有启动真实模型 Runtime，也没有替换日常 App、读写日常业务数据库或同步日常 Skill 文件。

旧版本来自独立、未修改的基线 checkout；新旧可执行文件分别冻结在本机 `/tmp/rovai-thread-evaluation/` 的独立目录。
原始命令日志保留为 `/tmp/rovai-thread-*.log`，旧数据升级报告保留在 `/tmp/rovai-thread-upgrade-integration-verified/report.json`。
早期失败的测试和夹具报告保留，没有覆盖成成功记录。

| 检查 | 结果与覆盖 |
| --- | --- |
| TypeScript | `pnpm typecheck` 通过 |
| Desktop / shared 单元测试 | `pnpm test` 最终重跑：223 个文件、2417 个测试全部通过；Native compaction 的原生 Conversation summary 标签保持原义 |
| Node、文档、Skill | `pnpm test` 最终重跑通过；主 Node 汇总 328 通过、2 项平台 skip；工具与评测双读另外定向验证；文档与 Skill 门禁通过 |
| Electron 真实界面 | 独立启动共 11 项通过；覆盖对话打开、历史加载、阅读位置、导航切换和草稿保留 |
| Rust 编译 | 最终 `cargo check --workspace --all-targets`、`cargo build -p rovai-core --bins`、`cargo fmt --all --check` 通过 |
| 上下文与工具专项 | Context 53、Built-in 32、CLI 29 项通过；涵盖冻结 bootstrap 补投、新旧工具输入、重复别名与旧 v5 receipt 投影 |
| 数据迁移专项 | 当前 schema / admission 3 项与升级回滚 1 项通过；历史证据非空的升级 owner 也列入合同回归 |
| 默认 Rust 回归 | Core 394 通过、1 ignored、1 失败；失败为 macOS `com.apple.provenance` 文件属性测试，未修改基线独立复现同样失败。其余 workspace 和 CLI 单独验证通过 |
| Rust 扩展回归 | 共 1251 项，首轮 1239 通过、6 失败、6 ignored；4 项旧字段／版本夹具断言已修正并逐项复测通过；另 2 项为独立基线同样失败的 macOS 文件属性检查，见下文 |
| 合同回归 | 最终 16／16 通过、0 unknown；报告 `/tmp/rovai-thread-contract-candidate-verified/benchmark-run.json`。这是离线合同回归，不是完整真实任务 Gate |
| 结果投影与重试 | 最终 7 项 Command owner、29 项 CLI 测试通过；自动化旧结果移除重复公开 ID，私有单聊 ID 和任意嵌套内容保留 |
| 旧 Core → 新 Core | 隔离数据升级、旧输入兼容、幂等重放及原路径 Skill 更新通过，详情如下 |
| 完整真实任务 Gate | 未运行：缺固定模型版本的 Judge 配置，三位评测队员、Runtime、模型与权限尚未写入冻结 plan；不以单元测试代替 |

## Rust 回归的未通过项

扩展回归首轮日志为 `/tmp/rovai-thread-full-slow-tests.log`，完整结果保留，没有删除测试或添加 skip。
四项夹具修正仅让断言读取新 `thread` 字段、检查 formatter 32，或在使用当前 claim API 前补齐到 Migration 178；
分别在 `/tmp/rovai-thread-independent-reads-final.log`、`rovai-thread-v163-final.log`、`rovai-thread-v95-final.log`、`rovai-thread-v98-final.log` 留下复测通过结果。

剩余两项在未修改的 `b534c16f` checkout 独立复现：

- `database_admission::tests::read_probe_tolerates_only_a_new_empty_wal_not_authority_changes`：本机新文件已带 `com.apple.provenance`，不满足夹具的“尚不存在”断言。基线日志 `/tmp/rovai-thread-baseline-provenance.log`。
- `authority_migration::tests::macos_provenance_added_after_ticket_is_readmitted_without_losing_business_data`：添加该属性后的 migration ticket revalidation 返回 `IdentityChanged`；候选与基线在同一步失败。基线日志 `/tmp/rovai-thread-baseline-migration-provenance.log`。

没有修改文件属性准入策略、关闭检查或把这些结果标成通过。日常默认 Rust 和扩展全量命令的整体退出码仍为非零。

## 旧版本数据升级验证

可重复入口为 [`scripts/smoke-thread-upgrade.mjs`](../../../scripts/smoke-thread-upgrade.mjs)，需要明确提供旧、新 Core 二进制与一个不存在的输出目录：

```bash
node scripts/smoke-thread-upgrade.mjs \
  --baseline /absolute/baseline/rovai-core \
  --candidate /absolute/candidate/rovai-core \
  --output /absolute/new-upgrade-evidence
```

旧版先创建一条对话和改名命令，正常停止并完成 checkpoint 后，新版打开同一数据目录。验证结果：

1. schema 127 → 128；原 `rvcamp_` ID 和标题保持，新输出只含 `thread`／`threadId`。
2. `camps.snapshot + campId` 与 `threads.snapshot + threadId` 返回相同新结果；混传两个 ID 字段被拒绝。
3. 升级前创建／改名的 commandId 用新拼写重试，原 recordedAt 不变，没有追加副作用。
4. 1 条业务对话、4 条审计记录及被检查证据表的行数与内容摘要保持；该夹具没有启动 Native Session，bootstrap 表为空，因此本项不作为真实模型 resume 的证明。
5. 同一路径的 `cli-operations/SKILL.md` 从旧 Camp 文本更新为 Thread；用户增加的 `local-note.txt` 保留。

Bootstrap 的验证来自 Core 既有 owner：显式存入旧 Charter 后，继续使用原 binding/native session/evidence ID，补投仍包含整段旧 Charter；新绑定从新模板创建。
历史 Migration owner 另验证非空 Bootstrap、Runtime delivery、旧 Manifest 和 AgentRunInput 字节保留。
Antigravity 测试比较真实基线工具目录摘要对应的绑定身份，升级后相等；安装或原生协议变化仍按原规则失效。

## 尚未完成

按[上下文真实任务 Gate](../../development/evaluation.md#上下文改动-gate)，仍须冻结同模型、权限、预算的 baseline/candidate plan，
运行 DEMO-101–112 并用固定版本 Judge 评分。已向 Principal 请求现有 Judge 配置路径；不能伪造 snapshotDigest，
也不能把 `judge: null`、合成冻结证据或合同测试标作完整 Gate 通过。分支供审阅，未合并、未发布。
