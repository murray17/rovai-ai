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
| 1C Web 闭环 | 同一 Axum 模块、内存 Bearer、受限 Fetch、上传 source ref、草稿归属、SSE 与宽屏闭环；第二台 LAN 电脑使用 | 只读入口与浏览器验证已接入；草稿、上传与发送未开放 |
| 2 Desktop 共用 | 受保护本机 IPC、同 Host Web 开关与会话管理；关闭 Web 不停 Core，bind 失败不毁 Desktop；保留退出与父进程异常语义 | 同 Host/匿名父管道/Web 开关已接入并做进程验证；完整隔离与 Desktop 交互验收待补 |
| 3 宽屏完整性 | Camp/成员/Task/Runtime/Memory/Automation/Skills/MCP 与必要设置；声明能力矩阵；多端、私聊归属、审批竞争和迟到响应回归 | 只读资源与现状双主题已接入；完整写入与多端回归未完成 |
| 4 三平台发布 | macOS arm64/x64、Windows x64、Linux x64 实际 CLI Server 闭环与匹配 Host/Web 包；平台/Runtime/部署方式分别留证 | 原生预览构建/验证工作流已准备，未正式验收或发布 |
| 5 Mobile | 按 2026-09-12 用户追加要求先出沿用现有风格的交互稿；真实 Mobile 生产实现与设备验收留待后续 | 已有可交互 HTML 和状态检查，待用户评审 |

1C 的基础门禁不能后移：两标签页互不覆盖，伪造归属不能读/写/绑定/消费；陈旧 revision 不消费新内容；
响应丢失按原 commandId 查回执；上传绑定结果未知不误删；源文件消失显示不可用；凭据不进入其他 origin、端口、
重定向、URL 或日志；撤销关闭 SSE；快照与水位无缺口、慢订阅有界；匿名/越权/失效审批和路径逃逸被拒绝。

三平台发布固定 OS 与库基线，Linux 首批实测 Codex CLI/Claude Code。Linux 原生通过后提供 systemd 示例，
非 root 容器部署单独验证，不从原生或 Desktop 资格推导。缺一目标平台证据，阶段 4 保持未完成。

## Main 迁移表

| 当前职责/入口 | 去向与阶段 | 回归证据要求 |
| --- | --- | --- |
| `CoreClient`、`FullCoreSupervisor` | 1A 旧 stdio 适配；2 当前启动同一个 Host，父管道与进程内 Web 共用 Core；独立身份握手 IPC 待补 | ready/blocked、generation、重复实例、错误与退出 |
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

## 同步 main 的边界

阶段性提交 `3a5789ed` 已先推送至同名远端分支；随后同步 `main` 的
`8203c6d33223c361f41fe8a53571ca4000c85499`。保留上游附件预览、Composer 接收者初始化、
Claude 原生初始化模型目录和移除 Rovai 外层 macOS 沙箱的变更；原 `main.rs` 的运行层变更同步到
`application.rs`，旧入口继续保持薄适配。

上述旧 macOS sandbox 测试结果仅证明合入 main 前的基线。上游随生产边界退役该测试，改为证明
Core 管理的 Probe 可使用 Runtime 自带的原生沙箱；这不构成 Host 控制凭据、IPC 或管理恢复的隔离证明。
当前 [User Automation v5](../../contracts/user-automation-v5.md) 明确不承诺防御同 UID 冒用，
与 Host 目标之间的差距仍需前置验证和最小方案说明，未通过前不放行控制面安全验收。

合并验证：`pnpm test:rust:staged` 选择完整 workspace 默认回归，Core 792 通过、0 失败、6 忽略，
CLI 35 通过、0 失败；新增 Claude 无 Prompt 目录 fixture 通过，真实安装版 smoke 保持显式人工忽略。
重新构建 workspace 二进制后的 stdio/Host 进程联合测试为 11 通过、0 失败、1 既有平台跳过，包含
Core 管理的 Probe 启动原生沙箱。格式、Clippy `-D warnings`、类型检查、Desktop build 和以本次
main SHA 为 base 的文档门禁通过。

