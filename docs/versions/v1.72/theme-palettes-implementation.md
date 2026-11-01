---
document_type: implementation-record
version: v1.72
lifecycle: current
authority: implementation-evidence
last_updated: 2026-10-25
---

# 晨雾、朝霞与绯夜实施

三款主题原名地平线、经典红、余烬；下文历史记录保留当时名称，当前显示名称见末尾更名记录。

User 最初在主题设计 Thread sequence 18 确认使用独立 worktree 实施第六版配色与六项紧凑选择器，
并明确不加入生产没有的功能、输入框聚焦装饰或原型专属行为。

## Scope and decisions

- 新增地平线（暖瓷白/浅米灰）、经典红（白/朱砂红）与余烬（石墨黑/正红），原有 system/day/night 保留。
- `ThemeId` 表示具体配色，`ResolvedTheme` 保留 day/night 明暗模式；没有新增持久化字段或 Core 事件。
- Desktop 继续使用 Main 的原子 schema-v2 偏好存储和 snapshot；Web 使用既有 Host/Owner 本地偏好。
- 消息、Composer、焦点、页面与 Dialog 沿用生产组件。仅主题选择器缩小卡片尺寸并按容器宽度排列。
- 新增动作文字 Token，避免暗色主题把按钮红底直接当作导航文字；原有日夜数值不变。
- 更新当前 UI/theme 文档；不改变模型上下文、数据库 schema、发布版本或 Runtime 能力。无需新 Version Decision。

当前规则由[主题注册](../../ui/themes/README.md)、[设计系统](../../../DESIGN.md)及
[设置 brief](../../ui/surfaces/settings-workspace.md)拥有。

## Validation

- `pnpm typecheck`：通过。
- `pnpm exec vitest run`：252 个文件通过；2884 项通过、2 项既有跳过。
- `pnpm build:desktop`：Web、execution-web、Electron Main/preload/Renderer 构建通过。
- 新增持久化恢复、固定配色与 OS 模式独立、切回 system、主题标题与完整 Token/对比度回归。
- `theme-tokens.test.ts` 最终对比度复验：41 项通过。
- `pnpm docs:test`、`pnpm docs:check`、以本 worktree base 为 `DOCS_BASE_REF` 的 `pnpm docs:check:ci`：通过。
- 生产 `ThreadWorkspace` / `AppearanceSettings` 隔离浏览器验收：六项切换、明暗模式、当前主题名称与原生方向键选择通过；返回会话后草稿保留。
- 三款新主题的用户/队员消息均为生产气泡与同色边线；Composer 聚焦前后边框和阴影一致，没有原型专属聚焦变化。
- 1512×769 常规窗口、1040×700 小窗口与 720×700 窄容器分别显示六/三/两列，无横向溢出；浏览器无 warning/error。
- 已保存三款新主题的会话截图、六项选择器常规/小窗口截图。临时 viewport 已恢复；预览仅用于验证生产组件。

完整 Windows/macOS 原生 UI、系统明暗切换、IME 与辅助技术矩阵未在本次浏览器 fixture 中实测；
隔离 fixture 不启动 Core 或 Runtime，也不读写日常 App 数据。构建与单元测试不替代原生平台实测。

## 地平线减暖修订（Thread sequence 20）

User 指出实现稿的暖色面积过大、执行台比原稿更暖，要求重新调整。配色以低饱和石灰和轻暖白为主，
执行台、输入与浮层收回中性白，代码和证据收回近中性灰；六项选择器与生产交互继续沿用。

| 表面 | 上版 | 本次修订 |
|---|---|---|
| 会话阅读区 | `#fcfaf5` | `#fdfcf9` |
| 侧栏 | `#f0ece3` | `#f3f1ec` |
| 消息气泡 | `#f0ebe2` | `#f0efeb` |
| 执行台 | 会话底色 `#fcfaf5` | 独立 `--execution-surface: #ffffff` |
| 代码块 | `#faf7f0` | `#f5f6f5` |

执行台的外壳、卡片、头像状态背板与滚动渐隐共用新语义 Token，覆盖浮层、底部与右侧位置。
其余四套配色的既有 Token 值与实际执行台底色保持不变；手机执行台仍由既有 `--mobile-page` 覆盖。

