---
document_type: implementation-plan
version: v1.33
lifecycle: current
authority: implementation-status
status: completed
last_updated: 2026-08-30
---

# v1.33 实施与验收

基线：`4e796bdedcbe771a2cd0f7ce083703e0db16cafb`。在隔离 worktree 的
`codex/pending-camp-input-v1` 分支实现；不覆盖日常 App 或生产 userData。

## 交付项

- Core migration 117、FIFO 私有输入、单编辑 token、队列暂停与原子发布；
- Composer 上方等宽队列，编辑复用结构化输入，保留普通草稿；
- 忙时同时保留停止和入队，附件边界由 UI 与 Core 共同验证；
- 无自动重试、无心跳、无 Pending 附件或 Runtime mid-run 能力。

## 验证记录

2026-08-30，本地功能与自动化验证结果如下；用户验收和主线合入另行记录，不计作已完成。

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm test` | 通过；99 个 Vitest 文件、714 项用例，Node 测试 219 通过、1 项 Windows 限定跳过 |
| `pnpm test:composer-input`、`pnpm test:desktop-bridge` | 通过真实 Electron 输入和 contextBridge 检查 |
| `cargo fmt --all --check`、`cargo clippy --workspace --all-targets -- -D warnings` | 通过 |
| `pnpm test:rust:pr` | lib 411、CLI 32、slow 291 项通过 |
| `pnpm test:rust:core` | 182 项通过，4 项已有忽略项 |
| `pnpm test:rust:staged` | 暂存真实改动后命中 workspace-default 全量路由，411 + 32 + 182 项通过 |
| `DOCS_BASE_REF=4e796bdedcbe771a2cd0f7ce083703e0db16cafb pnpm docs:check:ci` | 通过通用文档治理 |
| `pnpm package:mac`、`node scripts/verify-macos-app.mjs arm64` | arm64 开发包构建和 ad-hoc 签名校验通过 |

真实 Runtime 以打包 Core 运行，7 个场景全部通过：B/C 私有入队；A 结束时编辑 B 阻止 C 越过；
A→B→C 各发布并执行一次；一次停止在 A 完全停止后自动发出 B；B 执行时 C 仍私有排队；保存编辑不改变位置、不覆盖普通草稿；
重启保留编辑占用并拒绝旧 token。运行使用独立临时项目、userData、Skill Library 和 MCP config，
只参考本机生产 Claude Code CLI 的 model/permissions 配置，没有复制生产数据或凭据。

开发包位于 worktree 的 `dist/mac-arm64/Rovai AI.app`；本机 `dist/启动连续消息开发包.command`
显式绑定上述隔离验收数据，避免双击 App 使用日常 userData。验收 Camp 与消息为合成数据。
不把 macOS 本地验证扩展为 Windows 原生或所有 Runtime 的兼容性声明。

UI 收尾按用户提供的 `rovai-message-queue-composer.html` 对齐：继承相同系统字体栈，队列文字
10.5px、普通行 32px、6px 空心圆点；普通/编辑底色、边框混色和删除悬停色复用交互稿配方，
同时随现有 day/night token 切换。整行和正文不触发编辑，仅由右侧 24px 小铅笔入口打开；删除独立。
独立界面复核结论为 `ship`，没有确认的实质修复项。最终日间桌面截图与源码已核对，
交互稿以本地 HTML/CSS 对照；未将历史编辑状态截图当作最终视觉或焦点证据。
最终原生鼠标点击与焦点复验因桌面工具故障未完成，夜间、小窗口和 200% 缩放的最终截图也未覆盖。
这些是验收证据空缺，不代表全部主题、尺寸和原生交互已通过；交付说明保留这些边界，供用户验收。

## 测试准入说明

Pending 模块是队列准入、编辑 fencing 和原子发布的唯一 owner。已有消息和 Runtime 测试没有覆盖
私有输入跨重启编辑、队首阻塞和 Message/Pending 同事务提交；纯函数不能证明这些 SQLite 边界。
新增确定性数据库用例分别拥有 FIFO/成功唯一性、编辑重启/token、修复后命令身份、Continuation/Lead
绑定时机、附件不消费、停止后推进/失败暂停与提交回滚。fixture 使用临时目录，普通测试不启动真实 Runtime。
最小命令为 `cargo test -p rovai-core --lib pending_camp_input::tests`。Migration 的现有准入矩阵扩展
v1.29/schema-70 来源，新迁移 owner 验证原数据保留和重开幂等。

已有 Collaboration/Runtime 的测试夹具继续显式构造已准入的公开消息；该入口仅在 `cfg(test)` 下存在。
新的队列断言走生产 Composer 发送入口，避免把历史消息内核夹具误当作用户正在提交的草稿。

真实 Runtime 验收入口为 `node scripts/accept-pending-camp-input.mjs --core <绝对 Core 路径>`。
它创建全新的临时 userData、项目、Skill Library 和 MCP config，验证 FIFO、停止/继续、编辑保存和重启 fencing，
不加入普通测试门禁。可通过 `--runtime-config <JSON 路径>` 指定 adapterKind、model 和 permissions；配置不应含凭据。
结果与保留的 UI 验收 Camp 写入脚本打印的隔离 fixture，供打包 App 后续验收。
