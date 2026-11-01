---
document_type: protocol-contract
contract: host-lifecycle-v2
authority: headless-host-startup-and-controlled-stop
status: accepted
version: 2
source_version: v1.59
last_updated: 2026-11-02
---

# Host Lifecycle v2

本版本增加原生 Server 用户入口与单一数据根，替代 [v1](host-lifecycle-v1.md) 的当前入口地位。
v1 的 `rovai-host run/prepare/token` 和 Desktop 显式参数适配继续用于已有集成与旧预览数据；不自动迁移它们。
合同 accepted 不等于可下载：正式包、安装地址及平台资格以实际发布与验收记录为准。

## 同一 Host，两种启动布局

Desktop 按安装包中的明确路径启动 `rovai-host`，不从 PATH 查找 `rovai-server`。其数据库、MCP、Skills、
实例 Runtime 文件和 Electron profile 保持既有路径；Desktop 开启 Web 始终服务当前 Host 和当前数据，
不创建或选择独立 Server 实例。两入口共用 Core、Axum、业务存储和正式 React UI。

原生用户入口 `rovai-server` / `rovai-server.exe` 默认前台运行。不指定 `--data-dir` 时使用当前账号的
`~/.rovai-server`，与 cwd 无关；指定时必须是目录的绝对规范路径，不能是 SQLite 文件。
Host 自动创建尚不存在的必要目录。切换 data-dir 选择另一实例，不移动、复制、同步或接管原实例。

共享 Rust `ServerPaths` 从同一根推导：

| 资源 | 根内相对位置 |
| --- | --- |
| 主业务数据库及 SQLite 辅助文件 | `rovai.sqlite` 及既有 `-wal` / `-shm` |
| MCP | `mcp.json` |
| Skill Library | `skills/` |
| Runtime 文件 | `instances/<instance-key>/runtime-files/` |
| Host 落盘日志 | `logs/server.log` |
| 原生入口布局标识 | `server-layout.json` |
| 登录 Token / Web Sessions | 私有 `web-auth.json`；旧 `server-token` 仅在首次创建统一文档时导入 |

不要求用户填写内部 `--skill-library-root`、`--mcp-config-path` 或 `--runtime-camp-files-root`。
Runtime root 只允许精确实例 key 对应的根内位置，按实际使用准备；不为启动预先创建旧 Runtime root marker。
实际文件操作仍检查符号链接、其他受管目录重叠、本地目录所有权与实例归属。不能通过放开任意嵌套路径实现集中存储。
用户项目、source 附件原路径、Agent CLI 安装、原生认证及会话不属于本次集中存储范围。

## 数据准入与兼容

Core 仍先取得 data-dir 独占 lease，再检查 SQLite authority、执行必要迁移和启动恢复。同目录第二 Host
明确报占用并以非零退出，不终止原 owner。已有兼容数据库正常打开，不清空；损坏、未来 schema、残缺
authority 继续按现行准入拒绝。已有数据库、旧 Runtime root marker 或持久 Web 认证文档表明曾存在 authority 时，
主库消失不得再次以空库初始化。统一 Web 认证文档只在 Core 准入后创建；首次启动前读取 bootstrap Token 不创建
该文档，也不将新实例误判为丢失数据库。认证文档损坏或不可读仍明确失败，不重置，不增加新标记文件。

没有 `server-layout.json` 的已有数据库或 MCP/Skills/实例等自有资源被识别为 Desktop/旧预览布局，返回 `server_legacy_layout`，不改动
该目录权限或数据。继续使用其原 `rovai-host run` 命令和完整关联路径；本轮不新增 Desktop 迁移或通用迁移向导。
默认根尚无数据库、但旧建议位置 `~/.rovai/server/rovai.sqlite` 存在时同样拒绝静默创建空实例并给出提示。
不能仅复制 SQLite 后宣称完整迁移；实例 Runtime marker 与路径/目录身份绑定。

