---
document_type: implementation-plan
version: v1.59
lifecycle: historical
authority: version-implementation-plan
status: in_progress
last_updated: 2026-09-19
---

# v1.59 实施与验收

范围见[版本概览](README.md)，边界见[统一 Host](../../architecture/unified-rust-host.md)。
各批次的基线、分支和验收事实按对应章节记录；自动验收只使用隔离 data-dir、Skill Library、MCP config
和浏览器 profile，不接触日常 App 数据。

## 当前批次：置顶对齐与会话通知

2026-09-19 从 `main` 的 `3436bb9f` 建立分支 `rovai/mission/010`，按侧栏 v2 交互稿统一 Desktop、
宽屏 Web 与手机的导航层级。项目标题、项目内会话与置顶会话使用同一文本轴；项目内会话只通过组级缩进建立层级，
不再为提醒状态预留左侧空槽。置顶会话采用更扁、更圆、短尾的无填充对话图标；Desktop/Web 图标槽为 17px，
手机为不可压缩的 20px，底部“对话”入口继续使用 21px 视觉尺寸，其他导航图标不变。

每行会话始终保留一个 12×12px 右侧状态槽；该尺寸是容器，不是蓝点直径。蓝点与 loading 均在槽内居中，
loading 优先于未读，空状态仍保留槽宽以避免标题横向跳动。Desktop/Web 蓝点为 7px，手机为 6px；
按钮可访问名称独立表达“有新回复”“正在打开”或“正在运行”，装饰图标和视觉状态不重复进入可访问树。
本节取代下文早期手机批次中“未读蓝点位于左侧”的历史描述。

验证通过 `pnpm typecheck`、定向 App/主题 Vitest 209 项、原生 Electron 导航夹具、
`pnpm test:host-web-mobile` 4 项、`pnpm build:desktop`、macOS arm64 目录包构建以及打包 App 的
`navigation-windows` 侧栏验收（1440×920、1040×700、日/夜主题、折叠/分页/键盘路径）。同步最新
`main` 后，Product Contract Fingerprint 的测试期望随已生效的 projection schema 112 更新，不改变合同实现。完整
`pnpm test` 通过 207 个 Vitest 文件 / 2127 项测试，Node 门禁 324 项通过、2 项既有平台专项跳过。
真实 Host/Web 与打包 Desktop 验收均使用隔离数据和浏览器/App profile，未启动 Runtime；Chrome 手机视口与组件夹具
不替代实体手机、软键盘和移动网络验收。

## 当前批次：Command 文件来源与执行台宽度

本批从 `origin/main` 的 `e3ef6f37` 建立同级工作树 `rovai-ai-command-preview-fix`，分支为
`codex/fix-command-file-preview-overflow`，并在提交后 rebase 到包含 PR #414 的 `ffd02517`。文件入口新增
`run_activity_file` 封闭来源，Core 以 exact
Camp/AgentRun/epoch/Evidence/canonical diff path 重新授权，再按来源 Run `executionRoot`、历史 Camp 项目顺序
选择根目录。Renderer 只对缺少 Evidence identity 的历史 presentation 保留 workspace 回退。

执行布局在虚拟列表边界恢复 `min-width: 0`，不改变 Diff 的 520px 内部阅读宽度；生产 Camp 组件夹具新增
Desktop、Web 768/1440px 与 Mobile 360/375/430px 双主题 containment 断言。本地验证通过 `pnpm typecheck`、
5 个定向 Vitest 文件 / 87 项测试、`pnpm build:desktop`、`pnpm test:host-web-parity`、文档本地/差异门禁及
`pnpm test`（205 个 Vitest 文件 / 2122 项测试，Node 门禁 324 项通过、2 项既有平台专项跳过）。Rust 验证通过
fmt、workspace all-targets Clippy、Core 定向授权测试、Web 资源测试及 PR 套件（Library 829、CLI 28、
slow integration 310；6 项既有手工平台用例保持 ignored）。全程不启动 Runtime，不读取日常 App 数据。

## 当前批次：手机会话入口与项目目录

2026-09-16 按确认交互稿修正手机会话列表几何：新动态点与标题共用垂直中心，项目内会话和置顶会话保持各自图标槽，
选中灰底覆盖与普通会话一致的完整行宽。WebUI / MobileUI 的工作区选择改称“选择项目目录”，默认提供位置导航、
文件夹列表与当前目录确认，完整路径和系统根位置按需展开，不再用 Host 概念解释用户动作。

普通手机空 Camp 移除品牌图形和四项配置标签，只保留开始标题与默认折叠的“起步建议”；三个建议展开后仍调用共享草稿填充，
不会直接发送。宽屏空 Camp、首次使用欢迎、Composer、消息区和 Rust Host 合同保持现状。

验证通过 `pnpm typecheck`、定向 App Vitest 175 项、`pnpm build:desktop`（含 Web）、文档测试与两项文档治理门禁。
`pnpm test:host-web-mobile` 三项完整通过：390px 生产手机入口断言提醒点／标题中心、完整选中行、目录文案与按需路径、
空 Camp 折叠状态；共享执行夹具与独立 Server 手机设置回归同时通过。浏览器测试使用 `eb850265` 未改动的既有
debug Host / Server 二进制和当前 Web 构建，隔离 data-dir、Skill Library、MCP config 与 Chrome profile，未启动 Runtime；
仍不把 Chrome 手机视口当作实体手机验收。
`pnpm test:host-web-live` 也以 1440px 实际 Desktop／Web 双入口完整通过，覆盖宽屏目录跳转、共享 Camp 与管理写入，
并确认浏览器无原生桥接；同样不包含真实 Runtime 或第二台实体设备。

## 当前批次：审批 Dock 与手机适配

2026-09-15 从 PR #391 合入后的 `main`（`f67660b4`）实施用户已确认的审批改进稿。
共享 Dock 保留橙色顶部，移除左侧橙线和浮层阴影；请求 JSON 与执行台共用中性 command 底色，
可以键盘聚焦并滚动。手机使用上下标题、44px 控件、原生顺序的双列选项，以及跟随可视高度的滚动回退。
JSON、原生选项、请求身份、提交禁用与摘要聚焦语义保留；不修改 Core、Runtime 或 wire 合同。

`pnpm typecheck`、`pnpm test`、`pnpm build:desktop`（含 Web）、`pnpm test:rust:pr` 及
`pnpm test:approval-dock` 已通过。
[生产组件夹具与截图](../../../scripts/fixtures/approval-dock/README.md)覆盖桌面宽／窄列、双主题、
375/390/430px、844px 横屏和 500px 可视高度，验证 JSON 无损、44px 目标、12 项长选项的用户滚动、
原生选项回传和安全焦点。`pnpm test:host-web-mobile` 三项通过，覆盖真实 Host 与 Server 的生产手机入口、
共享管理、草稿、附件和执行展示；运行目录、Skill Library、MCP 与 Chrome profile 均隔离，无真实 Runtime。
上述组件和浏览器尺寸模拟不替代实体手机键盘与移动网络资格，后两项仍沿用本版未完成的验收事实。

## 当前批次：Linux GNU 2.35 基线与 Runtime 实测

