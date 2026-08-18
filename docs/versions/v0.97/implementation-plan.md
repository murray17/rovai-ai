---
document_type: implementation-plan
version: v0.97
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-17
---

# v0.97 实施与验收计划

## 计划状态与使用方式

本计划基于 v0.96 最终提交 `44075a11`、用户确认的四页产品语义、附件 HTML 原型与 Codex Brief 编写。
附件只提供需求和视觉输入，不覆盖仓库的 ADR、Contract、Architecture、`DESIGN.md`、主题合同或当前代码。
任何最终完成结论都必须由 rebase 后的全量测试、打包与隔离 Application 验收证明。

## 不变量

- 首次安装判定发生在 Core 启动建库之前；已有产品数据永远不被新训练阻塞；
- 前三页没有 skip，所有有效进度先持久化再返回 Renderer，restart 回到精确未完成页；
- Desktop 状态只拥有 admission/progress，Member、Runtime、Camp、Message 与 Draft 始终归现有 authority；
- provisioning 在任何 Core effect 前冻结三个 command ID 与 Runtime 权限载荷，随后逐阶段 checkpoint；
- 同一 provisioning retry 使用完全相同的 command identity 和 mutation payload；
- completion 晚于真实 Camp 与 restorable location，早于且独立于第四页 starter 交互；
- “初次集结”只包含选中 Member，且该 Member 同时是 Default Lead；
- starter 只写 durable Draft，不产生 send、Turn、Run、Skill、Tool 或 Runtime side effect；
- UI 延续 Porcelain Day / Steel Night，同一 DOM 和功能，不引入渐变、发光或 replacement-world 视觉。

## Checkpoint 0：版本与长期文档