`rovai-server paths` 只输出推导路径，不启动或写数据库。`rovai-server [--data-dir ...] token` 输出本实例
管理令牌，stdout 是秘密。交互式终端（stdin、stdout 均为 TTY）在 Core 与监听器就绪后直接显示当前有效令牌；
仅展示，不轮换。非交互启动或 stdout 重定向默认不显示令牌，原 `token` 命令保留。凭据直接写人类终端输出，
不经过 stderr 或文件日志管道，`--verbose` 也不改变这一点。长期登录 Token 与未过期普通 Session 在 Desktop/Server 正常重启、更新之间保留；
明确退出登录、重置 Token 和显式关闭 Web 的撤销范围由 [Host Web v2](host-web-v2.md#authentication-and-editor-ownership) 及其生命周期表拥有。
认证文档只在 Core 准入并拥有 data-dir 后打开；正常关闭结束网络流和扫码票据，不清除已提交的 Session。

原生入口默认只输出简洁就绪摘要：编译版本、Ready、真实监听端口对应的可用地址、访问范围、数据根、
日志文件与前台运行提示；不是把请求的 `:0` 或 `0.0.0.0` 当作可用地址。地址发现沿用 Web 的过滤规则。
TTY 使用颜色，重定向、`NO_COLOR` 或 dumb terminal 使用纯文本。普通运行诊断（包括 Core stderr）只追加到
选定数据根的 `logs/server.log`；`--verbose` 显式同时镜像到 stderr。失败与停止保留简短提示；详细失败写日志。
无持续终端日志不表示后台常驻，不新增后台启动/停止管理。

## Web、停止与安装归属

原生包包含同版 Host、Agent `rovai` CLI、`rovai-server` 用户入口与 `web-ui/`；从可执行文件真实目录定位
资源，用户无需手工定位 WebUI，也不依赖 cwd。缺失配套资源明确报安装失败。Web 默认监听
`127.0.0.1:8767`；可选 `--listen`、`--public-origin` 和显式 `--allow-insecure-lan` 沿用
[Host Web v2](host-web-v2.md) 的认证和网络边界。开发专用 WebUI 覆盖不构成用户安装要求。

Unix SIGINT/SIGTERM/SIGHUP、Windows console Ctrl-C/Ctrl-Break 的停止继续使用 v1 定义的 protocol 3：
注册监听早于 Core 启动，十秒总期限包含启动期间的停止，必须验证 durable 关闭报告和 runner 实际结束；
失败或超时非零退出，不承诺无损热升级。Windows console close 接入同一关闭路径，但请求期限缩为四秒，
给操作系统关闭窗口的通常五秒预算留出退出余量；OS 强制终止、断电或更短系统预算仍依赖下次启动恢复。
这是实现边界，不能由 Mac 的 PTY/SIGHUP 结果推断 Windows console close 已验收。
默认不建立后台服务或开机启动。

程序与数据分别管理。Desktop 更新整个安装包，包括随包 Host/WebUI；独立 Server 只替换自己的匹配
程序与 WebUI，不修改数据根、令牌或 Desktop 安装。未来 WebUI/CLI 的更新对象取决于所连接的 Host，
复用 Rust 更新实现；Desktop-managed Host 不接受独立替换。便利更新入口的实现状态须另行报告。
本轮不实现 Docker/Compose/镜像/容器初始化或容器内更新，也不把这些作为 Mobile 的前置。

## 验证 owner

`storage_layout` 单元测试负责根推导；既有 Runtime root admission 测试负责精确根、锁、重叠与 marker。
`scripts/lib/host-lifecycle.test.mjs` 继续拥有旧 Host 控制停止；原生 Server 用户入口的进程测试负责
默认/自定义路径、日志、持久状态、占用拒绝、旧预览提示与重启。Desktop pipe/Web 原有集成测试独立
证明 Web 同 Host；原生平台、原生 Runtime 和正式发布分别验收，不由 macOS 通过推断 Windows/Linux 资格。
