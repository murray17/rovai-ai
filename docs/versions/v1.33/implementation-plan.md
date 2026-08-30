---
document_type: implementation-plan
version: v1.33
lifecycle: current
authority: implementation-status
status: completed
last_updated: 2026-08-31
---

# v1.33 实施与验收

基线：`4e796bdedcbe771a2cd0f7ce083703e0db16cafb`。在隔离 worktree 的
`codex/pending-camp-input-v1` 分支实现；不覆盖日常 App 或生产 userData。

## 交付项

- Core migration 117、FIFO 私有输入、单编辑 token、自动续发与原子发布；
- Composer 上方等宽队列，编辑复用结构化输入，保留普通草稿；
- Composer 主操作保持单按钮：忙时无正文显示停止、有正文显示发送，附件边界由 UI 与 Core 共同验证；
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
初版 `dafeb3ac` 的独立界面复核结论为 `ship`；用户随后指出暂停/继续模式与自动续发预期冲突，
本轮已删除该模式、接口、入口和新库建表，并把提交按钮固定为“发送”。旧开发库的遗留暂停记录不再读取，
不需要清空验收数据。原队列中的两条输入在新包启动后自动依次发布并各执行一次，后一条 Run 的开始时间
晚于前一条结束时间；没有点击继续或重写输入。

本轮重新通过类型检查、前端完整回归、Clippy、staged Rust 全 workspace、Rust PR 门禁、文档门禁、
arm64 打包和签名检查，以及更新后的 7 个真实 Runtime 场景。验收脚本不再用人工暂停制造队列，
通过真实运行中的 Turn 覆盖编辑与恢复，结束时不遗留编辑占用。
移除暂停模式那轮的夜间截图、可访问性树均显示“发送”，队列没有暂停/继续入口。
完整双主题、尺寸及 200% 缩放矩阵未补齐；最终原生鼠标点击与焦点复验仍受桌面工具故障限制，
不把这些证据写成全部原生交互已通过。交互稿仍以本地 HTML/CSS 对照，未将历史编辑截图当作最终焦点证据。

后续验收反馈将 Composer 右下角主操作收为一个按钮：运行中无正文（含仅空白字符）时为“停止”，
有正文时为“发送”，删空恢复停止；空闲时为发送。复用同一个 button 节点并切换 type、事件和禁用状态，
空输入框按 Enter 仍经既有发送门禁返回，不触发停止；入队和停止后自动续发的 Core 逻辑不变。
该 Renderer 修正已通过类型检查、完整前端回归及真实 Electron 原生输入组件回归；既有渲染用例同步
验证运行中/停止中不并列显示发送、终态恢复发送。原生整页鼠标与键盘切换验证仍受上述工具故障限制。

2026-08-31，移除编辑区三处说明：队列下方的等待提示、框内编辑标题/顺序说明、框内本地草稿说明。
保留编辑行标识、保存/取消、可访问名称及错误/恢复提示；操作按钮继续靠右。不改变 Core 状态机。
类型检查、`App.test.ts` 147 项、原生 Composer 6 个输入场景、Pending Core 7 项确定性测试均通过。
本轮 arm64 开发包重新构建、签名检查和启动核对通过；当前验收会话保留原队列、普通草稿、消息和 Run，
第二位队员芝士已配置并加入会话。更新前的队首编辑继续保留，重开后由用户重新编辑或关闭，不代为提交。

同日扩展既有 opt-in 验收脚本，以相同的 Codex CLI / gpt-5.6-sol / xhigh 配置运行两位队员。
11 项场景检查通过：指定非队长“芝士”后 B/C/D 的续发目标保持不变；编辑队首时 A 自然完成后仍保留三条私有输入且不启动下一轮；
取消编辑后发送原版 B，保存编辑后发送修改版 B，随后 C/D 各在前一条结束后执行一次；普通草稿不被覆盖。
附件在队列非空时被拒绝且保留完整草稿，队列清空后原草稿可发送，芝士实际读出中文文件名附件中的随机校验值。
既有一次停止后自动推进和重启编辑 token fencing 场景也通过。配置值与 Runtime 上报分开记录：本次 Codex Run 的
`runtimeModel` 未上报，不用配置推断提供方返回的实际模型。测试使用全新隔离 fixture，不修改用户当前验收 Camp。
原生 App 点击通道仍返回 `Sky Computer Use native pipe closed before response`，上述结果不等同于完整鼠标/焦点验收。

## 测试准入说明

Pending 模块是队列准入、编辑 fencing 和原子发布的唯一 owner。已有消息和 Runtime 测试没有覆盖
私有输入跨重启编辑、队首阻塞和 Message/Pending 同事务提交；纯函数不能证明这些 SQLite 边界。
新增确定性数据库用例分别拥有 FIFO/成功唯一性、编辑重启/token、修复后命令身份、Continuation/Lead
绑定时机、附件不消费、终态后推进/非终态阻塞与提交回滚。用户验收反馈后移除暂停/继续模式，
既有停止和回滚测试分别更新为终态自动推进、发布失败需编辑保存；未新增或删除独立测试。
fixture 使用临时目录，普通测试不启动真实 Runtime。
最小命令为 `cargo test -p rovai-core --lib pending_camp_input::tests`。Migration 的现有准入矩阵扩展
v1.29/schema-70 来源，新迁移 owner 验证原数据保留和重开幂等。

已有 Collaboration/Runtime 的测试夹具继续显式构造已准入的公开消息；该入口仅在 `cfg(test)` 下存在。
新的队列断言走生产 Composer 发送入口，避免把历史消息内核夹具误当作用户正在提交的草稿。

真实 Runtime 验收入口为 `node scripts/accept-pending-camp-input.mjs --core <绝对 Core 路径>`。
它创建全新的临时 userData、项目、Skill Library 和 MCP config，验证两队员定向续发、文件附件、三条队列的队首编辑、FIFO、停止后自动推进和重启 fencing，
不加入普通测试门禁。可通过 `--runtime-config <JSON 路径>` 指定 adapterKind、model 和 permissions；配置不应含凭据。
结果与合成验收 Camp 写入脚本打印的隔离 fixture；结束时不遗留人工暂停或编辑占用，供打包 App 后续验收。