- [x] 建立唯一 current v0.97，冻结 v0.96 historical，并更新前后版本链接；
- [x] 接受 [ADR-0202](decisions.md#adr-0202)；
- [x] 建立 [First-run Onboarding v1](../../contracts/first-run-onboarding-v1.md)与
  [First-run Onboarding 架构](../../architecture/first-run-onboarding.md)；
- [x] 更新 [首次训练 UI](../../ui/components/first-run-onboarding.md)及文档路由；
- [x] 生成 HISTORY 并通过 `docs:test`、`docs:check`、真实 base 的 `docs:check:ci`。

## Checkpoint 1：pre-Core admission 与持久状态

- [x] Electron Main 在创建 Core Server 前读取 `onboarding.json` 并检查当前/遗留数据库；
- [x] fresh install 与 existing installation 使用 closed `schemaVersion: 1` union；
- [x] exact-key parser 拒绝宽松、矛盾或越阶段 persisted shape；
- [x] 写入队列串行化，使用 atomic private JSON 与 `0600` 文件权限；
- [x] typed preload/API 只暴露合法 transition，不暴露初始化或直接文件访问；
- [x] Renderer 在 admission snapshot 未知时显示中性 gate，避免正常侧栏闪现。

## Checkpoint 2：三页强制训练 UI

- [x] welcome、内置 Member 选择与 Runtime/模型配置构成不可跳过的全窗口流程；
- [x] Back 只回到上一页，并在 provisioning 前保留已选 Member 与 Runtime/model draft；
- [x] Runtime 页复用真实 discovery、health、managed-default/default-auth resolution 与 model catalog；
- [x] 权限不进入 UI，只从 selected Installation 的 Adapter-owned defaults 获取；
- [x] 1040×700 以单屏信息层级为基线，长状态可滚动且不产生页面级横向溢出；
- [x] 双主题、键盘焦点、错误/忙碌状态与 reduced motion 延续现有设计系统。

## Checkpoint 3：幂等产品 provisioning

- [x] `beginProvisioning` 原子持久化 Member/Runtime/Camp command ID 与 normalized permission payload；
- [x] 保留现有 present built-in Member，不存在时使用既有 `members.create` 命令；
- [x] 通过 `members.runtime.set` 原子应用选中模型与冻结权限，并使用 exact expected version；
- [x] 通过 `camps.create` 创建 Active peer Quick Chat“初次集结”；
- [x] 每个成功 Core effect 后持久 checkpoint，恢复跳过已完成阶段；
- [x] restorable Camp location 成功后才完成 onboarding；location 失败保持 `in_progress`；
- [x] 已开始的恢复不依赖当前 Runtime Installation 仍可发现，也不会重新读取变动后的默认权限。

## Checkpoint 4：真实第四页与 Draft-only starter

- [x] completion 后打开 normal App shell 中的真实“初次集结”Camp；
- [x] 空的首次 Camp 显示三条 starter，普通 Camp 行为不变；
- [x] starter 使用现有 Composer Draft API 覆盖文本、持久化、聚焦并把 caret 置于末尾；
- [x] 点击不会调用 send、创建 Message/Turn/Run、触发 Skill/Tool 或写 Runtime input；
- [x] restart 恢复 Camp 与未发送 Draft，用户仍需显式发送。

## Checkpoint 5：自动化、打包与发布验收

- [x] `pnpm typecheck` 与 onboarding/monitoring 聚焦 Vitest 全部通过；
- [x] `pnpm test` 全量 TypeScript/Node/文档测试与 `pnpm test:rust:full` 通过；
- [x] 严格 `cargo clippy --workspace --all-targets -- -D warnings` 通过；
- [x] `pnpm docs:adr:generate -- --check`、`pnpm docs:check` 与 diff-aware CI 门禁通过；
- [x] `pnpm package:mac` 生成 arm64 Application，代码签名严格校验通过；
- [x] `pnpm accept:onboarding-ui` 在 1040×700 覆盖 page 2/page 3 restart、Runtime 状态、真实 Camp、starter
  no-side-effect 与 Draft restart；
- [x] 人工复核 day/night 截图、页面溢出、层级、文案与第四页真实 Camp；
- [x] 安装到 `/Applications/Rovai AI.app`，核对关键文件摘要，从安装路径启动并确认无仓库
  `dist/out/resources` 日常进程；保留原 daily userData。

## 验收记录

实施提交 `0402ae54` 基于 v0.96 `44075a11`。最终验证记录如下：

- `pnpm typecheck` 通过；onboarding + Runtime monitoring 聚焦 Vitest 为 6 个文件、33 项测试全部通过；
- `pnpm test` 通过：文档 21 项、Skill 3 项、Vitest 56 个文件 381 项、Node 187 项；
- `pnpm test:rust:full` 通过：library 503 项、CLI 12 项、Core binary 79 项，另有 3 项明确标记为手工
  Runtime smoke 的 ignored 测试；严格 Clippy 零 warning；
- 文档版本检查覆盖 97 个版本目录；ADR 治理覆盖 202 份 ADR、134 份 current cross-version，
  `DOCS_BASE_REF=origin/main pnpm docs:check:ci` 通过；
- `pnpm package:mac` 完成 arm64 Application；source bundle 与安装 bundle 均通过
  `codesign --verify --deep --strict`；
- `pnpm accept:onboarding-ui` 报告：
  `/var/folders/49/z0f8w56s28j4pfc7t80cm3w80000gq/T/rovai-onboarding-ui-accept-5GEapH/captures/report.json`；
  1040×700 下证明 qilu、TRAE `installed_unverified`、Active“初次集结”、单 Member/Default Lead、
  starter Draft-only、focus/caret 与 restart persistence；
- 人工复核 `01`～`09` day/night 截图，无页面级裁切或溢出，两个主题保持同一结构与状态语义；
- `/Applications/Rovai AI.app` 与验收包的 Main、Core、CLI、`app.asar` 逐字节一致；安装版启动后恰有
  1 个 Main、1 个 Core 与 1 个 Renderer，全部来自 `/Applications`，没有仓库生成目录进程；
- 既有日常数据被正确登记为 `completed(origin = "existing_installation")`，`onboarding.json` 权限为
  `0600`，没有创建训练 Camp 或覆盖 daily userData；
- v0.96 安装包保留在
  `/Users/murray.xue/Downloads/Rovai AI.app.backup-before-v0.97-0402ae54.app`，可用于显式人工回退；
- 构建使用仓库既有 ad-hoc hardened-runtime 签名配置，严格本地校验通过；本次没有配置 Apple notarization。

## References

- [v0.97 版本概览](README.md)
- [ADR-0202](decisions.md#adr-0202)
- [First-run Onboarding v1](../../contracts/first-run-onboarding-v1.md)
- [First-run Onboarding 架构](../../architecture/first-run-onboarding.md)
- [首次训练 UI](../../ui/components/first-run-onboarding.md)
- [桌面 UI 验收](../../development/ui-acceptance.md)
- [本地 Runtime 工作流](../../development/local-workflow.md)
