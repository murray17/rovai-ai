---
document_type: research
status: not_qualified
reviewed_at: 2026-10-13
baseline_ref: f7b3bf8d89380cea3689eb9ffcdc0ff1c971d632
---

# Windows 原生 Runtime 会话恢复验收

本机原生 Windows 上，15 类 Runtime 均完成了真实 LLM 首轮、同 Core 次轮和携带原 Session ID
的冷恢复。13 类使用现有 sub2api BYOK 的 `gpt-6`；Kiro、Antigravity 使用已认证原生账户。
删除真实历史后，Pi、CodeBuddy、Qwen、Qoder、ZCode 五类完成一次新建、绑定切换和一次提示；
其余九类保留原绑定报错。**Copilot 正确识别缺历史，但降级进程的 `--add-dir` 目录已消失，
新建未完成；旧绑定保留、提示 0 次、业务输入 0 次。** 本报告不声明所有项目通过。

[脱敏证据](native-session-resume-windows-2026-10-13.evidence.json)保存每轮原 ID 调用、输入交付、
提示、进程关系、原生结构化错误、删除目标和私有原始结果摘要。每个成功阶段都观察到真实输出中的
验收标记；部分标记跨流式帧，因此同时核对 Core 已组装的模型 narration。Antigravity 的标记来自
原生输出帧。这里没有用模拟模型替代真实 CLI。

## 基线、平台与隔离

- 系统：Windows 10 Pro 10.0.19045，x64，本地 C: NTFS；未使用 WSL。
- 独立 worktree：`rovai-ai-windows-native-resume-721`；分支 `rovai/windows-native-resume-721`。
  测试二进制从 PR #721 合并提交 `f7b3bf8d89380cea3689eb9ffcdc0ff1c971d632` 构建。
  后续文件改动仅为测试、验收脚本和报告，未修改生产实现。
- 构建：`cargo build --locked -p rovai-core --bins`。实际测试的 `target/debug/rovai-core.exe`
  SHA-256 为 `6ecf83c6ed78fd861597246b45c5e9bfcdad79a8d44fae375d1cd507fbb497ca`，结束时复核相同。
  没有使用日常安装包的 Core 代替。Rust/Cargo 1.97.1，Node.js 24.19.0。
- 15 项均由该 Core 的 `health.check.runtimePlatformAdmission` 返回 Windows x64 `qualified`。
  证据保留各自 `evidenceRevision`。没有调整注册表、强制准入或修改真实服务凭据。
- 每项拥有独立 Core 数据、Skill Library、MCP 文件、Runtime 文件根、项目、Camp 和测试队员。
  使用 Core `--prepare-windows-data-root` 创建私有根；最终 15 个根均为受保护 DACL，只有当前用户
  与 SYSTEM 的允许项。项目及多级父路径包含空格。
- 主 checkout 的原有未跟踪目录及文件保持不变。结束时本次验收 Core 为 0 个，日常 App 的 4 个
  进程仍在；未停止承载工作的日常 Rovai。所有选定案例的已登记 Core/CLI 进程身份均已回收。

本轮排除 Cursor、Cline、Command Code。没有“未安装/未认证/未准入”导致的未测行；早期网关不可用、
账户余额不足、夹具配置失败和中断记录均保留在私有目录，未替换为成功记录。后续使用新的夹具及
新的业务输入；中断、超时或结果未知的旧输入没有自动重发。

## 逐 Runtime 真实 CLI 结果

`S` 表示首轮生成的原生 ID，`S′` 表示一次成功新建后的 ID。所有行的 Windows 准入均为
`qualified`，最终所用原生检查均返回 `authenticated`。输入列依次为“首轮/同 Core 次轮/冷恢复/缺历史”，
统计 Core 到 CLI 的业务请求，不把 CLI 内部网络请求、标题生成或能力探测算作业务重发。

“复用”表示观察到相同 CLI 进程承载次轮；“重建→S”表示同 Core 内重建 CLI 并实际恢复 S，不能算作
进程 Warm 复用。Claude、Kiro、Antigravity 属于后者；其他 12 类观察到实际进程复用。

