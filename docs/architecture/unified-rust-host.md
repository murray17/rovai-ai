---
document_type: architecture
authority: unified-rust-host
last_updated: 2026-09-25
---

# 统一 Rust Host

本文拥有已确认的 Host 目标结构。实施与平台资格见[当前版本](../versions/README.md)及
[Runtime 兼容性](../runtime-compatibility.md)，不能由目标结构推断完成。
现有准入、事务、Runtime 与关闭合同继续有效；新增 wire 合同随对应实现明确发布。
原生 Server 数据根、初始 CLI 兼容、初始化准入和停止适配由[Host Lifecycle v2](../contracts/host-lifecycle-v2.md)拥有；
当前受控网络入口由[Host Web v3](../contracts/host-web-v3.md)拥有；未变更的详细边界继续由其继承的 v2 章节定义。

当前已实现父进程匿名管道与进程内请求共用一个 Host/Core、共享生产 Camp 页面、客户端草稿、source 上传及
逐项准入的 Camp 写入。以下 UDS/Named Pipe 身份握手与完整公共 DTO 生成仍是后续目标，
不由现有管道或一个真实执行闭环推断阶段 1–3 完成。

## 组件和唯一权威

`rovai-host` 在进程内组装 `rovai-core` 应用运行层。Desktop 通过受保护本机 IPC 访问，独立 Server
直接运行相同 Host。`rovai-web` 使用 Axum 0.8、HTTP JSON 与 Fetch SSE，只接受已有应用服务句柄，
不创建数据库、第二份 Core 或调度器。`rovai-protocol` 拥有封闭公共 DTO，Rust Serde 为源生成 TS；
不能把任意内部 Core RPC 转为网络能力。React/TS/Vite WebUI 和 Desktop 共用业务页面、核心交互组件、
客户端接口和状态处理代码，不能仅共享 tokens 而独立演进另一套业务页面。启动、认证与系统集成分别适配；
草稿、缓存、订阅、连接代次和迟到响应仍按客户端隔离。当前实际 Web 已挂载从 Desktop 提取的业务壳层，管理页仍逐项接线；
阶段 1–3 的收敛入口见[宽屏对照稿](../ui/host-web-parity.md)。

