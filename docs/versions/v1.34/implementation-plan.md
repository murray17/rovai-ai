---
document_type: implementation-plan
version: v1.34
status: completed
last_updated: 2026-08-31
---

# Camp Fast 实施与验收

初始基线 `53d6e99a4662676cb7b3794681f1be74bf619b2f`；分支 `codex/fast-camp-member-mvp`。
实施期间同步主线 `8c98d5bf257abaf91cfcbbcf6ba55e95f6a28da6`，保留其连续消息队列与 Migration 117；
Fast 顺延为 v1.34 / Migration 118，两条旧源升级路径分别验证。
用户已授权独立 worktree 实施、PR 到 main 并合并。原始下载原型仅作参考，后续修订的最小方案拥有范围。

## 实施

1. Migration 118、保存绑定代次、Camp preference、事务命令/receipt、异步检查 fence 和 Run freeze。
2. Claude 原生认证、单 settings argv、on/off/cooldown；Codex 原生 metadata、schema 能力门禁、每 Turn 覆盖。
3. Usage observed tier 优先级、未知撤回估价、原生成本保留。
4. 既有成员浮层、静默自动检测与直接开关、焦点稳定、布局与隔离 Electron 回归。
5. 合同后继、版本切换、完整本地回归、独立复核、PR CI 与合并清理。

## Rust 测试准入

新增 owner 只覆盖此前不存在的合同，不为 UI 微调创建镜像测试：

| Owner | 修复前失败输入 / 独立性质 | 最小命令 |
| --- | --- | --- |
| `camp_fast` 原生资格纯函数矩阵 | 未知 auth、自定义 endpoint、缺模型 tiers 被误认为合格；两种原生输入形状分别拥有最低层 parser | `cargo test -p rovai-core --lib camp_fast::tests` |
| `camp_fast` 持久化生命周期 | 普通重测丢选择、切回旧绑定复活选择、Run 中途读到新覆盖；必须通过 SQLite/receipt/freeze seam | 同上 |
| `db` v118 migration | v1.33/schema 71 已有成员升级后丢绑定或被默认开启；新列/trigger 的升级是独立兼容入口 | `cargo test -p rovai-core --lib db::tests::v118` |
| `health` metadata 进程 seam | 原生检查未使用选定 executable/实际 cwd、丢 config includeLayers 或模型分页；纯 parser 不能验证进程参数和 RPC | `cargo test -p rovai-core --bin rovai-core health::tests::native_fast` |
| `claude` Session 观察 | 非当前 Session 的 Fast 结果污染状态，cooldown 被丢失；该新 metadata route 无既有 owner | `cargo test -p rovai-core --bin rovai-core claude::tests::native_fast` |

扩展既有 Claude session argv owner 覆盖新建/resume × 三态及单一 settings；扩展 Codex turn request/schema
owner 覆盖精确字段/省略/持久字段拒绝；扩展现有 pricing/monitoring owner 覆盖请求 Fast、实际 Standard 和
unknown 撤回。未删除、禁用或复制旧 Rust 测试。

独立复核补充：扩展既有 scheduler rebind owner，验证默认/显式模型均保留已冻结的 Fast，即使用户后来
选择 Standard；冻结摘要仍通过既有完整对象校验。资格缓存 owner 增加 search generation 拒绝、Codex
fallback 不改 Thread 默认；metadata 检查复用已有 executable identity wrapper 及其更新/清理失败测试，
检查前后均验证已解析的 executable，避免等待锁期间替换后的稳定结果写入旧 identity。
Electron owner 增加原生输入触发后挂起响应、换绑定、再释放旧响应，分别覆盖检测和保存迟到。
主线整合后扩展现有 Pending 队列终态 owner：A 已冻结、B 已入队时切 Fast，B 发布时采用新选择，
A 的完整冻结配置保持不变；不增加并行测试 owner 或改变消息队列行为。
历史 Migration owner 的升级后断言改为当前 contract 常量；旧源形状仍独立冻结。Product Fingerprint 的
现行版本断言与兼容性文件 byte digest 同步更新，不改变平台资格状态或既有历史证据内容。

## 验证记录

