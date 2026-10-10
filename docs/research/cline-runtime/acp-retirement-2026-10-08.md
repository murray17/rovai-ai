---
document_type: runtime-research
runtime: cline-cli
authority: research-evidence-only
status: implemented-with-native-limitations
admission: preview
observed_version: 3.0.3
observed_platform: macos-arm64
last_updated: 2026-10-08
---

# Cline 官方 ACP 与 Native Hub 退役验收

本报告绑定切换时的 3.0.3。User 97 后续授权升级到 3.0.70，账号/BYOK 的精确 cold 已通过；
ACP 自动压缩缺口仍在，见[升级核验](latest-acp-2026-10-08.md)。下文原始失败记录保留。

按 User 95 在 ada6f6c1 后续树实施，不回滚主干改动。唯一执行入口为所选 `cline --acp`，共享 ACP Client/Host/Fleet。
没有 Hub fallback、版本/账号字段门槛、认证锁、强制 cold、OAuth 复制或自有刷新。保持 Preview。

实际安装为 Homebrew Cellar `cline/3.0.3/libexec/lib/node_modules/cline/bin/cline`，未替换 wrapper 或二进制。
平台二进制 SHA-256 `1be9d0ad68b753b5efaf573b58dd7d48dc98db7475cc17d415dab9bd1071f574`。
账号直接使用用户已授权的日常 Provider 文件、openai-codex/gpt-6.1-sol，无静态 Key；BYOK 使用此前授权的
隔离来源、openai-compatible/gpt-6-sol，不改变账号或端点。App/Core、工作区、MCP 和 Skill Library 均独立。

## 代码边界

删除 cline_hub 全部实现、Application/Fleet/Runtime 接线、WebSocket 依赖、登录组件/IPC、Native Hub 与
SDK/shim 实验入口及专用依赖。Pi 结算回到 Application 的 Pi 方法；共享 ACP、Command Code 和内核进程账本保留。
工具配对继续解释 run_commands 失败、apply_patch/editor reported_mutation；没有扫磁盘补造 Diff。

本机 ACP 不加载此前逐 Session Plugin。因此 Bootstrap 使用成员 Host 私有的原生文件 Rule，内容写入后不可变，
不同 Bootstrap 拒绝在同 Host 覆盖；用户 Rules 使用冻结快照，源变化进入兼容性摘要。System 的 B 与 user 的 P
仍分开；不再依赖 Cline Plugin Session ID 等于 ACP Session ID。可用的原生 Plugin 仍只观察数值，缺失、ID 不匹配或写入失败时放弃观测，不阻断原生执行；完整性不足的数值不能覆盖 ACP 终态。
未广告的 auto_approve config ID 不盲发：原生请求审批时由共享权限逻辑执行成员的冻结选择，plan 保持原生模式。
当前模型不在可切换目录时使用共享 runtime-default 哨兵，不伪造模型切换能力。

## 原生限制与负例

3.0.3 initialize 声明 loadSession=true，但 session/load 实际返回 **-32601 Method not found**，未声明 resume。
普通 cold 经共享连续性丢失路径创建了新 Session 和 Binding generation。新请求生成成功、公开历史中的记忆可见，
但这不是原生 cold 恢复，不能记成同 Session 通过。不改装历史、不换 Runtime、不回退 Hub。
ACP 接受的 mcpServers 仅存入会话对象，buildConfig 未使用；保留必要的原生私有 MCP 投影，不重复交付。
ACP buildConfig 仍未交付 compaction；本轮不注入、不重做长上下文，旧 3.0.65—3.0.68 overflow 负例仍有效历史证据。

保留调试负例：首个手工 initialize 缺 clientInfo.version（夹具错误、零模型），修正后握手成功；初次产品检查
缺 MCP 适配能力声明、默认模型不在目录，均在接线中修正。旧 auto_approve 盲发收到 -32602 后改为只用广告选项。
旧 Plugin 身份路径下真实请求已经发送，但身份 marker 缺失且 observer 没有记录，Run 失败；该输入未自动重发。
之后在新独立验收 Session 验证原生文件 Rule，不将前述失败抹去。

## 当前实测记录

- 账号 first/warm：真实生成与一次已提交 builtin send 通过，warm 复用同 Host，身份和早期记忆正确。
- 账号 cold：后续生成成功，但原生 load 不可用且 Binding 换代，连续性验收失败。
- 同源双成员：两个独立 Host 同时通过互等 barrier，分别审批和发送、不串身份；七轮为 6 成功 / 1 预期取消。
- BYOK：原来源 first/warm、文件读写与 Diff、允许/拒绝审批、取消和取消后生成通过；七轮为 6 成功 / 1 预期取消。
  首个独立 fixture 曾在输入发送前遇到 Fleet startup could not commit；保留失败，原因未证实。第二个新 fixture 未换来源通过。