| Runtime / 实测版本 / 可执行来源 | 同 Core 次轮 | 冷恢复实际调用，随后成功 | 删除历史后的结构化结果 | 新建与绑定 | 提示 | 输入次数 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Codex 0.160.0；用户 `.codex/packages/standalone/releases/.../bin/codex.exe` | 复用，S | `thread/resume(S)` | `-32600`，没有专用不可恢复原因 | 无；保留 S | 0 | 1/1/1/0 | 保守边界符合 |
| Claude Code 2.1.288；用户 `.local/bin/claude.exe` | 重建→S | `--resume S` | 初始化控制响应拒绝；无可靠结构化缺失分类 | 无；保留 S | 0 | 1/1/1/0 | 保守边界符合；未实现本次进程 Warm 复用 |
| Pi 1.0.0；npm `pi.cmd` → 已安装 Node bundle | 复用，S | `switch_session` 指向 S 的原生文件 | Adapter 精确路径核验缺失 | `new_session` 一次成功；S→S′ | 1 | 1/1/1/1 | 降级符合 |
| Copilot 1.0.91；WinGet 官方 `copilot.exe` | 复用，S | `session/load(S)` | `-32002`，`data.uri=Session S not found`，目标匹配 | 降级启动一次，初始化失败；`session/new` 0 次；保留 S | 0 | 1/1/1/0 | 缺陷，见下文；失败保护符合 |
| Qwen Code 0.24.7；本地 `qwen-code/bin/qwen.cmd` → 随包 Node/`cli-entry.js` | 复用，S | `session/resume(S)` | `-32002`，`data.uri=session:S` | 一次成功；S→S′ | 1 | 1/1/1/1 | 降级符合 |
| Qoder 1.1.65；用户 `.qoder/bin/qodercli/qodercli.exe` | 复用，S | `session/resume(S)` | `-32602` + `INVALID_SESSION_IDENTIFIER`，Session 与 Windows 项目路径均匹配 | 一次成功；S→S′ | 1 | 1/1/1/1 | 降级符合 |
| CodeBuddy 2.164.0；本地 `codebuddy/bin/codebuddy.exe` | 复用，S | `session/load(S)` | Adapter 核验该运行环境下精确原生文件缺失，未向不存在目标发 load | 一次成功；S→S′ | 1 | 1/1/1/1 | 降级符合 |
| Kimi Code 2.1.1；用户 `.kimi-code/bin/kimi.exe` | 复用，S | `session/resume(S)` | `-32602` + `data.sessionId=S`，无专用原因码 | 无；保留 S | 0 | 1/1/1/0 | 保守边界符合 |
| Grok Build 1.0.46 (2765805b9442)；用户 `.grok/bin/grok.exe` | 复用，S | `session/resume(S)` | `-32603` + `FS_NOT_FOUND`；detail 为 Windows 系统路径错误，没有可靠目标字段 | 无；保留 S | 0 | 1/1/1/0 | 保守边界符合 |
| Kiro 2.27.1；本地 `Kiro-Cli/kiro-cli.exe` | 重建→S | `session/load(S)` | `-32603`，data 为普通错误文本 | 无；保留 S | 0 | 1/1/1/0 | 保守边界符合；未实现本次进程 Warm 复用 |
| OpenCode 2.0.26；用户 `.local/bin/opencode.exe` | 复用，S | `session/resume(S)` | `-32602` + `data.sessionId=S`，无专用原因码 | 无；保留 S | 0 | 1/1/1/0 | 保守边界符合 |
| TRAE 0.120.52 (6756e52)；本地 `trae-cli/bin/trae-cli.exe` | 复用，S | `session/load(S)` | `-32602`，data 为 `session not found` 普通文本 | 无；保留 S | 0 | 1/1/1/0 | 保守边界符合 |
| DeepSeek Harness 0.2.1-alpha.2；npm `dsh.cmd` → 已安装 `@deepseek-ai/dsh/lib/bin.js` | 复用，S | `session/resume(S)` | 普通 `-32602`，无结构化缺失依据 | 无；保留 S | 0 | 1/1/1/0 | 保守边界符合 |
| Antigravity 1.2.16；本地 `agy/bin/agy.exe`，生产 App Adapter | 重建→S | `--conversation S` | 原生初始化返回另一 ID，Adapter 在提交业务输入前拒绝 | 无受控新建；保留 S | 0 | 1/1/1/0 | 保守边界符合；未实现本次进程 Warm 复用 |
| ZCode 官方 App 3.14.4.7912，内置 kernel 0.16.9；`Programs/ZCode/ZCode.exe` → 官方 `resources/glm/zcode.cjs` | 复用，S | 官方 `session/resume(S)` | 原生 `-32004 sessionUnavailable` | 官方 `session/create` 一次成功；S→S′ | 1 | 1/1/1/1 | 降级符合；没有使用独立同名 CLI |

