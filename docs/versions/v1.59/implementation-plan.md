---
document_type: implementation-plan
version: v1.59
lifecycle: current
authority: version-implementation-plan
status: in_progress
last_updated: 2026-09-12
---

# v1.59 实施与验收

范围见[版本概览](README.md)，边界见[统一 Host](../../architecture/unified-rust-host.md)。
实现工作目录为仓库同级 `rovai-ai-unified-rust-host`，分支 `rovai/unified-rust-host`，
起点 `a18425ec78ae2e1a0666b2c029564ff3f7bc8f78`。验收只使用隔离 data-dir、Skill Library 和 MCP config。

## 检查点与完成条件

| 阶段 | 工作与放行条件 | 状态 |
| --- | --- | --- |
| 1A 共享 Core | 抽取应用运行层，普通串行入口与必要独立通道不变；旧 Desktop 准入、重复实例、执行、关闭回归；补齐 Main 迁移表及窄接口 | 实施中 |
| 1A 平台原型 | Windows/Linux 实测文件、环境/句柄、必要进程访问、IPC 冒用、管理恢复、授权工作区与后代回收；失败先由用户确认最小修正 | 待环境与执行 |
| 1B Headless | 空目录初始化与原生 Runtime 认证；真实发送、产物、审批、取消、受控关闭、强杀恢复；无 Electron/基础 Node 依赖 | 初始 CLI 在 macOS 验证；真实执行未验收 |
| 1C Web 闭环 | 同一 Axum 模块、内存 Bearer、受限 Fetch、上传 source ref、草稿归属、SSE 与宽屏闭环；第二台 LAN 电脑使用 | 未开始 |
| 2 Desktop 共用 | 受保护本机 IPC、同 Host Web 开关与会话管理；关闭 Web 不停 Core，bind 失败不毁 Desktop；保留退出与父进程异常语义 | 未开始 |
| 3 宽屏完整性 | Camp/成员/Task/Runtime/Memory/Automation/Skills/MCP 与必要设置；声明能力矩阵；多端、私聊归属、审批竞争和迟到响应回归 | 未开始 |
| 4 三平台发布 | macOS arm64/x64、Windows x64、Linux x64 实际 CLI Server 闭环与匹配 Host/Web 包；平台/Runtime/部署方式分别留证 | 未开始 |
| 5 Mobile | 共享组件与双主题，360–430px 核心闭环；真实 iOS Safari/Android Chrome 分别连接两种 Web Host，挂起/网络切换不重发命令 | 未开始 |

1C 的基础门禁不能后移：两标签页互不覆盖，伪造归属不能读/写/绑定/消费；陈旧 revision 不消费新内容；
响应丢失按原 commandId 查回执；上传绑定结果未知不误删；源文件消失显示不可用；凭据不进入其他 origin、端口、
重定向、URL 或日志；撤销关闭 SSE；快照与水位无缺口、慢订阅有界；匿名/越权/失效审批和路径逃逸被拒绝。

三平台发布固定 OS 与库基线，Linux 首批实测 Codex CLI/Claude Code。Linux 原生通过后提供 systemd 示例，
非 root 容器部署单独验证，不从原生或 Desktop 资格推导。缺一目标平台证据，阶段 4 保持未完成。

## Main 迁移表

| 当前职责/入口 | 去向与阶段 | 回归证据要求 |
| --- | --- | --- |
| `CoreClient`、`FullCoreSupervisor` | 1A 旧 stdio 适配；2 Host IPC 与 Desktop 监督 | ready/blocked、generation、重复实例、错误与退出 |
| `main/index.ts` Automation scheduler tick、powerMonitor | 1B Host 时钟；2 Desktop suspend/resume 适配 | 无浏览器仍触发，恢复不重复触发 |
| 日报、EvaluationHost 驱动 | 保留可选 Desktop 适配；初始 Headless 关闭 | Desktop 现有驱动和 Core 事实仍可用 |
| 渠道网络、Pump、Outbox、只读执行台 | 初始 Desktop 适配；Headless 未迁移能力关闭 | 旧渠道入口与只读权限不升级 |
| UserAutomationServer | 受保护 Host 用户控制面；窗口导航留 Desktop | Agent 身份不能冒用用户身份或恢复凭据 |
| ProjectAccess、文件与附件 | Core/Host 授权服务，原生选择/open/reveal 留 Desktop | 精确资源授权及 source ref 原语义 |
| 当前用户、成员/Runtime 业务配置 | 1C/3 共享应用服务 | 空目录配置且无需 Electron |
| 头像、FilePreview、首次配置壳层 | 共享资源授权与平台能力适配 | HostCapabilities 诚实禁用不可用入口 |
| 窗口/菜单/托盘/剪贴板/更新/退出 | 留 Desktop 平台层 | close-only、主动退出、升级与草稿 fence |
| 导航偏好、主题、窗口/页面状态 | 对应客户端本地状态 | Host/连接代次隔离；不变为业务权威 |