- stdio MCP 实际 tools/call 一次与原生 Skill 标记读取通过（三轮真实请求）。
- BYOK cold 同样因原生 load 方法缺失而换代，后续生成不能算 exact cold。
- 最终代码 `9b8fa131` 打包 App：账号 7 轮为 6 成功 / 1 预期取消，覆盖 first、同 Host warm、双成员 barrier、审批及取消后继续；BYOK first/warm 两轮通过。
  Renderer → preload → packaged Core → 所选 `cline --acp` 完成真实请求，随后通过界面精确 Thread 查找读回公开回复（零新增输入）。
- 无凭据原生源：正式 ACP 诊断返回 `runtime_authentication_required`、认证状态 unknown；零模型输入、零自动登录、无 Provider/计费回退。
  正向产品夹具按预期在 Ready 断言退出，不能将此负例的 `passed=false` 误称模型成功。撤销授权和实际网络中断未另行制造。
- 原生完整 System 输入中的精确出现次数尚未取得本机观察证据；私有 Rule 文件唯一性与 user 层 B=0 由代码/合同测试验证。
- 真实刷新、首次完整授权、外部 Cline 并发刷新、压缩后恢复与完整多平台 Runtime 矩阵未验证。

## 恢复与退役

旧 Hub Binding 不能进入 ACP load；新授权输入走共享不兼容替换，generation 正常推进并记录连续性变化。
旧 accepted/unknown 不自动重发，公开历史、Memory、工作区、文件证据及原生历史不删。
仅保留被动旧 missing-send boundary（不能产生新候选）和通用内核账本对旧 Host 目录的恢复，不具备 Hub 启动路径。
旧报告和负例保留，复现脚本链接固定退役前 ada6f6c1；不将旧 Hub 成绩计入本表。

当前可复用夹具：[ACP 产品验收](fixtures/acp_product_probe.mjs)、[打包 App 通道](fixtures/packaged_client.mjs)。

## 最终检查与可复核证据

代码切换提交 `3fee7e4f`，主干合流 `91e5fe56`，最终实现 `9b8fa131d77e8b98feb79667d4a74c699bca0336`。
后续提交只整理此报告、脱敏证据和验收夹具的界面读回；不改变该提交的 Rust/Renderer 执行代码。
[允许公开的结构化证据](evidence/acp-retirement-2026-10-08.json)仅保留状态、Host/Session/Binding 关系、计数及摘要，
不含 Provider 文件、凭据、原始模型上下文或授权链接。

- `cargo test --workspace`：462 通过，2 项既有忽略；`cargo check --workspace --all-targets --all-features` 通过。
- 共享 ACP 69 通过 / 2 项原生人工 smoke 忽略，Cline 3 通过，Fleet 23 通过，Pi/原生来源过滤组 23 通过 / 1 项真实 Runtime smoke 忽略。
  通用进程 4 通过、macOS 内核身份与重启账本 2 通过；未重新跑其他 Runtime 的完整模型矩阵。
- 迁移过滤组 23 项及既有 Runtime catalog owner 扩展均通过。合并保留 main 的 Mission 描述 Atom 和续做授权，
  以完整结构识别 184/185 分叉来源，原子合流到 187/schema 137，覆盖回滚和重开。
- 前端类型检查、238 文件 / 2611 项 Vitest、相关 Node/IPC 与设置工作区回归通过；通用文档及 base diff 门通过。
- `pnpm package:mac` 与 arm64 ad-hoc 签名校验通过；仅启动独立验收 App，未替换或重启日常 App。
- [Windows workspace/all-targets 编译](https://github.com/murray17/rovai-ai/actions/runs/37795323664)在最终实现提交通过；这不等于 Windows Cline Runtime 真机资格。

全仓生产引用检查只剩旧 Missing-Send 结果的被动反序列化及拒绝，以及通用账本对 `runtime/cline-hub/hosts`
的旧自有进程回收路径。负向测试继续拒绝旧协议；不保留任何 Hub 启动、探测、恢复器或后备实现。
`tokio-tungstenite`/`tungstenite` 已无消费者并从锁文件删除；`futures-util` 仍是其他库的传递依赖，未按名称误删。

收口时保留的范围：本机 Cline 3.0.3 的精确 cold 不通过，ACP compact 未修复；原生完整 System 输入中 B 的精确次数、
首次完整授权、真实刷新、外部刷新并发及压缩后恢复仍未验证。普通 warm/并行保持 Preview，不以这些未验证项增加封禁。
