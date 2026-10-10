---
document_type: runtime-research
runtime: cline-cli
authority: research-evidence-only
status: blocked-injection-entry
observed_version: 3.0.3
observed_platform: macos-arm64
last_updated: 2026-10-07
---

# 用户实际安装的 Cline ACP 注入入口核验

User 消息 `dcdde17c-198a-467a-86c7-6332be497675` 要求：在 `86d6b46b` 的实验之后，
先证明兼容注入能作用于用户实际安装、Rovai 正常选择的 Cline。不得用实验源码或另一份 SDK
代替 Runtime，不新增版本白名单，不修改安装与原生设置。

**结果：当前安装形态未找到可验证的 `Core.start()` 前注入入口，兼容接入阻断，自动压缩尚未解决。**
正常发现选中本机 Homebrew 3.0.3；其 Node 包装器启动编译后的平台二进制，未暴露实验需要的
ACP 模块及同进程 Core。原生 `cline --acp` 初始化成功不等于注入成功，也不等于产品 Ready。
本轮保留生产启动链，不交付猜测式 overlay、替代 Runtime 或新的压缩器。

本轮最小改动为此报告、[脱敏证据](installed-acp-entrypoint-2026-10-07.evidence.json)及相关研究和
兼容性导航。没有新增生产能力探测器、诊断枚举、缓存、shim 或版本限制。
下文的 `entry_not_injectable` 是本次研究结论，不冒称产品已经实现了该诊断字段。

## 实际选择与执行来源

日常数据库仅以 SQLite `mode=ro` 查询 Cline startup setting 与 installation，均为零条；
当前进程没有 `ROVAI_CLINE_BIN` 或 `CLINE_BIN_PATH` 覆盖。随后使用独立数据目录的 Rovai Core，
通过现有 `runtime.startup.get`、`runtime.startup.inspect`、`runtime.installations.list` 核对正常发现。
没有保存 Program Path，也没有传实验 Runtime 路径。

| 检查 | 实际结果 |
| --- | --- |
| Shell 路径 | `/opt/homebrew/bin/cline` |
| Rovai 正常发现来源 | `inherited_path`；startup revision 0、programPath null |
| Rovai 选中的真实入口 | `/opt/homebrew/Cellar/cline/3.0.3/libexec/lib/node_modules/cline/bin/cline` |
| npm 包 | `cline@3.0.3`，Homebrew bottle；无 `main` / `exports` / 普通 dependencies |
| 平台包 | `@cline/cli-darwin-arm64@3.0.3`；无 `main` / `exports` / dependencies |
| 实际子进程 | 同安装树 `node_modules/@cline/cli-darwin-arm64/bin/cline` |
| 二进制类型 | Mach-O arm64，内嵌 Bun 的发布形态 |
| CLI `--version` / ACP `agentInfo.version` | 均为 `3.0.3` |
| Rovai discovery inspection | `recognized`；只代表路径及版本识别 |
| 现有产品 Ready | `light_failed / runtime_version_below_minimum` |

现有 `cline.rs` 的最低版本为 3.0.65，早于本轮任务。本轮没有修改该基线，也没有因新版本或
“未测试版本”新增拒绝条件。**旧版本 Ready 门槛与缺少注入入口是两个独立事实**：下面的入口判断
依据安装内容和真实进程，不以版本号作判据；即使单独运行原生 ACP 成功，也不能宣称 Rovai Ready。

此前验收用的临时 3.0.65，以及 `86d6b46b` 的 3.0.68 源码/Core 0.0.90，均未被当成本轮 Runtime。
验收宿主复用之前未修改的 Rovai Core，其 SHA-256 为
`5633570f634a82598d77fc080b4406de686df6a25a6c1ac489598fd07438b95d`；这是 Host 的来源，
不能与 Cline 的来源混为一谈。它在独立目录运行，没有启动第二个日常 Core。

## 注入为什么停在入口检查

逐行读取安装内的 Node wrapper，并核对它的三条解析分支：`CLINE_BIN_PATH`、缓存 `bin/.cline`、
逐级寻找平台包。本次前两条都不存在，实际命中第三条。wrapper 使用 `child_process.spawnSync`
把原始参数和环境传给独立子进程，并传递退出状态/信号；没有导入或暴露实际 Core。

安装清单覆盖 9 个文件路径（含一个指向平台二进制的 `.bin/cline` 符号链接），其中有 wrapper、
postinstall、包元数据、文档/许可证、平台二进制及 `plugin-sandbox-bootstrap.js`。
没有实验所需的可加载 ACP 源入口或 Core 模块；Plugin sandbox bootstrap 不是 ACP/Core 的导出入口。
没有从相邻全局目录、项目依赖或实验目录导入 SDK 来填补这个缺口。

一次真实 ACP 初始化保留了进程树：Node wrapper PID `81123` → 平台二进制 PID `81124`，
后者的可执行路径与安装清单一致。只发送 `initialize`，收到协议版本 1 与 `cline / 3.0.3`；
关闭 stdin 后进程正常退出，退出码 0。

