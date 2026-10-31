---
document_type: implementation-record
version: v1.72
status: complete
last_updated: 2026-11-01
---

# Mission 详情与复用校验精简

## 范围

User sequence 63 授权实施 sequence 61 的两项局部精简。开工远端 main 为
`b3c9522d3bd63a6aea631cb0f71792e37650e664`，仍存在两条重复读取路径。
分支 `rovai/mission-read-simplification`；独立 worktree
`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-mission-read-simplification`。
Governance: none；Status: ready。只推送工作分支，不创建 PR、不合并、不安装或重启日常 App。
本轮不改变 schema、用户数据、原文件、真实 Git index、分支、工作区归属或 Mission 锁范围。
局部动态只读行为见 [Mission v14](../../contracts/mission-v14.md)；没有新增 Version Decision、
持久缓存、恢复服务、账本、队列或协调机制。

## 单文件 Diff

删除详情中的 `prepare_diff_snapshot` 和 `same_view` 全清单／checkout 相等门槛。已有
`viewId → fileId → raw_paths` 关联先验证 workspace ID、路径与 generation，再核对当前 Git
注册、owner 和固定 base。私有 index 只对选中存在的叶路径准备 intent-to-add；删除路径跳过
这一步，重命名保留两个可信路径但不把已消失的旧名传给 `git add`。一次限定路径的 Git 调用
同时返回 raw、numstat、patch，详情不混用旧行数、binary 或模式。选中项无法对应时继续显式刷新。
文件变目录不递归展开；中间链接、非法路径组件不进入读取。既有 Gitlink 语义保持。

Renderer 仅将详情标题栏、图标、复制路径和统计改为 `fileDiff.file`；列表总计、缓存、
请求合并、迟到响应隔离和显式刷新保持。列表读取仍执行原来的三组 Git 操作。
普通详情从全清单准备加 patch 的四次 Git 调用，减少为身份观察、选中路径准备、目标 Diff 三次；
没有无路径限定的 add 或全仓 raw/numstat。删除项可以省去 add。每次详情仍复制真实 index，
split index 时还复制 shared index；完成即回收，不宣称消除所有写入、永久泄漏或速度百分比。

回归归属保持在已有 `mission_workspace` 两个 Diff owner 中，未新增独立 Rust 测试函数。
修复前新增“列 A/B 后只改 B、首次读 A”断言实测失败：`mission.changes_refresh_required`。
修复后该 owner 验证当前统计、删除、未跟踪、重命名及配对失效、binary→text、文件变目录、
generation 变化、无差异目标、split index、真实 index 字节不变，以及详情命令路径范围。
另一个 owner 扩展冲突与稀疏检出的详情读取，保留 assume-unchanged 与冲突 index 不变断言。

隔离 Electron 的现有 Mission board 用例新增“详情 +1/−1、清单总计 +43/−20”断言。
修复前详情仍显示清单 +2/−1，断言失败；修复后目标用例通过。原先 smoke 中“只切换分支就
拒绝旧 view”的断言，按 v14 替换为同一 workspace/generation/目标仍可对固定 base 读取；
没有删除 workspace 替换保护。该 smoke 还新增无关文件变化及预览前后 index／文件字节比较。

## 验证进度

- `cargo test -p rovai-core --lib mission_workspace::tests`：4 项通过（无额外 feature）。
- `pnpm test:mission-board`：11 项全部通过，独立临时 Electron userData，无真实 Core/Runtime。
- `pnpm test`：包含文档、Skill、Electron 能力门禁；Vitest 259 文件／3022 项通过、2 项原有跳过；末段 Node 365 项通过、2 项 Windows-only 跳过。
- `pnpm test:rust:pr`（默认 `cargo test --workspace`）：477 项通过、1 项原有 ignored 手动 Runtime 验收。
- `pnpm typecheck`、`pnpm check:rust`、`pnpm build:desktop`、格式与文档门禁通过。
- Windows、完整 Desktop 的真实 Core 联动和安装路径尚未执行；隔离 Renderer 受控接口验收不等同于这些结果。

## 正常 ready 复用

在现有生命周期锁内记录本次进入时是否 ready，仅当该已存在工作区完成完整身份校验、
generation/token 条件更新成功后，在公共收尾复用本次结果。原有最终目录验证、数据库／删除
fence、冻结 execution workspace 比较都继续执行；结果不落库、不跨请求缓存。
首次创建、工作区缺失及 cleanup_failed 进入后恢复 ready 的路径不走该优化。

扩展已有 `late_mission_preparation_cannot_erase_camp_deletion_cleanup_owner`，沿用现有真实
Git 包装器与控制屏障。修复前 `--show-toplevel`、common-dir、admin-dir 查询各两次，新增
一次断言失败（2 != 1）。修复后各一次，错误 owner／注册拒绝、清理失败恢复保留多次必要
校验、删除竞争与清理 owner 不被晚到准备覆盖均通过。命令：
`cargo test -p rovai-core --lib --features slow-tests late_mission_preparation_cannot_erase_camp_deletion_cleanup_owner`，
实际运行 1 项；slow-tests 隐含启用 extended-tests。这是重复身份链从两组变一组，不是整个任务只执行三条 Git 命令。