以上成功业务阶段共 50 个。九类保守报错不是自动新建通过，也没有为了提高通过数增加错误文本猜测。
Antigravity 可能在自身恢复入口生成其他 ID，但 Rovai 未接受该目标；此行为与 Core 主动新建须分开理解。

## Copilot 降级启动失败

真实初测和同一隔离 Camp 的一次新输入复现，均出现相同结果：

1. `session/load(S)` 返回定义明确的 `-32002`，URI 精确对应 S。
2. Core 进入一次 replacement 启动。两个 CLI 启动的 `--add-dir` 包含相同的本次
   `<core>/runtime/builtin-tools/<process>/run-tmp`。
3. 记录器在第一次 spawn 前观察该目录存在，在第二次 spawn 前观察其不存在。
   Copilot 拒绝参数，报 `Directory does not exist or cannot be accessed`；第二次只观察到 initialize 请求，
   没有 `session/new` 和业务 prompt。
4. 原绑定 S 保留，连续性成功提示为 0，两个失败 Run 的业务输入各为 0。

已运行的快速复现命令（对私有 manifest 中 Copilot 的已完成缺历史夹具执行）：

```powershell
node scripts/probe-native-session-resume-windows.mjs copilot-cli $privateRoot --sub2api --reproduce-replacement-failure
```

该模式核验前次结果确定失败且 CLI 未接收业务输入，再创建**另一条具有新编号的验收输入**。
本次退出码 1，`replacementFailureReproduced=true`；输出不是重发前次输入。

诊断范围到可复现证据及最小修复建议为止，未改生产代码。候选原因按证据强度排序：

1. 旧 Host 清理后，replacement 复用了失效的 Built-in Tool 进程目录。预测：为 replacement 建立新进程
   上下文并使用对应的目录，第二次初始化才能继续；已观察到同路径从存在变为不存在。
2. ACL 拒绝访问。预测：目录还存在而仅新进程无法访问。现有存在性记录及第一进程正常工作不支持此解释，
   但没有把它写成已独立完成 ACL 故障注入的结论。
3. Windows 参数拼写发生变化。预测：两次参数不同；此次记录中的路径拼写相同。

静态定位是 `application.rs` 的恢复拒绝分支：`forget_agent_run` 后再次调用
`ensure_agent_run_runtime` 时仍传入之前的 `builtin_tools`。最小候选修复是让 replacement 的 Built-in
Tool 进程上下文和 `--add-dir` 在旧 Host 回收后重新准备，并由新的上下文承载新绑定；保留原有
“成功后才切换绑定、失败保留旧目标、输入只提交一次”的事务顺序。应在现有 replacement 进程夹具里
加入第二次启动要求目录真实存在的断言。此建议尚未实施或验证，不推广成其他 Runtime 已确认缺陷。

## Windows 存储、启动及删除核验

- 首轮业务成功、Warm/冷恢复成功及原 ID 调用成立后，才执行删除。停止本次 Core，按 PID、启动时间
  等身份确认测试树已退出，然后核验 Session ID、项目归属及精确路径，备份到同一私有夹具，最后删除。
  Core 当前原生绑定没有清空。无法核验时，脚本先停止该子测试。