这与官方[发布形态说明](https://github.com/cline/cline/blob/main/apps/cli/DISTRIBUTION.md)一致：
npm wrapper 选择并运行编译二进制。官方 [ACP 文档](https://docs.cline.bot/usage/acp)提供的入口仍是
客户端启动 `cline --acp`，没有为本轮注入提供可验证的公开 `Core.start` 入口。

对 wrapper 或另一份 Core 的 prototype 做修改，不能证明修改到了该子进程中的同一个 Core。
本轮没有这样的证明，因此不安装 preload、不拆解重打包二进制，也不下载源码替换执行内核。
这个判断只适用于本次观测的安装；不宣称所有未来 Cline 分发形态都不可能提供入口。

本机 `--help` 虽列出 `--compaction agentic|basic|off`，但其默认值显示为 **basic**，与先前
3.0.68 实验的未设置默认 agentic 不同。帮助文本既不能证明 ACP 使用该参数，也不能证明本次
`Core.start` 收到了配置；不能把任意版本的默认值照搬到当前安装。

## 来源、配置保护与隔离证据

本次通道为自动验收。Core 使用独立的 data-dir、Skill Library、MCP 文件及 Runtime Files Root；
原生版本/help/ACP 探针使用独立 Home、CLINE_DIR、CLINE_DATA_DIR 和明确的设置文件路径，
工作目录为空的隔离 workspace。没有复制原生 Provider 设置文件，没有请求模型或执行工具。

现有发现调用保留正常 PATH 和正常 Home 以解析用户安装；startup inspect 的草稿只覆盖 Cline
配置/数据目录，没有保存设置。直接 ACP 探针随后使用已证明相同的 `/opt/homebrew/bin/cline`，
私有 Home 不参与替换 Runtime。公开证据保留真实 Homebrew 执行路径，私有目录以占位符表示。

| 保护项 | 证据 |
| --- | --- |
| 安装文件内容与权限 | 原生探针前后 9 个路径的 SHA-256、大小、mode 一致；wrapper 和平台二进制分别记录 |
| 用户原生设置 | providers、MCP 文件摘要与权限不变；原先缺失的 global-settings、models 文件仍缺失 |
| 设置读取与写回 | 设置只做完整性摘要；没有解析为启用偏好，没有调用任何原生设置写接口 |
| Session 副作用 | 只有一次 ACP `initialize`，`session/new`、`session/load`、Prompt 均为零；隔离原生 Home/config/data 均无文件产物 |
| 清理 | Core 与 ACP 正常退出，记录 PID 均已不存在；中间私有环境快照已删除 |
| 失败后重发 | 没有执行兼容 overlay，也没有在兼容失败后重启 Runtime 重发用户输入 |

完整性摘要只能证明本次观测窗口，不是固定摘要白名单，也不构成已经实现升级探测。
原生 Session/sidecar 持久化仍归 Cline 所有；本轮没有 Session，不能借此验收持久化。

## 验收边界与继续条件

| 项目 | 本轮结论 |
| --- | --- |
| 正常发现与真实 Runtime 来源 | 已验证路径、版本、安装树及实际子进程一致 |
| 安装与用户设置保护 | 本次版本/help/ACP 初始化前后检查通过 |
| 原生 ACP 可启动 | 初始化通过；产品 Ready 另有既有低版本限制 |
| 兼容配置已补齐 | **未发生，当前入口不可注入** |
| 上游配置直通 / 用户明确关闭 | 未观察本次 Core.start 配置，不能分类为任一状态 |
| 默认/basic/agentic/off 与上游优先 | 未执行兼容注入矩阵；不沿用实验矩阵作为本安装验收 |
| 原生自动压缩与后续成功请求 | 未验收，自动压缩仍未解决 |
| 压缩后的 cold、System、Skill、MCP、权限及发送归属 | 未验收 |
| overflow recovery + retry、压缩取消、多 Session、其他平台 | 未验收 |
| 安装变化后重新探测与上游修复直通 | 尚无生产兼容层，未验收 |

以后只有实际安装暴露了可验证的原生 ACP/Core 启动接口，才继续实现内存 overlay：
保留已有 compaction 整个对象；缺失时调用该安装自身的解析/构造逻辑；读取失败保持失败；
仅新增字段，原 `this`、参数、返回、异常与一次调用语义不变。不能用“未知版本”或旁边 SDK
导入成功替代这项证明。若上游直接修好 ACP 配置，走原生路径并另做真实压缩验收。

复核可沿同一路径执行：先在隔离 Core 查询上述三个 Runtime 方法，核对返回的真实入口；
读取该安装的 package/wrapper 和文件摘要；在独立 Cline Home 运行该入口的 `--version`、`--help`
与只发送 `initialize` 的 `--acp`，记录子进程可执行路径；EOF 后复核文件摘要与进程退出。
不得用此报告中的机器路径或摘要充当产品允许列表。