Host 独占 data-dir lease、SQLite 准入、执行、恢复与后台驱动。普通业务命令保留串行入口和已有独立通道；
HTTP 并发不改变领域调度，SSE 不占命令队列，取消与审批不等待长 Runtime 执行。
默认新对话队伍、队长和一键创建开关由 Core 在当前数据根统一保存；Desktop 的旧值只导入一次，
两端经共享偏好适配读取，窗口、外观与导航展示偏好继续各端保存。细节见 [Host Web v2](../contracts/host-web-v2.md#shared-creation-preferences)。
Desktop-only 窗口、原生交互与更新保留 Electron；基础 Server 不要求 Electron 或 Node。
Runtime 自身依赖单独声明。Automation 时钟迁 Host；日报、评测与渠道未迁移驱动初始保留可选 Desktop
适配，并在 Headless capabilities 明确关闭。Desktop 托管 Web 的渠道管理通过受认证的 Axum 渠道操作、封闭父管道回调复用当前 Electron Main
渠道服务；发布流程、登录 Session 与运行期凭据不迁入 Rust。回调先释放 Core 请求队列，再由 Desktop
服务调用同一 Core，避免循环等待。独立 Server 不提供渠道能力，也不加载额外渠道进程。实际 Main 归属见当前实施计划。

macOS/Linux 本机传输为 UDS，Windows 为受保护 Named Pipe，另有可信身份、实例与代次握手。
同一目录不能被两个 Host 抢占；不自动 attach、抢锁或双写。Desktop Web 默认关闭；关闭 Web 仅关闭
网络入口、连接并持久撤销全部 Session，保留长期登录 Token；Core 及任务继续。正常 Host 退出、重启与升级保留未过期 Session，
不等同于显式关闭 Web。Desktop 主动退出和 Server 受控停止复用现行
[Planned Shutdown](planned-shutdown.md)，客户端断开不取消已准入工作。

## 身份与控制面

服务端从验证过的本机身份、Remote Session 或 Agent Built-in 上下文确定能力；不信任客户端自报用户身份。
Web 长期登录 Token 可重复兑换默认 30 天的可撤销 opaque Bearer Session；剩余不超过 7 天且有效时，
客户端申请延期至续期成功起 30 天，不轮换 Bearer 或编辑身份。正常访问、续期和重启不更换长期 Token。
Host 在准入的 Core data-dir 内持久保存私有认证文档，浏览器 IndexedDB 保存普通 Session；
标签页的编辑证明、草稿与原命令另归 sessionStorage，启动先认证再恢复。不使用认证 Cookie、双 Token 或 OAuth。
仅固定控制台 origin 的封闭 API 使用显式 Authorization；登录和认证 Fetch 拒绝重定向，SSE、图片、下载同样
走认证 Fetch，必要时生成并释放 Blob URL。不把管理令牌、Bearer 或编辑证明写 URL、预览链接或日志；浏览器长期存储只允许普通 Session 认证材料，
不保存长期登录 Token 或编辑证明；
扫码登录的一次性 fragment 票据按下述短期例外处理。

长期登录 Token 使用 256-bit 系统随机数，本机入口初始化、重复查看/复制或显式重置。
Desktop 与 Server 使用同一私有 `web-auth.json` 持久实现，原独立 `server-token` 仅作首次导入；Token 命令优先读取统一文档。
Host 保存 Bearer 的带类型摘要、编辑 ID、绝对到期时间和最近认证时间，认证使用恒定时间比较。
Session 上限保持 32；容量满时回收最久未使用且没有在途请求或 SSE 的记录，保护在线标签页与派生请求的父 Session。
回收与新建原子持久化，具体准入与失败边界由 [Host Web v2](../contracts/host-web-v2.md#bounded-session-admission) 拥有。
续期、撤销、重置和显式关闭在同一锁下先原子落盘再发布；损坏或写入失败不会静默重置。凭据不进入状态、日志或公开网络投影。
过期、撤销、轮换和关闭 Web 撤销已有订阅。登录限流，Host/Origin 封闭校验，请求/上传/并发/订阅有界；
实际网络接口自动展示并按同一 authority/origin 校验；外部代理 origin 可以显式补充。默认 loopback；LAN 明文必须显式开启并说明风险，不可信网络用
HTTPS/VPN。普通地址分享不含凭据；显式扫码登录允许 URL fragment 携带 Host 签发的两分钟一次性票据，
禁止长期管理令牌和已有 Session。前端立即清除 fragment，再 POST 兑换普通 Session；票据摘要、期限、
原子消费及重新生成／轮换／关闭失效由现有 Rust 会话管理统一负责，编辑归属继续由 Core 验证。
既有执行台身份仍只读。不自建账号／设备管理、域名、证书、Relay 或预览代理。

本轮正式采用“单 Owner、可信自托管 Host”。登录成功的远程 Owner 与 Desktop 拥有同一业务能力目标；
未接通的页面是实现缺口，不创建受限远程角色。不建设多租户或强隔离执行平台，不承诺防御任意恶意同 UID
进程；该系统级隔离证明不再是阶段 1–3 或统一 Host/WebUI 的交付前置条件。既有哨兵失败证据和风险保留，
不能改写成通过。[Managed Runtime Process v2](../contracts/managed-runtime-process-v2.md) 与
[User Automation v5](../contracts/user-automation-v5.md) 的当前边界保持一致，不恢复外层 macOS 沙箱，
不削弱 Runtime 原生权限、审批、生命周期或回收。

网络认证、凭据不自动附带到其他端口、跨站与主动内容保护、既有文件校验和基本限额仍由实现负责。
新增限制须说明保护对象与必要性，不扩为用户配置的安全平台。地址发现排除 198.18.0.0/15，
不展示、推荐、复制或生成二维码；网络层不主动封禁该网段。用户选择展示地址不改变权限、令牌、监听或 Host 状态。

## 草稿与用户文件

每个客户端草稿有独立身份与后端验证的归属，贯穿读取、保存、附件、队列与发送消费。
作用域含 Host/Owner/client/Camp，私聊再含 Conversation。客户端提交 ID 不是授权；保留 revision、
原子消费、命令幂等与 Core FIFO，不做跨端同步、实时合并或多人共编。
可续期认证 Session 与标签页编辑身份分离；同页面同 Owner 重登保留编辑、原命令及 Core 验证的恢复证明。
普通刷新沿用原编辑身份，浏览器标签页占用记录仅存随机文档标识；复制标签页由已认证 Host 分配独立编辑身份和 Session，不复制草稿或原命令。浏览器重开只有认证材料时同样新建编辑身份，不借用其他标签页草稿；细节见[Draft v13](../contracts/camp-composer-draft-v13.md)。

Web 上传写 Host 临时文件后绑定当前客户端草稿，复用现行 source reference。
失败或可确认未绑定文件由入口清理；绑定结果未知按原命令查询回执，不能证明未绑定就不删除。
Core 接受后由 OS 决定临时文件寿命；发送失败、退出或删除一个引用不删除源文件。
草稿/Pending/消息交接由 Core 原事务管理，重启或 OS 清理后按实际可用性处理；不承诺永久历史下载。
Agent Managed 与 legacy 机制不变，不建对象存储、附件目录库或用户 Managed 资产。

资源读取按精确身份、owner locator 与作用域授权；路径规范化、符号链接和读取时变化不能逃逸授权。
远程 Owner 直接选择 Host 有权访问的工作目录，不需要本机预授权名单；Core 继续拥有原有项目和文件校验。
文件分页仍逐次完整验证 SHA-256，复用与摘要绑定的 UTF-8 / 稀疏行号信息以减少重复扫描，读取仅保留所需页。
图片与下载使用认证原始字节响应；上传按块写入和计算摘要。草稿缩略图仅在 Host 确认绑定、可用性及摘要一致后
复用当前客户端的有界 File 缓存；刷新、内容变化或缓存淘汰恢复 Host 读取。空句柄不启动文件更新轮询。
静态服务只挂应用构建产物。长期缓存只准入构建清单中带内容哈希且字节校验相符的文件，入口及私有响应仍不缓存。
具体字段和边界由 [Host Web v2](../contracts/host-web-v2.md#workspaces-uploads-and-resources) 拥有。
HTML/HTM 附件复用共享交互查看器，由认证 POST 读取后交给同来源静态预览壳。Desktop 托管 Web 和独立
Server Web 共用该 Rust 路径；响应 CSP 与 iframe 均采用
`sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"`，仅预览响应允许 HTTP(S)
表单提交，工作台与 API 的策略保持不变，不增加顶层导航权限。
可信 HTML 可以访问同来源主页面及登录材料，不再承诺附件与工作台隔离，也不提供每份附件独享的存储。
localStorage/sessionStorage 由访问设备的浏览器原生管理，遵循来源及标签页作用域，不写 Server 数据根、不修改
原 HTML，也不模拟或检测 Storage。消息通道使用实际来源，继续匹配发送窗口、预览 ID、generation、challenge
和 document。Web 沿用既有句柄的来源目录内资源能力及 HTTP(S) 依赖；源码模式保留原稿。
资源读取边界见 [File Preview v18](../contracts/file-preview-v18.md)，本轮不改造该资源加载链路。
Desktop 原生不同源预览不变，SVG 独立文件仍以文本或下载处理。精确边界见 [Host Web v2](../contracts/host-web-v2.md)。

## 命令、事件与兼容性

复用 commandId、请求摘要及持久结果，先授权再回放；同 ID 不同请求冲突。断网后按原 ID 核对，
不以新 ID 自动重发，不承诺外部工具 exactly-once。两端审批只产生一个有效结果，验证精确 Run、审批与原生选项。
SSE 只输出授权投影，快照与水位连续，过期/缺口重取快照；有心跳、有界队列与慢客户端限制。
缓存和迟到响应以 Host/连接代次隔离，协议不兼容阻止危险写入，敏感响应不缓存。

Runtime Catalog、平台矩阵与 Adapter 唯一维护。Server 目标为 macOS arm64/x64、Windows x64、Linux x64，
实际原生、Desktop 与系统服务分别验收。Linux Server 的 GNU x86_64 发布包以 glibc 2.35 为兼容基线，
在 Ubuntu 22.04 构建；包内所有 ELF 的导入 GLIBC 符号需求不得高于该版本。Ubuntu 22.04、Debian 12、
Ubuntu 24.04 必须安装和运行同一份归档，记录其 source SHA、manifest 摘要与各自 OS/内核。
Server OS（Gate A）与 Runtime（Gate B）分别保存资格：前者证明安装、Web、持久化、互斥和受控停止；
后者由每个 Adapter 的实际认证、执行、权限、内置工具和恢复证据拥有。OS 通过不得自动开放其他 Runtime。
Linux 适配范围经维护者扩大为现有 Runtime 中除 Cursor 之外的 14 项，当前均仅开放有缺失理由的 preview；
后续新增的 DeepSeek Harness 不属于该 Linux preview 范围，并在独立闭合目标主机证据后取得 Linux x64 qualified。
未来 Adapter 不自动纳入。完整资格和机器上的安装/认证可用性仍为独立事实。
后续发行版属于兼容目标，实际支持范围随验收证据推进；不承诺 Debian 11、Alpine/musl 或 Linux ARM64。
Linux Desktop、额外 CPU 架构、三平台一键服务安装器不在本轮。
同版 Host/Web 配对发布，数据库升级与回退遵守 authority 准入，不能用旧程序打开新 schema。
Mobile 最后复用同一 Web：宽屏 >=1040px，紧凑 768–1039px，手机 <768px；不引入离线执行队列或原生移动 App。

## 原生 Server 数据与分发

独立入口名为 `rovai-server`，仍运行同一 Rust Host/Core/Axum。统一实现不要求两份安装共用磁盘上的同一
可执行文件，更不允许两个进程同时管理同一数据。Desktop 继续使用 Electron 应用数据及既有 `.rovai`
关联资源布局；开启 Desktop Web 仅开启当前 Host 的网络入口，不选择独立 Server 数据。

独立 Server 默认使用当前账号 `~/.rovai-server`，可选一个 `--data-dir` 覆盖整个自有数据根。共享 Rust
路径层推导 SQLite、MCP、Skills、实例 Runtime 文件与日志的位置，存储和业务实现保持唯一。
Runtime 文件使用根内 `instances/<instance-key>/runtime-files`；Desktop 保留其原平台根。
路径校验只增加精确的 Server 布局，不放开任意目录或取消既有身份与唯一 owner 检查。
旧预览数据必须明确提示兼容入口，不能悄悄创建空实例；本轮不迁移 Desktop 数据。
项目与 source 附件、第三方 Agent CLI 安装/认证/会话不被搬进 Server 根，附件语义不变。

正式原生分发目标为 GitHub Releases 预编译包，包含匹配 Host、协议与共享 WebUI。用户无需 clone、Rust
编译器或前端构建；Host 本体不依赖 Electron、Node、npm 或 Bun，Agent CLI 依赖另行处理。
安装器管理当前账号的程序和外置资源，macOS/Linux 命令入口目标为 `~/.local/bin/rovai-server`，配置
常见 Shell PATH 时保持幂等。不自动接管实例，不建立系统常驻服务。不购买域名或建设下载服务器。
命令、安装地址与平台支持在实际发布和验收前必须标为目标或开发预览。

Desktop 从安装包明确路径启动自己的 Host，随整个 Desktop 安装更新；独立 Server 按自身安装更新。
两份安装可以版本不同，但每份内部 Host/协议/WebUI 匹配。安装器与 Rust 更新入口采用同一资产与
校验规则，校验后替换程序及 UI，不重置数据。WebUI 更新当前连接的 Host；Desktop-managed Host 引导
使用 Desktop 更新。主动检查、下载、确认重启，受控停止遵守现有任务关闭语义。

本轮仅交付原生部署。Dockerfile、Compose、官方镜像、容器初始化/挂载/更新均不在当前任务或可选阶段中，
不阻塞原生 Server 发布与后续 Mobile。也不建立数据同步、多实例管理、全机版本同步或复杂升级监督平台。


独立 Server 的更新状态、下载验证与重启交接由 Rust Host 的 Server updater 拥有，Web 只提供已认证的封闭动作。
Desktop 托管页只读展示版本说明，不提供 Electron updater 代理。Server Web/Mobile 与 Desktop 复用同一更新页面及状态，
下载资产按各自发布通道区分；字段、停机与失败边界见 [Host Web v2](../contracts/host-web-v2.md#login-presentation-and-server-updates)。
Server 成功检查后按版本坐标归属发布信息：等于运行版本的日志进入 `currentRelease`，严格高于运行版本的
候选进入 `availableRelease`，更旧版本不成为候选；失败检查保留已知的新版本。Web 适配器也按版本身份
归一化旧 Server 的快照，日志页签只选择阅读内容，不决定下载或官方发布页链接的目标。
