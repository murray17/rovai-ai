---
document_type: development-guide
authority: standalone-server-preview-operation
last_updated: 2026-09-29
---

# 原生 Server 安装与开发验收

Server 0.4.1（`server-v0.4.1`）已有公开原生包。普通用户从[官网安装与启动指南](https://rovai.dev/zh/docs/server-install.html)开始，无需克隆或构建源码；本页保留开发构建与资格验收流程。公开发布不代表所有平台与智能体组合均完成真实执行验收。

2026-09-29 的 macOS arm64 **0.4.0** 发布包实测确认安装、登录与会话可用，但有两个发布包阻碍：快捷命令启动可能找不到 WebUI；直接运行 `current/rovai-server` 后，首次 Agent 执行仍因 `bundled Skill resources are unavailable` 失败，归档缺少内置 Skill 资源。0.4.1 桥接包补齐归档资源与快捷命令路径，包内 Skill 读取和 0.4.0 数据升级已在隔离环境验收；尚不能把旧截图记成端到端执行成功。完整记录见[官网部署素材说明](../../website/deployment-notes.md)。

已接通能力与平台资格分别判断，按[当前版本入口](../versions/README.md)及 [Runtime 兼容性清单](../runtime-compatibility.md)查看当前状态。产品为单 Owner、可信自托管 Host，不承诺同 UID 强隔离。本文历史 Gate 与草稿发布流程描述的是资格流程，不是“当前尚无公开包”的声明。

## 构建与包内容

在目标 OS/CPU 的原生机器上运行 `pnpm build:server`；本地快速验证可加 `--debug`。
构建依赖 Rust、Node 与 pnpm；包内包含 `rovai-server`、兼容入口 `rovai-host`、Agent `rovai` CLI、`web-ui/`、`skills/`、安装脚本、许可证及
SHA-256 manifest。运行 Host 本身不依赖 Electron、Node 或 pnpm；Runtime 自身依赖另行配置。
解包内容位于 `out/server/<target>/`；压缩包和 `SHA256SUMS` 位于 `out/server/releases/<target>/`，
不能从同名目录推断平台通过。源码构建属于开发流程，正式用户无需 clone、Rust 或前端工具链。

当前 Windows x64 原生产物动态导入 `VCRUNTIME140.dll`。目标机器需要与构建工具兼容的 x64
Visual C++ v14 Runtime，获取方式见 [Microsoft 官方说明](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist?view=msvc-170)。
CI 镜像已安装开发工具，不能据此推断干净 Windows 机器无需该依赖；当前包不自动安装系统组件。
Linux x64 GNU 发布构建使用 Ubuntu 22.04，glibc 兼容基线为 2.35。构建中的 ABI 门禁检查所有包内 ELF，
拒绝更高 GLIBC 导入、私有 libc ABI、非 x86_64 或非 GNU 动态加载器；`linux-abi.json` 随 manifest 校验，
同时记录 GLIBCXX/CXXABI 和所需动态库。更换 runner 本身不等于兼容性通过。
Gate A 必测 Ubuntu 22.04、Debian 12、Ubuntu 24.04 上完全相同的发布归档。
`Full check(scope=server)` 分别使用 Ubuntu runner 和 Debian 官方 cloud image 的独立 VM 内核执行；
Python smoke 只作为外部驱动，Host 的 PATH 中不含 Node/Electron/Rust。真实 VPS 补充环境另记证据。
历史 GLIBC_2.39 包仍保留其原要求，不能因为更新文档而作为兼容包安装。
本轮不承诺 Debian 11、Alpine/musl、Linux ARM64 或其他发行版，不实现 Docker/Compose。

原生构建目标为 macOS arm64/x64、Windows x64、Linux x64。Linux 当前适配范围为现有目录中除 Cursor 外的
14 项，显式开放 `preview`；DeepSeek Harness 不在目录中且不新增。完整资格仍须逐项通过 Gate B，
只有该 Adapter 的真实执行证据才可晋升。没有增加 Linux Desktop 或系统服务安装器。
`Full check` 的 `scope=server` 使用固定 OS runner 构建并测试四个产物；Windows console 受控关闭与
真实模型/工作区/恢复仍是独立资格，不由编译或有限进程测试推导。
原生复核可以用 `server_target` 只选择发生变更的目标；默认 `all` 才运行全部四个目标，单目标通过
不能写成三平台通过。main 上全部目标通过后可显式开启 `server_release_draft` 组装 GitHub draft Release；
它校验 source SHA、release profile、版本及平台一致，不自动公开发布或晋升默认安装指针。

## Linux 的两个验收 Gate

- Gate A：对同一 release profile/source SHA/归档，在三套目标 OS 的普通用户环境完成安装、Web 登录、认证读写、
  数据与 Session/Token 持久化、同根互斥和 SIGTERM 停止重开。独立入口为
  `python3 scripts/smoke-linux-server.py <已安装程序目录> --expected-source <SHA> --output <报告>`。
- Gate B：按 Runtime × version × OS 记录原生 Provider/认证、实际 Camp、文件/命令、Built-in CLI、审批、
  取消/子进程回收、warm/cold resume 和既有 First-Class 能力轴。API/模型不可用不等于 Linux 不支持；
  安装成功或一次文本回复不等于完整资格通过。任一 Runtime 的探测结果不自动晋升其他准入行。
- Server 和 Runtime 分别记录 CPU/RAM、峰值、swap、并发与任务规模。2 GB VPS 的低配实验不替代
  Runtime 官方硬件基线验收。与既有服务共机时串行执行，设置独立测试 cgroup，内存不足立即停止测试进程。

## 安装和启动

程序与数据分开：Unix 安装器管理 `~/.local/share/rovai-server/revisions/`，以 `current` 原子链接选择程序，
命令入口为 `~/.local/bin/rovai-server`。Windows 安装到当前账号 LocalAppData 的 `Programs/RovaiServer/current`，
将其加入用户 PATH；更新前须先停止该安装的 Server，安装器不终止进程。两种安装都不建立系统服务。
安装器不会打开、迁移或重置业务数据，不会替换 Desktop 随包 Host。

取得原生压缩包及同一 Release 的 `SHA256SUMS` 后，可在已有脚本上执行本地安装（版本填写包的真实版本）：

```sh
sh scripts/install-server.sh --version <版本> --from-dir <发布资产目录>
```

Windows 对应 `install-server.ps1 -Version <版本> -FromDirectory <发布资产目录>`。脚本也包含在解包目录中。
Unix 默认配置 `.profile`、`.bashrc`、`.bash_profile`、`.zshrc` 的去重 PATH；Windows 配置用户 PATH。
安装器打印新终端和立即生效方法。自动验收使用隔离安装位置；Windows 测试不修改真实用户 PATH。

官方源固定为 GitHub Releases。0.4.0 和 0.4.1 桥接包使用 `server-v<版本>`；后续与 Desktop 同版合发时使用 `v<版本>`。资产名为
`rovai-server-<版本>-<target>.tar.gz`（Unix）或 `.zip`（Windows），`SHA256SUMS` 每个资产恰好一项。
安装器先完整下载、校验 SHA-256，检查归档路径/类型和包内版本/目标，再切换入口；下载/校验失败保留旧安装。
0.4.0 已安装程序继续读 `scripts/server-channel.txt`，该旧指针在桥接版发布后固定为 `0.4.1`。
0.4.1 起的程序和安装器改读 `scripts/server-release-tag.txt`：`server-v0.4.1` 指向桥接包，未来 `v<版本>` 指向同版 Desktop/Server 包，`unpublished`
表示新通道尚未晋升。只有实际发布相应资产并晋升指针后，才能把网络安装命令描述为可用。
没有独立域名或下载服务。

安装完成后可在任意工作目录运行：

```sh
rovai-server
rovai-server --data-dir /data/rovai
rovai-server --data-dir /data/rovai token
```

Windows 同一个参数接口：`rovai-server.exe --data-dir "D:\RovaiData"`。`token` 的 stdout 是秘密，供登录使用，
不要接入日志采集。交互式终端启动成功后已直接显示当前 Token，可立即复制登录；展示不会轮换 Token。
非交互启动或 stdout 重定向不显示 Token，仍可用上面的 `token` 命令查询。凭据不会进入 Server 文件日志。
长期 Token 与普通 Session 保存在数据根的私有 `web-auth.json`；旧 `server-token` 只作首次导入，
`token` 命令优先读取统一文档。正常重启与升级保留未过期 Session。

启动摘要显示实际版本、就绪地址、访问范围、数据根与日志位置。默认前台运行，Ctrl-C 受控停止；
终端挂断也进入受控关闭。普通诊断写入 `<data-dir>/logs/server.log`，需要同时在终端排障时使用
`rovai-server --verbose`（自定义数据根仍传相同 `--data-dir`）。无刷屏不表示服务已转入后台。
独立 Server 的 Web 默认地址为 `http://127.0.0.1:8767`，配套 UI 从可执行文件真实目录定位，不依赖当前工作目录。

独立 Server 当前不支持飞书／钉钉渠道。渠道功能请使用 Rovai Desktop。
Desktop 设置中开启的 Web 服务属于该 Desktop 实例，可以管理已有账号的 Bot 发布、重试和结构化审批人选择；
它与独立 Server 不自动共享渠道配置或登录态。账号连接、切换和重新登录在运行服务的那台 Desktop 中完成。

不传内部路径参数：默认使用当前账号 `~/.rovai-server`，其中包括 `rovai.sqlite`、`mcp.json`、`skills/`、
`instances/<instance-key>/runtime-files/`、`logs/server.log` 及私有布局/令牌文件。自定义 `--data-dir` 后全部跟随，
不会默认写回 Desktop 的 `~/.rovai`。`rovai-server paths` 只读显示推导路径。
不存在的根由 Host 初始化；既有根复用原数据，同根第二个 Host 拒绝启动。改参数选择另一实例，不搬迁旧数据。

## 旧预览数据的兼容入口

以下仅供已经使用旧显式路径布局的实例，不是新用户的安装步骤。没有独立 Server 布局标识的既有数据库，
以及旧默认建议位置 `~/.rovai/server` 的数据，都会触发明确兼容提示，避免误开空实例。
继续使用原命令和完整关联路径；不要只复制 SQLite、手工伪造 marker 或修改身份校验来冒充迁移。
本轮不迁移 Desktop，不新增通用迁移向导。


先为该 Host 选择独立绝对路径，禁止使用日常 Desktop 数据目录或其他运行中 Host 的目录。
从包目录运行 `./rovai-host prepare --data-dir <绝对目录>`（Windows 可执行文件为 `rovai-host.exe`）。
此命令要求父目录已存在、目标目录尚不存在，只创建私有目录并打印四个路径与 `runArguments`；
不创建数据库、不迁移、不启动 Runtime，也不修复或更改已有目录。准备输出不含令牌。

把输出路径传入以下参数。`--initialize` 只允许 Core 初始化已确认不存在的 authority；以后启动可去掉。

```text
rovai-host run --data-dir <dataDir> --skill-library-root <skillLibraryRoot>
  --mcp-config-path <mcpConfigPath> --runtime-camp-files-root <runtimeCampFilesRoot>
  --initialize --web-listen 127.0.0.1:4317 --web-ui <包内web-ui的绝对路径>
  --web-token-stdin
```

参数须在同一条命令中传入。管理令牌由 `rovai-host token` 生成，是 64 位十六进制的 256-bit 随机值。
启动命令从 stdin 读取一行；请通过操作系统提供的安全输入方式或受保护文件重定向传入，保留一份供
登录使用。不要把令牌写在命令参数、环境变量、URL、聊天或日志中。`token` 的 stdout 是秘密输出，
不应接入普通日志采集。首次启动导入统一私有认证文档；后续启动须传入原 Token，冲突不会覆盖存储。
变更长期 Token 必须走显式重置，不能通过正常重启隐式轮换。

管理者输入长期登录 Token 后兑换默认 30 天 Session；正常使用时剩余不超过 7 天会自动申请续期。
页面只向固定控制台地址发送显式 Bearer，不使用认证 Cookie 或保存长期 Token 自动重登。
应将完整控制台地址交给客户端，不能通过预览端口登录。浏览器 IndexedDB 保存普通 Session，
标签页另存编辑证明和草稿；刷新保留原编辑，浏览器重开没有标签页编辑材料时新建独立编辑身份。
登录后的单一 Owner 可以选择 Host 有权访问的工作目录，无须预授权。真正过期或撤销后仍可使用原长期 Token 手动登录。
Web 与 Host 必须使用同一协议版本，当前为 [Host Web v3](../contracts/host-web-v3.md)。

## 网络与停止

默认推荐 loopback。局域网监听显式设置 `--allow-insecure-lan`，Host 自动发现实际网络接口。
新入口可用 `--listen 0.0.0.0:8767 --allow-insecure-lan`；
反向代理可补充 `--public-origin https://<代理地址>`（旧入口参数为 `--web-public-origin`）；不要求唯一手填 LAN 地址。地址发现排除 198.18.0.0/15，
不提供展示、复制或扫码；网络层不主动封禁。明文网络可能暴露令牌和内容；不可信网络使用
外部 HTTPS 或可信 VPN。本实现不创建域名、证书或预览代理，不信任任意代理转发头。

Unix 用 SIGINT/SIGTERM；Windows 用 console Ctrl-C/Ctrl-Break。停止沿用 Core protocol 3；只有 durable
收口完成才以 0 退出。强杀不构成执行完成，下一次启动由 Core 恢复。两个 Host 不得共用数据目录。

Desktop「设置 → 远程连接」控制当前 Host，Web 默认关闭，端口默认 `8766`；独立 Server 默认 `8767`，允许两者在同一电脑使用独立数据根并行运行。手动设置端口或传入 `--listen` 时以显式值为准。关闭 Web 只撤销网络会话与订阅，
当前 Core 和任务继续；重启 Desktop 后默认关闭。开发 Desktop 开启前运行 `pnpm build:web`，打包时则
随包携带同一 WebUI 构建产物。

## 首个真实 Camp 复验

使用源码构建产物进行自动验收，不启动日常 App：

```bash
cargo build -p rovai-host -p rovai-core --bin rovai-host --bin rovai
pnpm build:desktop
ROVAI_REQUIRE_ELECTRON_INTEGRATION=1 pnpm test:host-web-live
pnpm smoke:host-web-runtime
```

两条验收命令目前在 macOS 使用独立 Chrome profile；`ROVAI_REVIEW_CHROME` 可指定 Chrome 可执行文件。
第一条启动隔离 Electron，与实际浏览器对照同一 Camp、日夜主题和三个客户端草稿，不调用模型。
`ROVAI_KEEP_HOST_WEB_LIVE_FIXTURE=1` 保留其截图与隔离目录。

第二条会调用本机已认证的 Codex，在空目录初始化的独立 Host 中，通过正式浏览器页面检查 Runtime、配置队员并创建 Camp，
随后从正式浏览器页面上传、发送、选择 Host 提供的一次审批、阅读产物与停止另一个运行。
只审批脚本中精确限定的夹具发布命令，不修改用户级 Runtime 权限。命令打印隔离路径并保留脱敏报告和截图；
原始目录可能包含 Runtime 会话材料，不得整体上传。它不证明其他 Runtime、其他平台或同 UID 强隔离。设置 `ROVAI_HOST_ENTRY=desktop` 运行同一真实流程，
并验证执行中关闭 Web、重新登录后继续停止运行。`ROVAI_HOST_BIN` 和 `ROVAI_WEB_UI` 可以指向匹配的独立包。

独立的 `pnpm test:host-web-html` 使用隔离 Rust Host 和 macOS Chrome，验证正式 Web 页面上传 HTML、
交互预览、原稿源码切换、刷新恢复、资源错误和可信同来源下的原生 Storage、表单、新窗口及原生弹窗；
同时验证桌面宽度和手机宽度的消息通信，不将窄屏模拟计为实体手机验收；不启动 Electron 或模型。
运行前完成 `cargo build -p rovai-host` 与 `pnpm build:web`，其他 OS 的浏览器验收单独记录。

## 更新、备份与既有 Mac 包演练

新入口更新时重新运行同一安装器，替换匹配程序与 UI，仍用原 `--data-dir` 启动。自定义数据根不会被安装器改写。
完整原生包提供 WebUI/MobileUI「关于与更新」中的检查、下载、安装并重启；按新通道指向的精确 tag 使用 Server 资产。
官方 Server 通道以实际已发布并完成晋升的 tag 为准，不能将模拟发布源验证当成真实 Release 升级。
数据必须放在程序目录之外。安装前会受控结束执行并保留 Session，Windows 重启后不另开终端，诊断仍在原数据目录。
`rovai-server upgrade` 命令未提供；不宣称无损热升级或数据库自动回滚。
停机备份新布局时保留整个数据根及其权限、目录身份要求；源附件、用户项目与 Agent CLI 原生认证/会话独立保留。
恢复前保留当前数据，不让旧程序直接打开已升级 schema。

下面记录的演练针对既有 `rovai-host run` 包和显式关联路径，不代替新入口或其他平台的资格。

本机当前验收为 macOS 26.3 / arm64，Codex CLI 0.153.4；不代表 Intel Mac 或最低 OS 版本实测。
包内 Mach-O 声明最低 macOS 11.0，仅依赖 Apple 系统库；ad-hoc 签名通过不等于 Developer ID 签名或公证。

`node scripts/smoke-server-package.mjs <新包目录> <旧包目录>` 校验两个 manifest，把包复制到仓库外的
一次性目录，以不含 Node/pnpm 的 PATH 启动 Host、验证旧数据库升级后的浏览器读取，再用停机备份回退。
测试仅创建本地记录，不调用模型。旧包必须是有独立 manifest 的实际支持来源；不能拿当前包改版本号充当升级。
原始夹具和报告保留在脚本打印的位置，可能包含私有状态，不整体公开上传。

实际升级前先停止唯一 Host，保留旧包并备份完整 data-dir、Skill Library、MCP 配置及
`prepare` 输出的 Runtime 文件根目录；备份时不能有正在写入的 Runtime。用户附件仍是 source reference，
源文件需要独立保留。旧 Runtime 视图目录可能只有遍历权限，普通递归复制会失败；备份工具必须报告失败，
不能把不完整目录当成成功。演练脚本只在自身创建的停机夹具里暂补目录读取权限，复制后恢复原权限。

回退恢复旧包及同一停机点的完整备份，保留原数据根目录和 Runtime 文件根目录本身，在原位置恢复内容。
Runtime marker 绑定目录身份，直接替换根目录会按合同拒绝启动。先保留升级后的完整状态，再执行回退；
不要让旧包直接读取已升级数据库，不修改 schema/receipt，也不重新初始化来绕过失败。
本轮演练不涵盖跨机器迁移、运行中备份或任意备份工具，不新增系统服务安装器。


构建新的本机包而保留正在使用的包：

```sh
node scripts/build-server.mjs --target-key macos-arm64 --output-dir /absolute/new/server-directory
```

`--output-dir` 必须尚不存在；归档放在同级 `<目录>-release` 中。该命令只构建，不停止或替换运行中的 Server。