首次 `pnpm test` 与 Rust 构建/回归并行时，既有评测 Host 的 `auto-run-1` 完成状态轮询超时；
该生产文件与测试均未在本次合并中改变。原测试单独复验 4 项通过，待 Rust 检查结束后完整重跑
`pnpm test` 通过：Vitest 174 文件 / 1757 测试，末尾 Node 317 通过、0 失败、2 既有平台跳过。
未修改断言、超时或跳过配置；首次失败保留记录，不将并行负载推断成已证实的根因。


## 2026-09-12 继续二三四与 Mobile 交互稿

按用户追加范围先合入 `origin/main` 的 `22f91ded1b2ad51698d96f6356d7a39049182e5d`，
合并提交 `1be7f545`。上游 source-attachment 精确路径读取修正同步到已抽出的 application 层；
保留附件弱持久性、当前无外层 macOS sandbox 的 Runtime 合同和前版本未完成事实。

当前可运行增量是共享 Host/Web 的只读开发预览；没有把旧 camp_id 唯一草稿 RPC 暴露给浏览器。
`rovai-web` 的管理/会话/只读 RPC/失效 SSE 与 Desktop 控制路径见 [Host Web v1](../../contracts/host-web-v1.md)。
Desktop 默认启动同一个 Host，打包同时包含兼容 Core、Host、CLI 和同版 WebUI。
两端主题改为引用同一个生产 Token 文件，完整原主题测试保留。移动提案见
[交互说明](../../ui/host-web-mobile.md)，HTML 与截图随 Camp 交付，未强制纳入被忽略的 prototype 目录。

已执行的真实 Host 进程测试覆盖两个会话身份独立、撤销关闭 SSE、默认不使用 Cookie、错误 Origin/URL
查询/未准入方法拒绝、Web 回执不写 Desktop stdout、关闭 Web 不停 Core、再次开启与受控关闭。
真实 Chrome 使用临时 data-dir/Skill Library/MCP/浏览器 profile，创建仅本地记录的 Camp（execution=null，
不调用模型），验证登录、消息读取、HTML 不执行、资源页、800/1040/1440 视口和双主题、撤销后回到登录。
该检查发现原生 Window.fetch receiver 丢失，已修复，并扩展既有客户端测试。

`rovai-host prepare` 为显式新目录创建私有路径并输出启动参数，不创建 authority、不修复已有目录；
Server 预览打包脚本在原生目标构建 Host/CLI/WebUI，记录 commit、dirty、target、profile 和逐文件 SHA-256。
CI 原生目标为 macOS 15 arm64、macOS 15 Intel、Windows Server 2022 x64、Ubuntu 24.04 x64；这只是构建/
进程入口覆盖，不替代桌面 OS 最低基线、实际 Runtime、系统服务、容器、LAN 第二设备或移动浏览器资格。
Linux x64 在同一 Rust/TS 平台矩阵中显式为构建身份，所有 Runtime 保持 not_qualified；不修改已绑定的
macOS/Windows 兼容性证据。

原生文件边界探针只访问本次临时目录中的无敏感哨兵文件。macOS arm64 的
[观测结果](evidence/host-file-boundary-macos-arm64.json)显示 ManagedProcess 及后代均能读取私有目录里的哨兵，
同时能写授权工作区；因此现有进程回收/私有目录权限不能单独证明目标隔离。该探针不读取真实控制凭据，
也未覆盖环境/句柄、IPC 或内存；不能把它扩称为完整隔离攻防结论。Windows/Linux 同入口待原生 CI 实测。
若其隔离失败，按用户已确认规则先提交最小修正、替代与影响，由用户决定再实施。

第一轮全量 Rust library 为 790 通过/2 失败/6 既有忽略：一项是未验收 Linux 说明误加入被 SHA-256 绑定
的兼容性清单，已移回平台合同，原 evidence 字节保持不变；另一项是既有 Claude 原生初始化夹具 1 秒期限
超时，正在单独复验并限制测试并发重跑，未修改生产期限、断言或忽略配置。后续门禁结果继续补记。

后续 Core library 限制 4 并发仍为 791 通过/1 失败/6 既有忽略，唯一失败仍是该 Claude 初始化期限。
精确用例、health 分组（22 通过/3 既有忽略）以及与相邻 v99 migration 的组合均通过；尚未得到稳定的
最小失败复现，未改动该生产路径或测试。完整串行复核结果见下文；该间歇超时没有被宣称为已修复。
新增 Web 纯状态/公开投影测试 3 项通过，Clippy 全目标通过；本机原生 debug Server 预览包已构建。
Desktop 真实 contextBridge 与设置工作区检查通过，覆盖迟到 status、未知 start 回执只查询不重试、
令牌轮换与页面卸载清空。Windows 安装器的 Host 进程识别和 macOS/Windows 包验证已随入口切换更新。