- Copilot：读取 `events.jsonl` 的 `session.start.data.sessionId` 和 `context.cwd`，删除精确 Session
  目录。Grok：同时核验事件里的 Session ID 和 `prompt_context.json.working_directory`，删除该完整
  Session 目录；早期仅删除事件/usage 的不完整尝试作废，重新建立独立会话完成实测。
- DeepSeek Harness：解压 `session.v4.jsonl.zstd`，按真实头记录的精确 ID 和 cwd 选中历史文件；
  没有通过目录名子串猜测归属。Pi、Codex、Claude、Kimi、Qwen、Qoder、CodeBuddy、Kiro 的文件目标
  同样由解析出的精确 ID 选取；随后真实恢复错误/降级提供加载行为证据。
- OpenCode 2.0.26 使用 `session_v2` 表；ZCode 使用隔离 `sessions.sqlite`。删除的是本轮新建的私有
  数据库及 sidecar。所有根 Session 必须是当前测试目标或同夹具协议日志已观察到的探测 Session，
  然后才允许备份和移除。未删除共享数据库。
- Antigravity 沿用本机原生存储，在精确 `<S>.db` 中核验 `trajectory_meta` 唯一 ID，结合本轮 fresh
  binding 与冷恢复证据，只备份并移除该测试数据库及存在的 sidecar；未删除共享 conversations 根。
- 记录实际 `.exe`、npm/官方 `.cmd` shim 与对应 Node 入口。透明记录器不改变业务协议字节；最终
  Windows native launcher 使用实际安装 CLI 的版本输出。ZCode 直接使用真实 `node.exe` 加只观察
  stdin/stdout 的 preload，实际 kernel 始终来自官方 App。
- 夹具修正记录：`.cmd` 记录器影响部分 Core 版本探测；Rust `current_exe()` 的 Win32 verbatim
  前缀不适合作为 Node 入口路径；`NODE_OPTIONS` 的反斜杠会被转义，改用等价正斜杠路径。
  这些启动失败均在业务输入前发生，已与最终真实结果分开。未修改生产目标核验。
- 检查 HOME/USERPROFILE 及原生配置目录覆盖。TRAE 在私有 HOME/USERPROFILE/AppData 内使用 BYOK；
  其他 Runtime 使用自身官方配置根，ZCode 使用独立 Provider Config/数据库。环境键大小写由现有
  Windows overlay 测试验证；A/B 冻结由下述协议回归验证，不能标作真实 CLI 的 A/B 故障注入。

## BYOK 配置依据及范围