- 主题对比度、偏好与执行台布局回归：3 个文件、78 项通过。
- `pnpm typecheck` 与 `pnpm build:desktop`：通过。
- 生产组件浏览器预览：执行台三种位置的背景均为中性白，命令结果为中性灰；无横向溢出。
- 截图覆盖浮层、底部与右侧，并保留上版浮层截图用于比较。
- 通用文档测试、版本/决策门禁与以本次修订前提交为 base 的 CI 门禁通过；独立 HTML 默认进入地平线，浏览器无 warning/error。

## 地平线原版配色恢复（Thread sequence 24–25）

User 指出原版的对比色更合适，并在 sequence 25 提供 `rovai-theme-refined-v3.html`，
明确指向该稿「看原版」状态。该状态由 `baselineOptions.horizon.tokens` 拥有，
不能仅把精修版的灰绿强调色替换为蓝灰后称为原版。

本次恢复该参照的 89 个配色角色，包括暖瓷白阅读区 `#fcfbf7`、浅岩灰侧栏 `#eae7e1`、
消息气泡 `#eeeae2`、Steel 蓝灰 `#4e6c7e` 与正文 `#252a2d`；
生产新增的动作文字角色与原稿动作色一致。执行台继续使用 `--execution-surface: #ffffff`，
保留先前针对执行台泛暖的修正。选择器缩略图与完整主题合同同步更新。
其余主题、六项紧凑选择器布局、消息几何与聚焦行为均不变。

- `theme-tokens.test.ts`：41 项通过，覆盖完整 Token 与对比度。
- 生产组件 fixture 构建通过；浏览器确认默认地平线、六项选择器与白色执行台，无横向溢出及 warning/error。
- 保存独立 HTML、会话与外观设置截图；预览仅使用固定数据，不接入 Host 或 Runtime。

## 队员浮层与合入验收（Thread sequence 27–28）

User 在 Thread sequence 27–28 确认其余效果并要求 PR 合入 main，同时指出「队员」浮层底色不符。
地平线的 `--inspector-surface` 收敛为 `#ffffff`，使浮层外壳、置顶摘要与队员列表使用同一中性白；
不改变队员管理交互或其余配色。首帧原生窗口背景同步地平线当前画布色；主线新增的引用功能与翻译已合并保留。

- 同步 `origin/main` 后的 `pnpm typecheck`、`pnpm build:desktop`、`pnpm test`、`pnpm test:rust:pr` 通过。
- Vitest：252 个文件、2886 项通过，2 项既有跳过；完整 Node 门禁通过。
- 首轮完整 Node 门禁中钉钉文件投递用例等待超时；该文件独立复验 73 项通过，随后完整门禁再次通过，没有改动该用例。
- 浏览器实测队员浮层和置顶摘要均为 `rgb(255, 255, 255)`，四位队员完整显示，无横向溢出；截图随 Thread 交付。
- 通用文档测试、版本/决策门禁以及以最新 main 为 base 的 CI 文档门禁通过。

## 地平线恢复 v7（Thread sequence 30）