验证在隔离 worktree 进行，不启动日常 App，不使用日常 Electron userData。UI fixture 运行生产
CampWorkspace，通过关闭的模拟 API 供给数据，无 Core/SQLite/真实 Runtime；native auth/schema 只检查
metadata，不发起模型请求。以下为主线整合后的本地结果；PR CI、合并与清理结果由 GitHub PR 和开发交接记录拥有。

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck`、`pnpm test` | 通过；719 项 Vitest、219 项 Node 测试，1 项既有平台 skip；文档与 Skill 检查通过 |
| `pnpm build:desktop` | 通过 |
| `pnpm test:rust:pr` | 415 项 lib、32 项 CLI、291 项 slow 测试通过 |
| `cargo test -p rovai-core --bin rovai-core -- --quiet` | 184 项通过，4 项既有 ignore |
| `cargo test -p rovai-core --lib pending_camp_input::tests -- --quiet` | 7 项通过，包括整合后补充的 Pending/Fast 发布时冻结断言 |
| `cargo fmt --all --check`、严格 Clippy 全 workspace/all-targets | 通过 |
| 生产 Electron fixtures | Fast 布局、连续消息、contextBridge、结构化输入、启动呈现、文件预览六组通过 |
| diff-aware 文档检查 | 对整合基线 `8c98d5bf257abaf91cfcbbcf6ba55e95f6a28da6` 通过；无 checker exception |

## 独立复核

| Standards | Spec |
| --- | --- |
| rebind 丢失冻结选择与摘要问题已修复；metadata 复用完整 executable identity，并在检查后再次验证原 fingerprint。双迁移、旧源助手和版本路由复核无剩余阻断。 | Codex fallback 不再改写 Thread 默认；迟到的检测/保存结果不能恢复旧绑定 UI。Pending 发布时冻结新选择，已有 Run 保持原值；无剩余实现问题。 |

复核针对 `b9f58fc7` 的生产实现；随后扩展现有 Pending owner 并完成上述回归，没有修改队列产品语义。
首轮 Linux CI 暴露 fixture 预先打开浮层会被启动焦点事件收起；fixture 改为与正常工作区相同的初始收起状态，
经原生点击入口打开后再断言，并保留全部布局/焦点断言。产品的浮层关闭规则未修改。

首轮实现的本机边界：Claude 2.1.220 仅报告 `oauth_token`、订阅类型为空；Codex 0.147.0 标准与 experimental schema
均无 `serviceTierForTurn`。当时两者均按未知/不支持隐藏；Claude 判断过严的问题由下述修正处理，
不能宣称本机原生 Fast 端到端成功。

## 2026-08-31 最小修正

用户确认只做三项修改，不继续扩展状态模型：

1. Claude 原生 firstParty 登录接受 `claude.ai` / `oauth_token`，移除 `subscriptionType` 硬门槛。
   继续拒绝自定义 Key/Base URL/云 Provider、未知认证方式与不支持的 CLI；运行资格由原生 Runtime 判断。
2. Fast override 只在真正更换 Runtime 绑定时失效。模型变化使资格缓存失效，但保留所有 Camp 的偏好；
   权限变化不修改 Fast。Migration 119 替换已发布的 v118 触发器，从 schema 72 升到 73，保留旧选择。
   异步资格检测使用既有模型配置快照和冻结模型校验，不添加资格代次。
3. 成员浮层只表达后续执行偏好，不显示实际状态警告。`runtime.fast.observed` 仅保存为当前 Run/epoch
   的安全 Execution Evidence，Codex 实际 service tier 继续进入该 Run 的 monitoring；不回写 Camp。
   三态下发不变：true 请求 Fast、false 请求 Standard、null 省略参数。旧观测列保留但不再使用，
   不增加 preferenceRevision、observedRunId、currentRunFastState、lastRunFastState 或类似字段。

本次 worktree：`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-fast-auth-preference-fix`；
分支 `codex/fast-auth-preference-fix`，基线 `91ecd6d40d8618af20e3a3aa3d839d22da320637`。
无需单独主线治理提交；沿用 v1.34 范围并同步当前合同、Runtime 边界、组件与兼容性文档。

测试准入：扩展既有 `camp_fast` 认证矩阵与持久化 owner，覆盖缺失/null 套餐、官方 OAuth、两个 Camp 的
相反选择、权限变更、模型失去/恢复资格、迟到旧模型结果、真正换绑定与冻结三态。旧 Camp 观测断言随该
合同退出，运行观测的隔离/脱敏由既有 Execution Evidence owner 接手，未禁用测试。新增独立 v119 migration
owner 是已发布 schema 72 的升级兼容入口；验证三态保留、旧 trigger 替换及重新打开幂等，纯函数不能覆盖此边界。
最小命令分别为 `cargo test -p rovai-core --lib camp_fast::tests`、
`cargo test -p rovai-core --lib db::tests::v119` 与既有 Execution Evidence owner。
生产 Electron fixture 扩展旧 Fast/Standard/cooldown 投影不影响按钮、无警告的场景，保留原布局/键盘/失败/重测断言。

修正验证在隔离 worktree 完成：

| 检查 | 结果 |
| --- | --- |
| 定向认证/偏好、v119 升级、Run Evidence | 通过；Fast metadata 不产生 Canonical Activity |
| `pnpm typecheck`、`pnpm test`、`pnpm build:desktop` | 通过；719 项 Vitest、219 项 Node，1 项既有平台 skip |
| `pnpm test:rust:pr` | 416 项 lib、32 项 CLI、291 项 slow 通过 |
| `cargo test -p rovai-core --bin rovai-core -- --quiet` | 184 项通过，4 项既有 ignore |
| `cargo fmt --all --check`、严格 Clippy 全 workspace/all-targets | 通过 |
| 生产 Electron Fast fixture | 通过；浅色/深色截图、键盘与旧观测不影响偏好/UI 已复核 |
| diff-aware 文档门禁 | 对本次基线通过，无 checker exception |

独立复核针对实现提交 `e0982586`，后续仅补充本节验证记录及概览说明：

| Standards | Spec |
| --- | --- |
| 0 项待修问题；Rust 测试准入、既有视觉与无障碍边界符合规范。 | 0 项待修问题；三态下发、模型/权限保留选择、观测仅归属 Run，未扩展状态模型。 |

PR CI、合并与清理结果由 [PR #126](https://github.com/murray17/rovai-ai/pull/126) 拥有。
本机仅重跑原生 `--version` / `auth status`，确认 firstParty OAuth、套餐为空、无自定义环境；未调用模型、
未读取凭据文件或钥匙串，也未触碰日常 App 数据。

## 2026-08-31 自动检测交互修正

根据用户确认的自动检测范围，展开会话区队员浮层后，静默调用既有 `camps.members.fast.check`：
仅检查缺少有效结果的 Claude/Codex 队员；不展示检测占位、成功通知或失败 Toast，移除手动检测菜单。
当前 Camp 工作区复用正负结果和在途请求，切换浮层 Tab 不丢缓存；失败在下次展开重试，绑定、模型或
Installation 检测依据变化时重新检查。旧请求先结束，迟到结果不能恢复旧绑定按钮，也不阻止其他成员切换 Fast。

三态偏好、原生认证门禁、`fast.set`、执行冻结与 Run 监控均不变；没有新接口、迁移、持久状态或模型请求。
扩展既有生产 Electron owner，覆盖自动检测、静默失败/重试、重复展开、正负缓存、同成员请求去重、
Runtime/认证切换及旧响应隔离，继续保留布局、双主题、键盘焦点、保存失败和初始默认断言。
Profile/Installation 先于 Camp 投影刷新时，不能沿用旧投影或本地保存结果展示 Fast，已有 fixture 增补此顺序。

真实开发版复现了新安装仅有 `light_ready` 时的前置缺口：Claude 原生资格已通过，但只读投影仍要求 `ready`；
Codex 此时还没有每轮档位能力快照，会提前被判为不支持。`runtime_for_target` 现在只复用完整且未过期的原生
能力快照，否则沿既有检查队列先执行 `AvailabilityCheck`，随后再检查实际 cwd 的 Fast 资格。
不放宽认证/协议门禁，不增加深检入口或模型请求。扩展既有 `camp_fast` 持久化/投影 owner，覆盖轻检、
检查失败和未认证输入必须先补齐能力，不新增 Rust 测试函数或平行数据库夹具；最小命令为
`cargo test -p rovai-core --lib camp_fast::tests -- --quiet`（3 项通过）。

使用独立 worktree，分支 `codex/fast-auto-detection`，基线 `1a90e864ecfbe9e2d21d28f69dd122e461e40ea0`。
沿用当前 v1.34，同步 Fast、Runtime、UI 和测试合同，无单独主线治理提交。

本地 `pnpm typecheck`、`pnpm test`（731 项 Vitest、219 项 Node，1 项既有平台 skip）、
`pnpm build:desktop` 和生产 Electron Fast fixture 通过；最终缓存字段精简后重新通过 Typecheck 和 Electron fixture。
开发版 Core 由当前 worktree 单独构建，使用独立 userData、Skill Library 和验收工作目录，
参考本机 Claude Code 2.1.236 与 Codex CLI 0.151.0 的原生安装和默认配置，不复制日常数据库或凭据。

真实开发版中，两条 Runtime 均从 `light_ready` 自动补齐为 `ready`，并通过原生 Fast 资格检查后显示按钮。
设置接口的 `true/false/null` 均已验证；两次重复展开未再次检测，期间没有 AgentRun。
验收中用户补充取消 Fast 按钮的悬浮提示和费用确认：删除提示 DOM、确认状态、存储标记读写和样式，
点击直接切换并保存，保留可访问名称与键盘焦点。既有 fixture 改为验证首次点击即保存。
成员菜单中的“恢复默认响应模式”也按用户要求删除；未设置覆盖时仍由 Runtime 原生配置决定默认值。
普通保存成功与运行中切换的提醒一并删除，Fast 正常交互静默，只有保存失败时显示错误反馈。
完整 Rust lib 416 项通过；Core binary 184 项通过，4 项既有真实环境测试忽略。

用户已验收隔离开发版，并授权创建 PR、合并 main 和删除 worktree；最终门禁与合入结果由 PR 和 CI 记录拥有。
用户验收产生的 Codex 执行确认请求了 `priority`，但当前原生会话日志、完成事件和用量事件未报告实际档位，
不能把请求配置或执行成功当作服务端实际 Fast 的证据。本次未为该观测限制增加 UI 提示或状态模型。