本轮实现已提交并推送 `670dae367c6a00d45d0a9ec96eca57c575645249`。完整串行
`RUST_TEST_THREADS=1 pnpm test:rust:pr` 通过：Core library 792 通过/6 既有忽略，CLI 35 通过，
slow integration 309 通过/0 忽略。没有永久禁用测试、修改超时或放宽断言。

`pnpm test` 最终通过：175 个 Vitest 文件/1759 项，Node 聚合 317 通过/2 既有平台跳过。
此前两项读取主题文件的测试仍指向旧文件，已改为读取共享生产主题，原颜色与对比度断言保留。
Typecheck、workspace 全目标 Clippy、Desktop/Web build、真实 bridge/设置与固定 main base 的文档门禁通过。
本机原生 debug Server 包的真实进程测试 3 项通过；真实浏览器截图使用界面主题按钮，避免只改 DOM 造成状态失配。

[三平台原生工作流](https://github.com/murray17/rovai-ai/actions/runs/34637391844)对应上述实现 SHA；
运行状态与具体失败继续补记，不能将 pending 或 preview artifacts 当正式发布证据。

## 原型缺口的最小修正提案（待用户决定）

本节是待确认提案，不是新授权或已实现隔离。macOS 当前哨兵读取失败事实见上文；Windows/Linux 仍以
原生工作流结果为准。哨兵证明“目录私有权限不足以隔离同一用户的 Runtime”，不证明本次新 Token
已经泄漏：新令牌只经本机管道或显式 stdin 输入，服务端只留摘要。进程访问、IPC、句柄和环境仍须独立验证。

| 选项 | 最小范围 | 影响与门禁 |
| --- | --- | --- |
| 系统能力适配原型（建议） | 先只在 Windows/Linux 的 ManagedProcess 启动边界验证系统隔离；Host/Core/API 不分叉，不增加常驻服务 | 先验证两个原生 CLI 的登录、工作区、运行和回收，再决定生产接入；不通过就停止该平台资格 |
| 由部署者提供分离的 OS 运行身份 | Host 控制身份与 Runtime 身份分开，授权工作区显式共享 | 产品改动可能更少，但部署需要账户/ACL/原生认证迁移与跨身份启动；当前普通 Desktop 无法据此自动通过 |
| 保留只读开发预览 | 不新增隔离依赖，也不开放 Web 发送、上传、审批或宣称正式安全发布 | 可审阅和继续独立 UI 工作，但不满足用户要求的完整第二至四阶段，不能作为原目标的默认替代 |

建议原型限定为以下两条，各自通过才提出生产补丁：

- Windows 使用系统 AppContainer 的进程启动能力，给明确的工作区和 Runtime 所需原生配置目录授予最小访问；
  保留现有 Job 回收。需实测 CLI 的登录方式、网络、子进程和 MCP，不假设原生账户配置自动可用。
  该选择依据 [Microsoft 的 AppContainer 启动与资源授权说明](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer)，
  不是对本项目兼容性的证明。
- Linux 先检查可用内核能力，再验证文件读取、进程访问、路径/abstract Unix socket 与后代边界；
  Landlock 可以限制文件与进程访问，但不同 ABI 的 IPC 覆盖不同，不能只限制文件就声明 IPC 安全。
  见 [Linux 内核的能力与 ABI 说明](https://docs.kernel.org/userspace-api/landlock.html)。如果当前最低基线不足，
  必须明确是提高基线、采用现有系统隔离工具，还是选择分离 OS 身份，不能静默降级。
  单独新建 user namespace 也不足：文件访问仍按映射到初始 namespace 的身份检查，见
  [user_namespaces(7)](https://man7.org/linux/man-pages/man7/user_namespaces.7.html)。

不恢复上游已移除的 macOS 外层沙箱，不添加通用策略编辑器、容器调度器或额外管理守护进程。
macOS 同 UID 保护目标与已合入的 Runtime 合同也需用户决定如何一致，不能用 Windows/Linux 方案替它放行。
