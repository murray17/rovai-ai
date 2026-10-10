---
document_type: runtime-research
runtime: command-code
authority: research-evidence-only
admission: research
observed_version: 1.65.2
observed_platform: macos-arm64
last_updated: 2026-09-25
---

# Command Code 1.65.2：真实 BYOK Smoke

本记录来自 macOS arm64 上的官方 `command-code@1.65.2`，使用用户现有的 Command Code 官方 `providers.json`、`config.json`、`auth.json` 和 `sub2api/gpt-6-sol`。测试把这些配置复制到私有临时 Home，使用隔离工作区及独立 App `userData`／Skill Library；临时配置及原生会话含认证信息和完整 Prompt，均不进入仓库或附件。执行时设置 `CMD_LOCAL_ONLY=1`、`DO_NOT_TRACK=1`、`COMMANDCODE_SKIP_UPDATES=1`，并使用 `--local-only --no-auto-update --skip-onboarding --no-skills`。这只限定本次试验的配置与工作区，不证明无网络或生产权限隔离。

`GET /v1/models` 在测试时返回 HTTP 200，但列表没有 `gpt-6-sol`；显式指定 `--model sub2api/gpt-6-sol` 的真实生成请求仍返回 `result.subtype=success`。因此不能把该目录缺项直接判为模型不可用，也不能仅凭本次成功推断目录、价格或未来可用性。

| 流程 | 原生观察 | 已证明的范围 |
| --- | --- | --- |
| Auth / model | 首轮 25 条 NDJSON 包装帧，最终 `result.success`，回复含预设合成标记；未见认证错误 | 本次隔离 Home 的现有 BYOK 凭据可调用显式模型；不是 Rovai Product Probe |
| Warm continuation | 新 CLI 进程使用首轮完整 UUID `--resume`，成功复述首轮合成标记；返回同一 UUID | 同 Home、同工作区的精确原生续接 |
| Read | 原生 `read_file` 的 `tool_queued → tool_running → tool_completed`，最终回复含文件中的合成标记 | 本次真实模型调用了原生读工具；未经过 Rovai Action 流 |
| Edit | 原生 `edit_file` 完成，隔离文件从旧标记变为新标记；返回同一 UUID | 本次真实模型可编辑该私有工作区文件；未证明 Core 工作区门禁 |
| Command output | 原生 `shell_command` 将 stdout、stderr 分别放在 `tool_update.partial`，终态 `tool_completed.result` 合并为文本，首行为 `Exit code: 7`；CLI 顶层仍为 `result.success` | 非零 Shell 退出与 CLI/Tool 成功状态不同，Rovai Action 需独立归约 |
| Empty output | `true` 的终态文本为 `(no output)`；`exit 3` 的终态文本为 `Exit code: 3`；两者顶层仍为 `result.success` | 空输出与非零退出可从本次原生文本区分；不是结构化 exit-code 合同 |
| Headless `dont-ask` | 新隔离 Session 下，`read_file` 得到 `queued → running → completed` 并读出文件标记；`shell_command` 的 `touch` 和 `edit_file` 的替换都得到 `queued → denied`，两个目标文件均未改变；三轮顶层仍为 `result.success` | 当前内部传输固定 `dont-ask` 时读可用、写和命令被拒；这是真实原生权限边界，不代表已有 Rovai Approval/deny/cancel 产品路径 |
| Headless `--yolo` | 分别新建隔离 Session，`edit_file` 成功替换隔离文件，`shell_command` 的 `printf` 标记出现在 Tool 终态；两者为 `queued → running → completed` | 明确证明 1.65.2 在最高权限模式可运行这些 Golden Flow 的原生工具；Rovai 尚无该模式的产品 Approval、安全隔离和副作用管理 |
| Shell 文本歧义 | 成功命令 `printf 'Exit code: 7\n'` 的 `tool_update.partial` 和 `tool_completed.result` 都恰为 `Exit code: 7\n`，顶层 success | 不能仅看终态文本首行就判非零；staged normalizer 以原生 live output 与终态相等作为这一实测反例的排除条件 |
| Manual compact | 同一 Session 扩充到超过原生近期保留窗口后，交互 `/compact` 提示节省约 8,014 tokens；隔离 Session 文件出现一条 `type: compaction`，含 `tokensBefore: 40057` 和 `firstKeptEntryId`；退出交互进程后的新 headless `--resume` 保持同一 UUID，并能回答首轮合成标记 | 本次原生手动压缩和压缩后精确恢复；不能推断 Rovai Bootstrap 补发、自动/溢出压缩或 Core 冷恢复 |
| Usage | 上述成功 `result.usage` 均有 `inputTokens`、`outputTokens`、`cacheReadTokens`、`cacheWriteTokens` | 上游字段存在；scope、累计方式、成本及 Rovai canonical 归属尚未证明 |

Command Code 的非零 Shell 退出仍发 `tool_completed`，此前 Core 归约会把它记为成功。本次在现有 `command_code_activity` owner 中按 `shell_command` 终态文本首行 `Exit code: N` 且 `N != 0` 归为失败，同时排除终态文本与已观察的 live output 完全相同的成功命令；既有测试覆盖非零、stdout/stderr 保留和上述反例。上游仅给文本而非结构化退出码，若没有 live output 或输出被截断，仍可能存在无法区分的形态；正式 Action 资格须以更广的真实样本或上游结构化信号解决。

## 未达到的 Camp 验收

当前 `AdapterKind::ALL`、Product Catalog 和 AgentRun dispatch 没有 Command Code。上述真实调用直接运行原生 CLI，**没有**创建 Rovai AgentRun、Camp、Native Binding、ContextManifest、Input Delivery、Action、Usage 记录，也没有可保留的 Command Code App Camp 界面。它不替代 [Runtime 接入 Checklist](../../development/runtime-integration-checklist.md) 的 First-Class 或 Golden Flows。当前缺口还包括：首次/压缩后 Charter 实际交付、Core 冷恢复、自动及溢出压缩、Skills/MCP 隔离、Built-in `rovai` CLI、权限拒绝/取消、超大输出、Usage 归属与各目标平台证据。
