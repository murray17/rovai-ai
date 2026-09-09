---
document_type: research
status: verified-with-limitations
last_updated: 2026-09-10
---

# 官方 ZCode 接入与一致性矩阵

本次使用官方 ZCode App 3.11.2 内置、未修改的 `glm/zcode.cjs` 0.16.5，由独立 Node.js 运行
`app-server`。官方 App 只提供内核文件，不执行 App 主程序。社区 `zcode-app-cli`、`zcode-acp` 不属于产品入口。
本机 Homebrew cask 安装的是官方 App；命令行启动内核不代表上游另行发布了官方 npm CLI，也不代表 GUI 被 Rovai 控制。

官方公开说明：[安装](https://zcode.z.ai/en/docs/install)、[BYOK 配置](https://zcode.z.ai/en/docs/configuration)。
NDJSON、原生配置细节和事件字段另外依据本机官方内核源码与隔离实验核实；这是 App 内置协议，升级仍需重新验证。
App 内核 SHA-256：`e9f1868c0fdb863537ed910ee3828b9be96b8c2fd805473f63b439e1113266b8`。
界面图标直接取自该官方 App 的 `Contents/Resources/icon.png`，未改变品牌图形。

## 与现有 Runtime 的一致性

“产品验证”仅指经过 Rovai Core 的真实 AgentRun；原始协议实验与单元测试分别标注，不相互替代。
当前交付等级为 macOS arm64 Preview；其他平台未资格化，不能由共享代码推导通过。

| 能力轴 | 实现与证据 | 一致性与差异 |
| --- | --- | --- |
| 官方入口 / BYOK | 官方 bundle identity、官方 bundle/cjs/Node composite fingerprint；用户和项目原生配置只读；真实 MiniMax BYOK AgentRun | 不增加 Rovai provider/密钥配置，不支持本次范围外的账户订阅登录 |
| Host / Fleet / owner | 复用 AcpHost/Fleet、独占 lease、兼容性 digest 和 ManagedProcess；Camp 范围内按进程配置复用、精确切换成员 Session | Core 内部转换成现有 Session transport；上游协议仍标为 `zcode-app-server-v1`，不声称原生支持 ACP |
| Session / continuation | exact ID；真实 Core 重启后恢复同一 Session；无历史动作/审批重放；无效 ID 仅一次显式 continuity loss 后重建 | 不使用 latest Session，不猜私有历史；已 accepted 的输入不自动重发 |
| Bootstrap / Context | 复用 user FirstPayload assembler、成员身份和动态协作输入 | 官方内核无 `--system`、`--system-prompt`、`--append-system-prompt`。与其他 FirstPayload Runtime 一致，指令层级不同于支持 system 注入的 Runtime |
| Compaction | manual/auto/reactive completed 事件按 Session/operation/boundary 关联；真实 Core manual/threshold auto/overflow reactive compact 后 revision 1 requested/acknowledged，下一 input accepted；auto compact 后 Core 重启仍恢复同一 Session 和补发 | started/failed/cancelled 不触发。auto/reactive 经本地 provider 观察确认真实请求携带补发；不承诺在同一原生轮次内部 compact/retry 之间插入 Bootstrap |
| Skills | `.zcode/skills` 原生投影、调用、项目冲突保护、重启恢复与删除通过共享 Skills smoke | 更新、禁用、重新启用、取消分配、硬删除均经过真实调用/缺席验收；不覆盖项目自有 Skill |
| External MCP | 原生 + assigned union，stdio/HTTP 与同名覆盖真实通过 | 原生 user MCP 优先于 project；Rovai assignment 优先于原生同名完整定义。真实更新、取消分配、重新分配、删除、相邻成员隔离通过；集合变化 fence Host，避免原生 warm resume 不刷新 MCP |
| Permission / Cancel | 原生 plan/build/edit/yolo/auto，默认 yolo；回调 optionId 精确映射；真实审批允许/拒绝、plan 无写入、取消后等待 35 秒无延迟副作用 | 未实现 GUI/Computer Use、结构化图片输入和其他桌面交互回调；未知回调安全拒绝，不自动批准 |
| Narration / Final | text_delta 作为公开执行叙述，reasoning_delta 隔离；匹配 input 的成功 terminal 才形成 Final | Narration 是执行中说明；Final 是最终回答。`Missing-Send` 是没有业务 send 时由 Core 补发最终回答，已有 accepted send 则抑制补发；三种真实场景已通过 |
| 内置 rovai CLI | 复用当前 bundled CLI 与 active Run lease；共享完整 operation、Gather、后续 Run 和过期租约验收 | 不安装第二套 CLI 或借用历史上下文。完整操作集、Gather 返回、续接与过期 lease 验收通过 |
| 后台执行 | foreground terminal 后继续等 jobs、tools、permissions、requests 清空且 native idle，再释放 Run/lease | 原生 Bash 的 backgrounded 是启动回执；正常等待，不当作完成或主动取消。300 秒仍未收口则关闭 Host，取消继续由共享进程树期限兜底 |
| Usage / Cache / Cost | 唯一原生 terminal 的 provider input/output/cacheRead；真实持久化与稀疏字段 parser 校验 | 原生汇总会为缺值填零，因此 cacheWrite、reasoning、uncached 和成本保持未知；Turn 聚合不用于推导单次请求缓存命中率 |
| 平台 / Ready | 官方身份、最低 kernel 0.16.5、无 Prompt capability Probe、平台资格独立 | Probe 不验证账户余额或真实模型可调用性；macOS arm64 Preview，macOS x64 / Windows x64 NotQualified |

## 文件、命令输出与 Diff

| 原生事件 | Rovai 呈现 | 验证与边界 |
| --- | --- | --- |
| Read 成功 result | 阅读活动、文件路径链接；不加入 Files Changed | 真实现有文件读取通过；可能是原生缓存命中，不宣称发生了磁盘 IO |
| Write 成功 result | 写入活动、路径链接、Files Changed | 新文件和空文件写入的实际字节、实时活动与历史投影通过；缺少原生 before/after，不猜新增/覆盖 Diff |
| Edit 成功结构化 patch | 编辑活动、Files Changed、不可变 unified diff | 路径、hunk 起点/长度、行计数、增删数完整校验；真实 Edit 显示 update Diff。截断、冲突、零变化、越界 patch 不准入 |
| Bash / git diff | 命令及输出 Evidence | stdout、stderr、mixed、empty、exit 7、large 六项通过；exit 7 为失败 Tool，即使原生 success=true。文本 git diff 不升级为已应用文件变化 |
| 大输出 artifact | 现有有界预览 + 完整内容 blob | 真实 131100 字节输出保存进 blob。只读取结构化指定且匹配 Session/Tool 的普通文件，拒绝 symlink/跨 Session；恢复上限 256 KiB，超限或文件不可用明确标记 |
| 删除 / 移动 / shell 修改 | 按真实工具和命令输出呈现 | 上游没有提供可准入的原生文件结果/patch 时，不从命令字符串、Prompt 或事后磁盘状态推导删除、重命名或修改 Diff |

## 启动方式与 App 弹出问题

早期实现使用 `ELECTRON_RUN_AS_NODE=1` 执行 App 主程序。macOS 对照实验显示：即使只运行 `--version`、
可见窗口数为零，这个进程仍以 activation policy 0 注册为 ZCode App，足以造成 Dock/App 启动干扰。
独立 Node 执行同一份官方内核仍返回 0.16.5，且不注册 App。版本检测、深检、正式 Host 和本机 `zcode` shim
均使用独立 Node；`scripts/smoke-zcode-launch.swift` 从 macOS 观察真实产品验收，冷恢复及 Core/原生进程强杀验收
均未观察到新的 ZCode App 注册。

Rovai 的 Node 启动 prelude 另带进程回收 companion。真实强杀测试发现原生 Bash 使用 detached 进程组，
只杀 Host 会留下延迟命令。companion 记录这些原生 spawn 的组 ID，在 Host pipe 关闭时回收；官方内核文件
保持原样，既有 Fleet 仍拥有 Host/Run 生命周期。Core 和原生 Host 分别 SIGKILL 后，已观察到的子进程均退出，
等待 35 秒没有延迟文件。这是 ZCode 相对其他 Runtime 增加的启动适配，不是额外进程池。
本机便捷 `zcode` shim 直接调用官方内核；Rovai Host/Probe 使用含上述回收机制的统一启动器。

因此额外依赖 PATH 中的独立 Node.js（本机实测 26.8.1）；可用 `ROVAI_ZCODE_NODE_BIN` 指定绝对路径。
任何 `.app` 内的 Node/Electron 路径均不接受，Node 文件也计入 Installation fingerprint。官方 `.app` 路径仅作为
bundle 身份定位，不能把对它的发现误解为启动 GUI。与 Pi 的 workspace 复用不同，ZCode Host 以 Camp 授权范围
为边界；同一 Camp 内满足进程配置条件的成员 Session 可以切换复用，跨 Camp 不共享 Host。

## 官方配置边界

读取 `~/.zcode/cli/config.json`；项目按最近 Git root 到 cwd 合并 `zcode.json` 与 `.zcode/config.json`，
无 Git root 时仅 cwd。原生 `ZCODE_MODEL`、`ZCODE_BASE_URL` 覆盖纳入兼容性 digest。配置更新使旧 Host/Binding
不再复用。模型列表仍取自官方 Session snapshot；只有官方配置中可解析的 BYOK 模型可选。

普通 BYOK 形式是 `model.main = "providerId/modelId"`，`provider.<id>.kind`、`options.baseURL`、
`options.apiKey` 和 `models` 由 ZCode 拥有。也支持原生 main 对象及 model alias；Rovai 不写入 provider 文件。
秘密只传内存 RPC，不放 argv、Prompt、产品数据库、公开 Evidence 或日志；测试使用独立 Home、Core data、Skill Library。

当前权威与最终验收见 [v1.56](../versions/v1.56/README.md)、[Runtime Launch v37](../contracts/runtime-launch-and-verification-v37.md)
及 [Runtime Compatibility](../runtime-compatibility.md)。本文记录来源与比较，不授予平台资格。