User 在 sequence 30 选择恢复 v7。此前三款主题与队员浮层修订已通过
[PR #879](https://github.com/murray17/rovai-ai/pull/879) 合入 main。
本次从该主线创建独立 worktree，将地平线完整配色恢复到 v7 对应提交
`87b9245486aeb1b6031c2475c8726b4438cbbb17`，同步选择器缩略图、原生首帧画布色与主题合同。
阅读区恢复 `#fdfcf9`、侧栏 `#f3f1ec`、气泡 `#f0efeb`、灰绿强调色 `#586e67`；
执行台与队员浮层均继续为 `#ffffff`。其余主题、六项选择器、生产交互与消息几何没有改动。

- 地平线 187 个 Token 与 v7 提交完全一致，主题合同逐项匹配；共享 CSS 的其余部分无变化。
- `pnpm typecheck`、`pnpm test`、`pnpm build:desktop` 通过；Vitest 252 个文件、2886 项通过，2 项既有跳过。
- `pnpm test:rust:pr`：475 项通过，1 项既有忽略。
- `pnpm docs:test`、`pnpm docs:check` 与以本次 main 基线为 `DOCS_BASE_REF` 的 `pnpm docs:check:ci` 通过。
- 生产组件浏览器预览确认地平线色值、六项主题选择器、白色队员浮层及执行台；无横向溢出或 warning/error。
- 保存会话队员浮层、执行台和外观设置截图；隔离 fixture 不接入 Host/Core/Runtime，不改动日常 App 数据。

## 经典红 A「轻红侧栏」（Thread sequence 32–40）

User 要求经典红通过区域配色呈现，避免红色导航文字、改色 Logo 和鲜红选中块，
并在 sequence 40 选择 A「轻红侧栏」。本次使用该稿的 56 项配色赋值，其中 44 项改变既有值：
侧栏 `#f8f5f6`、选中面 `#eee4e6`、中性动作文字 `#373437`、实心动作 `#ce3e4e`，
Logo 恢复 Steel `#526f88` 与 Ember `#d3a45f`。会话、执行台和队员浮层保持白底，消息继续使用生产气泡。

外观选项增加 `--settings-choice-selected-surface` 语义 Token，以复现 A 的轻红选中面。
其余四套配色取各自原有 `--home-surface` 值，既有 Token 均未变化，包括地平线 v7。
同步经典红缩略图、Main 首帧背景和主题合同；没有主题专属组件选择器、额外聚焦装饰或新功能。

- `pnpm typecheck`、`pnpm test`、`pnpm build:desktop` 通过。
- 同步主线 PR #886 的撤回后重新编辑改动后，重新执行 typecheck、完整 `pnpm test` 和桌面构建，均通过。
- Vitest：255 个文件、2947 项通过、2 项既有跳过；完整 Node 门禁通过。
- `pnpm test:rust:pr`：475 项通过、1 项既有忽略。通过本机已安装的 Rust 1.98 工具链运行；
  `rust-objcopy` 因缺少 `libLLVM.dylib` 报告剥离调试信息警告，不影响构建和测试退出结果。
- 主题合同的 188 项 Token 与实现逐项匹配，新增选中面的文字对比度纳入既有测试。
- `pnpm docs:test`、`pnpm docs:check` 与以本次 main 基线为 `DOCS_BASE_REF` 的 `pnpm docs:check:ci` 通过。
- 当前源码的生产组件浏览器 fixture：六项主题切换通过，其他主题的选中面保持原色；切回会话后草稿保留。
- 经典红队员浮层、执行台与 Composer 均为白色，消息气泡为 `#f5f4f4`；输入框聚焦前后边线与阴影一致。
- 1512×772、1440×920 和 1040×700 无整页横向溢出；最小窗口主题卡片为三列、六项完整可达。
- 已保存会话、队员浮层、执行台、外观页及最小窗口截图；浏览器无 warning/error，临时 viewport 已恢复。

本次视觉验收使用固定数据，不启动 Host/Core/Runtime，也不读写日常 App 数据。
未重复原生 Windows/macOS 系统明暗切换、IME 与辅助技术验收；此配色修订不改变这些入口。

## Windows 窗口按钮与经典红滚动块（Thread sequence 42）

User 指出 Windows 菜单栏切换主题后，右上角最小化、最大化与关闭区域没有同步，
并质疑经典红滚动块的粉色。根因分别是 Main 只向窗口装饰传递明暗模式，以及滚动块复用了选中区域 Token。

- 窗口装饰接收含具体偏好的 appearance snapshot，启动与运行时更新共用配色解析。
  五套配色分别匹配 `--rail` / `--ink`，`system` 继续解析为日间或夜间；原生按钮、系统高度与交互不变。
- 增加独立 `--scrollbar-thumb`，经典红使用中性灰 `#dedede`；其他四套配色保持原滚动块色值。
  通用滚动条和 Mission 文件树使用该 Token，Memory / Automation 保留已有无彩色覆盖。
  淡红选中面、透明轨道、尺寸与交互均不变。
- 现有窗口装饰测试扩展为六项偏好 × 两种明暗模式，检查建窗与运行时颜色均匹配生产 Token，
  同时保留 macOS / Linux 边界与系统默认高度检查。针对性回归 58 项通过。
- `pnpm typecheck`、`pnpm test`、`pnpm build:desktop` 通过；Vitest 256 个文件、3005 项通过、2 项既有跳过。
  同步主线 PR #890 后，类型检查、完整 JavaScript 测试与桌面构建复验通过。
- 同步主线后的 `pnpm test:rust:pr` 477 项通过、1 项既有忽略；本机 Rust 1.98 工具链仍报告缺少 `libLLVM.dylib`
  的调试信息剥离警告，不影响构建和测试结果。
- 生产组件浏览器 fixture 验证六项切换；经典红滚动块为 `rgb(222, 222, 222)`，选中面仍为 `#eee4e6`，
  轨道透明、可见滚动块宽 8px，实际滚动正常，无整页横向溢出和浏览器 warning/error。
- 当前运行环境为 macOS；Windows 原生窗口按钮未做真机实测，不以浏览器 fixture 替代原生验收。
- 文档与五套主题合同同步更新；通用文档测试、版本/决策门禁与基于本次 main 基线的 CI 门禁通过。
  核对另发现日间/夜间附件色表分别有 8/6 项既有文档—实现偏差，已记录到任务的 palette audit；
  本次新增滚动块 Token 的合同与实现一致，既有配色值没有变化。

## 显示名称统一（Thread sequence 44–48）

User 要求三款名称具有一致风格，并指出「暮色」没有体现暗色配色中的红色。
最终采用晨雾、朝霞、绯夜，在 sequence 48 授权完成后 PR 合入 main。

| 原显示名称 | 新显示名称 | 英文显示名称 | 稳定 `ThemeId` |
|---|---|---|---|
| 地平线 | 晨雾 | Morning Mist | `horizon` |
| 经典红 | 朝霞 | Dawn Glow | `classic-red` |
| 余烬 | 绯夜 | Crimson Night | `ember` |

更新共用主题选项、英文翻译、既有设置测试与当前 UI 文档。稳定 ID、CSS 选择器、合同路径、
偏好存储、所有配色值和生产交互保持原样，旧偏好无需迁移；system/day/night 继续保留。
历史设计稿与实施记录保留当时名称；品牌 Ember 色及 Logo 地平线几何不属于主题显示名称。

- `pnpm typecheck`、`pnpm test`、`pnpm build:desktop`：通过；Vitest 256 个文件、3005 项通过、2 项既有跳过，完整 Node 门禁通过。
- `pnpm test:rust:pr`：477 项通过、1 项既有忽略；本机 Rust 1.98 工具链仍报告缺少 `libLLVM.dylib`
  的调试信息剥离警告，不影响构建和测试结果。
- 通用文档测试、版本/决策检查随完整测试通过；最终提交另执行基于本次 main 基线的 CI 文档门禁。
- 生产组件浏览器 fixture 确认六个选项完整显示，新中英文名称、选中摘要及明暗模式正确；
  仍分别提交 `horizon` / `classic-red` / `ember`，无整页横向溢出或浏览器 warning/error。
- CSS 去除注释后与本次 main 基线完全一致，所有配色值与生产样式保持不变；仅更新既有测试的名称预期。
- 已保存外观设置截图与命名映射检查结果；fixture 使用固定数据，不接入 Host/Core/Runtime，不改动日常 App 数据。

## Worktree handoff

- Work item: User sequence 44–48 的三款主题显示名称统一。
- Worktree: `/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-theme-names`
- Branch: `rovai/theme-display-names`
- Base: `origin/main` / `179289b080d74a8868c7d7de8bfb5dd99508a292`
- Governance: none；局部可逆名称修订，沿用已授权的 PR 与合入流程，UI 合同随同提交。
- Status: ready
- Validation: 见上节；源码预览提交 `53b4f061eac1abd086827b11ab724f24220c7bb3`。
- Next: 创建 PR，CI 通过后合入 main 并清理 worktree。
