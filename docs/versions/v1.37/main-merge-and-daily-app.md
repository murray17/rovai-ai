---
document_type: implementation-evidence
version: v1.37
authority: main-merge-and-local-daily-installation
status: completed
last_updated: 2026-09-01
---

# main 合并与 Applications 安装

本记录按批次覆盖 v1.37 分支的 main 合并、回归和本机安装。
不提升 Runtime 平台资格，不将尚未完成的渠道验收改判为通过；没有创建 PR。

## 源码边界

- `edc006f4`：保存 Runtime 图片实施及六种 Runtime 的真实图片结果验收。
- 合并 main `01c70f08ceb62d2ab205e892192ec5103fc94324`，merge commit `2a166702`。
- 保留 main 的业务投影 Open schema 6、消息本地 sequence 排序和阅读位置；同时保留渠道来源及
  Runtime 图片元数据。图片仍在同 Run 最后公开消息后、Files Changed 前。
- 同号 v10 合同分别保留原文，合并当前接口由 [Camp Open Projection v12](../../contracts/camp-open-projection-v12.md)
  拥有；旧渠道 v10 的引用只修正路径，不重写历史语义。
- `826f1896`：把既有 Product Contract Fingerprint 测试的旧 Data Contract 预期同步为 `v1.43 / schema 84`。
  不改变生产代码、测试门槛或历史 Benchmark artifact。

## 验证结果

- `pnpm typecheck` 通过。
- Vitest：133 文件、1339 项通过，使用 `--maxWorkers=2`。
- package test 命令串中的 Node 脚本：220 项通过、1 项既有 Windows 原生专项跳过；文档单测 9 项、
  Skill 单测 3 项及 14 个 Skill 的通用检查通过。
- `pnpm test:rust:pr`：fast library 469、CLI 32、slow integration 294 项通过；另外
  `pnpm test:rust:core` 187 项通过、4 项既有人工 Runtime smoke 跳过。合计 982 项 Rust 测试通过。
- 首次并行构建时，既有 Runtime identity discovery 测试一次未取得版本；独立重跑及随后完整重跑均通过。
  未禁用该测试，未放宽超时阈值。
- Rust fmt、含 slow-tests 的 all-targets Clippy `-D warnings`、普通及以以上 main SHA 为 base 的
  文档治理检查、`git diff --check` 通过。
- 隔离生产组件验证：图片 Gallery、业务投影刷新/旧消息/阅读位置、渠道 Camp 命名全部通过。
  CampOpen 回归保留 61 条消息，refresh/append 的阅读锚点位移均为 0。

## 打包与安装

使用 `pnpm package:mac:daily` 构建 macOS arm64 ad-hoc App，未发布 Release。
在全新临时 `userData`、独立 Skill Library/MCP 配置下运行打包 App；主页、队员、队员详情和新对话
截图通过。该隔离数据库已完成 Migration 133，图片表存在；未发送 Camp 消息、未运行新的模型或渠道发件。
验收 App/Core 已退出，日常数据未用作测试 fixture。

Core 和 CLI 在构建暂存、打包 App、最终安装位置的 Mach-O UUID 一致：

| Binary | arm64 UUID |
| --- | --- |
| Core | `FD56BE6E-A513-3FC6-881C-EA75E35DABFD` |
| CLI | `D47286B8-90A5-3AA2-8082-54051A18172D` |

通过 `pnpm install:mac:daily` 安装到 `/Applications/Rovai AI.app`，保留旧版
`/Applications/Rovai AI.backup-before-20260831T152139Z.app`。源、同文件系统暂存和最终安装位置均通过签名、
Bundle ID 与架构验证。

安装后原 Main PID 79785、Core PID 79795 及四个原 Helper 均仍存活；安装没有终止进程或改写日常
`userData`。这是磁盘安装，不是热升级：当前运行实例仍是旧版，用户退出后从规范 Applications 路径
重新打开才使用新构建。备份继续保留，不从备份或仓库 dist 启动日常实例。

## 2026-09-01 飞书执行台交付

### 源码边界

- `4d1db313`：停止 exact-run 后即时把飞书执行卡收敛为“已取消”，并保留 Owner callback 鉴权与幂等取消。
- `e254df64`：把只读 Web 执行台恢复为 Rovai 生产执行台的信息结构和视觉语言；每个 AgentRun、连续工具组、
  每条 Command 与文件变化均可独立折叠，聚焦 Run 和当前尾部默认展开，触发者固定显示“你”。
- `042844c4`：一次性 HTML、Snapshot 和错误响应显式关闭短连接，SSE 独立保持长连接，避免同地址重绑后
  浏览器连接池复用旧 socket。
- 最终再次合并 main `6114c9dd685d952a058b3e34397812853d01be3e`，merge commit 为 `88ebaca2`。
  冲突只位于 `channel.rs` 的相邻测试插入点；最终同时保留 exact-run 取消测试和 main 新增的
  `terminal_pending` 重启恢复测试，生产恢复扫描、quiet window、CAS 封存与同事务终态 Outbox 语义不变。

### 验证结果

- 生产执行台 HTML 在桌面 `1440px`、手机竖屏 `375×812`、手机横屏 `812×375` 下完成真实浏览器验证；
  无页面级横向溢出，Run/工具组/Command 键盘展开成立，移动端可见 summary 高度至少 `44px`。
- 浅色主题最低实测文本对比度 `4.73:1`，深色主题最低 `6.13:1`；禁用文案“局域网视图”和“飞书成员”
  不再出现，触发者显示“你”。
- ExecutionViewService 针对性测试连续运行 20 轮通过；完整 `pnpm test` 通过 134 个 Vitest 文件、
  1373 项测试，以及 220 项 Node 脚本测试，1 项 Windows 原生专项按平台跳过。`pnpm typecheck`、
  `pnpm build:desktop`、Rust fmt 和文档治理检查通过。
- 合并最新 main 后，两条交叉 Core 测试分别通过：
  `owner_card_cancels_only_the_exact_channel_agent_run_idempotently` 与
  `terminal_execution_console_recovers_after_completed_request_and_restart`。

### 打包与安装

最终在 `88ebaca2` 上重新执行 `pnpm package:mac:daily`；macOS arm64 App、Core、CLI 均通过 ad-hoc
签名、架构和 Bundle ID `ai.rovai.desktop` 门禁。打包与安装位置的 Mach-O UUID 一致：

| Binary | arm64 UUID |
| --- | --- |
| Core | `16BF73E7-AC9F-3450-A3B6-3D91F8621BA2` |
| CLI | `414020A7-D440-3391-BC9B-2E27AB524BDD` |

通过 `pnpm install:mac:daily` 原子安装到 `/Applications/Rovai AI.app`，旧版保留为
`/Applications/Rovai AI.backup-before-20260901T093520Z.app`。最终安装的 `app.asar` 已确认包含
`command-disclosure` 生产实现。

安装前后的原 Main PID 均为 90222，启动时间仍为 2026-09-01 16:13:04；安装没有终止或重启当前实例，
也没有把日常 `userData` 用作测试 fixture。当前运行实例仍是旧内存代码；用户退出后从规范 Applications
路径重新打开，才会运行本次安装的磁盘版本。
