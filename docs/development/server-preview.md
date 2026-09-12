---
document_type: development-guide
authority: standalone-server-preview-operation
last_updated: 2026-09-12
---

# 独立 Server 开发预览

这是开发预览：提供同一个 Rust Host 的本机启动、显式 Web 开关和只读浏览器工作区。
发送、上传、审批、私聊、后台 Automation 驱动与完整三平台 Runtime 验收尚未交付。
不能将本包视为通过了受管 Runtime 控制面隔离的正式 Server。

## 构建与包内容

在目标 OS/CPU 的原生机器上运行 `pnpm build:server`；本地快速验证可加 `--debug`。
构建依赖 Rust、Node 与 pnpm；包内只有 `rovai-host`、Agent `rovai` CLI、`web-ui/`、许可证及
SHA-256 manifest。运行 Host 本身不依赖 Electron、Node 或 pnpm；Runtime 自身依赖另行配置。
包输出在 `out/server/<target>/`，不能从同名目录推断平台通过。

当前 Windows x64 原生产物动态导入 `VCRUNTIME140.dll`。目标机器需要与构建工具兼容的 x64
Visual C++ v14 Runtime，获取方式见 [Microsoft 官方说明](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist?view=msvc-170)。
CI 镜像已安装开发工具，不能据此推断干净 Windows 机器无需该依赖；当前包不自动安装系统组件。
当前 Linux x64 GNU 产物包含 `GLIBC_2.39` 符号依赖，仅在 Ubuntu 24.04 原生环境验证过启动链路。
它不适用于更低 glibc 或 musl/Alpine 环境；容器和其他发行版仍需独立构建与验收。

原生构建目标为 macOS arm64/x64、Windows x64、Linux x64。Linux 当前 Runtime 行保持
`not_qualified`；只有该 Adapter 的真实执行证据才可晋升。没有增加 Linux Desktop 或系统服务安装器。
`Full check` 的 `scope=server` 使用固定 OS runner 构建并测试四个产物；Windows console 受控关闭与
真实模型/工作区/恢复仍是独立资格，不由编译或有限进程测试推导。
原生复核可以用 `server_target` 只选择发生变更的目标；默认 `all` 才运行全部四个目标，单目标通过
不能写成三平台通过。

## 显式初始化

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
不应接入普通日志采集。重新启动时可换用新令牌；旧页面 Session 不跨进程存活。

管理者在控制台输入管理令牌后交换半小时 Session；页面刷新需要再次登录。当前页面只向固定控制台
地址发送显式 Authorization，不使用认证 Cookie。应将完整控制台地址交给客户端，不能通过预览端口登录。

## 网络与停止

默认推荐 loopback。局域网监听必须同时显式设置 `--allow-insecure-lan` 和
`--web-public-origin http://<Host在局域网中的地址>:<端口>`。明文网络可能暴露令牌和内容；不可信网络使用
外部 HTTPS 或可信 VPN。本实现不创建域名、证书或预览代理，不信任任意代理转发头。

Unix 用 SIGINT/SIGTERM；Windows 用 console Ctrl-C/Ctrl-Break。停止沿用 Core protocol 3；只有 durable
收口完成才以 0 退出。强杀不构成执行完成，下一次启动由 Core 恢复。两个 Host 不得共用数据目录。

Desktop「设置 → 通用 → 浏览器访问」控制当前 Host，Web 默认关闭。关闭 Web 只撤销网络会话与订阅，
当前 Core 和任务继续；重启 Desktop 后默认关闭。开发 Desktop 开启前运行 `pnpm build:web`，打包时则
随包携带同一 WebUI 构建产物。
