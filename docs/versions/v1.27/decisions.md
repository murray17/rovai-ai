---
document_type: version-decisions
version: v1.27
lifecycle: current
last_updated: 2026-08-22
---

# v1.27 决策记录

本文件只记录本版本满足准入门槛的重要取舍；当前行为规范由链接的 Architecture 与 Contract 拥有。

<a id="v1-27-d01"></a>
## V1.27-D01：Provider 凭据只进入私有进程配置，Kimi Session 采用 `new_only`

### 背景

Kimi Code 可以通过环境变量配置 OpenAI-compatible provider。用户要用 MiniMax Token Plan 做真实本地验收，
但把 token 写入仓库、数据库、命令行、日志或共享 `~/.kimi/config.toml` 都会扩大秘密暴露面。另一方面，
Kimi native resume 依赖同一 Kimi home。真实 Probe 已证明新进程复用同一 home 时 exact resume 成功并保留
上下文，而 Rovai 为每个 Host 创建新的隔离 home 后会稳定得到 `Unknown sessionId`。

### 决定

1. Rovai 只从权限收窄的外部 env 文件读取六个显式 `KIMI_MODEL_*` 键，并只注入 Kimi 子进程；
   `KIMI_MODEL_CAPABILITIES=thinking` 只声明能力，Rovai 不强制关闭 Kimi/MiniMax thinking；
2. 默认文件为 `~/.config/rovai/kimi-code.env`，可由 `ROVAI_KIMI_CONFIG` 覆盖；内容不进入数据库、Evidence、
   diagnostics、命令或 Git；未知、重复、空值和权限过宽都 fail closed；
3. 每个 Kimi Host 使用新的隔离 `KIMI_CODE_HOME`，Run terminal 后停止并清理；
4. 当前 continuation strategy 固定为 `new_only`，snapshot 不声明 `session.resume`；Rovai portable context 仍按
   既有合同送入新 Session；
5. Catalog identity 与平台资格分离。macOS arm64 虽通过基础 ACP 行为验收，但在完整 Built-in CLI matrix
   建立合格 evidence 前保持 `not_qualified / runtime_platform.builtin_transport_unqualified`；其他平台独立取证。

当前规范见 [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)与
[Runtime Launch and Verification v20](../../contracts/runtime-launch-and-verification-v20.md)。

### 后果

- 用户原有 Kimi 配置和认证状态保持不变，密钥暴露面限制在私有文件与目标子进程；
- 每个 Run 有确定性隔离和清理，代价是暂不复用 Kimi native conversation；
- 未来要启用 resume 必须先设计稳定隔离 home/binding，并以新证据和合同版本准入；
- Catalog identity 与逐平台 qualification 继续分离。
- Product Runtime 普通路径不会启动 Kimi；直接真实模型诊断不改变准入状态。

### 被拒绝方案

- **把 token 存入成员 Runtime 参数或数据库：** 会把秘密带入持久投影、诊断和备份面；
- **复用或改写 `~/.kimi/config.toml`：** 会污染用户日常 Kimi 环境并破坏验收隔离；
- **通过命令行参数传 token：** 容易进入进程列表与命令 Evidence；
- **仅凭同一 home 的 `session/resume`/`session/load` 成功就声明产品 continuation：** 这会绕过当前每 Host
  私有 home 的隔离与 compatibility 边界；跨隔离 home 的真实结果仍是 `Unknown sessionId`。

<a id="v1-27-d02"></a>
## V1.27-D02：Kimi 使用稳定私有 Session home，并在新 Host 精确恢复原 Session

### 背景

D01 把 Kimi 原始 resume 能力与 Rovai 产品语义严格分离是正确的，但它选择的每 Host UUID home 同时删除了
Runtime 恢复 Session 所必需的本地状态。AgentRun terminal 后停止 Host 并不要求更换 Runtime 专用 home；
“新进程 + 人为换 home + resume 失败”也不是 Rovai 的实际产品需求。其他 Runtime 的 continuation 同样以
兼容逻辑会话和稳定原生状态为前提，不把刻意破坏状态目录作为必须支持的场景。

真实 Kimi `0.32.0` 已证明新进程复用同一 home 时 `session/resume` 与 `session/load` 都保持精确 Session ID。
修复后的产品级 fake Runtime 回归进一步证明：两个 AgentRun 使用不同 Host instance、相同私有 home，协议依次
执行 `session/new` 与 `session/resume`，Native Session ID 不变。

### 决定

1. D01 的 provider allowlist、secret 不落库、不改写用户 `~/.kimi/config.toml`、thinking 清洗和平台准入结论
   保持有效；本决定只替代 D01 第 3、4 项的 home/continuation 语义；
2. Kimi `KIMI_CODE_HOME` 使用 Rovai data-dir 下的稳定私有 Session home，scope 绑定 Camp、成员、Runtime
   installation 与 auth scope，并用 canonical digest 作为目录名；不改变进程通用 `HOME`；
