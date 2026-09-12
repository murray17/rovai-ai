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

## 当前收敛：阶段 1–3，方向通过后接通真实 Camp

用户以 PR #345 / `077bf78e64c76e934c45675ddb55e05165a2c49f` 提交补充静态审阅后，已核对实际
本地与远端提交一致。已交付三项材料：[行为差异表](../../ui/host-web-parity.md#一张行为差异表)、
生产 React 组件的宽屏可点击稿（同页说明构建与验收）、[一页复用/调用说明](frontend-reuse.md)。
用户已通过方向评审，直接推进下表，不再扩展模拟稿或替换已有 Rust Host/Axum。

| 当前检查点 | 可演示结果与放行证据 | 当前状态 |
| --- | --- | --- |
| 评审稿 | 同 fixture / 1440×920 / 日夜主题，Camp、新建、执行审批、附件预览、队员配置共用生产组件；模拟明确标识 | 用户已确认方向；模拟证据不代替 A–D |
| A 共享 Camp | 登录后实际 Web 挂载共享业务页面；Native 启动留 Desktop；旧 Desktop 无回归 | 实际 Web 已挂载共享 BusinessApp/导航/Camp；真实 Desktop/Chrome 同数据、1440×920、日夜主题对照及 Camp/文件页面回归通过 |
| B 真实写入闭环 | 独立 Host 从受信空目录初始化，经浏览器配置、创建、发送、审批、停止、文件读取；草稿/上传/幂等前置 | 浏览器生产 Composer 发送、真实 Codex 执行/原生审批、产物阅读与停止已通过；初始化后配置/建 Camp 仍由真实 HTTP 验证，完整配置 UI 和私聊/待发送附件等未闭合 |
| C 双入口一致 | 同一 Web 产物分别连接 Desktop-managed 与独立 Host；双草稿、审批竞争、失效/迟到/断线与 Web 开关 | 两种 Host 挂载同一 Web 产物；真实 Desktop/双浏览器草稿独立，同页重新认证保留 Composer；第二客户端处理已决审批被拒；两入口完整相同执行场景、运行中关闭 Web 仍待补 |
| D 逐页业务能力 | 队员/Runtime、Task、Memory、Automation、Skills/MCP 与必要设置逐项原动作/失败/权限/刷新闭合 | 未完成；通用只读行不计入 |

Mobile 新增、扩平台、容器与发布优化暂停，已有包/CI/原型保留。长期 Server 仍为 macOS、Windows、Linux。
安全仅追踪下文 S1；安全等待不阻塞受控本机的共享 UI、模拟交互与非发布测试，也不允许把未通过保护的网络写入
宣布为正式发布。以下原阶段表保留总体目标与未完成事实。

### 首个真实 Camp 增量

`App.tsx` 的生产业务协调器提取为 `BusinessApp.tsx`，两个入口显式注入 IPC/Remote 与资源适配。
实际 Web 的旧独立 Workspace 已删除。消息、导航、发送、审批与活动 Camp 的刷新只有这一份生产协调代码，
没有复制 Review fixture；`window.rovai` 不存在于实际浏览器。Host OS 来自 health，快捷键平台来自浏览器设备。

Core Migration 150 把 Camp 草稿、附件和 pending 编辑归属接到独立编辑客户端，保留 Desktop 默认草稿。
Web 认证协议 2 用独立恢复证明关联 Core 持久身份，同页面重新登录只更换认证代次；Web 消费后递增草稿 revision，
避免删除重建造成旧请求可再次生效。命令结果不明时保留原 ID，先读回执；只有用户显式重试才发送原命令。
提交参数在客户端入队时复制；旧退出登录响应不清除新会话。引用操作的持久拒绝有明确的 `recorded.error`，
不能因业务拒绝而永远停在 unknown；目录 Camp 创建回执不依赖原工作区仍然存在，也不通过任意路径探测来查回执。
上传沿用 source reference，未知绑定不删除源文件，已经接受的源文件不因发送/退出/移除引用被上传服务清理。

`pnpm test:host-web-live` 启动隔离的真实 Electron root 和两个 Chrome profile，使用 Core 的真实持久消息
（`execution:null`）对照同一 Camp。验证 270px 侧栏、38px Camp 顶行、日夜主题、三个独立草稿、令牌轮换后
同页重新登录保留同一 Composer DOM/内容，以及关闭 Web 后 Core 仍响应。它不启动模型；
[脱敏记录](evidence/desktop-web-live.json)与真实 Runtime 证据分别记录。

`pnpm smoke:host-web-runtime` 从空目录启动独立 Host，复用本机已认证 Codex，在实际浏览器执行上传/阅读、
发送、Host 权威原生审批、产物读取、运行中停止，并拒绝第二客户端重复处理已决审批。Runtime/队员/工作区/Camp
配置先走真实授权 HTTP，因此该证据不能替代配置页面验收。执行和 SSE 更新期间保留下一条草稿及 Composer DOM。
脚本与截图只使用一次性 data-dir、Skill Library、MCP config、Chrome profile，不访问日常 Rovai 数据。

2026-09-12 两个上述入口已实际通过。[独立 Host 报告](evidence/runtime-browser.json)记录真实 Run、审批、
消息、产物、停止 Run 和逐项断言；[Desktop 日间](evidence/desktop-web-live/desktop-day.png) /
[Web 日间](evidence/desktop-web-live/web-day.png)、[Desktop 夜间](evidence/desktop-web-live/desktop-night.png) /
[Web 夜间](evidence/desktop-web-live/web-night.png)用于同视口对照。
浏览器的[上传阅读](evidence/runtime-browser/web-source-upload.png)、[原生审批](evidence/runtime-browser/web-native-approval.png)、
[产物阅读](evidence/runtime-browser/web-runtime-artifact.png)和[停止终态](evidence/runtime-browser/web-stop-complete.png)
均来自实际生产入口；不含登录凭据。Desktop 的短暂缩放反馈属于原生适配，未为截图改变其行为。

实际诊断暴露的两个边界保持记录：Codex 0.153.4 的 `workspace-write` 原生限制阻止未审批的 Unix socket
CLI 调用，已通过精确命令的原生 `allow_once` 验证发布；未更改用户级权限，也不据此宣称 S1 通过。
Managed 产物的祖先目录为只允许穿越的目录，原 `O_RDONLY` 逐层打开错误要求列目录权限；精确文件读取改用
macOS `O_SEARCH` / Linux `O_PATH` 的目录句柄，最终文件仍只读且逐段拒绝 symlink，不扩大目录权限。
过早点击停止曾收到版本冲突；UI 保留已有错误/刷新语义，最终在真实工具运行中点击停止并在 Host 退出前确认取消。

全量回归曾复现既有 Claude 无 Prompt 目录测试的 1 秒成功路径超时。该既有 owner 的正常协议路径改用独立
10 秒夹具预算，专门的 timeout case 仍为 1 秒；同时逐项断言 missing/rejected/interaction/malformed/EOF/timeout
的真实失败原因，防止超时冒充协议分支通过。生产探测超时和进程回收断言保持原合同，未禁用或删除任何 case。

提交前已通过类型检查、前端 175 文件/1765 测试、脚本 317 通过/2 既有平台跳过；Rust 默认工作区与 PR 门禁
通过（Core 793/6 既有忽略、CLI 35、slow 309），以及 Clippy `-D warnings`、格式检查。
最终新二进制/同一 Web 构建上的 HTTP owner、真实 Desktop/双浏览器与原生 Runtime smoke 均通过，无测试跳过。
既有真实 Electron 启动恢复回归另行通过，验证 Desktop 仍提供诊断导出；共享失败页面的诊断能力改为显式注入，
浏览器保留连接恢复而不访问桌面桥。并行重负载曾导致进程启动和定时测试超时，最终上述验收按组串行复跑通过；
没有因此改生产时限或关闭门禁。文档门禁在最终证据入库后再执行。

未完成项保持可见：浏览器完整新建/配置路径、私聊独立草稿、待发送附件上传、头像编辑、相对资源/大文件分页、
共同管理页动作、无 Desktop/浏览器的 Automation 时钟、两种 Host 的完整相同运行场景、第二台设备及 S1。
首个真实 Camp 增量不等于 B/C/D 或阶段 1–3 整体完成。

### 已确认对照稿的历史证据（不含本次真实接线）

[验证记录与源码/产物 SHA-256](evidence/desktop-web-parity-review.json)固定本轮内容与范围。
`pnpm review:host-web-parity` 生成一个可离线打开的 HTML；`pnpm test:host-web-parity` 在独立 Chrome 与
sandboxed Electron profile 运行相同生产组件、6 个场景及日夜主题。验证每个内容视口为 1440×920，
导航宽度 270px，Camp 顶行与生产现状同为 38px，无产品横向溢出；不伪造 `window.rovai` 或 Node 运行依赖。
审批提交中/已处理及各路径截图与完整观察写入指定输出目录，生成物不进入生产 Web 构建。

实际点击走通了本页模拟发送与清空草稿、授权目录和队员选择/新建、结构化工具详情、原生选项提交/处理、
Web 固定示例下载、Runtime 配置版本保存，以及独立 HTML 的入口/主题/场景切换和模拟连接状态隔离。
修正了夹具遗漏的生产 `members-workspace` 容器和工具 evidence 结构；没有通过改生产样式来匹配截图。
这些操作均由固定内存 fixture 驱动，没有启动 Core、真实 Runtime、访问日常数据或开放 HTTP 写入。

评审稿提交时生产 TypeScript 与 fixture 类型检查、Desktop/Web 构建通过；当时 Vitest 175 文件/1759 测试通过。
定向真实 Electron 回归 7 项通过、0 跳过，覆盖 Camp projection 刷新/阅读位置、稀疏执行正文与重试、
产物/消息层级、文件 split/阅读状态与设置。通用文档门禁随最终提交运行。这些回归只证明本次组件提取范围，
不能替代完整 Desktop 启停、Host 写入、并发客户端或 S1 安全验收。Rust/Host 生产实现与公开操作集合在评审稿提交时未变；
原有平台证据保留，未重新申报平台资格。

## 检查点与完成条件

| 阶段 | 工作与放行条件 | 状态 |
| --- | --- | --- |
| 1A 共享 Core | 抽取应用运行层，普通串行入口与必要独立通道不变；旧 Desktop 准入、重复实例、执行、关闭回归；补齐 Main 迁移表及窄接口 | 实施中 |
| 1A 平台原型 | Windows/Linux 实测文件、环境/句柄、必要进程访问、IPC 冒用、管理恢复、授权工作区与后代回收；失败先由用户确认最小修正 | 四个目标的文件边界均未通过；其余边界未验收 |
| 1B Headless | 空目录初始化与原生 Runtime 认证；真实发送、产物、审批、取消、受控关闭、强杀恢复；无 Electron/基础 Node 依赖 | macOS 独立 Host 的浏览器发送/原生审批/产物/取消已验证；配置页面、恢复和全部场景尚未验收 |
| 1C Web 闭环 | 同一 Axum 模块、内存 Bearer、受限 Fetch、上传 source ref、草稿归属、SSE 与宽屏闭环；第二台 LAN 电脑使用 | 共享生产 Camp、独立草稿、上传与发送已接通；完整闭环与 LAN 第二设备尚未全部验收 |
| 2 Desktop 共用 | 受保护本机 IPC、同 Host Web 开关与会话管理；关闭 Web 不停 Core，bind 失败不毁 Desktop；保留退出与父进程异常语义 | 同 Host/匿名父管道/Web 开关已接入并做进程验证；完整隔离与 Desktop 交互验收待补 |
| 3 宽屏完整性 | Camp/成员/Task/Runtime/Memory/Automation/Skills/MCP 与必要设置；声明能力矩阵；多端、私聊归属、审批竞争和迟到响应回归 | 独立通用资源页已移除；共享业务页面逐项适配中，私聊、管理动作和无浏览器 Automation 等尚未完成 |
| 4 三平台发布 | macOS arm64/x64、Windows x64、Linux x64 实际 CLI Server 闭环与匹配 Host/Web 包；平台/Runtime/部署方式分别留证 | 四个原生预览包与有限链路已验证；隔离未通过，未正式发布 |
| 5 Mobile | 按 2026-09-12 用户追加要求先出沿用现有风格的交互稿；真实 Mobile 生产实现与设备验收留待后续 | 已有可交互 HTML 和状态检查保留；新增工作暂停 |

1C 的基础门禁不能后移：两标签页互不覆盖，伪造归属不能读/写/绑定/消费；陈旧 revision 不消费新内容；
响应丢失按原 commandId 查回执；上传绑定结果未知不误删；源文件消失显示不可用；凭据不进入其他 origin、端口、
重定向、URL 或日志；撤销关闭 SSE；快照与水位无缺口、慢订阅有界；匿名/越权/失效审批和路径逃逸被拒绝。

后续三平台发布仍须固定 OS 与库基线，分别验收 Runtime；当前不继续扩平台、常驻部署或容器优化。
已有原生构建不替代实际部署资格，阶段 4 保持未完成。

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
也未覆盖环境/句柄、IPC 或内存；不能把它扩称为完整隔离攻防结论。随后四个目标的原生 CI 结果见下文。
按用户已确认规则，隔离失败后先提交最小修正、替代与影响，由用户决定再实施。

第一轮全量 Rust library 为 790 通过/2 失败/6 既有忽略：一项是未验收 Linux 说明误加入被 SHA-256 绑定
的兼容性清单，已移回平台合同，原 evidence 字节保持不变；另一项是既有 Claude 原生初始化夹具 1 秒期限
超时，随后单独复验并限制测试并发重跑，未修改生产期限、断言或忽略配置。最终门禁结果见下文。

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
最终结果及失败边界见下文，不能将 preview artifacts 当正式发布证据。

## 原生预览检查与依赖证据

第一轮 [Run 34637391844](https://github.com/murray17/rovai-ai/actions/runs/34637391844) 对应实现
`670dae36`，四个原生 release 包均构建并上传；这次 Run 的最终结果是 failure。

| 原生目标 | 凭据状态与 Core 进程/目录检查 | 包内 Host 生命周期 | 文件边界原型 |
| --- | --- | --- | --- |
| macOS 15 arm64 | 通过 | 3 通过 | [未通过](evidence/host-file-boundary-macos-arm64-ci.json) |
| macOS 15 x64 | 通过 | 3 通过 | [未通过](evidence/host-file-boundary-macos-x64-ci.json) |
| Ubuntu 24.04 x64 | 通过 | 3 通过 | [未通过](evidence/host-file-boundary-linux-x64-ci.json) |
| Windows Server 2022 x64 | 通过 | 复核 2 通过/1 console 平台跳过 | [未通过](evidence/host-file-boundary-windows-x64-ci.json) |

四个目标均观测到自身及后代能读取本次私有哨兵文件；授权工作区写入与回收请求成功。
该结果不等同于真实 Token、IPC、环境/句柄或进程内存攻防。CI 的 OS/权限上下文不替代最低支持 OS、
普通非提升权限用户、实际 Runtime、干净机器、系统服务与容器验收。

Windows 初轮失败是测试将带 extended-length 前缀的规范路径与普通拼写作字面比较，Host/Web 场景本身通过。
`fbadd0e9` 改为验证真实目录身份，原“只创建新目录、不改变已有内容”断言保留；同提交扩展了跨会话 SSE 配额/
撤销检查。本机复验 3 项通过，工作流新增封闭的单目标选择，
[Windows 复核 Run 34639404464](https://github.com/murray17/rovai-ai/actions/runs/34639404464) 对应此提交。
该次原生构建、凭据状态、Core 进程/目录、Host prepare 和同 Core Web 生命周期均通过；随后文件边界原型失败，
Run 保持 failure。Windows console 事件的原生受控关闭仍未验收，没有将平台跳过计为通过。

对下载的原生产物先校验 manifest SHA-256，再离线读取二进制依赖：
[Windows Host/CLI](evidence/windows-server-imports.json) 动态依赖 VCRUNTIME140.dll；
[Linux Host/CLI](evidence/linux-server-imports.json) 分别包含 GLIBC_2.39 / GLIBC_2.34 符号需求。
运行说明据此列出当前预览包的 Windows v14 Runtime 与 Linux glibc 基线；未把开发工具齐全的 CI 镜像
等同于干净用户环境，不扩大成系统组件安装器。

<a id="host-protection-decision"></a>
## S1：受管 Runtime 的 Host 控制面保护（唯一待确认安全项）

状态：待维护者确认；本节只收敛此前修正提案，不增加生产隔离授权。UI 稿件确认与 S1 分开：
稿件确认后可以继续受控本机的 A–D 实现/非发布测试，S1 未通过仍阻断正式安全发布。

**保护目标。** 仅 Rovai 管理的 Runtime 与后代不能取得 Host 控制凭据、冒用本机管理 IPC 或调用管理恢复，
同时能访问明确授权的工作区、保持原生 Runtime 登录/运行能力并被回收。不防御管理员/root，不把任意私有
文件都等同于真实控制凭据。Host 身份和网络 Owner 授权仍来自服务端，不信任客户端自报。
当前 `Managed Runtime Process v2` / `User Automation v5` 已取消外层 macOS sandbox 和原同 UID 防冒用承诺；
这个新 Host 目标不能被当作旧承诺仍存在，也不能悄悄恢复旧 sandbox。维护者须确认是否将这个新目标用于
三平台 Host 准入，再同步相应合同。

**可复现失败。** 本地临时哨兵与四个 CI 目标的事实见上文 JSON。可在目标原生机器运行：

```bash
cargo run --quiet -p rovai-core --example host_runtime_boundary_probe
```

探针只创建本次临时文件；当前自身和后代均可读 sentinel，`privateFileIsolationSatisfied=false`。
它不证明真实 Token 泄漏，也未覆盖句柄/环境继承、IPC、进程内存、实际 Runtime。CI 的权限上下文不能
替代普通非提升权限用户验收。现有探针和失败证据保留，不改文案/删测试绕过门槛。

**最小修正提案。** 只在已有 ManagedProcess 启动和 Host 控制入口补系统能力适配，保留唯一 Host/Core、
原 Job/进程树回收、现有命令与认证实现，不新增常驻服务或通用策略平台。先验证凭据/管理句柄不继承以及
目标文件/进程/IPC 访问；Windows 以系统 AppContainer 为候选，Linux 按实际内核 ABI 验证可用的文件、进程
和 IPC 限制，不能把只限制文件当作完整保护。macOS 不自动恢复外层 sandbox；先验证现合同下是否有满足
目标且保持 Runtime 兼容的最小系统方案。若需要独立 OS 运行身份、提权安装或提高 OS/内核基线，先回到同一
S1 说明实际必要性与较小替代，不自动实施。单纯依靠同用户目录权限已经不够；保留只读预览也不是阶段 1–3
完整交付的替代方案。

**Runtime 兼容影响。** 原生 CLI 的认证目录、网络、子进程、MCP、路径授权以及恢复/回收都可能受限。
原型不迁移维护者的真实凭据、不改日常账户或全局安全配置；用独立测试实例验证。共享库代码不推导平台资格。

**实际验收。** 在普通用户原生环境逐项验证：私有控制哨兵拒绝、授权工作区可读写；环境/管理句柄不泄漏；
IPC 冒用及恢复入口拒绝；必要的进程访问拒绝；子孙进程保有相同边界且能回收；真实 CLI 登录、发送、审批、
取消和恢复仍可运行。不能只看探针一项转绿。成功后保留版本/系统能力/Runtime/命令和结果关联，才开放对应资格。

维护者待决定的问题是：**是否确认上述新 Host 保护目标，并授权这一范围内的最小系统能力原型？**
不同时提交第二套隔离工程或把 macOS 的旧承诺恢复当成默认答案。

候选能力参考：[Microsoft AppContainer](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer)、
[Linux Landlock 能力与 ABI](https://docs.kernel.org/userspace-api/landlock.html)、
[user namespace 的身份映射边界](https://man7.org/linux/man-pages/man7/user_namespaces.7.html)。这些资料不证明本项目已兼容。