额外执行 `--features slow-tests mission`：75 项中初次 72 通过、3 失败。
其中已有 `mission_git_reads_release_ingress_database_and_lifecycle_authority` 的旧 fixture 仍期待
发送直接返回 Run ID，在进入 Git 路径前 unwrap 失败。已按现有流程先准备真实工作区、捕获
workspace fence、认领 Delivery，再建立只读证据；未改变生产调度。完整原断言保留，单独重跑
1 项通过，覆盖请求并发预算、普通读取不等待 Git、清理／generation 变化后的 post-read 拒绝。
另两项为 Steer 的 Hermes 版本资格断言及通知 fixture 的数据库契约断言：

- `delivery_queue::tests::steer_admission_uses_the_frozen_run_and_rejects_stale_or_unknown_capability`：Hermes 1.0.0 实际 `VersionUnverified`，旧断言期待无拒绝。
- `notification::slow_tests::interruption_admission_is_atomic_and_thread_acknowledgement_is_bounded`：fixture 不符合当前数据库契约，`Current` 分类断言失败。

已在同一隔离 worktree 暂时恢复三处修改的 Rust 文件，确认整个 `crates/` 与原始 `b3c9522d3`
无 diff 后，分别按完整名称、`--features slow-tests -- --exact` 运行以上两项。
两项均以相同断言失败；随后逐字节恢复本次源码并核对 SHA-256。
对照记录 `/private/tmp/rovai-mission-baseline-comparison.json`。不将这轮扩展过滤结果写成全通过，
两项基线问题保留，不扩大本轮产品修改。

## 真实 macOS Core／Runtime 验收

使用本 worktree 的 `pnpm core:build:debug` 产物与配套 CLI，Core 版本 0.5.4，二进制 SHA-256：
`9a474d285d4eddce978b39bf82430d5edfa101d9301032f5331eb3f04e7112d4`。
验收是在第二项生产代码已应用、尚未提交时构建；基线对照前后源码字节相同。
生产文件 SHA-256：`application/mission.rs` 为
`8d5fc3d72ad0a86d721c31d8635af78171a0d36374aa1c43f8c2a9f10294b824`，
`mission_workspace.rs` 为 `f156f48d11d553e4a90ac53535ec5e02776c995c5e6883a0e420216f7c256a38`。

完整命令为 `ROVAI_SMOKE_MODEL=gpt-6.1-sol node scripts/smoke-mission.mjs <本 worktree>/resources/bin/macos-arm64/rovai-core /private/tmp/rovai-mission-read-acceptance-1793467885867`。
独立 `core-data`、`skill-library`、`core-data/mcp.json`、`native-codex` 和 Git source/worktree。
只复制 Codex 配置与认证，不复制日常 Session；结束后 Core 已停止，复制的 `auth.json`、
`config.toml` 已移除。Runtime 实际入口 `/opt/homebrew/Caskroom/codex/0.165.0/bin/codex`，
CLI 和 fixture 数据库记录均为 `codex-cli 0.165.0`；模型 `gpt-6.1-sol`。

`report.json` 为 passed：9 个场景、6 个真实 AgentRun 均 succeeded。实际覆盖：

- 真实 Mission 首次创建工作区、队长／队员执行和原路径文件发布。
- 读取清单后只改无关 `new.txt`，首次读取 `tracked.txt` 成功；返回当前 +1/−1 与 patch。
- 预览前后真实 index 文件及三个用户文件字节一致；source 原有 dirty 内容保留。
- 切换 checkout 后仍用原 view 读取同一目标；固定 base 不变。
- 关闭并重开 Core，同使命后继任务复用同一路径；detached/base 不可用不妨碍真实执行。
- 非 Git Mission、脏工作区清理拒绝、未删除现场的旧失败恢复、清理后重建、最终 Thread 删除。

首轮自动验收目录 `/private/tmp/rovai-mission-read-acceptance-1793467540668` 在配置阶段被旧
`configureProductRuntime` 的 profile-ready 等待卡住，尚无 Run；当前产品按配置返回
`installed_unverified`，原生探测已经 ready。已停止该 fixture，保留 `setup-diagnostic.json`，
清除复制凭据。Mission smoke 现在使用现有配置入口直接配置，并以真实执行判断结果；未修改产品
Runtime 准入或共享 helper。最终版本的 smoke 另补报告尾部读取已经观察到的 Runtime 版本，
已在同一结束后的 fixture 中只读执行并断言为 `codex-cli 0.165.0`；未重跑整套模型任务，
生产代码与已测二进制不变。

## 交付与限制

两个独立提交：`fix: read mission file diffs without whole-workspace revalidation`
（`ad8b609da5c0ffcb37e9f8d48927cd2981f89eb0`）及
`fix: avoid duplicate validation when reusing ready mission workspaces`（本记录最终所在提交）。
分支保持在 `rovai/mission-read-simplification`，未合入的 worktree 保留。

Windows 原生、完整 Desktop 与真实 Core 的联动、安装路径未验证。隔离 Electron 的 11 项通过
和真实 Core/Runtime 的 6 次执行分别记账。两项非目标扩展测试的基线失败如上保留。
私有 index／shared index 复制、既有详情缓存与手动刷新、无计划／归属不明时的 Mission 锁等待
继续存在。未新增后台清理、恢复机制、持久验证状态或数据迁移。