## 验证记录

- Core 入口与其单测迁入 library；原有测试保留，所有权随应用运行层移动，未新增重复测试或禁用既有测试。
- 机械库化及显式配置/传输抽取通过工作区默认 feature 全目标编译；后续修改继续回归。
- 新增 transport 单测拥有断开不取消已准入请求、乱序回执归属、未启动 runner 退出和事件缓冲缺口；
  原 stdio 进程测试无法覆盖进程内句柄生命周期，因此使用不打开数据库/文件/Runtime 的最低成本 owner。
  最小验证：`cargo test -p rovai-core --lib application::transport::tests::`。
- Windows/Linux 实际连接入口待提供；本机未发现可用容器/虚拟机工具。
- 旧 stdio 隔离启动回归完整复验：`node --test scripts/lib/core-startup-availability.test.mjs`，
  9 通过、0 失败、1 既有平台跳过；两个 save RPC fixture 已改用当前 ComposerDocument V2，
  数据库中的旧格式恢复 fixture 保留。`pnpm build:desktop` 通过。
- 工作区 slow feature 全目标编译、Clippy `-D warnings` 和 `pnpm typecheck` 通过。
  全量 library 先前为 791 通过、1 失败、5 既有忽略；唯一失败的现有 macOS sandbox 测试在受管
  Runtime 内收到 `sandbox_apply: Operation not permitted`，最小空策略也失败。未禁用或判为通过。
  外部终端复验尚未执行：电脑控制工具明确拒绝操作 iTerm2，属于工具限制，不是平台隔离结论。
- 2026-09-12 在当前执行环境复验：最小 `sandbox-exec` 空策略成功；既有
  `managed_process::tests::macos_runtime_sandbox_denies_user_automation_root_but_keeps_other_files_visible`
  精确测试 1 通过、0 失败、0 忽略。此前这项 macOS 环境阻塞已解除；Windows/Linux 及其余控制面隔离仍未验收。
- 初始 `rovai-host run` 在进程内组装共享 Core，显式路径与 `--initialize` 沿用原准入，Unix/Windows
  console 停止适配走既有 protocol 3；[CLI 生命周期合同](../../contracts/host-lifecycle-v1.md)与唯一测试
  owner `scripts/lib/host-lifecycle.test.mjs` 同步。测试必须经过真实 Host 进程/信号，原 stdio 与纯传输测试
  无法证明该 seam；复用临时目录规则，不新增 Rust fixture。最小命令为 `pnpm test:host-startup`。
  Web、用户 IPC、管理凭据和 Automation 时钟尚未接入，阶段 1B 不因此放行。
- 同日 `cargo test --workspace`：Core 792 通过、0 失败、5 既有忽略；CLI 35 通过、0 失败。
  随后修正库化中可选 Skill 清理参数错误的归属：捕获解析错误并在原 Skills 初始化边界降级，
  不升级成 authority 启动失败。扩展既有纯配置测试覆盖缺少值与相对路径，定向测试通过，未新增数据库 fixture。
- 最新二进制完整构建与 stdio/Host 进程联合回归：10 通过、0 失败、1 既有平台跳过；Host 证明显式初始化、
  默认拒绝缺失 authority、重复目录拒绝、SIGTERM/SIGINT 受控关闭与再次打开，不调用模型。
  `cargo clippy --workspace --all-targets -- -D warnings` 与 slow feature 全目标编译通过。
- `pnpm test` 通过：Vitest 173 文件 / 1751 测试；末尾 Node 聚合 317 通过、0 失败、2 既有平台跳过；
  前置文档、Skills 与 Electron sandbox capability 检查均通过。这些结果不替代真实 Desktop/Headless Runtime、
  Windows/Linux、Web 或 Mobile 验收。

后续每个检查点记录命令、结果、产物与未覆盖项。提交前运行适当 Rust/TS/UI/文档门禁；
跨层变更运行 Desktop build 与隔离 bridge/旧入口回归。完成后 push 同名远程分支并按仓库规则创建 PR，
保留 worktree 供审阅；未经另行合并流程不合入 main。

2026-09-12 用户追加要求先推送当前阶段进展，再把最新 `origin/main` 合入任务分支。
本次阶段性推送不代表五阶段交付完成；主工作目录中的其他未提交改动不纳入本分支。
