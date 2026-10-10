---
document_type: runtime-research
runtime: claude-code, codex
authority: research-evidence-only
status: verified-with-native-limitations
observed_version: Claude Code 2.1.280, Codex CLI 0.159.2
observed_platform: macos-arm64
last_updated: 2026-10-10
---

# 受管原生自动记忆：启动配置与隔离验收

本轮固定关闭 Claude Code / Codex 原生自动记忆，保留 Rovai Memory、项目规则与原生 Session 持久化和恢复。
Claude 使用原有私有 settings 文件及最终子进程 env 双重覆盖；Codex 在 App-Server 启动参数中传入三个 `-c` false。
只修订 Codex Host 兼容摘要，不改 Native Binding 的兼容摘要，不增加每轮版本/配置检查，不修改 Windows shim。
完整当前策略由[Runtime 架构](../../architecture/runtime-catalog-boundaries.md#受管执行的原生自动记忆)拥有。

产品改动在 `crates/rovai-core/src/claude.rs`、`codex.rs`；已有证据摘要同步在 `runtime_platform_admission.rs`。
已有测试随两个 Adapter 一起更新，Windows 扩展测试入口在 `.github/workflows/full-check.yml`。
当前文档同步 `runtime-catalog-boundaries.md`、`runtime-compatibility.md`、v1.72 的概览与实施计划；
本目录保留手动隔离夹具和脱敏证据，不接入每轮生产执行。

## 隔离与实测范围

基线为 `d1dd5cce299b6896b6ea88495aa06d02f6ea91d6`，任务分支 `rovai/disable-native-auto-memory`。
所选程序为 Homebrew 安装的 Claude Code 2.1.280 与 Codex CLI 0.159.2 的真实二进制；程序摘要和脱敏结果见
[证据文件](evidence.json)。没有升级日常安装、读取或复制日常记忆/认证，也没有重启日常 App。

所有验收采用新的私有临时目录，显式绑定 HOME、CODEX_HOME、CLAUDE_CONFIG_DIR、项目、Core data-dir、Skill Library、
MCP 文件与 Runtime Files Root。模型端点为 loopback SSE fixture，仅使用合成 Key 和标记；原生 CLI、协议、会话存储、
配置加载、工具和 Core Adapter 是真实实现。该结果证明执行链行为，不等于真实模型质量或账号认证验收。

## 配置、自动加载与生成

| 场景 | 观察与结论 |
| --- | --- |
| Claude 用户和项目 settings 设 env=0，继承环境开启 | 关闭组私有 settings env=1 加子进程 env=1；实际请求无原生记忆标记。项目独有 `CLAUDE_CODE_MAX_OUTPUT_TOKENS=3333` 在请求中出现，证明项目 settings 参与加载。两个原始文件字节不变。 |
| Claude 开启／关闭对照 | 同版本、等价合成记忆下，开启组首次和冷恢复请求含标记及 `How to save memories` 指引，关闭组均不含；CLAUDE.md 标记和已有对话仍在。 |
| Claude 自动生成边界 | 保存指引的移除是原生生成机制的配置证据。本轮脚本 Provider 不作自主记忆决策，未触发真实模型自动写记忆；该行为仍为未验证，不把“没有新文件”当作通过。 |
| Codex 用户和受信任项目三个值均 true | `config/read(includeLayers=true)` 显示 project 层未被禁用，user/project 值为 true，启动覆盖层和读回三个值为 false；原配置文件不变。 |
| Codex 自动加载 | 开启组请求含唯一原生记忆标记，关闭组无标记；AGENTS.md 和会话历史标记保留。 |
| Codex 自动生成输入资格 | 开启组新 Thread SQLite `memory_mode=enabled`，关闭组为 `disabled`；不依赖尚未满足后台提取触发条件时的文件数量。未删除旧记忆或清除旧 Thread 历史资格。 |
| `config/read` 与 Thread 覆盖 | 独立原生负向对照显式给 Thread 三项 true 后，请求重新含记忆，而 `config/read` 仍为 false。它不是指定 Thread 的最终快照。生产 start/resume 的可选配置只追加既有 MCP 内容，测试确认没有 features/memories 反向覆盖。 |

这些标记来自实际 HTTP 请求内容的布尔比较，报告不保存完整 Prompt、环境、配置、Key 或记忆正文，
也不依赖模型自述。历史会话中已出现的内容不追溯删除；恢复历史中的旧内容与再次自动加载必须分开判断。
开启组 Codex 会额外发起不含用户输入的辅助请求；夹具按唯一输入标记识别主对话并验证项目规则，
证据仍保存所有请求的布尔结果。关闭组同时要求所有请求都不含原生记忆标记。

## 受管执行、工具与恢复

[Core 夹具](fixtures/core_probe.py)启动编译后的真实 Core，通过现有配置、Thread 及消息 API 运行所选 CLI。
每个 Runtime 分别使用无 MCP / 有 MCP 场景，执行首次、后续 Run、Core 正常退出并重启后的 cold Resume。
SQLite 的 Native ID / Binding ID / generation 与实际成功 Run 一起核对；Codex 还核对首次与后续 Host 相同、cold Host 不同。
Native ID 字符串相等本身不被当作恢复成功。

新版 Core 的两种 Runtime × 两种 MCP 配置 × 三个阶段共 **12 次 Run 成功**。另从基线独立构建旧 Core，
用其完成首次与后续执行，再由新版 Core 冷启动并恢复原会话，另 **12 次 Run 成功**。
四组升级均保留原 Native ID / Binding / generation；Codex 旧 Thread 的 `memory_mode` 仍为 `enabled`，
而由新版 Core 新建的 Thread 为 `disabled`。未把旧 Thread 的资格追溯改写。

升级恢复的请求仍含旧记忆标记，Claude 也保留旧会话缓存中的保存指引；重启前向原生记忆文件新增的第二个标记没有出现。
独立原生对照中，Claude 开启组冷恢复会读到第二个标记，关闭组不会。Codex 开启组冷恢复同样未读到第二个标记，
所以不能仅用该冷恢复现象证明 Codex 的关闭效果；它的新 Thread 开启／关闭对照、启动配置和生成输入资格证据共同支持结论。
这些历史差异没有通过换 Session 或清空历史消除。

原生 shell 工具调用 bundled `rovai` CLI，通过隔离 Core 完成一次 Companion Memory 写入，后续读取和搜索同一 Memory，
并产生公开发送回执；cold 后继续读取原结果。MCP 复用仓库现有 echo fixture 和正式配置/Assignment 接口，
原生模型协议返回正确命名空间的 MCP 调用，服务器调用记录作为执行证据。

## 复现与测试

先按[本地隔离流程](../../development/local-workflow.md)构建当前分支：`cargo build -p rovai-core --bins`。
下面两个输出目录必须尚不存在；每次重放生成独立合成存储，程序路径必须指向需要验收的真实安装。

```sh
python3 docs/research/native-auto-memory/fixtures/probe.py \
  --codex /absolute/codex --claude /absolute/claude --out /new/private/native-probe
PYTHONDONTWRITEBYTECODE=1 python3 docs/research/native-auto-memory/fixtures/core_probe.py \
  --repo /absolute/task-worktree --codex /absolute/codex --claude /absolute/claude \
  --out /new/private/managed-probe
# 升级验收：同一命令另用新输出目录，追加 --old-core /absolute/baseline/target/debug/rovai-core
CLAUDE_CODE_DISABLE_AUTO_MEMORY=0 cargo test -p rovai-core --features extended-tests --lib -- \
  claude::tests:: codex::tests:: runtime_fleet::tests:: camp_fast::tests:: memory_tool::tests:: --test-threads=4
```

定向 Rust：**83 passed、1 ignored**（既有手动原生 smoke），不是零匹配通过。复用原有 owner，覆盖 Fast true/false/None、
环境优先级与父环境不变、settings/Bootstrap 持有和清理、Windows 文件参数运输、MCP 增量对象、新建/恢复、
旧策略 Host 正常替换、warm 复用、cold 恢复及明确参数拒绝不降级重试。

Windows 使用已有 Full check workflow 的 `windows-runtime` scope，新增一步执行已有 Claude 扩展模块，
不放宽通用 shim 限制。Windows fixture 从真正 `.cmd` 经 PowerShell 读取 settings 文件并验证最终子进程 env；
这项受管入口回归与 Windows 上真实官方 CLI 的行为验收分开记录。
[Windows Full check 38031819120](https://github.com/murray17/rovai-ai/actions/runs/38031819120) 在
`7184f08efa6b7da034306a566ecd8c9616ff0fa9` 通过：Claude **34 passed**、Codex **21 passed / 1 ignored**，
Fleet **23 passed**，另有 Windows 进程所有权、私有文件和 MCP 配置检查通过。

首次 Windows 扩展测试有两项 PowerShell 冷启动等待超时。调整的是既有测试夹具的 Windows 启动预算
（5 秒变为 15 秒）及本模块 CI 并发数（2），不改生产超时、shim 校验或 Runtime 失败处理。

兼容性清单新增记录后，按仓库既有规则同步 `MACOS_RUNTIME_COMPATIBILITY_EVIDENCE_REVISION` 的文档字节摘要。
它是已有证据登记常量，不属于 Native Binding 摘要，也未增加任何 Runtime 准入检查。

全量 extended-lib 探索发现的以下两项失败，在基线的独立源码和构建目录均已复现；不列为本次通过：

- `authority_migration::tests::macos_provenance_added_after_ticket_is_readmitted_without_losing_business_data`：`authority_contract_changed`。
- `channel::tests::pending_picker_upgrade_keeps_history_rolls_back_failure_and_reuses_the_old_card`：缺少 `last_delivery_sequence` 列。

该探索运行在确认基线失败及定向验证后停止，未声称整套 extended-lib 通过。本次新增 settings 文件引起的
既有文件数／遍历顺序断言已修正，归入上述 83 项通过结果。

默认工作区检查 `cargo test --workspace -j 2 -- --test-threads=4`：**463 passed、1 ignored**，退出码 0。
`cargo fmt --all --check`、`git diff --check`、`pnpm docs:test`（10 项）、`pnpm docs:check` 与
`DOCS_BASE_REF=d1dd5cce299b6896b6ea88495aa06d02f6ea91d6 pnpm docs:check:ci` 通过。

## 未验证边界

本轮真实 Runtime 行为证据限于 macOS arm64 和上述版本；没有 Windows/Linux/macOS x64 官方 CLI、真实账号模型或
组织管理设置冲突夹具。Claude 自主生成的正向触发未验证，Codex 后台提取/合并的模型质量未测。
固定策略不声称文件访问隔离，不控制显式文件工具、外部进程或 Rovai 之外启动的 Runtime。
新策略从新版 Core 新建的子进程开始生效；旧 Core 与活动 Run 不热更新、不强制退出。

官方语义核对：[Claude 环境变量](https://code.claude.com/docs/en/env-vars)、
[Claude 记忆机制](https://code.claude.com/docs/en/memory)、
[Codex 配置参考](https://developers.openai.com/codex/config-reference)、
[Codex App-Server](https://developers.openai.com/codex/app-server)。本轮执行证据只绑定实测版本，不能外推新版本或管理策略。