2026-09-14 从 `c72f1ee9` 继续统一 Host 分支。Linux release 使用 Ubuntu 22.04，包内 ABI 门禁拒绝
高于 GLIBC_2.35 的导入符号。`bda1ab83` 的同一归档已通过 [Linux 原生与三 OS Run](https://github.com/murray17/rovai-ai/actions/runs/34839772567)：
[Ubuntu 22.04](evidence/linux-server/ubuntu-22.04.json)、[Ubuntu 24.04](evidence/linux-server/ubuntu-24.04.json)、
[Debian 12 独立 VM](evidence/linux-server/debian-12.json)全部通过；[实际 ABI](evidence/linux-server/linux-abi-bda1ab83.json)
的三份可执行文件最高导入 GLIBC_2.34。[DMIT 同包 Gate A](evidence/linux-server/dmit-server-os.json)也通过，
测试账号峰值 RSS 约 59 MiB。以上只证明 Server OS，不晋升 Runtime。

本地 ABI 拒绝矩阵、Rust workspace/all-targets check、Core 单测 805 通过/6 既有忽略、格式与文档门禁
对应原始 `bda1ab83`。后续依维护者的新范围将现有 14 项 Linux Runtime 显式开放 preview（排除 Cursor），
完整资格证据仍待逐项闭合；DeepSeek Harness 不属于本批 Linux 适配范围；后续 ACP 增量单独记录。
[初轮 DMIT 探测](evidence/linux-server/dmit-runtime-probes.json)与[续测及清理记录](evidence/linux-server/dmit-final-probes.json)
保留每次失败和协议切换结果：Codex 0.154.0、Claude Code 2.1.270、Pi 0.85.1、Grok 1.0.30 完成 MiniMax-M3
工具写入/读回；Qwen 0.23.3 改用原生 Anthropic Provider 后通过。OpenCode 1.18.30、Copilot 1.0.83 工具链成功，
但原严格末尾换行断言失败；不改记为原用例通过。Qoder、CodeBuddy 与 Cursor 的探测遇到各自账号认证门槛，
不把认证缺失记为 Linux 不支持。Antigravity、TRAE 安装成功；Kimi 首次安装受测试安装器的 Python tarfile API
版本差异阻断，尚未执行 CLI。

Claude 包内 Server HTTP 验收已通过原生发现、工具写入/读回与公开投影、warm continuation、Server 重启后的
cold continuation；取消场景未闭合，整体仍失败。Codex 原生 MiniMax 执行通过，但包内检测把 `login status`
当作唯一认证事实，误拒绝未登录 OpenAI 的自定义 Provider。修复改由 Codex app-server 的 `account/read`
明确返回 `requiresOpenaiAuth=false` 时接受原生 Provider 语义；缺失、类型错误、true 或 RPC 错误均不放行。
回归只拥有认证进程边界，不虚构模型调用和 capability 成功，验证入口见[测试层级](../../development/testing.md)。
新开发机上的官方 ZCode 3.11.2 Linux AppImage 实测布局为 `zcode` + `resources/app.asar` +
`resources/glm/zcode.cjs`。Rovai 补充该原生布局与常见安装位置，保持使用独立 Node 启动 bundled kernel，
不启动 Electron GUI、不引入社区 CLI；缺失资源或越界 symlink 继续拒绝。
新增修复已随 `e1b5ac46` 构建，并在新主机复验；下面只归属该来源包的实测证据。

DMIT 使用独立账号与数据根，串行测试设置 1100 MiB cgroup 内存上限。Kiro 安装触发上限后已立即停止；
当时系统可用内存约 1.59 GiB、swap 为 0、无 OOM。用户随后明确授权跳过 Kiro 继续轻量测试。
2026-09-14 用户将后续适配迁往专用开发机，并要求卸载：本次测试账号及整个 Home、Node、Runtime、Server
与测试凭据均已删除，测试进程和 unit 为零，Xray active，swap 0，可用内存约 1667 MiB。
新范围为 Rovai Server 及其余 Linux Runtime 逐项适配，排除 Cursor 与 DeepSeek Harness；具体访问资料仅存私有
Obsidian 运维文档。新机验收、其他 Runtime 资格与手机实际连接仍待完成，正式 Release 尚未发布。

### 新开发机与 e1b5ac46 同包验证

[新包 CI](https://github.com/murray17/rovai-ai/actions/runs/34844158693)的原生构建及
[Ubuntu 22.04](evidence/linux-server/e1b5ac46/ubuntu-22.04.json)、
[Ubuntu 24.04](evidence/linux-server/e1b5ac46/ubuntu-24.04.json)、
[Debian 12 VM](evidence/linux-server/e1b5ac46/debian-12.json)全部通过。
[ABI 报告](evidence/linux-server/e1b5ac46/linux-abi.json)及
[新开发机同包 Gate A](evidence/linux-server/e1b5ac46/advin-server-os.json)绑定 manifest
`b42c13dfec8cdff9d6ed59baa4048adc4a3adf66f5de697936d4f8346c65116a`；主机为 Ubuntu 24.04.5、glibc 2.39、4 vCPU、7941 MiB RAM。
Core 806 通过/6 既有忽略，后续平台准入与 ZCode 布局定向测试、Clippy、格式和文档门禁通过。

[首轮 Server Runtime 证据](evidence/linux-server/e1b5ac46/advin-runtime-initial.json)保留所有失败：

| Runtime | 首轮 Server 集成结果 |
| --- | --- |
| Codex 0.154.0 / Claude 2.1.270 / Pi 0.85.1 | 原生认证、工具写读、公开投影、warm/cold 精确 Native Binding、内置 CLI、HTTP 取消通过 |
| OpenCode 1.18.30 | 前五项通过，取消前的公开命令输入匹配失败；不计取消通过 |
| Qwen 0.23.3 | 前五项通过；原生 Shell 拒绝独立 sleep，随后转入后台，用例未完成有效取消 |
| Copilot 1.0.83 / Grok 1.0.30 | 第一轮工具与公开回复通过；续接回复的标记文本校验失败 |
| Kimi 1.50.0 | 原生 CLI 工具写读已通过；Server 检测反复 stable_failure，测试组触发 4 GiB 上限后停止 |
| 其他已安装 Runtime | 后续批次另记，不能由安装或账号登录推断执行通过 |

Kimi 首次停止时整机最低可用内存约 7.0 GiB、swap 0，无内核 OOM；所有测试进程与单元已退出。
用户授权将这一次 Kimi 重试上限增至 5 GiB，仍保留整机 2 GiB 底线，失败则跳过。
验收脚本增加稳定检测失败即停止、私有诊断保存，避免重复深检；重试 10.07 秒返回稳定检测失败，
cgroup 峰值 598388736 字节，无 max/oom 计数增长，本轮跳过 Kimi。
取消用例改为受控 Python 子进程，必须同时观察原生 Tool、真实子进程和启动标记，
取消后检查子进程消失及延迟写入未发生；首次失败不被改写。

[后续 Server Runtime 证据](evidence/linux-server/e1b5ac46/advin-runtime-followup.json)保留 22 次独立 fixture 与内存记录。
Codex、Claude、Pi、Kiro、Qwen、Copilot、Grok 已通过有限集成链路；Qoder 经原生 `/model` 配置 MiniMax BYOK 后
工具、续接与内置 CLI 已通过，账号 Credits 不再阻塞 BYOK。OpenCode/Qoder 的新取消用例均复现父进程退出、
工具子进程仍存活；`ae872240` 增加 Linux pidfd 身份捕获与取消后退出确认，原生 Linux 回归与同包 OS 矩阵正在 CI 验证。
Antigravity 登录后原生服务明确返回地区不符合资格，不能绕过；修复非零退出码先于结构化 ERROR 的分类，
既有测试扩展 exit 0/1 并通过。CodeBuddy 原生 MiniMax 调用成功，Server 启动却把 RuntimeDefault sentinel 作为
模型 ID 传入；修复只对显式选择传 `--model`，构造测试先失败后通过。ZCode 原生内核连接成功，但版本探测
被执行期 watcher 提前 SIGKILL；只读 `--version` 绕过 watcher 后同机 exit -9→0，实际执行期清理仍保留并通过回归。
TRAE 本机已写入 BYOK 配置但缺原生登录令牌；随后维护者确认已在其他机器实测，要求停止本机测试。
TRAE Linux 标记通过（用户异机实测），不改写本机原失败记录，也不声称本机或未知版本已完成全轴验收。
Kimi 按用户授权重试失败后跳过。其他阻塞不等于 Linux OS 不支持。

[ae872240 原生回收复验](evidence/linux-server/ae872240/advin-runtime.json)：OpenCode 71.94 秒、Qoder 109.28 秒
完成全部六项有限集成检查，真实取消子进程均已退出。两项 cgroup 峰值分别为 1515311104 / 1702301696 字节，
整机最低可用内存分别约 5.8 / 5.6 GiB，无 swap 或 max/oom 事件。Antigravity 9.56 秒投影明确 terminal failure
与地区资格原文，替代此前等待超时；调用仍不能记为通过。`ae872240` 的 Linux 进程边界回归通过，但
[该 CI](https://github.com/murray17/rovai-ai/actions/runs/34851451019) 在异常上传的 fetch writer 上返回 EPIPE，后续 OS 矩阵未运行。
验收客户端改为独立 HTTP 连接读取实际拒绝响应，仍要求 400/413 和临时文件清理；本地公开 HTTP 回归通过。
包含 CodeBuddy/ZCode 修复的 [a5f25ba0 CI](https://github.com/murray17/rovai-ai/actions/runs/34852688532) 已通过原生进程、
版本探测和包级生命周期检查；同一归档在 [Ubuntu 22.04](evidence/linux-server/a5f25ba0/ubuntu-22.04.json)、
[Ubuntu 24.04](evidence/linux-server/a5f25ba0/ubuntu-24.04.json) 与 [Debian 12 VM](evidence/linux-server/a5f25ba0/debian-12.json)
全部通过。[ABI](evidence/linux-server/a5f25ba0/linux-abi.json)三份 ELF 最高导入仍为 GLIBC_2.34，manifest SHA-256 为
`b8bb92f16c3dbe7c87ac9dc0a238dc45858265f7b9cf99e4b7afe9e5c9a5a652`。

[a5f25ba0 新机证据](evidence/linux-server/a5f25ba0/advin-runtime.json)中 CodeBuddy 2.150.0 的六项有限检查全部通过，
66.40 秒、峰值 948539392 字节，无 max/oom/swap。ZCode 0.16.5 两轮前五项通过，但取消均留下独立进程组的
Python 子进程。第二轮仅加私有信号观测：原生 ps 枚举 616 ms 超过内核的 500 ms 期限，随后只终止 Bash，
Python 重新挂靠 PID 1；测试结束已由 cgroup 清理，无内存压力。Linux 显式 ZCode Host 回收改用取消前的 pidfd
身份；无保留后台任务时取消关闭整个 Host，有后台任务时保留原有作用域取消。[64b52784 真实复验](evidence/linux-server/64b52784/advin-runtime.json)六项全部通过，67.01 秒、峰值 1721004032 字节，
真实前台取消子进程已退出，无 max/oom/swap。该 CI 因后续启动修复构建而取消，使用 manifest 校验过的
原生 preview 归档完成 Runtime 复验，不将其称为通过三系统 Gate A 的发布包。
[Advin 同包 Gate A](evidence/linux-server/a5f25ba0/advin-server-os.json)通过。

常驻 systemd 采用 `UMask=0077` 后，HTTPS 登录和读写成功，但首条 UI Run 停留 queued；日志明确提示内置
Skill 摘要不匹配。新建内置文件的声明模式 0644 被 umask 过滤成 0600，摘要包含模式，导致 Skills subsystem degraded。
既有 `skill::slow_tests::official_skills_apply_management_policy_and_preserve_user_managed_changes` 在独立进程
umask 077 下复现同一失败；修复通过新文件句柄显式恢复内置声明模式，私有 Skill 根权限保持不变。
既有测试在相同 umask 下修复后通过（1 项）；Gate A 增加 umask 077 和五项执行基础 subsystem ready 检查，
避免再由纯 HTTP 成功掩盖调度阻塞。初次 HTTPS 与调度阻塞记录见[部署观测](evidence/linux-server/a5f25ba0/deployment.json)。

最终安装来源为 `448c234f9163c58f9cb122114453131e7764e15c`；[CI Run](https://github.com/murray17/rovai-ai/actions/runs/34856416812)
已全部通过：[Ubuntu 22.04](evidence/linux-server/448c234f/ubuntu-22.04.json)、
[Ubuntu 24.04](evidence/linux-server/448c234f/ubuntu-24.04.json)、[Debian 12 VM](evidence/linux-server/448c234f/debian-12.json)
与 [Advin](evidence/linux-server/448c234f/advin-server-os.json)使用同一归档，包含 umask 077 和执行基础子系统检查。
[ABI](evidence/linux-server/448c234f/linux-abi.json)最高导入 GLIBC_2.34，manifest SHA-256 为
`d06610be60674bf90b6cd2a5516ddfb41525a3b479752535a1e6abab0d53e9ed`。

[常驻部署](evidence/linux-server/448c234f/deployment.json)通过公网 HTTPS、匿名拒绝、Token 登录、systemd 重启和
持久会话。浏览器升级刷新后恢复登录，在 390×844 视口配置 Codex 的 workspace-write/on-request，真实发消息并
收到「连接成功」，Run succeeded。五项基础子系统 ready；服务限制 4 GiB / swap 0，异常退出停止，不自动重启，
已启用开机启动。机器资料、私有凭据路径和手机操作步骤记录在用户 Obsidian 文档，不把凭据写入仓库。

本机共 11 项 Runtime 完成上述六项有限检查；TRAE 按维护者异机实测记录通过，Kimi 已按授权跳过，
Antigravity 保留地区资格阻塞。Server OS 与 Runtime 结果分别记录，未由 Gate A 推导 Gate B。

这些是有限集成证据，`fullQualification=false`；Skills/MCP、权限与压缩等 First-Class 全轴尚未逐项闭合，
14 项 Linux Runtime 均保留 Preview 与缺失资格原因。正式 Release 和实体手机资格尚未完成。

## 本轮：Mobile 执行文案与文件资源性能

手机发送或排队发布 Run 后保持对话页；执行标签仍可主动打开。手机 Run 摘要改用 Desktop 相同的时间范围、
AgentRun 状态和“当前执行”标记，不把正文“思考中”的占位拿来代替 Run 状态。

确认六项开销后实施以下修复，边界由 [Host Web v2](../../contracts/host-web-v2.md#workspaces-uploads-and-resources) 拥有：

- 分块读取及计算摘要，只保留所需页；与内容摘要绑定的 UTF-8 / 稀疏行号信息减少重复扫描。
  每次仍完整重新计算 SHA-256，不能按相同大小或修改时间跳过内容验证。
- 文件预览图片、子图片与预览下载改为认证字节响应，原始内容和大小限制不变。
- 上传绑定成功后，仅在 Host 再次确认来源、可用性与摘要一致时复用当前设备 File 缩略图；刷新或变化回退 Host 读取。
- 浏览器按 256 KiB 切片计算原 SHA-256，并在片段间让出 UI 线程；Host 分块接收、增量计算摘要并写临时文件。
  上传取消、拒绝、重复、绑定未知与 Core source 生命周期继续使用原规则。
- 文件更新订阅还须有活动句柄才启动两秒轮询，全部释放后停止，重新打开后恢复。
- 只有构建清单中带哈希且实际字节摘要匹配的资源可长期缓存；入口、业务、认证、附件和私有文件仍为 no-store。

功能来源提交 `2ace68a6`。完整前端测试通过（2028 / 200 文件，Node 317 通过、2 既有平台跳过）；
最后的“保留默认 Run、只取消切页”调整另经 194 项定向测试和真实 Run 验证。
Rust workspace 847 通过、6 既有手动 ignored，另有 slow-tests 310 通过；Clippy、格式、类型与文档门禁通过。
[检查记录](evidence/web-resource-performance/checks.json)保留最初失败、修复后的 owner、命令和验证范围。

[固定工作量测量](evidence/web-resource-performance/measurement.json)使用独立 Debug Host、20 MiB 文本和 80 页，
核对每页内容、行号与完整下载字节。下载响应从 Base64 JSON 的 27,962,080 字节改为 20,971,520 原始字节。
计时仅作单机观察，不设毫秒门槛，不据此声称消除了每页完整摘要读取，也不等同于实体手机或物理磁盘流量测量。
复跑入口是 `node scripts/measure-host-web-resources.mjs`。

从功能提交[构建](evidence/web-resource-performance/build.json) 0.2.6 arm64 daily 包，签名、架构与 Bundle ID 门禁通过。
包内 Host HTTP 验证原始字节、同大小/修改时间的变化拒绝、上传取消/上限/重放清理和静态缓存边界。
[手机正式入口](evidence/web-resource-performance/mobile.json)上传 2 MiB 图片，Host 确认后初始缩略图不取回原图，
刷新后一次原始字节读取恢复图片；既有 HTML、独立草稿、设置、目录和定时流程继续通过。
[共享执行组件](evidence/web-resource-performance/execution.json)验证两主题、四宽度、时间线、逐 Run 折叠和标题文案。
[包内真实 Runtime](evidence/web-resource-performance/runtime.json)由隔离 Desktop 的 Host 托管，手机点击发送后保持对话，
手动执行页直接选中对应 Run，command 在运行中可见；Mobile 与 Desktop 摘要相同，Run 最终成功。

[包级恢复](evidence/web-resource-performance/validation.json)继续验证正常 App/Host 重启、浏览器重开、独立草稿和显式撤销。
首次在隔离 App 的 Camp 操作阶段发生 CDP 超时，夹具已有创建成功的 Camp；只增阶段日志，保持原断言与超时串行复测通过，
不把时序推测写成产品根因。

已[非终止安装](evidence/web-resource-performance/installation.json)到 `/Applications/Rovai AI.app`，备份为
`/Applications/Rovai AI.backup-before-resource-perf-2ace68a6-20260914T110020Z.app`。App/Host/Core/CLI 摘要和全部 139 个 Web 文件与验收产物一致；
记录的 5 个日常 App/Helper/Host 进程保持原 PID 与启动时间，安装器没有修改日常 userData。
当前进程继续运行原版，退出并从规范路径重新打开后启用新包，已有 Web/Mobile 页面刷新后使用配套前端。
此批仍为 macOS arm64 与 Chrome 手机视口模拟，Windows/Linux 和实体手机资格没有新增；后续证据提交不改变包来源。

## 本轮：浏览器会话容量与 Mobile 修复

连续关闭并重开浏览器会触发 `fork: true`，旧派生 Session 原先只等待 30 天过期，最终耗尽 32 个名额。
可控时钟回归在第 31 次派生恢复复现容量失败。现在保持 32 上限，满额时回收最久未认证的空闲 Session；
在途 HTTP、SSE 和当前派生请求持有的 Session 不参与回收，写入失败不提前撤销旧记录。
既有 Rust 准入与重启恢复 owner 增补 96 次派生、全在线容量拒绝、长期 Token 登录回收、重启和存储失败检查。
独立真实 Chrome owner 连续新开/关闭 40 次，同时保留两个在线标签，核对身份、草稿和浏览器进程重开免登录。
精确边界见 [Host Web v2](../../contracts/host-web-v2.md#bounded-session-admission)。

Web 发起的 Run 只显示“思考中”的根因为前端操作白名单遗漏 `agentRunExecution.changes`。
Host 已持有证据，共享执行窗口的增量请求却在发送前被客户端拒绝；补齐白名单并以实际 ConsoleClient / CampAdapter /
ExecutionWindow owner 验证新增 command 与原记录状态更新。真实隔离 Desktop Host + Codex 也观察到 command 在运行中出现。

Mobile 修复普通主按钮颜色、执行中图标、时间线对齐、输入提示位置和退出按钮字距；Web / Mobile 标题统一为 `Rovai AI`。
记忆页不再自动选中首条导致列表立即消失；支持多条列表、点选/返回、修订，治理操作靠近正文，版本记录按需展开。
页面规则由 [Mobile WebUI](../../ui/host-web-mobile.md) 拥有。

功能提交 `7d497e25` 的 TypeScript、完整前端测试（Vitest 2025 / 199 文件；Node 317 通过、2 个既有平台跳过）、
staged Rust 全 workspace（846 通过、6 个既有手动场景 ignored）、Clippy 和格式门禁通过。
既有 Host / 渠道 / 时钟 3 组与 Mobile 3 组回归通过；[检查记录](evidence/web-mobile-recovery/checks.json)
保留最初回归失败、测试脚本修正与最终范围。包级 App 曾出现一次 CDP 超时，串行复测使用原断言和超时通过；
手机真实运行脚本误选隐藏的单聊按钮，定位后按 `#camp-message` 所属表单点击，未改产品来适应脚本。

从该提交[构建](evidence/web-mobile-recovery/build.json) 0.2.6 arm64 daily 包并验证签名、架构和 Bundle ID。
[包内恢复验收](evidence/web-mobile-recovery/validation.json)覆盖正常 App/Host 重启、浏览器重开、草稿归属和显式撤销；
[真实标签页回归](evidence/web-mobile-recovery/sessions.json)使用包内 Host/Web 连续关闭并新开 40 次，另两个在线标签的
身份与草稿不变，浏览器进程重开免登录，最终 Session 数保持 32。
[手机正式入口](evidence/web-mobile-recovery/mobile.json)使用包内资源验证列表、记忆操作、按钮与设置；
[真实 Runtime](evidence/web-mobile-recovery/runtime.json)由隔离打包 App 的 Host 托管，手机页面点击发送后，
Codex command 在完成前已显示，宽屏切换同样可见，Run 最终成功。头像/多 Run/主题仍由
[共享组件证据](evidence/web-mobile-recovery/execution.json)拥有，不能把示例数据当作真实执行。

已[非终止安装](evidence/web-mobile-recovery/installation.json)到 `/Applications/Rovai AI.app`，
备份为 `/Applications/Rovai AI.backup-before-recovery-7d497e25-20260914T101039Z.app`。
安装器核对 App/Host/Core/CLI 摘要与全部 138 个 Web 文件；记录的五个日常 App/Helper/Host 进程均保持原 PID 和启动时间。
当前进程继续运行原版，退出并从规范路径重新打开后启用新包；旧的持久认证格式兼容此次升级。
本批次为 macOS arm64 与 Chrome 手机视口验收，未补齐 Windows/Linux 或实体手机资格；后续证据提交不改变功能包来源。

## 先前批次：同步 main 与本机安装

2026-09-14 按用户要求合入 main `0bfc35b0`，执行失败信息现在位于该 Run 执行记录末尾；Desktop、Web 和
Mobile 共用同一组件。合并没有冲突，功能源码提交为 `4ffb6892`，包含此前 Mobile、Web 执行光圈与认证持久化改动。

从该提交构建 0.2.6 arm64 daily App，App、Host、Core、CLI 的 ad-hoc 签名、架构与 Bundle ID 门禁通过。
[构建来源](evidence/main-local-install/build.json)记录包内二进制摘要和 138 个 Web 文件。
[包级验收](evidence/main-local-install/validation.json)使用全新隔离 userData / Skill Library / MCP，
由真实 Electron Main 启动包内 Host、选择包内 WebUI，未启动真实 Runtime。
覆盖 Desktop 就绪、普通 Token 登录、30 天有效期/7 天窗口元数据、窗口外续期不变、私有认证文件、
刷新保留草稿与编辑身份；正常退出并重开隔离 App 后，长期 Token、原 Bearer、原编辑身份和草稿仍可恢复。
Chrome 进程重开直接恢复普通 Session，手机 390×844 布局展示五项导航、新编辑不继承旧草稿且无横向溢出。
显式关闭 Web 后 Core 继续就绪，重开后旧 Session 及续期请求被拒绝，原长期 Token 仍可重新登录。
手机证据为 Chrome 视口模拟，不是实体设备；30 天/7 天时钟边界继续由此前可控时钟测试拥有。

TypeScript、Desktop/Web 构建与完整 `pnpm test` 复验通过（Vitest 2024 / 198 文件；Node 317 通过、2 个既有平台跳过）。
首轮与 Release 编译并行时，Evaluation Host 等待子进程完成的轮询超时；保留该失败，未改代码或放宽断言，
定向 4 项及随后完整套件均通过，不将时序相关推测写成已确定的根因。
`pnpm test:rust:pr` 通过：Core 基础 805 项、CLI 35 项、slow integration 310 项，共 1150 项；
6 个既有手动场景保持 ignored。Clippy workspace all-targets、Rust 格式与文档门禁通过。
完整命令、首轮失败与复测范围见[检查记录](evidence/main-local-install/checks.json)。

已用专用 daily 安装器[非终止安装](evidence/main-local-install/installation.json)到 `/Applications/Rovai AI.app`，
备份为 `/Applications/Rovai AI.backup-before-main-4ffb6892-20260914T084702Z.app`。
App/Host/Core/CLI 摘要及全部 138 个 Web 文件与验收来源相同；安装前记录的六个 App/Helper/Host PID 和
启动时间均保持不变，没有重启日常实例或修改日常 userData。当前进程仍运行旧版，用户退出后从规范路径打开才生效。
此次从未持久保存认证的旧版升级，Web 需要重新登录一次；之后按新版长期 Token / Session 合同恢复。
安装后的文档与证据提交不改变 `4ffb6892` 功能包，不代表 Windows/Linux 或实体手机资格已完成。

## 先前批次：长期 Token 与 30 天 Session

2026-09-14 按用户确认补齐统一 Host 与浏览器认证持久化，默认 Session 30 天、有效期剩余不超过 7 天时续期。
续期保持同一 Bearer 与编辑 ID；二维码继续兑换普通 Session。Desktop/Server 的正常退出、重启与升级保留未过期
Session，主动登出仅撤销当前 Bearer，Token 重置和显式关闭 Web 撤销全部 Session。写盘失败不给出成功响应。
浏览器持久认证不含长期 Token 或编辑证明，标签页草稿归属继续独立；新浏览器页通过已有 Bearer fork 新编辑身份。

时间矩阵扩展既有 Rust Session 生命周期与浏览器客户端 owner，用可控时钟覆盖 7 天边界、30 天延期、实际过期、
并发续期及网络失败。唯一新增 Rust 文件 seam 验证原子持久化、损坏拒绝、写失败、重启与撤销竞争，使用私有临时目录，
没有 Core/SQLite/Runtime。进程验收扩展既有 Host HTTP、原生 Server 与浏览器恢复脚本。

[浏览器记录](evidence/session-renewal/validation.json)验证真实 Chrome 进程重开、同标签页刷新、复制标签页隔离、
Host 重启保留 Bearer/编辑身份、一次性扫码及真正两分钟票据过期。该两分钟检查为既有扫码 smoke；Session 的 30 天/7 天
矩阵全部使用可控时钟。新页面从持久普通 Session fork 新编辑身份，截图确认不带入原标签页草稿。
HTTP 验收同时覆盖已关闭状态的显式关闭、此前重置/关闭的 Session 重启后仍拒绝；原生 Server 默认/自定义目录、
长期 Token 查询、重启 Session 恢复和终端受控退出通过 macOS 验收。Windows 控制台专项保留跳过，不冒充跨平台结果。

旧版本仅驻留内存的 Host Session 无法事后补存，首次升级需要重新登录；旧 standalone Token 可以导入，旧 Desktop
进程结束后无法恢复未持久化 Token。本版本成功保存后的正常重开、重启与升级按新合同保留。
Web 构建、TypeScript、Clippy（workspace all-targets、零 warning）和文档三门禁通过；staged Rust 路由触发
workspace default features：Core 805、CLI 35、Web 6 项通过，共 846，6 个既有手动场景保持 ignored。
完整 `pnpm test` 通过（Vitest 2022 / 198 文件；Node 317 通过、2 个平台专项跳过）；随后补充旧恢复材料离线迁移
与浏览器存储失败登出，认证定向套件最终 22 项通过。最终范围和来源摘要由 [检查记录](evidence/session-renewal/checks.json) 汇总。

## 先前批次：同步 main 与 Web 执行入口

2026-09-14 同步 main `42e1e6d1`，包含执行入口运行头像/双弧及会话横向溢出修复。
宽屏 Web 复用 `CampDetailEntries` 与 `runningCampMembers`，不另建运行状态或动效实现；
同一队员去重、最多三张头像、超出 `+N`、完整名单、减少动态和停止后撤下均沿用共享组件。
合并时保留手机布局上下文，把原手机 `runningCount` 调整为同一 `runningMembers` 投影。
正式手机仍显示蓝点；紧凑双弧在执行标签内的方案只交付 HTML 交互稿，头像保留在执行页。

补充宽屏 Chrome/Electron 组件验收的单人/十人入口、768/1040/1440px 浏览器几何、焦点名单、
收起保留提示、减少动态及模拟停止；手机回归覆盖运行/审批提示与既有多 Run 展开。
Chrome headless 显式设置前台焦点模拟，Electron 夹具使用自身 WebContents 焦点；
它们仍是组件与模拟执行证据，不代表实际模型或实体手机验收。
HTML 使用共享生产组件和本地展示覆盖，覆盖浅色/深色、运行/等待/空闲/停止与静止动效，
不连接 Host，不修改正式手机样式。原生 App 本轮未安装。

[验证记录](evidence/execution-entry-sync/checks.json)保存源码摘要、28 个宽屏场景、手机组件与交互稿检查范围。
TypeScript、fixture 类型检查、Desktop/Web 构建、完整 `pnpm test` 通过（Vitest 2015 / 198 文件，
Node 317 通过 / 2 个既有平台专项跳过）；执行头像入口与文件引用/横向溢出的原生 Electron 回归通过。
新增检查先修正了隐藏窗口焦点与多 Run 夹具的选择前置，最终两端全部通过；没有改变产品的焦点或执行语义。

## 先前批次：Mobile 正式入口

用户确认第四稿并补充左侧蓝点、完整六种定时计划与手机日期选择后，已将手机布局接入实际 `apps/web`。
新增展示上下文与 Web 专用样式，继续复用 BusinessApp、Camp、结构化 Composer、执行与正式管理页；
不复制示例状态机，不改变统一 Rust Host。原生 Desktop 不启用手机布局。

手机根页为五项底部导航；对话、执行、任务切换不加入返回历史。会话列表连续 44px，当时的未读蓝点位于左侧，
初始 5 项、每次增加 5 项，Desktop 保留每次增加 10 项。文件预览全屏阅读后返回对话，公共/私聊分别保留草稿。
输入框 Return 换行，@ 入口复用结构化 Mention，发送继续使用原命令与默认接收逻辑。

多队员执行头像自动换行，连续 Run 独立展开并通过已有标签页恢复存储保留展示状态。
队员/记忆改为列表和详情分屏；Runtime 页内编辑；设置复用正式页面并提供 A 字号滑条。
定时类型为每天、工作日、每周、仅一次、自定义 Cron、手动触发，手机底部日期/时间面板复用 Desktop 字段和校验。
Desktop 托管的手机页面只有关于；独立 Server 有原生安装/更新说明入口，自动下载/安装/重启 API 仍未交付。

[生产入口记录](evidence/mobile-production/validation.json)、[执行组件记录](evidence/mobile-production/execution-validation.json)
和[独立 Server 记录](evidence/mobile-production/server-validation.json)分别标明真实 Host 与模拟执行证据。
测试脚本为 `pnpm test:host-web-mobile`，使用隔离数据、Skills、MCP 与 Chrome 目录，不启动真实 Runtime。
实体手机软键盘、相机、后台恢复、网络切换与第二设备联调仍待完成；不以窄屏模拟宣称第五阶段全部验收。

TypeScript、Desktop/Web 构建、完整 `pnpm test`（Vitest 2009 / 198 文件、Node 317 通过 / 2 个平台专项跳过）、
文档三门禁通过。Desktop 导航、启动、Composer 与文件预览原生回归通过；宽屏 Chrome/Electron 双入口 24 个场景通过。
手机入口 3 组覆盖真实 Host、共享执行/审批组件与独立 Server；最终校验范围与来源见 [验证总表](evidence/mobile-production/checks.json)。

## 先前批次：最新执行态与 Mobile 交互稿

Mobile 第四稿将会话行压为连续 44px，移除列表日期、行间分隔和消息日期分组；顶栏保留圆圈加号，项目级
改为普通加号。队员消息名后展示 Codex CLI 等 Runtime；移除焦点黑框与装饰，设置图标对齐正式 NavigationIcon。
执行区采用 Desktop 浮层的头像/状态样式，手机自动换行；每位队员示例包含三次可独立展开的 Run，紧凑历史行
和运行中“正文—command 组—正文”交错内容；命令类型、当前高亮、阅读锚点、切换/刷新恢复分别验证。
新建任务只显示标题、说明、验收条件和负责人，默认待处理；编辑保留状态。此轮仍只交付本地交互稿与文档证据，
不改生产代码或 Host，也不安装 App。

Mobile 第三稿进一步将根页面与项目新建改为无底色圆圈加号，移除普通页顶部重复品牌和口号，文件夹采用生产
圆角开合图标。11 个示例项目会话覆盖 5 → 10 → 11 条、“查看更多 / 收起”、独立文件夹开合与返回/刷新恢复。
定时任务按正式 `AutomationEditor.memberId` 改为单一执行队员，带头像单选并保存；删除前稿错误的“执行队伍”页。
这次只调整交互稿与证据，不改变生产业务或 Host 接口。

Mobile 第二稿根据 25 项反馈收敛：白 / 黑阅读面、紧凑对话列表、按需搜索和项目入口、普通登录页复用、
对话内审批、带头像和一键创建的新建面板、页内运行时编辑、Skills 生效组、多队员执行、@ 与既有默认接收提示、
用户消息靠右、圆形回到最新、A 字号滑条。移除铃铛、会话地图、队员页的 Skills/MCP、执行中的队员配置，以及
没有生产汇总能力依据的全部会话文件 Tab；消息附件预览与引用保留。

“远程连接”已在共享 `CampNavigation` 中移入能力分组、渠道上方，Desktop/Web 同时生效，Mobile 稿一致。
其他手机交互仍为本地提案；上述修改不表示生产 Mobile 已实现。验证与截图记录在本页下方的 Mobile 证据入口。

同步 main 的 command / Compact 呈现：指令与类型图标一致、收起运行文字高亮、展开后静态、状态在最右、
触摸目标和明确提示、异步结果与收起时保留阅读位置。两处合并冲突只涉及 import；保留网络 CampClient
和幂等命令依赖，同时加入共享 RunningText / useExecutionDisclosureAnchor。实际 Web 入口继续挂载
BusinessApp 并引入共享样式；执行详情和内容读取仍由显式网络客户端完成。

默认 Vitest 原先仅匹配 `.test.ts`，遗漏 main 新增的 8 个 JSX 组件用例；已通用扩展至 `.test.{ts,tsx}`。
既有 Desktop/Web 对照 owner 改用当前 disclosure 和 Runtime 参数选择组件，增加运行摘要、展开静态、
阅读锚点、触摸与减少动效验证。完整加载/失败/重试、键盘及位置切换继续由既有 CampOpen owner 负责。

[Mobile 稿](../../ui/host-web-mobile.md)按本轮用户要求恢复，单文件 HTML 随 Camp 附件交付，源码保持本地忽略。
五个底部入口、对话单列详情、底部面板、独立草稿、HTML 预览、共享管理功能和两套主题均纳入示例，并同步
上述执行态。Desktop 托管保留渠道且没有更新；独立 Server 隐藏渠道并提供更新提案入口。当前 Web 的 Server
更新适配尚未接通，稿中检查/下载/重启为模拟状态，不代表生产 API。

验证分别记录在 [Mobile 示例交互](evidence/mobile-review/validation.json)与
[执行态同步](evidence/execution-sync/validation.json)。本轮不安装或重启日常 App，不启动真实模型，
不把本机 Chrome/Electron 或窄屏模拟计为实体手机、Windows、Linux 或三平台验收。

TypeScript、Desktop/Web 构建、Vitest 2009 / 198 文件、Node 317（2 个 Windows 专项跳过）和文档三门禁通过。
[双入口对照](evidence/execution-sync/shared-browser-parity.json)覆盖 24 个场景，
[CampOpen](evidence/execution-sync/camp-open.json)的 9 组回归全部通过；没有 Rust 改动，staged 路由明确跳过。
初稿 15 组、第三稿 25 组和第四稿 28 组示例流程通过，当前证据为第四稿，截图覆盖日夜、小屏、横屏、
多行头像与连续 Run。头像压力样例改为页面初始化前注入后全量重跑；没有放宽检查条件。
上述生产构建与单测属于执行态同步批次，本次纯交互稿不重复执行或冒充新增生产验收。
HTML 子帧使用独立 CDP target 检查，未放宽它的 opaque sandbox。

## 本轮：HTML 附件预览与正式登录页

以下记录保留该批次的验证事实；不透明来源策略随后由 [V1.59-D09](decisions.md#v1-59-d09)取代。

Web 的 HTML/HTM 不再强制标为普通文本。正式文件查看器复用 Desktop 的交互视图、源码读取、查找与诊断；
认证 Host 读取后把文档交给无凭据静态 shell，响应 CSP 和 iframe 都使用不含 `allow-same-origin` 的 sandbox。
保留原读取限额、编辑归属和 generation 校验；当前单文件 HTML 与 HTTP(S) 依赖可用，本地多文件站点依赖尚未接通。
下方早期“HTML 不执行”的记录仅描述当时实现，当前边界由 [Host Web v2](../../contracts/host-web-v2.md)拥有。

已确认的登录交互稿接入正式 WebUI：沿用完整 Rovai 标志、Porcelain Day / Steel Night、紧凑 Token 表单，
支持键盘提交、Token 显隐、真实错误和提交反馈；恢复与扫码等待共用同一品牌入口。
提示为“输入 64 位的 Token”，位数来自现有 32 字节随机值的十六进制编码。首次登录跟随浏览器设备主题，
已挂载工作台的重新登录沿用当前主题与编辑；继续使用原 Bearer Session 和标签页恢复机制。
该登录页批次仅适配窄屏入口；后续 Mobile 工作台实施见本页顶部。
“核对 N 项提交／重试原提交”追溯到 `b62752dd9`（2026-09-12），此前在未确认完成的命令或上传期间显示。
用户随后确认移除这两个 Web 专用按钮及其界面计数，Desktop 本来没有这些入口；保留断线反馈、
原命令材料、自动回执核对和幂等逻辑，不因移除按钮而自动重发命令。按用户要求关闭 PR #345；后续默认仅推送任务分支。

正式登录页使用隔离 Rust Host + Chrome 验证：日夜 1440/390px 与 844px 横屏、键盘显隐/Enter、错误 Token、
真实离线请求、提交禁用、刷新恢复、同一编辑器重新认证、扫码单次进入及两个浏览器草稿独立均通过。
验收脚本首轮过早点击尚未加载的会话列表；两处改为等待正式列表出现后，原产品代码通过完整复跑。
TypeScript、Web 构建、Vitest 2001 / 197 文件、Node 317 通过（2 个既有 Windows 专项跳过）与文档门禁通过；
本次不改 Rust，不把 macOS 浏览器模拟窄屏计为实体手机或 Windows 验收。

干净 `831092a0` 构建 0.2.6 arm64 daily App，架构、Bundle ID 与 ad-hoc 签名通过。
[包级复验](evidence/web-login/validation.json)使用包内 Host 和 WebUI，覆盖上述登录全流程；
HTML 既有 owner 同时通过，测试 UI 目录与包内目录逐文件一致。
已由专用 daily 安装器非终止安装到 `/Applications/Rovai AI.app`，
备份为 `/Applications/Rovai AI.backup-before-web-login-831092a0.app`。
[安装核对](evidence/web-login/installation.json)确认 App/Host/Core/CLI 哈希及全部 138 个 Web 文件与来源相同，
原 App、Host 和三个 Helper 的 PID 均存活。当前进程仍是旧版；用户退出后从规范路径重开，再刷新 Web 生效。

`pnpm test:host-web-html` 拥有真实 Rust 授权读取、正式共享 Viewer 与 Chrome CSP 的新适配交界，
无需 Electron 或模型；已有 Host HTTP owner 扩展 HTML 分类、原稿读取和编辑/代次拒绝，不新增 Rust 测试实例。
TypeScript 单元测试拥有注入位置映射与 opaque 消息来源/代次校验；Desktop 原不同源站点由既有 HTML 回归负责。

## 本轮：区分默认端口与 Web 设置导航

`e863243c` 将 Desktop 托管 Web 默认端口从 4317 改为 8766，独立 Server 默认监听改为
`127.0.0.1:8767`；显式参数与已运行监听优先，未应用的 Desktop 端口仍只在下次开启生效。
`8e1e704e` 让 Web 设置复用 macOS 固定 270px 导航规则：展开后不显示折叠、后退、前进或调宽入口；
继承折叠状态时仅保留展开恢复，退出设置后还原普通页面宽度。浏览器 History API 和普通页面按钮保留。

TypeScript、远程连接 14 个既有模拟视图/交互、Server 入口 2 项、正式导航组件原生输入 owner 1 项通过。
导航 owner 在同一 macOS Electron fixture 切换 darwin/win32 客户端标记，验证两类浏览器都采用同一设置规则，
不将标记切换计为 Windows 原生验收。通用文档门禁通过。

[实际包与浏览器验证](evidence/default-ports-settings/validation.json)使用干净 `8e1e704e` 的 0.2.5 arm64 daily 包，
隔离 userData/Skill/MCP 及 Chrome profile；Desktop 正式开关实际启动 8766，同时由本机 debug `rovai-server`
不带 listen 参数启动独立数据根的 8767，两处 HTTP 均可用。Web 通用/远程栏目无顶部控件，刷新及浏览器后退
返回设置仍保持；普通页三个按钮保留。Server 受控停止成功，关闭 Desktop Web 后 Core 仍 Ready，未启动模型。
首轮自动化在引导首个点击发生 CDP evaluate 超时；增加逐次点击记录及窗口激活后，以原期限和同一产品包通过，
不将该结果视为已确定超时根因。仅端口的中间打包在收到导航补充后停止，未安装；最终从完整提交重新打包。

## 本轮：默认队伍与一键创建设置对齐

Web 正式页面最初接入时（`b62752dd9`），通用偏好适配将默认队伍、队长和一键创建开关保存为浏览器本地值，
因此无法带入 Desktop 设置。`apps/web/src/preferences.test.ts` 在原生产适配上复现：期望已保存队伍及开启开关，
实际返回 null / false。修复后三项由当前 Core 统一持久化，两端共用偏好适配；Desktop 旧值只导入一次，
其他展示偏好保留客户端归属。新对话点击前重读，读取失败不以空默认值继续创建；请求期间阻止重复点击。

既有 HTTP / Host 生命周期 owner 扩展验证跨端读写、设置合并、旧副本重复导入、迟到失效请求、无效队伍拒绝、
Host 重启与损坏记录显式失败；本机 1 项通过。客户端、原偏好与选择规则 4 文件 / 33 项通过，TypeScript、
Desktop/Web 构建及通用文档门禁通过。新建弹窗唯一的 `compact-primary` 仍使用旧 Steel token，改为已有
conversation-action 中性按钮；日间为黑色，夜间遵循同一主题配对。该处在 `112db2a83` 中性操作按钮调整时遗漏。

功能提交 `ff7e6a1f`，`ee224fa0` 补齐页面实际观察值到失效请求的传递，避免旧页面使较新队伍失效；
后者的相关 3 文件 / 20 项复验、TypeScript、Core/Web/Host Clippy `--all-targets -- -D warnings` 通过。
实际 0.2.5 arm64 daily 包的[界面证据](evidence/shared-defaults/validation.json)覆盖 Main 旧设置导入、Web 通用回显、
Web 保存后 Desktop 回显、日夜弹窗默认勾选及按钮颜色、一键 Pending 创建与刷新恢复。
脚本使用独立 userData/Skill/MCP 和 Chrome profile；仅浏览器看到的 Runtime 可用性为响应夹具，
设置持久化、授权、Camp 创建和读回均使用实际包内 Host；未启动真实模型。

验证脚本曾因 DOM 引用不可序列化、过早检查保存状态和错误的单数 `camp.open` 方法失败，已分别修正为
布尔谓词、完整保存完成态和既有 `camps.open`，未放宽数据断言。另有 CDP 启动/evaluate 超时；
脚本增加分阶段记录，并在启动及切换受测窗口前调用 `Page.bringToFront` 后，以原超时和原产品代码完整通过。
最终观测的 visibility 均为 visible，不能据此认定先前超时由窗口遮挡造成；根因仍未确定。

[本机安装记录](evidence/shared-defaults/installation.json)：专用 daily 签名、Bundle ID 与架构门禁通过，
官方非终止安装到 `/Applications/Rovai AI.app`；app.asar、Core、Host、CLI 与验收来源的 SHA-256 一致。
旧包保留为 `Rovai AI.backup-before-shared-defaults-20260913T135905Z.app`，原五个进程继续存活，
用户退出后从规范路径打开才使用新版本；后续提交仅含验收脚本与文档证据。

## 本轮：扫码登录、Web 刷新恢复与共享导航

2026-09-13 后续同步 main `93487750`，合并提交 `b1d5000f` 保留原 Web 实现，并纳入共同的“回到最新”
交互；TypeScript 与 Camp / 单聊两项对应原生 Electron 交互回归通过。随后按用户新增要求完成扫码登录，
安装的是含该功能的 `4c92c500`，没有先提升中间合并包。

Desktop 远程连接二维码改为显式“扫码登录”。普通复制地址和手工管理 Token 登录保留；本机管理入口
`host.web.loginTicket` 让 Rust 会话注册表签发两分钟、一次性的随机票据，内存仅保留摘要和到期时间。
至多一张未使用票据；重新生成、轮换管理令牌、关闭 Web / Host 都使旧票据失效。兑换使用已有 Core
编辑证明与 Session 发行路径，授权后再核对票据并原子消费，两个客户端竞争最多一个成功。
Web 读取 fragment 后立即清理地址再 POST，票据不写恢复存储；成功后的刷新继续用现有 Bearer 和原草稿。
此要求替代历史“二维码只能含地址”约束；历史只含地址二维码截图仅证明当时实现，不再代表当前产品行为。

[扫码登录浏览器验收](evidence/scan-login/validation.json)使用真实 Host / 正式 Web：fragment 清理、
StrictMode 单次兑换、票据不进入 sessionStorage、真实 120 秒过期拒绝、刷新保留草稿和复制标签页独立编辑通过。
双客户端同时兑换、重新生成、管理令牌轮换、关闭重启后旧票据拒绝及公共操作禁止签发票据由实际 HTTP owner 验证。
两客户端竞争来自同一 Mac 的独立请求，不宣称已完成两台实体设备扫码验收。
Rust 原 Session 生命周期 owner 扩展输入矩阵后 Web 5 项通过，Clippy 通过；Web 客户端 / fragment / 导航 16 项通过。
设置页 14 个既有状态、双主题二维码独立解码、复制和键盘交互通过；模拟 API 仅证明呈现，不代替 Host 票据事实。

干净功能提交 `4c92c500129be3e2c5bf2850bf196383ecbfb65c` 完成 TypeScript、设置评审入口类型检查、
release 构建及 `package:mac:daily`；0.2.5 / macOS arm64 的签名、Bundle ID 与架构门禁通过。
[实际打包 App 验收](evidence/scan-login/packaged-validation.json)使用独立 userData / Skill Library / MCP，
从 Desktop 正式设置页解码真实二维码，重新生成后旧码 HTTP 401，新码直接进入正式 Web，重复兑换 401；
刷新保留原编辑身份和未提交内容，关闭 Web 后 Core 继续就绪。
[日间](evidence/scan-login/scan-login-day.png)与[夜间](evidence/scan-login/scan-login-night.png)
来自该 App，截图中的票据已经兑换并随隔离 Host 关闭失效；[Web](evidence/scan-login/packaged-web.png)
来自该包所托管的页面。首轮验收曾发生 CDP `Runtime.evaluate` 超时；只增加脚本阶段日志后，在全新隔离目录
以原期限和产品代码重跑通过，未把首次超时宣称为已定位或修复。UI 模拟入口的独立
[状态验证记录](evidence/scan-login/settings-validation.json)另行保留，不冒充真实票据服务。

已通过官方 `install:mac:daily` 完成[本次非终止安装](evidence/scan-login/installation.json)：
规范目标 `/Applications/Rovai AI.app`，备份
`/Applications/Rovai AI.backup-before-scan-login-20260913T132121Z.app`。
暂存及最终目标验签通过，app.asar / Core / Host / CLI 的 SHA-256 与已验收来源相同；
安装前记录的五个 App / Helper / Host 进程仍存活，未修改日常 userData，未开启第二份日常实例。
新版本已安装，当前进程仍是旧版本；用户随后退出并从规范路径打开才生效，以下旧安装记录保留作历史证据。
安装后追加的文档与证据提交不改变上述功能包。

功能提交 `d24a624a` 在已有 Bearer Session 上补齐当前标签页恢复：`sessionStorage` 保存登录、
编辑身份及证明、未提交编辑和原命令核对材料，启动先经 Host 验证再挂载正式页面。
正常刷新保持原草稿身份；复制标签页通过独立文档租约检测后，由 Host 验证并派生独立 Session / 编辑身份，
不继承原标签的编辑与待定命令。派生 Session 不延长原有效期，退出只撤销当前 Session。
非秘密租约与卸载交接标记不保存 Token、证明或编辑内容；这些材料仅在当前标签页 `sessionStorage` 中保存。
上传刷新后只恢复提交核对材料，不把文件正文塞进浏览器存储；未完成上传需要重新选择文件。

main 新增的页面历史、离开保护与导航组件已接入共享 `BusinessApp`。Desktop 继续使用内存历史，
Web 以浏览器 History API 驱动同一导航控制器，页内箭头、浏览器前后退和刷新后的前进保持一致；
Web 控件从左侧开始，不留 macOS 原生三按钮空位。侧栏移除健康连接的“已连接 Host”常驻文案。

[真实浏览器记录](evidence/web-recovery/validation.json)与
[日间](evidence/web-recovery/web-recovery-day.png)、[夜间](evidence/web-recovery/web-recovery-night.png)
使用真实 Rust Host / 正式 Web 页面验证刷新保留原编辑身份和尚未自动保存的 Composer 内容、
页内与浏览器历史、刷新后前进、复制 `sessionStorage` 的新标签独立编辑、退出副本不影响原页。
复制场景使用 `window.open` 触发浏览器原生存储复制，不冒充已点验所有浏览器的“复制标签页”菜单。
正式渠道页面原有浏览器验收通过；原生 Electron 导航与结构化 Composer 两个既有 owner 通过。

macOS arm64 验证：TypeScript、Desktop / Web 构建、Rust Web 5 项、Clippy 与通用文档门禁通过；
HTTP owner 扩展验证 Session 恢复证明、派生身份和独立撤销。客户端 / 浏览器导航 / Composer 定向
22 项通过，Desktop / Web 导航含超过 50 项浏览器历史的 12 项通过。
全量 Vitest 首轮为 1984 通过 / 1 超时失败，失败来自未改动的 CoreClient 启动重试时间断言；
停止并行编译后该文件 21 项定向复验通过，未删除或放宽断言，不将首轮改记为全量通过。
本轮未运行 Windows 原生资格、真实模型或实体第二设备验收；既有 Windows 附件 404 未因此消失。

干净 `d24a624a` 构建的 macOS arm64 日常包版本为 0.2.5，ad-hoc 签名、Bundle ID 和三个 Rust
程序架构门禁通过。[打包 App 验收](evidence/web-recovery/packaged-validation.json)使用全新独立
userData / Skill Library / MCP，走首次引导并通过既有命令暂缓 Runtime 配置；创建测试 Camp，
确认[Desktop 正式页面](evidence/web-recovery/packaged-desktop.png)、包内 Host 开启的
[Web 正式页面](evidence/web-recovery/packaged-web.png)、刷新身份与草稿、关闭 Web 后 Core 继续就绪。
首次脚本曾等待首次引导后的侧栏而超时；补齐新安装引导前置后通过，没有修改产品断言。

按用户明确要求通过 `install:mac:daily` 完成[非终止安装](evidence/web-recovery/installation.json)：
新包位于 `/Applications/Rovai AI.app`，旧包保留为
`/Applications/Rovai AI.backup-before-web-recovery-20260913T125721Z.app`。
暂存与最终位置验签通过，最终 app.asar / Core / Host / CLI SHA-256 与已验收来源一致，原 App、Host
和 Helper 五个 PID 安装后仍存活；不修改日常 userData。当前会话仍运行旧版本，用户稍后退出后从
规范路径打开才使用新版本；不把磁盘替换表述为热升级。安装后追加的记录提交不改变该功能包。

## 本轮：原生入口与 Desktop Web 渠道收敛

在 main `bfd93864` 合入后实现：Web 退出登录收敛到设置 → 远程连接；交互式 Server 就绪后展示现有 Token，
非交互默认不展示；诊断默认仅写当前数据根日志，`--verbose` 才镜像终端；SIGHUP 与 Windows console close
接入既有受控关闭。Windows 原生 close 资格单列，不能把 POSIX PTY 结果记作 Windows 通过。

Desktop Web 注入明确渠道能力，复用正式管理页面与现有 Desktop 发布、恢复、审批人服务；账号登录留在
运行该服务的 Desktop。独立 Server 隐藏渠道入口，不新增渠道迁移或运行层。新增验证区分真实
Host/HTTP/父管道/生产调用适配与平台服务夹具，不把夹具结果写成真实平台 Bot 发布通过。
[浏览器验收记录](evidence/desktop-web-channels/validation.json)来自实际生产 Web 与 Rust Host，
[日间](evidence/desktop-web-channels/desktop-web-channels-day.png)、[夜间](evidence/desktop-web-channels/desktop-web-channels-night.png)、
[审批表单](evidence/desktop-web-channels/desktop-web-approver.png)和[独立 Server 遗留入口](evidence/desktop-web-channels/standalone-legacy-channel.png)
确认正式页复用、授权进度重读、结构化选择、设置内唯一退出与 Server 能力隐藏；平台发布服务为可控夹具，未操作真实账号。
`scripts/lib/server-entry.test.mjs` 的 macOS PTY 实测确认当前令牌仅交互显示、非交互与重定向不显示、
普通输出不镜像诊断、显式 verbose 镜像及真实 PTY 关闭后的 durable settlement。Windows WM_CLOSE case
只在 Windows 执行，Mac 上的跳过不是 Windows 通过。

功能提交 `4f95d5f2` 的 macOS 26.3 / arm64 验证：TypeScript、Desktop/Web 构建、通用文档门禁与
Clippy 通过；全量 Vitest 190 文件 / 1970 项、Node 聚合 317 通过 / 2 原有平台跳过。
Rust workspace default 为 Core 805 通过 / 6 原有忽略、CLI 35、Web 5。
Host 生命周期 / HTTP / 渠道 / Server 入口合计 8 通过 / 1 Windows 专用跳过。
既有隔离 Electron 设置页 owner 通过双主题与缩放、原生账号操作及登录态有效 / 待校验 / 暂不可用。

干净 `4f95d5f2d51f719f79505fbd79639ab9a00cb78a` 生成的 macOS arm64 Debug 原生包版本为 0.2.4，
`rovai-server-0.2.4-macos-arm64.tar.gz` SHA-256：
`0dd18acca26fc43489c9ec41c0eb962842926bcda57a88f26941f5f717583845`。
通过原生安装器装到临时目录，再在无 Node/pnpm PATH 下验证默认 / 自定义根、数据与 Token 保留；
包内程序通过真实 PTY 的凭据 / 日志 / 挂断检查。包与安装 owner 合计 4 通过 / 1 Windows 专用跳过。
这是 development-preview 调试包，不是签名公证或正式发布证明。
Windows 原生资格来自同一功能提交的 [Windows 2022 CI](https://github.com/murray17/rovai-ai/actions/runs/34750040484)：
原生 Release 构建、凭据状态、进程 / 私有存储（含追加日志）检查通过；实际 `WM_CLOSE` 控制台关闭
在 12.37 秒的完整用例中通过，断言退出码 0、durable settlement 与日志不含令牌。该时长含控制台创建、
Server 启动和 PowerShell 编译，不是关闭耗时。新的 Desktop Web 渠道父管道 owner 也通过。
Node 原生批次为 6 通过 / 1 失败 / 3 有原因的平台跳过；整套 CI 仍失败：
`scripts/lib/host-web.test.mjs:182` 的附件读取期望 200、实际 404，与此前
[`ab278fa2` 原生记录](https://github.com/murray17/rovai-ai/actions/runs/34744528165)相同。
保留失败断言，本轮未扩大为 Windows 附件修复；不能把控制台关闭通过记作全部 Windows / 阶段 1–4 完成。


## 当前收敛：原生 Server 数据根、启动与安装

2026-09-13 最新补充覆盖冲突约定：独立入口使用 `~/.rovai-server`，一个 `--data-dir` 推导 SQLite、
MCP、Skills、根内实例 Runtime 文件与落盘日志；Desktop 保持现有存储与同 Host Web。
共享 Rust 路径解析、资源准入与业务实现不分叉；旧预览数据明确提示，不静默初始化空库。
Docker/Compose/镜像/容器更新完全移出本轮任务，不作为可选阶段或 Mobile 前置。

已实现 `rovai-server` 薄入口、共享 Rust `ServerPaths`、精确实例 Runtime 根准入和匹配原生归档；
默认/自定义根、占用拒绝、停止重启、旧数据提示及 Desktop 不变均有定向回归。安装器负责程序与 UI、PATH 与可重复执行，不操作业务数据。
GitHub Releases 为正式发布目标；安装脚本地址、命令可用性与平台资格在发布前不能声明完成。
未来 WebUI/CLI 更新继续按连接的 Host 和安装归属，保留当前 data-dir；不将未实现的便利入口写成已可用。
本轮同步 `origin/main` 至 `de239656`，通过 merge 保留已有分支工作。

本机 macOS arm64 自动验收：默认与自定义根实际经 HTTP 写入 MCP、导入 Skill，重启后读回相同数据与令牌；
同时运行使用既有布局的 Desktop pipe Host，实际从该 Host 读回未变的 MCP/Skills；Desktop 开 Web 前后都未创建独立数据根。
第二 Host 占用拒绝，主库丢失后不重建空库；旧 SQLite、旧默认建议目录和 Desktop 资源目录有明确兼容提示。
入口不会通过 symlink 祖先创建新根。所有进程使用临时账号 Home/独立绝对数据根，不调用模型、不动日常 App。
安装器的归档校验、重复安装、内容替换、错误包不切换、链接成员拒绝、PATH 去重与数据保留通过。
实际预编译 Debug 包及干净 `e1e73ca2` 的 release profile 包（含共享生产 WebUI）均经安装器装到仓库外，
在无 Node/pnpm PATH 下完成同一数据根验收；[包哈希与范围记录](evidence/mac-server-root/validation.json)保留实际来源。
这证明本机安装链路，不等于正式 Release 或其他平台资格。本轮全量 Vitest 190 文件/1968 项、
Node 聚合 317 通过/2 既有平台跳过、Rust workspace default（Core 804 通过/6 既有忽略、CLI 35、Web 5）通过。原 Desktop/Headless 生命周期、同 Core Web 与关闭 Web 后
继续调度的四项 owner 回归通过；Rust 根推导/Runtime root admission、Clippy、TypeScript 和通用文档门禁通过。

测试 owner：`storage_layout` 分别拥有纯位置推导和跨平台私有目录/Runtime root 准入 seam。
后者保留从 Unix-only fixture 移入的精确根、错误 key、重叠及独占 case，并增加 marker/token 重开；
这样 Windows 也能实际执行其原生 ACL 准入，不增加第二份等价 Unix fixture。`server-entry.test.mjs` 必须用真实进程/SQLite/HTTP 才能证明路径传递、
持久化与第二 owner 拒绝；`server-install.test.mjs` 负责已校验包到磁盘入口切换的失败窗口。
最小命令是 `pnpm test:server-entry` 和两个定向 Rust owner，不增加重复 schema/常量测试，也不替代平台验收。

`Full check(scope=server)` 已包含四原生目标的新入口/安装器及带 SHA-256 的归档。只有 main 上手动选择全部目标并开启
`server_release_draft`、且所有 job 通过后，才组装匹配 source SHA/版本/平台的 GitHub draft Release。
该流程不会发布草稿或修改 `server-channel.txt`；目前指针为 `unpublished`，WebUI/CLI 便利更新仍未实现。

## 既有阶段 1–3 业务闭环记录

2026-09-13 本轮继续：先同步最新 main，完成阶段 1–3，再推进阶段四可在 Mac 上完成的部署验收。
Windows/Linux 实机、容器、Mobile 和正式发布仍不纳入本轮。当前同步点为 `d53f8ca9`；
保留共享业务入口，并接入上游导航窗口、执行历史和 Runtime 启动配置。
合并基线通过 TypeScript 与 Rust workspace default：Core 799 通过/6 既有忽略、CLI 35、Web 4。
Task/Memory/Automation/Skills/MCP、单聊和资源适配现已接入同一业务入口；以下记录使用本轮重新执行的证据。
Migration 153 保留上游 150/151/152；旧任务分支的客户端草稿 150 通过精确 schema 检查和原子迁移升级，
保留 editor proof、草稿及回执。Migration 154 继续将私聊 Draft、Pending 来源／编辑绑定客户端，该步骤目标为 schema 104；
随后 Automation 155 和附件路径 156 依次推进到 schema 106，DSH 闭集迁移 157 最终推进到 schema 107。

本轮管理资源与 Host 时钟增量的 Core library：803 通过／6 既有忽略；Desktop 时钟适配 20 项、共享 Web build 通过。
Rust 调度循环在两入口自行运行；原 Host pipe/HTTP owner 与新增无浏览器时钟 seam 共 2 项通过，
后一项使用未配置 Runtime 的持久计划，验证关闭 Web、独立 Host 与重启领取次数，不冒充模型执行或实体睡眠。
随后私聊与四种上传目标共用原业务事务。私聊既有 9 项含新增跨 client 资源／回执／移回矩阵通过，
前端私聊与 ConsoleClient 定向 24 项通过，TypeScript 通过。Migration 154 的数据库组 72 项通过；真实 HTTP 私聊上传/重放、跨 client 拒绝和独立草稿通过。
随后补齐会话管理、Fast、成员排序/移除、通知、运行监控与诊断等共享入口；页面内提醒复用正式控制器。
当前真实 HTTP owner 通过新操作及删除后回执、文件分页/行定位/下载、相对链接/独立恢复、图片归属和变化检测。
实际 Desktop/双浏览器回归已验证提醒保存、监控/诊断下载文件、三草稿及同页重新认证；继续覆盖 Memory
新建/修订/停止沿用、Automation 创建/关闭、MCP 保存、Host 目录导入 Skill、头像上传/裁剪/保存、Task
创建/编辑/取消，以及单聊正文/附件独立与重新认证保留输入。此 UI owner 不调用模型。

[管理页与双浏览器记录](evidence/mac-shared-business/desktop-web-live.json)、
[独立 Host 原生执行](evidence/mac-shared-business/headless-runtime.json)、
[Desktop 托管原生执行](evidence/mac-shared-business/desktop-runtime.json)和
[Host 强杀恢复](evidence/mac-shared-business/host-recovery.json)分别拥有自己的证据范围。
两种入口都从空 Host 经生产浏览器检测 Codex、保存队员配置、选择目录、新建 Camp，完成 source 上传、
发送、一次原生审批、竞争审批拒绝、执行中编辑保留、产物阅读及停止；Desktop 入口另验证执行中关闭 Web，
Core 继续运行，重新登录后可停止。强杀恢复保持原接受输入与 execution epoch，进入显式 recovery blocker，
不重发原提示词；再次重启不产生重复 Run/Task，再由原业务操作关闭未知结果。

本轮常规门禁：TypeScript、Vitest 189 文件/1960 项、Node 聚合 317 通过/2 既有平台跳过，
Rust workspace default Core 803/6 既有忽略、CLI 35、Web 5，以及 slow-tests 310 项通过。
Clippy workspace/all-targets 与 fmt 通过。扩展门禁修正了 MCP slow owner 的宏/字段引用；未删除或禁用用例。
AVIF 大头像由实际静态资源 HTTP 和页面图片解码验证，文件预览继续保持原 HTML/SVG 文本边界。
实体 LAN 第二设备、实体睡眠唤醒、Intel Mac 与其他 OS 不从这些本机证据推导通过。

阶段四的本机增量：[包级升级/回退](evidence/mac-shared-business/package-upgrade.json)校验 manifest，
将实际旧预览包和新 release 包搬至仓库外，用不含 Node/pnpm 的 PATH 启动原生 Host；旧数据迁入当前合同后，
浏览器授权读取保留消息，再恢复停机备份交由原旧包读取。演练保留根目录身份，不做逆向 schema 修改。
旧包为带独立 manifest 的开发预览，不冒充历史正式发布。试验中的目录读取权限只调整本次停止的隔离夹具，
恢复源与备份原权限。初版演练更换 Runtime 根目录触发 marker identity 拒绝，修正为原目录内恢复后通过。
[包内真实 Codex](evidence/mac-shared-business/package-runtime.json)使用搬迁后的 Host/CLI/Web，完成同一生产
配置、发送、原生审批、产物与停止流程；[门禁与二进制范围](evidence/mac-shared-business/validation.json)
记录 macOS 26.3/arm64、声明的最低 OS 与系统依赖。阶段四其余平台及正式发布保持未完成。



最新交互调整：管理令牌栏始终显示，关闭服务后仍能查看和复制；移除环形箭头入口，只保留显隐、复制两个图标。
Rust Host 把管理令牌与监听实例分开保存；首次本机读取即可生成，同一 Host 进程内关闭、再次开启沿用同一令牌。
关闭仍撤销全部浏览器会话；Host 进程退出后不保留令牌。底层显式轮换接口保留，独立更新 Host 保存的令牌。
[关闭态](evidence/retained-token/remote-off.png)、[开启态](evidence/retained-token/remote-day.png)和
[夜间](evidence/retained-token/remote-night.png)使用生产组件；
[交互稿记录](evidence/retained-token/remote-connection-review.json)覆盖 14 个日夜状态以及关闭后显隐、切页读取。
既有 Host pipe/HTTP owner 扩展验证首次读取、启动失败不换令牌、轮换后关闭/重启保留最新令牌、旧 Session 拒绝、新登录成功；
原生设置 owner 继续验证迟到状态与未知启动结果，不新增 Rust 测试函数或 SQLite fixture。
[真实 Desktop/双浏览器记录](evidence/retained-token/desktop-web-live.json)确认首次开启前和关闭后令牌可复制、重启监听不换令牌，
并通过既有目录选择、共享编辑与重新认证回归。仅同机隔离实例，无模型、无第二实体设备。
本次 TypeScript、Desktop/Web 构建、`pnpm test`（175 文件/1798 项 Vitest；Node 317 通过、2 既有平台跳过）、
原生设置、交互稿、Host HTTP 和真实 Desktop/双浏览器均通过。staged Rust 选择 workspace default：
Library 795 通过/6 既有忽略、CLI 35、Web 4 通过；Clippy workspace/all-targets 与 fmt 检查通过。
不冒充 slow/all-features 或新平台验证。

前次交互调整（`73ea01ba`）：管理令牌的显示／隐藏、复制、重新生成改用同一尺寸的图标按钮；
地址与令牌复制成功只短暂变勾，不再在页面下方显示复制或重新生成成功提示。
保留图标可访问名称、读屏反馈、失败时手动复制说明与重新生成确认。
当前[日间](evidence/remote-token-actions/remote-day.png)、[夜间](evidence/remote-token-actions/remote-night.png)和
[复制状态](evidence/remote-token-actions/remote-copied.png)使用生产组件；
[交互稿记录](evidence/remote-token-actions/remote-connection-review.json)覆盖 14 个日夜状态、图标操作、复制内容、
反馈恢复、无页面位移及既有端口／二维码／失败路径。
[真实 Desktop/双浏览器回归](evidence/remote-token-actions/desktop-web-live.json)确认复制成功仅在图标反馈，
并通过既有开启、目录选择、编辑与重新认证流程；仅同机隔离实例，无模型、无第二实体设备。
TypeScript、Desktop/Web 构建、`pnpm test`（175 文件/1798 项 Vitest；Node 317 通过、2 既有平台跳过）、
原生设置、交互稿及真实 Desktop/双浏览器均通过。本次无 Rust 改动，前次 Rust 记录不作为本次重跑。

前次交互调整（`d83786e7`）：端口常驻，修改仅用于下次启动，当前窗口内切换菜单也保留未应用输入；不再选择本机／远程范围，
“远程访问”开关直接开启服务，关闭不再确认。本机与远程地址分别说明使用设备，每行使用复制、二维码两个图标，
复制图形与会话区共用 `CopyIcon`，布局保持设置页的双主题、阅读轴和控件风格。
该次[日间](evidence/remote-addresses/remote-day.png)、[夜间](evidence/remote-addresses/remote-night.png)与
[交互稿记录](evidence/remote-addresses/remote-connection-review.json)覆盖两类二维码、端口延迟应用、切页保留和直接关闭。
该次[真实 Desktop/双浏览器回归](evidence/remote-addresses/desktop-web-live.json)验证输入新端口后旧监听和令牌保持不变，
直接关闭后 Core 存活，再开启使用新端口；随后完成登录、目录选择、共享编辑与重新认证恢复。无模型、无第二实体设备。
本次只调整前端及既有验收，不修改 Rust 网络、认证、草稿与审批实现；下方 Rust 门禁属于前一提交证据。

前次增量（`3e046183`）：设置页保留原有壳层与控件，收紧为“远程访问”开关、连接地址和管理令牌；移除设备装饰图标、
重复副标题、单独开启按钮及开启成功提示。复制地址旁增加本页生成的二维码，只编码所选地址。
Rust 地址发现排除 198.18.0.0/15，既不展示也不作为默认地址；网络准入仍使用实际接口与明确代理地址，
没有可展示地址也不阻止监听启动。原网络测试扩展 CIDR 两端及 IPv4-mapped IPv6，保留同源正反例；
Host HTTP 验证过滤后的投影与未封禁的实际请求准入。浏览器验收通过独立解码器核对所显示二维码的地址。
本增量[日间](evidence/remote-access/remote-day.png)、[夜间](evidence/remote-access/remote-night.png)、
[二维码](evidence/remote-access/remote-qr.png)及[离线稿验收记录](evidence/remote-access/remote-connection-review.json)使用生产组件、模拟 API。
[真实 Desktop/双浏览器回归](evidence/remote-access/desktop-web-live.json)再次通过开启、复制、登录、目录选择与编辑恢复；
与前一轮一样使用同机隔离 profile，不声称第二台实体设备已验收。
本增量通过 TypeScript、Desktop/Web 构建、`pnpm test`（175 文件/1798 项 Vitest；Node 317 通过、2 既有平台跳过）、
Rust Web 4 项、PR library 795 通过/6 既有忽略、CLI 35、slow 309，以及 Clippy、fmt 和固定 base 文档治理。
原生设置、真实 Host HTTP、最终 Desktop/双浏览器和 14 个日夜状态的交互稿验收均通过；二维码由独立解码器核对，
另覆盖空地址、剪贴板失败、窄窗口开关同行和键盘焦点恢复。最终离线产物哈希记在上述交互稿记录中。

前一增量（`c0cc4304`）：正式“远程连接”菜单复用现有设置风格，自动展示实际 Host 接口并独立选择复制地址；
管理令牌可重新查看/复制，重新生成独立确认。取消工作目录预授权，登录后的浏览器可浏览 Host 目录、
输入绝对路径，再进入现有 Core 项目校验与共享新建会话流程。交互稿直接挂载生产远程连接组件。
本增量 [真实 Desktop/双浏览器记录](evidence/owner-host/desktop-web-live.json)已通过：从正式设置开启服务，
复制地址与令牌，通过实际非 loopback 接口登录，使用[浏览器 Host 目录选择器](evidence/owner-host/web-host-directory-picker.png)
打开已存在项目，再继续共享 Camp 编辑、上传、Pending 移回和重新登录；同一 Composer 保留，关闭 Web 后 Core 继续。
测试先在隔离目录创建一个已有项目 Camp；它不冒充新建配置 UI 或第二台实体设备验收。未调用模型。

[日间](evidence/owner-host/remote-day.png)/[夜间](evidence/owner-host/remote-night.png)设计稿使用生产组件，
[14 状态记录与离线产物哈希](evidence/owner-host/remote-connection-review.json)已通过。新增网络纯测试拥有
接口推荐与 authority/origin 配对，覆盖 198.18/15 不默认推荐但不禁用；既有 Host HTTP owner 扩展验证无目录
预授权的项目创建和重复读取令牌不退出会话，未新增 SQLite fixture。

真实 LAN 回归发现 main 的 Pending 草稿协调器残留 `crypto.randomUUID()`（HTTP LAN 不提供该方法），
已改用项目既有 `newCommandId` / `getRandomValues`，既有协调器测试在无 randomUUID 环境运行同一撤回用例。
另修正验收鼠标先移动再按下；原样式的悬停加号保留，临时就绪状态改动和诊断计数已撤掉。
旧证据保留原提交边界，不因当前模型变化而转为通过。

前一增量门禁通过：TypeScript、Desktop/Web build、`pnpm test`（Vitest 175 文件/1798 项，Node 317 通过/2 既有平台跳过），
后续受影响的 App/client/draft coordinator 定向 185 项；Rust Web 4 项，Rust PR library 795 通过/6 既有忽略、
CLI 35、slow 309；workspace all-target check、Clippy、fmt 和固定 main base 文档治理。
重建 Host 的 HTTP、真实 Electron/双浏览器、最终原生设置与离线稿验证均通过，未跳过。
未验收第二台实体设备、Windows/Linux 新增量或本增量的真实模型执行；阶段 1–3 整体仍在进行。


用户以 PR #345 / `077bf78e64c76e934c45675ddb55e05165a2c49f` 提交补充静态审阅后，已核对实际
本地与远端提交一致。已交付三项材料：[行为差异表](https://github.com/murray17/rovai-ai/blob/0479da42f66e0f1a390d8bbe07e0d575b1ca0bfd/docs/ui/host-web-parity.md#一张行为差异表)、
生产 React 组件的宽屏可点击稿（同页说明构建与验收）、[一页复用/调用说明](frontend-reuse.md)。
用户已通过方向评审，直接推进下表，不再扩展模拟稿或替换已有 Rust Host/Axum。

| 当前检查点 | 可演示结果与放行证据 | 当前状态 |
| --- | --- | --- |
| 评审稿 | 同 fixture / 1440×920 / 日夜主题，Camp、新建、执行审批、附件预览、队员配置共用生产组件；模拟明确标识 | 用户已确认方向；模拟证据不代替 A–D |
| A 共享 Camp | 登录后实际 Web 挂载共享业务页面；Native 启动留 Desktop；旧 Desktop 无回归 | 实际 Web 已挂载共享 BusinessApp/导航/Camp；真实 Desktop/Chrome 同数据、1440×920、日夜主题对照及 Camp/文件页面回归通过 |
| B 真实写入闭环 | 独立 Host 从受信空目录初始化，经浏览器配置、创建、发送、审批、停止、文件读取；草稿/上传/幂等前置 | macOS 空 Host 生产配置/建 Camp UI、真实发送/审批/停止通过；Camp/单聊独立草稿、四种上传及原命令重放通过 |
| C 双入口一致 | 同一 Web 产物分别连接 Desktop-managed 与独立 Host；双草稿、审批竞争、失效/迟到/断线与 Web 开关 | macOS 两入口真实执行通过；双浏览器/单聊草稿独立，同页重认证保留编辑；竞争审批拒绝，执行中关闭 Web 不停止 Core，Host 强杀不重发输入 |
| D 逐页业务能力 | 队员/Runtime、Task、Memory、Automation、Skills/MCP 与必要设置逐项原动作/失败/权限/刷新闭合 | 正式共享管理页及资源适配已接通；本机真实 UI 覆盖 Runtime 配置、Task/Memory/Automation/Skills/MCP/头像、提醒与诊断，权限/失败/刷新由原 Core 与客户端 owner 回归 |

Mobile 新增、扩平台、容器与发布优化暂停，已有包/CI/原型保留。长期 Server 仍为 macOS、Windows、Linux。
安全边界按用户最新确认的单 Owner 模型执行；原 S1 已从交付前置移除，失败记录保留。
网络认证、跨站/内容防护及业务正确性仍需验证；不把变更范围视为正式发布完成。以下原阶段表保留历史目标和证据。

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

首个增量当时尚未完成浏览器新建/配置、私聊草稿、头像、管理页、双入口完整运行和第二实体设备；
本轮新增证据见本文顶部，历史通过结果不回填。第二实体设备仍未验收。
首个真实 Camp 增量不等于 B/C/D 或阶段 1–3 整体完成。

### 本次 main 同步与远程连接设计稿

按用户新指令，将 `origin/main` 的 `afd01d1010639a99ad4862774d1d17c03e1dd19b` 合入原任务分支，
合并提交为 `fa136899`。保留 main 的预览全选、末行引用、HTML 预览独立上限、图片延迟加载、内置工具
输入展示/匹配 shell 折叠、压缩行间距与 Chrome 缩放档位。图片加载继续使用当前客户端的资源适配与缓存；
两端共用的生产组件直接获得这些逻辑，没有再次复制到独立 Web 页面。

随后响应“再 pull”补入 `f30024ae76bdeb3534e10a56d0da6a6a8bd56e13`，合并提交 `27d1c348`。
同步普通 Composer 的 Pending 撤回、导航/未知结果围栏及渠道账号菜单；渠道的网络管理准入仍是原有缺口，
未借合并公开桌面专用 API。撤回通过共享 CampClient/已有 HTTP 操作进入同一个 Core 事务，目标限定为
Host 校验的调用客户端；正文、附件 source refs 与引用一起移回，其他 Desktop/标签页草稿不变。
legacy foreign 编辑显式“接管并移回输入框”，令牌本身不能冒用归属，直接删除保持禁用。原生清理逻辑迁入
共享 application，Web 不触及 Desktop 的 legacy Prepared 文件。待发送附件修改随新流程回到普通 Composer，复用已接入的
浏览器上传；不再需要新建 Web 专用 Pending 编辑器或公开 legacy working-file 上传。

Rust 复用上游唯一 withdrawal 事务 owner，将相同 CAS、重放、释放 FIFO、阻止重复发布用例表驱动扩展到
Desktop/Web，并保留另外两份草稿的正文、source refs、引用和 revision；既有 recovery owner 增加 foreign
return/delete 拒绝输入。没有新增平行 SQLite fixture；定向 `pending_camp_input::` 11 项通过。

通用设置改为由两端入口显式注入偏好 API。Desktop 注入窗口能力与原浏览器访问管理块，Web 使用当前
Host/Owner 的浏览器偏好，不再访问 Electron 桥；主题/字号仍共用正式外观页。浏览器整页缩放由浏览器
菜单或快捷键保存，外观页给出实际可用的操作说明，Desktop 继续使用 main 的原生 Chrome 档位。

用户本次单独要求的[远程连接设计稿](../../ui/host-remote-connection.md)在现有设置“应用”分组追加菜单，
直接复用正式侧栏、页头、控件和日夜主题；同稿的通用/外观页面提供直接对照。在 `fe7fc8cd` 时该菜单仅在稿中；本轮已接入正式设置，读取 Host 实际接口和令牌，取消目录预授权。
表单草稿不代表运行配置；该增量不扩大 Mobile、平台或发布范围。

本次真实 Electron/双浏览器回归增加了 Web 通用偏好保存且不改 Desktop、原生窗口能力隔离、浏览器缩放
说明、预览内全选和准确的消息末行引用；仍保留三份草稿、同页重新认证、关闭 Web 后 Core 响应的原断言。第二次 main 合入后增加实际 Web 撤回
及继续添加附件：仅在隔离数据库种入一条 needs_repair canonical Pending 记录，真实页面通过 HTTP 进入
Core，再读回自己完整草稿；验证另两个客户端不变。该 fixture 不启动模型，也不冒充真实 Run 自动排队证据。
[实际 Host 报告](evidence/main-web-sync/desktop-web-live.json)、[通用设置](evidence/main-web-sync/web-general-night.png)、
[外观设置](evidence/main-web-sync/web-appearance-night.png)、[预览全选](evidence/main-web-sync/web-preview-select-all.png)、
[末行引用](evidence/main-web-sync/web-last-line-quote.png)及[待发送移回](evidence/main-web-sync/web-pending-return.png)记录此次真实生产入口结果，不启动模型 Runtime。
原流程对照与补充后的完整流程均通过；脚本明确等待新文档、按已知正文选取最后一行并在继续编辑前关闭引用浮层。
排查时发生过 CDP 命令超时，最终完整流程未复现；未修改生产时限或删减验收断言。

最终交互稿的 [14 个双主题状态记录](evidence/remote-connection/remote-connection-review.json)包含精确交付 HTML
的 SHA-256，页头位置、字号、侧栏宽度和背景色与同一构建的生产通用页一致。稿件验证不代替真实 Host 操作。

第二次 main 合并后的最终验证：

| 检查 | 结果 |
| --- | --- |
| TypeScript、Desktop/Web 生产构建 | 通过 |
| `pnpm test` | Vitest 175 文件 / 1798 项；Node 聚合 317 通过 / 2 项既有平台跳过；文档及 Skill 门禁通过 |
| `RUST_TEST_THREADS=1 pnpm test:rust:pr` | Library 795 通过 / 6 项既有忽略，CLI 35 通过，slow 309 通过 |
| Workspace all-target check、Clippy `-D warnings`、fmt | 通过 |
| 真实 Host HTTP 与 Desktop/双浏览器 | 均通过，0 跳过；本增量不启动模型 Runtime |
| 原生设置、Camp/单聊 Pending 撤回、文件预览、消息选文 | 均通过，0 跳过 |
| 单文件远程连接交互稿 | 14 状态及交互/响应式检查通过，0 跳过 |

验收夹具修正保留原断言与时限：选文的“清空后再引用”现在模拟一次新的 pointer down/up 选择手势；
原先仅修改 Range，被生产的已关闭选区抑制规则挡住。失败报告补具体点击步骤，复制后滚动不复活选区
和末行原生三击断言均保留。Desktop 联调确实观测到窗口为 `hidden`，复用仓库已有 CDP focus emulation，
并记录 `desktopFocusEmulated: true`；不将其当作 OS 前台/遮挡行为验收。Pending 移回期间普通 Composer
会同步取消 contenteditable，等待断言因此按元素重新可编辑后才读取正文，不跳过状态围栏。

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
| 1A 共享 Core | 抽取应用运行层，普通串行入口与必要独立通道不变；旧 Desktop 准入、重复实例、执行、关闭回归；补齐 Main 迁移表及窄接口 | 共享 Core、原 Desktop 入口与完整本机门禁通过 |
| 1A 平台原型 | Windows/Linux 实测文件、环境/句柄、必要进程访问、IPC 冒用、管理恢复、授权工作区与后代回收；失败先由用户确认最小修正 | 历史原型失败保留；按单 Owner 模型已移出本轮交付前置 |
| 1B Headless | 空目录初始化与原生 Runtime 认证；真实发送、产物、审批、取消、受控关闭、强杀恢复；无 Electron/基础 Node 依赖 | macOS 空 Host 配置 UI、发送/审批/产物/取消、受控信号关闭和强杀恢复通过；其他 OS 独立验收 |
| 1C Web 闭环 | 同一 Axum 模块、内存 Bearer、受限 Fetch、上传 source ref、草稿归属、SSE 与宽屏闭环；第二台 LAN 电脑使用 | 本机真实业务闭环通过；第二实体 LAN 设备尚未验收 |
| 2 Desktop 共用 | 受保护本机 IPC、同 Host Web 开关与会话管理；关闭 Web 不停 Core，bind 失败不毁 Desktop；保留退出与父进程异常语义 | 同 Host/匿名父管道、失败隔离、执行中 Web 开关、重新登录继续工作与真实执行通过 |
| 3 宽屏完整性 | Camp/成员/Task/Runtime/Memory/Automation/Skills/MCP 与必要设置；声明能力矩阵；多端、私聊归属、审批竞争和迟到响应回归 | 共享正式页面、单聊归属、管理动作与无浏览器 Host 时钟通过本机验收；合理平台差异见对照表 |
| 4 三平台发布 | macOS arm64/x64、Windows x64、Linux x64 实际 CLI Server 闭环与匹配 Host/Web 包；平台/Runtime/部署方式分别留证 | 本轮推进 Mac arm64 原生 release 包、搬迁/旧包升级/停机回退及真实 Runtime；其余原生预览证据保留，不宣称三平台正式发布 |
| 5 Mobile | 2026-09-14 用户重新授权交互稿，要求功能对齐当前 WebUI、手机便利性及两种部署更新入口差异 | 新稿恢复评审并同步最新执行态；生产 Mobile、Server Web 更新接口与设备验收未完成 |

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
## S1：同 UID 控制面隔离（已从本轮交付前置移除）

2026-09-12 用户明确采用“单 Owner、可信自托管 Host”，不建设多租户或强隔离执行平台。
原 AppContainer、Landlock、独立 OS 身份等候选方案不再作为本轮待批准工作，不实施通用沙箱工程。
不承诺抵御任意恶意同 UID 进程；不削弱已有 Runtime 权限、审批或进程回收。当前规范已同步到
[Host Web v2](../../contracts/host-web-v2.md)和[统一 Host](../../architecture/unified-rust-host.md)。

历史哨兵证据保留：本地与四个 CI 目标均观测到进程和后代能读取测试私有 sentinel，
`privateFileIsolationSatisfied=false`。该事实没有变成通过；它也不证明真实令牌泄漏，未覆盖进程内存、
句柄/环境继承、IPC 或真实 Runtime。可复现命令仍是 `cargo run --quiet -p rovai-core --example host_runtime_boundary_probe`。

新增限制需要明确保护对象和必要性。保留网络认证、Bearer 凭据不自动跨端口泄漏、浏览器内容及跨站请求保护、
文件操作校验、基本限额；继续验证客户端草稿、原命令回执、审批一致性与生命周期。

### 原生安装矩阵的首轮问题与复核

`a8e809b5` 的 Full check run `34742163864` 中，macOS arm64 与 Linux x64 的包级安装和数据根测试通过。
Windows 原生构建成功，但测试发现：PowerShell 进程可能继承不含 `Get-FileHash` 的模块路径；安装器改用
.NET 流式 SHA-256，保持同一校验规则。Web 路径断言改为规范路径身份比较，兼容 Windows extended prefix。
Clock owner 在 Windows 使用 Node 强制终止来验证持久计划重开，明确不把 SIGTERM 当作 console Ctrl-C 正常关闭；
原 Windows console 资格仍未验收。修复后的平台结果以随后原生矩阵为准，不抹掉首轮失败。

已同步 main 的 `49b7b623`（模型选择器），保留上游 UI 改动；合并后的 TypeScript 与共享 Host 客户端回归通过。


已同步 main 的 `5b933352`（执行记录连续缓存）：将新增分页/增量命令接入共享 Core 与 Web 白名单，
Renderer 继续经当前客户端访问；缓存按客户端实例隔离，避免换连接后继续使用旧凭据的读取器。
本地全量回归为 Rust Core 805 通过/6 既有忽略、CLI 35、Web 5；Vitest 190 文件/1966 项、
Node 317 通过/2 既有平台跳过；执行区真实 Electron 验收 7 项通过，HTTP 增量接口与客户端缓存隔离通过。

首轮原生矩阵的 macOS x64 也已通过。Windows 第二轮 `34743287413` 发现新数据根检查对规范路径中的
盘符前缀单独调用文件元数据，返回 `Incorrect function`。共享祖先检查改为从完整根目录开始，仍检查每个
实际路径组件；现有原生 Server 准入用例保留并在下一轮复核。该轮失败未标为平台通过。

当前提交包级复验发现本机同时执行 Desktop 构建会重建共享 `out/web`，Server 在等待 Rust 编译后可能复制到空 UI。
安装器正确拒绝该不完整包；构建器改为独占临时 WebUI 输出并检查入口，避免两种构建竞争同一目录。
该次安装失败保留，随后以独立输出重建完整包并重新验收，不将失败产物晋升发布。

`e1e73ca2` 同时运行 Server/Desktop 构建后，完整归档经安装器在仓库外安装，包级 7 项全部通过。
最终串行 `RUST_TEST_THREADS=1 pnpm test:rust:pr`：Core 805 通过/6 既有忽略、CLI 35、slow integration 310 通过；
未新增跳过或放宽断言。TypeScript、Clippy、默认 workspace、Desktop/Web 构建与文档门禁另已通过。
包哈希和准确执行范围更新在本机证据文件；正式 Release、Windows console 与便利更新入口仍未申报完成。

当前远端状态（2026-09-13）：[原生 Run 34744528165](https://github.com/murray17/rovai-ai/actions/runs/34744528165)
对应 `ab278fa2`，macOS arm64、macOS x64、Linux x64 全部通过。Windows 的数据根准入与安装器已通过，
但共享 Web 生命周期在读取当前客户端私聊附件时得到 404（预期 200，`host-web.test.mjs:182`），仍待定位修复；
该 Run 整体失败，Windows 不宣称通过。`e1e73ca2` 后续构建隔离改动已完成本机包级复验，尚无同提交四目标结果。
用户最新要求仅推送现有远端分支、不新建 PR、不合并；既有 PR #345 保持打开，工作区保留以继续处理未完成项。


## 当前增量：登录页统一与 Server 内更新

2026-09-14 用户明确要求：Desktop 托管的 Web/Mobile 进入「关于与更新」只看版本说明；独立 Server
提供与 Desktop 相同的检查、下载、安装与重启体验，下载独立 Server Release。此项替代前述仅说明入口的交付边界。
登录页保持单组件，Host 类型只控制 Token 获取说明；退出后恢复初始表单，认证及草稿归属不变。

已实现共享 AboutUpdatesSettingsView、Rust Server updater、固定 GitHub 来源、既有安装器验证与独立暂存、
受控关闭后程序切换、Windows helper 与 Unix exec 重启。macOS 定向测试、真实 Host/浏览器回归、类型检查、
构建与 Clippy 已通过，详细范围见 [本轮验证记录](evidence/server-updates/README.md)。
当前未发布官方 Server Release，不把本地 fixture、编译或其他 Linux Runtime 验收宣布为真实发布升级通过。
新增 Rust 测试分别拥有发布准入/状态门禁与程序目录事务；不启动 Core/SQLite，既有安装器输入矩阵继续由
server-install 拥有。最小验证：`cargo test -p rovai-host --lib server_updates`。


## 文件预览窗口保留

2026-09-15 增量实现：窗口资源管理与稳定预览宿主、轻量阅读快照、分层 LRU、Main session 身份与满额回收、
独立候选刷新及 HTML 文档就绪后切换。共享浏览器入口沿用 Host 容量，通过独立 restore 候选避免刷新破坏旧资源。
验证覆盖热命中零额外读取、后台异步归属、关闭迟到结果、容量淘汰、HTML 页面身份和刷新失败保留旧版本。

本机 macOS 验证通过：`pnpm typecheck`、`pnpm test`（202 个 Vitest 文件、2053 项测试）、
`pnpm test:desktop-bridge`、`pnpm test:file-preview-layout`、`pnpm test:html-preview`、
`pnpm test:file-reference-navigation`、`pnpm build:desktop` 与基于 main 的文档 CI 门禁。
Electron 验收使用独立 userData、真实生产预览组件及 Main 文件服务，不启动 Core/Runtime；同时核对日夜主题截图。
HTML 跨 Camp 验收直接检查同一 iframe、页面内存标记和 `performance.timeOrigin`，确认保留实际页面。
Rust 门禁：Core 807 通过/6 既有忽略、CLI 35 通过、slow integration 310 通过；workspace Clippy 通过。
此增量没有 Rust 改动，不把本机 fixture 结果声明为跨平台发布资格或应用进程内存上限证明。


## DeepSeek Harness ACP 接入增量

按 [V1.59-D10](decisions.md#v1-59-d10)与 [Runtime checklist](../../development/runtime-integration-checklist.md)实施。
工作树分支 `rovai/dsh-acp-runtime`：共享 Host/Fleet、exact resume、managed system prompt、原生权限、模型目录、
Skill group、标准 MCP、结构化 Activity、逐调用 usage 与 context gauge 已接通。迁移 157 保留现有 Runtime/Skill 行及 trigger，
从 v1.59/schema 106 升至 107。现有模型上下文合同不变。macOS arm64 的 14 轴验收闭合、独立 digest-bound qualified 后，
Root README 增加对应的正式支持行；逐项真实验收和差异由 [DSH Parity Matrix](../../research/deepseek-harness-runtime/acp-0.1.5-parity.md)记录。
2026-09-17 Linux x64 与 Windows x64 又分别以目标主机自动化归档闭合 14 轴；维护者确认 macOS x64 完成同一矩阵
并批准发布。四个 shipped platform keys 各自绑定 evidenceRevision，全部开放为 qualified，普通 Machine Ready 门禁不变。

2026-09-16 收敛项已实现：队员页显示并保存 DSH 原生 `sandbox_mode`/`approval_policy`；Core 删除 MCP 名称/只读
推断和二次询问，只承载 DSH 原生请求；shared Fleet 的 DSH replacement 同时覆盖 idle 先回收、busy Run 后回收、
回收失败阻断；observer 把官方 write/edit Before/After 归一为标准 ACP Diff，新增缺 Before 与大文件走通用路径级回退。
真实 MiniMax-M3 文件矩阵已得到 edit `+1/-1` 与空文件 edit `+1/-0`；脚本化 MCP 更新/exact resume/隔离矩阵得到
0 个 synthetic Approval。最低版本错误和权限说明由 Desktop/Mobile 共用组件呈现；没有 DSH 专属 Command、文件或 Diff UI。
Windows 目标宿主额外验证 verbatim execution root、PowerShell 命令/取消、嵌套 bundled Skill 展开、真实文件矩阵与
Camp 相对路径投影；生产 30 分钟 idle eviction、Core crash 和 planned shutdown 均确认进程树回收并 exact resume。

2026-09-17 在专用开发机的 Ubuntu 24.04.5 / GNU x86_64 上完成 Linux x64 独立资格验证。固定验收包为
`@deepseek-ai/dsh@0.1.5-rc.2`，产品最低门槛仍是 `>=0.1.5-rc.2`。真实 MiniMax-M3 路径覆盖文件和命令矩阵、
Skills、contract-v25 全部 22 项 Built-in CLI、原生 parity、cold resume、Missing-Send、安全与 usage；MCP 生命周期
使用确定性模型但保留真实 DSH/Core 配置、工具和 Session 路径。Fleet 使用生产 30 分钟 TTL 复验并发、A/B/A、
Core crash、idle eviction 后 exact resume 与 planned shutdown。Linux 构建使用
`cargo build --locked --package rovai-core --bins`；`pnpm core:build:debug` 仍只负责 Desktop sidecar 目标。

所有目标机步骤串行置于 4 GiB cgroup，整机可用内存低于 2 GiB、出现 swap 或 OOM 时立即停止；本次没有触发。
脱敏结果归档在 [Linux x64 DSH 资格证据](../../../qualification/runtime-platform/linux-x64-deepseek-harness-v1.json)。
该归档只证明 `deepseek-harness × linux-x64`，不改变其他 Linux preview 或 Server OS 基线；Windows x64 与
macOS x64 后续分别由自己的自动化验收归档和维护者目标主机验收归档独立晋升，不继承 Linux 证据。
最终 Built-in CLI 报告复验中有一次真实 Gather 的两次交付与完成 Run 均成功，但模型没有输出验收要求的
captured-return marker，因此严格断言失败；配置不变的重跑通过全部 22 项。通过与失败尝试的日志摘要都保留在
资格归档中，没有删除失败尝试或放宽断言。

## Weekly 无时间上限

- 已接入显式 null 的整轮、Case 和 Judge 时间策略，以及 Host/等待器和 Owner 配置的 Automation 时限。
- 保留旧 seal、历史结果、数量限制、手动停止与恢复收口；普通有限计划默认行为保持。
- Migration 155 从 schema 104 原位升级至 105，不清除 Camp、Run、输入或评测证据。
- 本地验证：`pnpm test:rust:pr` 的 Library 809 项、CLI 35 项及 slow integration 310 项通过；6 项既有手工平台测试维持 ignored。
- `pnpm test` 通过，包含 Vitest 2072 项与脚本 320 项（2 项既有 Windows 专项跳过）；宿主 4 项、类型检查及 Desktop 构建通过。
- 无时限用例覆盖跨一周的 Core 结算、模拟跨一小时的进程/Judge timer、Host 绑定返回版本、取消、旧定义及历史回执保留和迁移失败回滚。
- 新 App 安装、Owner 绑定及 12 Case 的真实回归尚未执行，不能宣称业务回归通过。

## 本轮：可信 Web HTML 原生浏览器能力

2026-09-16 按用户确认，iframe 与统一 Rust Host 的 `/preview.html` 响应采用
`allow-scripts allow-same-origin allow-forms allow-popups allow-modals`，仅预览壳允许 HTTP(S) 表单提交。
Web 描述符与握手/命令使用实际来源，保留窗口、预览 ID、generation、challenge/document 校验。
原生 Storage 归访问设备浏览器；同来源主页面及登录材料不再与可信附件隔离，理由见 [V1.59-D09](decisions.md#v1-59-d09)。

集成主线 `f41ad4aa` 的附件来源改动后，保留已有相对资源入口、CSP、来源检查与替换保存能力；
只调整静态预览壳的权限。Desktop 原生 `file:` 宿主的既有消息通道保持，HTML 原文件没有被重写。

已验证 TypeScript、Web/Desktop 构建、文档门禁，以及 CI 的 204 个 Vitest 文件 / 2108 项测试。
`test:host-web-html` 使用隔离 Rust Host 与 Chrome，覆盖原生 localStorage/sessionStorage、同来源读取、
刷新后存储保留、手机宽度、表单、新窗口、原生弹窗、查找、资源诊断、源码、相对 CSS 与替换保存；
`test:host-web` 的 4 项和 `test:html-preview` 的 4 项通过。实际浏览器证据来自 macOS，窄屏模拟不计为实体手机、
Windows 或 Linux 实机验收；本轮不安装或发布产品。

合入上述主线后的完整回归暴露三个陈旧门禁：当前合同 profile 引用了已改名的 attachment test，合同指纹仍断言
schema 105 / context 23 / Built-in 24，Windows release verifier 也仍声明 Built-in 24。本增量按权威代码同步为
schema 107、context 24 与 Built-in 25。修正后 `pnpm test` 的 204 个 Vitest 文件 / 2110 项测试和 323 项 Node
门禁全部通过，2 项 Windows 环境专项按既有条件跳过；没有改动产品合同或放宽测试。