3. AgentRun terminal 前仍停止 Kimi Host，但 Host shutdown 不删除该 Session home；不同 scope 不共享；
4. snapshot 保留 Runtime 实际声明的 `session.resume/load`。新 Host 优先 exact resume；只有 resume 不可用时
   才允许 load 进入既有 History Restore quarantine；不同 Session ID 或协议异常 fail closed；
5. 该修复不启用 warm Host、External MCP、Built-in transport、Usage/Cost 或 Compaction，也不改变任何平台
   `not_qualified` 结论；异步 command catalog 未成为产品 snapshot 不是 continuation 或启动硬阻断。

当前规范见 [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)与
[Runtime Launch and Verification v21](../../contracts/runtime-launch-and-verification-v21.md)。

### 后果

- 同一兼容逻辑会话跨 Run/进程复用原 Native Session，不再因 Rovai 自己轮换 home 而丢失上下文；
- 进程生命周期仍是每 Run 回收，Session 生命周期与 Host 生命周期明确分离；
- 私有 home 会跨 Host 保留，需要后续定义无绑定 Session home 的有界垃圾回收；当前不能在单个 Host shutdown
  中删除；
- Built-in CLI 的 `0/15` 资格失败仍是 macOS arm64 唯一已确认硬阻断。

### 被拒绝方案

- **继续每 Host 新建并删除 home：** 会确定性破坏 Kimi 的原生 Session 恢复前提；
- **要求跨不同 home 恢复同一 Session：** 不是当前产品场景，也与 Kimi 的 Session 存储模型冲突；
- **为了 continuation 保留 warm Host：** 增加进程状态与清理复杂度，没有必要；冷 Host exact resume 已足够；
- **直接使用或改写用户 `~/.kimi`：** 会重新扩大配置污染与秘密边界，稳定 Rovai 私有 home 已能满足恢复。

<a id="v1-27-d03"></a>
## V1.27-D03：修正过期 Built-in fixture，并准入 Kimi macOS arm64

### 背景

D01、D02 把 Kimi macOS arm64 保持为未准入，是因为三次完整 Built-in 资格运行未取得 operation evidence。
对失败 fixture 的逐步诊断后来证明，Kimi 已启动 Shell 并执行 bundled 验收脚本；脚本在第一项 canonical
operation 前检查 legacy stdin 非法输入，却仍期待旧退出码 `1`。当前 CLI 合同对该输入返回结构化
`fix_input` 与退出码 `2`，与 direct-flag 非法输入一致。所谓“两次模型跳过 shell、`0/15`”因此是过期
fixture 提前退出造成的错误归因，不是 Kimi transport 行为。

把断言修正为 `2` 后，同一 `kimi 0.32.0` + MiniMax M3 安装完整通过十五项 operation，并产生 56 条
full-run evidence；三种输入模式、Gather capture、精确后继寻址、stale-version conflict、initial/resumed
lease fencing、logical conversation 与跨新 Host native Session continuation 全部通过。

### 决定

1. D01 第 5 项与 D02 第 5 项中关于 Kimi macOS arm64 平台未准入、Built-in transport 未启用的结论由本决定
   替代；provider、thinking、stable private home、cold exact resume、External MCP、Usage/Cost、Compaction 和
   warm Host 边界保持不变；
2. `kimi-code-cli × macos-arm64` 晋升为 `qualified`，evidence revision 绑定当前
   `docs/runtime-compatibility.md` 的 SHA-256 digest；macOS x64 与 Windows x64 仍为
   `not_qualified / runtime_platform.qualification_evidence_missing`；
3. Kimi capability snapshot 声明 Built-in transport；默认 Built-in CLI 与 `smoke:skills all` 资格集合包含
   Kimi。External MCP capability 仍不声明；
4. 异步 `available_commands_update` 已安全路由但尚未形成产品权威 catalog snapshot。它是独立功能空缺，
   不是启动、continuation、Built-in transport 或 macOS arm64 准入阻断；
5. 以后资格失败必须先保留并定位 Runtime 是否实际执行、脚本停止在哪个 contract assertion，再把 `0/N`
   归因给模型或 transport。

当前规范见 [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)与
[Runtime Launch and Verification v21](../../contracts/runtime-launch-and-verification-v21.md)。

### 后果

- macOS arm64 普通产品路径可以 discovery、配置、Probe 和执行 Kimi；
- Built-in transport 不再是 Kimi 遗留阻断；默认资格 Smoke 会持续覆盖该 Runtime；
- macOS x64、Windows x64 仍需独立行为矩阵，不能从 arm64 外推；
- 保留 closed `runtime_platform.builtin_transport_unqualified` reason code，不代表当前 Kimi 行仍使用它。

### 被拒绝方案

- **维持旧未准入结论：** 已与修正后完整资格证据冲突；
- **只把 15/15 写入文档而不进入默认矩阵：** 会让未来回归不再覆盖刚建立的资格；
- **同时开启 External MCP 或 telemetry：** Built-in CLI 证据不证明这些独立能力轴；
- **把 macOS arm64 结果外推到 x64/Windows：** 违反逐 Adapter、逐平台资格合同。
