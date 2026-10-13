---
document_type: research
status: not_qualified
reviewed_at: 2026-10-13
baseline_ref: 30e2ff2dc9fe6827cb8a0566e1ae2ef81ab3c779
---

# PR #725 合入后的 Windows 原生恢复复测

**Copilot 1.0.91 的降级启动问题已在原生 Windows、真实 LLM 上确认修复。**
15 类 Runtime 全部重新完成首轮、同 Core 次轮和携原 Session ID 的冷恢复。删除真实原生历史后，
Copilot、Pi、Qwen、Qoder、CodeBuddy、ZCode 六类各新建一次、正常切换绑定、提示一次并提交一次输入；
其余九类保留原 ID 报错，符合此前确认的保守边界，不算自动降级通过。

[本轮脱敏证据](native-session-resume-windows-pr725-2026-10-13.evidence.json)与
[PR #721 修复前 Windows 结果](native-session-resume-windows-2026-10-13.md)分别保存。
前一轮 Copilot 失败记录没有改写。本轮共观察到 **51 个成功业务阶段**的真实模型输出标记，
13 类使用现有 sub2api BYOK / `gpt-6`，Kiro、Antigravity 使用原生账户。

## 实际构建与隔离

- 获取的 main 是 `cc465dda562536b94f23787759e3206324baa29e`，已合入 PR #725 的
  `b7fe50854f5cf178c24c1fdf80dd7bb1a9b3f2a2`，且包含 PR #721 的
  `f7b3bf8d89380cea3689eb9ffcdc0ff1c971d632`；两条祖先关系实际检查成功。
- 复用 `C:\Software\CursorProjects\rovai-ai-windows-native-resume-721`，分支
  `rovai/windows-native-resume-721`。将 main 合入既有验收分支后，构建源码提交为
  `30e2ff2dc9fe6827cb8a0566e1ae2ef81ab3c779`。与 main 的 Rust 差异仅为既有 Windows 测试夹具，
  生产 `application.rs` 与 main 相同。
- 执行 `cargo build --locked -p rovai-core --bins`，实际运行本工作区的
  `target/debug/rovai-core.exe`，SHA-256：
  `f174278c0beb50a71f94a2dee51e403ba150a9f6b812b36fd4a599289099975b`。
  测试结束后复核一致；没有用已安装 App 的 Core 替代源码构建。
- Windows 10 Pro 10.0.19045、native x64、C: NTFS；Rust/Cargo 1.97.1、Node 24.19.0，没有 WSL。
- 每项使用全新私有数据根、项目、Camp、测试队员、MCP、原生配置与历史。Core 启动参数显式选择隔离
  `--skill-library-root <core>/managed-skill-library`；该 deferred Revision Library 本轮未物化，
  内置 Skill 实际位于各自 `<core>/skills`。MCP 显式绑定 `<core>/mcp.json`。
- 用本轮 Core 的 `--prepare-windows-data-root` 原生创建目录。包括首次未测 DSH 夹具在内，
  16 个夹具的 root、Core、内置 Skill 目录共 **48 个目录**均为 protected DACL，允许项仅当前用户和 SYSTEM。
- 删除前均已停止对应测试 Core/CLI，核验精确 Session、测试归属与路径，完成私有备份后才删除；
  保留 Core 当前绑定。沿用原有逐 Runtime 原生存储核验，不删除共享目录或共享数据库。
- 日常 App 的四个进程及 `rovai-host.exe` 在测试前后 PID/创建时间一致；结束时测试 Core 为 0。
  主 checkout 原有未跟踪目录与文件保留。进程回收的一次验收误判及复核详见下文。

## 逐 Runtime 真实 CLI 结果

以下 15 项最终原生检查均为 `authenticated`，Core 返回的 Windows x64 平台准入均为 `qualified`，
各自 evidence revision 见 JSON。未绕过准入。排除 Cursor、Cline、Command Code；ZCode 使用官方 App Adapter。

`S` 是原 ID，`S′` 是替换 ID。输入次数按“首轮/同 Core 次轮/冷恢复/缺历史”排列，统计 Core 向 CLI
提交的当前业务输入；能力探测、标题生成及 CLI 内部 HTTP 请求不计作业务重发。
“复用”表示同进程、同 S；“重建→S”表示同 Core 次轮重建原生进程并实际恢复 S，不冒充进程 Warm。

| Runtime / 实测版本 / 可执行来源 | 同 Core 次轮 | 冷恢复实际调用且成功 | 缺历史后的结构化结果 | 新建与绑定 | 提示次数 | 输入次数 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Codex 0.160.0；用户 `.codex/packages/standalone/releases/.../bin/codex.exe` | 复用 S | `thread/resume(S)` | `-32600`，无专用缺失原因 | 0；保留 S | 0 | 1/1/1/0 | 保守边界符合 |
| Claude Code 2.1.288；用户 `.local/bin/claude.exe` | 重建→S | `--resume S` | 初始化控制响应拒绝，无可靠缺失分类 | 0；保留 S | 0 | 1/1/1/0 | 保守边界符合；非进程 Warm |
| Pi 1.0.0；npm `pi.cmd` → 已安装 Node bundle | 复用 S | `switch_session` 精确文件 | Adapter 核验精确历史路径缺失 | 1；S→S′ | 1 | 1/1/1/1 | 降级符合 |
| Copilot 1.0.91；WinGet 官方 `copilot.exe` | 复用 S | `session/load(S)` | `-32002` + `data.uri=Session S not found` | 1；S→S′ | 1 | 1/1/1/1 | PR #725 修复通过 |
| Qwen Code 0.24.7；本地 `qwen.cmd` → 随包 Node/`cli-entry.js` | 复用 S | `session/resume(S)` | `-32002` + `data.uri=session:S` | 1；S→S′ | 1 | 1/1/1/1 | 降级符合 |
| Qoder 1.1.65；用户 `.qoder/bin/qodercli/qodercli.exe` | 复用 S | `session/resume(S)` | `-32602` + `INVALID_SESSION_IDENTIFIER`，S 与项目均匹配 | 1；S→S′ | 1 | 1/1/1/1 | 降级符合 |
| CodeBuddy 2.164.0；本地 `codebuddy/bin/codebuddy.exe` | 复用 S | `session/load(S)` | Adapter 核验精确文件缺失，未向缺失文件发送 load | 1；S→S′ | 1 | 1/1/1/1 | 降级符合 |
| Kimi Code 2.1.1；用户 `.kimi-code/bin/kimi.exe` | 复用 S | `session/resume(S)` | `-32602` + `data.sessionId=S`，无专用原因 | 0；保留 S | 0 | 1/1/1/0 | 保守边界符合 |
| Grok Build 1.0.46 (2765805b9442)；用户 `.grok/bin/grok.exe` | 复用 S | `session/resume(S)` | `-32603` + `FS_NOT_FOUND`，缺可靠目标字段 | 0；保留 S | 0 | 1/1/1/0 | 保守边界符合 |
| Kiro 2.27.1；本地 `Kiro-Cli/kiro-cli.exe` | 重建→S | `session/load(S)` | 普通 `-32603` | 0；保留 S | 0 | 1/1/1/0 | 保守边界符合；非进程 Warm |
| OpenCode 2.0.26；用户 `.local/bin/opencode.exe` | 复用 S | `session/resume(S)` | `-32602` + `data.sessionId=S`，无专用原因 | 0；保留 S | 0 | 1/1/1/0 | 保守边界符合 |
| TRAE 0.120.52 (6756e52)；本地 `trae-cli/bin/trae-cli.exe` | 复用 S | `session/load(S)` | 普通 `-32602` | 0；保留 S | 0 | 1/1/1/0 | 保守边界符合 |
| DeepSeek Harness 0.2.1-alpha.2；npm `dsh.cmd` → `@deepseek-ai/dsh/lib/bin.js` | 复用 S | `session/resume(S)` | 普通 `-32602` | 0；保留 S | 0 | 1/1/1/0 | 保守边界符合；另保留首次探测失败 |
| Antigravity 1.2.16；本地 `agy/bin/agy.exe`，生产 App Adapter | 重建→S | `--conversation S` | 初始化返回不同 ID，Adapter 在输入前拒绝 | 无受控新建；保留 S | 0 | 1/1/1/0 | 保守边界符合；非进程 Warm |
| ZCode 官方 App 3.14.4.7912 / 内置 kernel 0.16.9；`Programs/ZCode/ZCode.exe` → 官方 `resources/glm/zcode.cjs` | 复用 S | 官方 `session/resume(S)` | 原生 `-32004` | 官方 `session/create` 1 次；S→S′ | 1 | 1/1/1/1 | 降级符合；未用独立同名 CLI |

## Copilot 修复的实际证据

1. Warm 复用首轮进程及 S；重启测试 Core 后，真实 `session/load` 携 S，随后业务轮次成功。
2. 停止测试进程，核验 `session.start.data.sessionId` 与项目 cwd，备份并删除该测试的精确 Session 目录。
3. 再次启动后仍先 `session/load(S)`，收到精确目标的 `-32002/data.uri`，未向旧 Session 发业务输入。
4. 恢复进程与替换进程使用不同的 `processId`、`context.json` 和 `run-tmp`；二者在原生 CLI 启动前
   均为未绑定工具上下文，`run-tmp` 与所有 `--add-dir` 目录均存在，cwd 均为含空格的项目目录。
5. 仅观察到一次 `session/new`，新 S′ 正常绑定；持久事件顺序为 `conversation.native_session_bound`
   后 `agent_run.native_session_continuity_lost`。仅提交一次当前输入并成功完成，提示 1 次。

Pi 的真实缺历史分支同样观察到两个独立进程上下文、有效临时目录和一次新建/输入/提示。
其余四条允许降级的真实路径也实际断言新建 1 次、输入 1 次、正常绑定后提示 1 次。

## Windows 差异、未测尝试与回收核验

- Codex 实际进程 cwd 和 `thread/resume.params.cwd` 带 `\\?\` 前缀。证据保留原样；通过 NTFS
  文件身份（device/inode）确认其与普通盘符项目路径为同一目录，没有修改 Adapter 的目标核验。
- Kiro 实际进程 cwd 是 `<core>/runtime/kiro/acp-host/<id>`；其 `session/load.params.cwd` 则为项目目录。
  停止后临时 host 目录已回收，汇总中的目录身份复核值为 null。这里记录两者差异，不把所有 Adapter
  的 cwd 宣称为项目目录，也不把 Kiro 的启动规则套用到 Copilot。
- 记录器保留 HOME/USERPROFILE 和路径拼写。一次性 Adapter 可以在 spawn 前绑定自身 lease；
  ACP/Pi 的“新进程先未绑定”断言没有被错误推广到其他启动协议。
- DSH 首次未开始任何业务 Run：Core 记录 `reported_version=null`、`light_failed`、
  `runtime_version_below_minimum`，后续等待 ready 超时。真实入口另行 `--version` 返回
  `0.2.1-alpha.2`（exit 0，247 ms）。在新夹具中相同版本通过原有准入并完成表中链路。
  初次原因尚未确定，不归因于 PR #725；失败原始记录和 JSON 的 `preflightAttempts` 保留，
  业务输入 0、历史删除 0。没有重发任何已接收或结果未知的业务输入。
- Antigravity 最后一次回收检查最初失败：PID 表将一个更早启动的 OneDrive 服务接到本次新建的
  Git 进程之下。服务出生时间早于该“父进程”，是 PID 复用造成的归属误判。没有停止 OneDrive。
  保留原始 `cleanupFailure`，以记录的 Core PID、完整进程身份和创建时间重新核验：真正测试进程
  均已退出，被排除的无关服务仍在运行。JSON 同时保留初检失败和 `cleanupOwnershipReviews`，
  不伪装成初检直接通过。
- 最小修正仅在验收辅助 `descendantsOf()`：已知子进程出生早于当前父 PID 时不纳入测试树。
  扩展既有 Node owner，覆盖 ISO 与 Windows PowerShell `/Date(...)/` 的实际序列化形式、
  旧进程及其后代、真实新后代和无创建时间的既有行为。先看到失败，再修正并通过；不涉及生产回收代码。

## 模拟协议与 Rust 回归

以下结果独立于真实 LLM 表格，不计作额外真实 CLI 通过。

- `smoke-member-environment-upgrade.mjs --adapter-regressions`：通过。保留 Windows `.cmd` + 原生
  Python 的 UTF-8 夹具，并合入 PR #725 的启动前工具上下文检查。ACP 覆盖恢复明确失败且新建失败
  保留旧绑定、初始化/模型/MCP 的 `incompatible` / `method not found` 不降级、取消/超时/已接收但
  结果未知不重发；Warm 环境 A、保存 B 后仍 A、真正重建后 B 且继续原 ID；仅上下文变化仍恢复原 ID。
  Pi 公聊/私聊 Warm/冷恢复和缺历史替换共 **9 次输入**通过，私聊绑定未被公聊替换影响。
- **19 项定向 Rust owner 实际通过**，命令显式使用 `--features slow-tests --lib <完整名称> -- --exact`，
  每项均检查 `1 passed`。包括恢复策略、新建失败保留旧绑定、未知输入、其他 Camp 不受坏队员阻断、
  Windows 环境键大小写、路径与平台准入，以及 PR #721 的真实 `complete_pending()` 传递链。
- PR #721 的 Windows owner 在 `RUST_BACKTRACE=1` 下实际执行：合成短凭据 `test` 与
  `C:\work test\project`、Session、URI 重叠，原始结构化字段仍正确匹配；Display、Debug、anyhow
  和日志保持脱敏。没有修改真实凭据，没有用 `0 tests` 充数。
- `node --test scripts/lib/qualification-core.test.mjs scripts/lib/native-resume-probe-history.test.mjs`：
  **4 passed**，包含本次 PID 复用回归及原有精确历史删除边界。
- Rust 格式、相关 JavaScript 语法、15 项真实证据断言、公开凭据/用户目录检查、
  `pnpm docs:check`、以 main `cc465dda` 为基线的通用 decision gate 和 `git diff --check` 均通过。
- 默认 `pnpm test:rust:pr` **未通过**：Core lib **451 passed / 1 failed / 8 ignored**，
  后续 workspace target 因该失败未继续。唯一失败是未改动的
  `command_code_acp::tests::native_configuration_tracks_scoped_mod_sources_without_hashing_history`，
  `command_code_acp.rs:615` 返回 Windows `os error 1314`（客户端没有所需特权）。用相同测试二进制
  `--exact` 单独复现为 0 passed / 1 failed；未修改系统权限或扩展生产修复。这里是默认合成测试，
  不是被排除的真实 Command Code CLI 验收。本轮没有重跑 all-features，也没有宣称全量 Rust 通过。

## 复跑与交付

```powershell
cargo build --locked -p rovai-core --bins
rustc scripts/lib/native-resume-launcher.rs -o target/native-resume-launcher.exe
# 使用新的绝对路径，由 Core 原生创建私有根；凭据保持在现有环境中。
.\target\debug\rovai-core.exe --prepare-windows-data-root $privateRoot
node scripts/probe-native-session-resume-windows.mjs copilot-cli $privateRoot --sub2api
```

协议回归先将 `ROVAI_TEST_PYTHON` 指向本机原生 Python，再运行上述 `--adapter-regressions`。
汇总器接受私有 manifest，逐项断言真实冷恢复、输出标记、输入/提示计数、新建绑定顺序与进程归属。
跨源码或跨 Core 哈希的续跑会拒绝，要求新的夹具，以免把新构建结果写到旧基线名下。

本轮没有改动生产恢复实现。公开报告和 JSON 脱敏；配置、精确 ID、原生备份、失败原始结果及完整日志
保留在 ACL 私有根。继续使用 [验收 PR #723](https://github.com/murray17/rovai-ai/pull/723)，
保留 review-ready worktree 与草案 PR，待默认门禁失败和验收辅助修改评审；不自动合并。