本机 sub2api `/v1/models` 成功返回 GPT 模型列表，单次真实 `/v1/responses` 可用性检查由 `gpt-6`
返回期望标记。凭据只从现有环境读取，并仅写入 ACL 保护的隔离配置；公开证据没有密钥。
Kimi 按[官方环境变量接口](https://moonshotai.github.io/kimi-code/en/configuration/env-vars.html)选择
临时模型；Copilot 按[官方 BYOK 接口](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/copilot-cli/customize-copilot/use-byok-models)
设置 Responses；TRAE 使用[官方自定义模型配置](https://docs.trae.cn/cli_model)。其他配置由本机 CLI
自带配置/帮助及已安装实现核对，实际成功响应才计入验收。

Kiro 使用现有账户，本次未找到该安装版本支持外部 sub2api endpoint 的原生接口。
Antigravity 官方只接受 Gemini BYOK provider，见[官方认证与自定义端点文档](https://www.antigravity.google/docs/cli/install/)。
本机 sub2api 的 Gemini models 请求返回 HTTP 400 / `INVALID_ARGUMENT`，明确原因是
`API key group platform is not gemini`，因此用已认证原生账户完成真实 LLM 验收。

## 模拟协议和定向 Rust 回归

以下与上面的真实 CLI 结果分开：它们使用隔离协议夹具或数据库/纯函数测试，不代表额外真实 LLM 通过。

- 原有 `smoke-member-environment-upgrade.mjs --adapter-regressions` 已适配 native Windows
  `.cmd` + 系统原生 Python，显式 UTF-8；没有 WSL。ACP 矩阵验证明确拒绝后新建一次、新建失败保留旧绑定、
  初始化/模型/MCP 的 `incompatible` / `method not found` 不降级、取消/超时/输入已接收但未知不重发。
  Pi 原有公开/私有两条会话共 8 次输入的 Warm/冷恢复断言通过。
- 扩展原有 ACP owner：Warm 进程保持环境 A；保存 B 后次轮仍为同 PID/A/原 ID；真正重启后为新 PID/B，
  仍尝试原 ID。只改变隔离 conversation compatibility/bootstrap digest 后，也观察到原 ID 的 load。
- PR #721：Windows 原生 Host 的 `complete_pending()` → oneshot → `AcpRpcError` → 精确目标分类
  链实际执行。短凭据 `test` 与 `session-test`、`C:\work test\project`、资源 URI 重叠；另有凭据与
  `INVALID_SESSION_IDENTIFIER` 重叠。Qoder、Copilot、Qwen 原始结构化字段仍可匹配目标；错误 Display、
  Debug、anyhow 格式和 HostDiagnostic 日志均脱敏。只使用合成凭据，没有改动真实服务凭据。
- 唯一新增 Windows Rust owner 是此前 Unix gate 无法执行的真实 Windows Host/transport seam；输入矩阵
  抽成共享 helper，由原 Unix terminal owner 和新 Windows owner 调用。两个既有纯/文件边界测试迁到
  跨平台模块，保留原有正反例及边界。Pi 的既有文件夹具改用 Windows 私有目录创建流程。
- 最終 19 项相关定向 Rust 测试通过，包括前述脱敏、replacement 失败保留绑定、未知输入不重发、一个
  队员配置失败不阻断其他 Camp、配置/安装变化不取消恢复、历史失败不取消新尝试、Windows 环境键大小写、
  路径拼写、平台准入。每条定向命令都有非零实际测试数；新 Windows 脱敏 owner 单独执行 **1 passed**。
- `node --test scripts/lib/native-resume-probe-history.test.mjs`：**1 passed**。证据汇总器还对 15 项冷恢复
  的真实原 ID、成功输出标记、每阶段至多一次业务输入/提示以及进程回收作了实际断言。

额外执行了 `cargo test --locked --workspace --all-features`，**没有通过**：停止时已完成 317 pass / 21 fail，
还有未完成的慢测试。失败涉及未改动的 file-change、application、migration、camp-history owner。
已单独复现未改动的 `agent_run_file_change::tests::discontinuous_full_states_degrade_only_that_file_to_operation_history`
在 Windows 上于 `agent_run_file_change.rs:1778` 的 `Option::unwrap()` 失败（1 个测试实际执行）。
发现这些范围外失败后，停止了精确归属于本次额外 suite 的测试进程；没有把部分结果或 0 tests 写成全量通过，
也没有为了收绿扩展生产改动。额外套件的运行日志、失败名清单及单项复现输出保留于本 worktree，未公开。

## 可复跑入口与交付状态

```powershell
cargo build --locked -p rovai-core --bins
rustc scripts/lib/native-resume-launcher.rs -o target/native-resume-launcher.exe
# $privateRoot 必须是新的绝对路径；先由 Core 创建 Windows 私有根。
.\target\debug\rovai-core.exe --prepare-windows-data-root $privateRoot
node scripts/probe-native-session-resume-windows.mjs qwen-code $privateRoot --sub2api
cargo test --locked -p rovai-core --features extended-tests --lib native_windows_complete_pending
```

协议回归使用 `ROVAI_TEST_PYTHON` 指向已安装的 Windows 原生 Python 可执行文件：

```powershell
node scripts/smoke-member-environment-upgrade.mjs --adapter-regressions
```

私有原始结果、认证配置、精确 ID、日志及原生备份保留在测试私有根，不提交仓库。公开 evidence 由
`scripts/summarize-native-session-resume-windows.mjs` 按显式私有 manifest 生成，替换用户路径、Session/Camp
标识并检查已知凭据未出现。工作状态为 review-ready，保留独立 worktree；不修改日常安装，不合入生产修复。
