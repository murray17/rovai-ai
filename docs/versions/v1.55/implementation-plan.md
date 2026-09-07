---
document_type: implementation-plan
version: v1.55
authority: implementation-and-acceptance-status
status: complete
last_updated: 2026-09-07
---

# v1.55 实施与验收

## 实施范围

- [x] 扩展 FilePreviewPathPresentation，由 Main 按 canonical 文件与 canonical 项目根签发
  project_relative、external 或 file_name_only。
- [x] 让项目根文件和项目外普通文件显示路径；主目录内外部路径使用 ~/，其他位置使用绝对路径。
- [x] 区分本地源引用与 Managed/legacy 附件：前者成功预览后显示和复制实际路径，后者保持安全文件名并拒绝 absolute 复制。
- [x] 将路径行接入既有 revealInFolder；将可见复制入口改为“复制完整路径”并固定使用绝对格式。
- [x] 为长路径补齐中间省略、完整 title、hover/focus tooltip、键盘焦点和失败反馈。
- [x] 为同名普通文件 Tab 计算最短唯一目录后缀，并保留安全序号回退。
- [x] 保持显式 Markdown 入口、来源工作目录、文档目录解析、restore、Root Grant 和单文件能力边界不变。
- [x] 从 Pi JSONL RPC v1 成功 `edit` 终态接入 `result.details.patch`，并把 reported path、双文件头、hunk 与
  同一 `toolCallId` 的参数绑定；终态缺参时只复用该 ToolCall 已观察的 start/update 参数。
- [x] 对 Pi patch 执行 fail-closed 规范化和 managed output 排除；增删统计只计算 hunk 内容行，`write` 与不合格
  edit 继续保留 path-only 文件操作。
- [x] 发布 `activity-v4`，让新 operation 接纳 Pi edit Diff；v1/v2/v3 operation 与历史投影保持冻结，Read Side
  按 v4、v3、v2、v1 读取。
- [x] 以 Migration 147 在 Notification Single Chat Migration 146 后原子推进
  `v1.54 / schema 96 / activity-v3` 到 `v1.55 / schema 97 / activity-v4`，不回写 Evidence 或 Canonical Activity。
- [x] 更新合同、架构、UI、版本生命周期与决定导航。
- [x] 完成完整测试、Desktop 构建和文档治理门禁。

## 验收矩阵

| Gate | 状态 | 证据 |
| --- | --- | --- |
| Main 路径投影与系统操作 | passed | 定向 Vitest 覆盖项目根、项目外绝对路径、~/、symlink canonical 目标、Managed/legacy Attachment 隐私、reveal 与绝对路径复制 |
| Renderer 路径与同名 Tab | passed | 定向 Vitest 覆盖 ready 可见性、项目根/外部/Managed Attachment、路径按钮与 tooltip、最短唯一后缀和重复后缀扩展 |
| 消息链接与来源解析 | passed | SafeMarkdown、File Preview session 定向回归及 `pnpm test:file-reference-navigation` 保持显式链接、点击时解析、行范围和阅读锚点 |
| 真实 Electron 交互与视觉 | passed | 生产 Renderer 场景验证 Day/Night、窄宽路径、~/ 外部路径、hover 完整值、路径 reveal 和 Managed Attachment 无路径行 |
| TypeScript / Desktop build / 全量测试 | passed | `pnpm typecheck`、162 files / 1657 项 Vitest、223 项 Node 测试（1 项 Windows 平台跳过）和 `pnpm build:desktop` 通过 |
| Pi edit Diff ingress / activity-v4 / Migration 147 | passed | Pi/normalization/classifier/migration 定向回归通过；Core lib 540/540、Core bin 234/234（5 项 manual smoke ignored）、CLI 33/33 通过；`cargo check --workspace --all-targets` 与标准全 workspace Clippy 通过。真实模型 smoke 不重复执行，wire 证据来自同一 Pi 0.84.4 Native Session 的只读核验 |
| 文档治理与 diff hygiene | passed | `pnpm docs:test`、`pnpm docs:check`、固定 base 的 `pnpm docs:check:ci` 和 `git diff --check` 通过 |

## 完成条件

- 项目内、项目根和项目外普通文件成功打开后都显示 Main 签发的实际路径形式。
- 长路径在窄文件区不产生水平溢出，鼠标和键盘可读取完整值并定位当前文件。
- 同名 Tab 提供最短的必要目录信息；用户源附件遵循相同路径规则，Managed/legacy 不暴露内部路径。
- 复制完整路径对项目内外普通文件均得到重验后的 canonical 绝对路径。
- 项目切换不改变历史文件引用的解析基准，缺少上下文时不搜索或猜测文件。
- 展示和系统操作不新增 Root Grant、父目录授权、工作目录变更或 Agent 权限。
- Pi 成功 edit 只有在原生 patch 与同 ToolCall 路径精确绑定时显示可靠 `+ / -`；write、失败或不完整 edit
  不伪造 Diff，旧 classifier 的 operation 不因升级重分类。
- Migration 147 只从完整 v1.54/schema 96/activity-v3 来源、且在 receipt 146 后提交 marker 与 receipt；失败原子回滚。
- TypeScript、完整测试、Desktop 构建、真实 Electron 场景与文档治理门禁全部通过。

## 用户源附件路径回归修复

消息首条附件为 Local Attachment Source Ref 时，旧实现将其统一投影为 file_name_only，导致实际本地文件
成功预览后仍看不到路径。File Preview v11 用 Core/Main 内部 canShowPath 区分来源；不新增持久化或 Renderer
附件字段。主进程按所属 Camp 的 workspace authority 计算相对路径，不能使用附件父目录代替项目根。

回归 owner 为生产 CoreFilePreviewSourceAuthority + FilePreviewService + 路径可见性函数，表驱动覆盖项目根、
子目录、Downloads 与缺少 workspace；同一场景验证 absolute copy、reveal、路径许可撤销和 Camp restore。
既有受管附件测试扩展为经过 Core authority，保留隐藏路径与只复制安全文件名的检查。

Rust 新增最低成本的 source desktop target 测试，拥有源引用经文件验证后允许路径呈现、文件删除后拒绝的独立
回归语义；现有测试仅验证 Runtime source 拷贝或 Managed desktop target，不能覆盖此边界。Managed 分支扩展
既有 slow test 断言，不另建数据库 fixture。最小命令为
`cargo test -p rovai-core --lib source_attachment_desktop_target_allows_path_after_source_validation`。

修复门禁：定向 Vitest 3 files / 55 tests、完整 Vitest 163 files / 1669 tests、Node 222 passed / 1 Windows
skip、TypeScript、Desktop build 和真实 Electron `test:file-preview-layout` 均通过。`test:rust:pr` 的 Core lib
541、CLI 33 与 slow lib 307 项全部通过。同步修正既有产品指纹测试的版本期望到当前 v1.55/schema 97。
打包后的原生源附件验收与 Applications 安装结果在本次 PR 交付记录中报告。
