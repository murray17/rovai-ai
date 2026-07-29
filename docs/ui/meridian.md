---
document_type: ui-design-system
authority: renderer-ui-detail
status: accepted
design_direction: meridian
theme_modes:
  - day
  - night
last_updated: 2026-07-29
---

# Meridian 详细设计规范

本文定义 Rovai-ai 当前可执行的「子午线 Meridian」双主题、视觉 Token 和组件外观
契约，是唯一的视觉 Token 与组件外观详规。稳定总则与 Coding Agent 阅读入口见
[UI 规范索引](README.md)；v0.07 建立的双主题基础设施与历史决策见
[版本文档](../versions/v0.07/README.md)。

Meridian 取代 v0.07 的 Hearth & Camp 视觉方向：品牌色从苔藓绿迁到北极星靛蓝
（呼应新品牌图形：四角星 + 地平线弧 + 营火点），导航从单一 220px 侧栏改为
「52px 图标轨 + 224px 对话列」两级结构，公共讨论流改为「行进时间线」。营火橙
降为低频暖色；身份色、语义色、证据区 Token 体系保留。本文所有色值、字号、
间距、圆角与状态语义均为最终值，按本文标注实现。

## 1. 体验边界

### Meridian Day｜晨线

- 冷调纸白与纯白表面构成清晰、安定的日常协作环境。
- 北极星靛蓝承担品牌、主要操作与选中关系；营火橙只用于审批等待与低频叙事点缀。
- 表面轻盈、边界清晰，不堆叠悬浮卡片墙。

### Meridian Night｜夜航

- 深海军蓝与炭黑构成低眩光、适合长期执行的工作环境。
- 靛蓝提高亮度以保持品牌连续性；营火橙保持克制。
- 面板依靠明度和边界区分，不使用玻璃拟态、霓虹或持续发光。

两种主题只改变视觉材料，不改变信息架构、尺寸、功能或状态含义。

## 2. 主题契约

```ts
type ThemePreference = "system" | "day" | "night"
type ResolvedTheme = "day" | "night"
```

- 偏好由 Electron Main 持久化在 `userData/appearance.json` 的
  `themePreference` 字段；Renderer 不维护第二份 `localStorage` 真源。
- `system` 通过系统原生外观解析，并只在该偏好下监听系统变化。
- 根节点使用 `data-theme="day|night"`，同时设置正确的 `color-scheme`。
- Electron 原生主题与 Renderer 解析结果一致；平台不允许覆盖的系统界面除外。
- 初始化必须早于首次可见绘制；无有效偏好时回退到 `system`。
- 切换为原子替换 `data-theme`，不设置 `transition: all` 或全局颜色过渡。
- `ThemePreference` 枚举不变；`theme.ts` 仅更新展示文案与描述：
  「家园晨光」→「晨线（Meridian Day）」、「夜色营地」→「夜航（Meridian Night）」。

## 3. 基础 Token

实现方式：替换 `styles.css` 中 `[data-theme="day"]` / `[data-theme="night"]`
的 Token 值。Token 名称沿用现有（`--canvas` `--surface` `--ink` `--brand` …），
新增 `--brand-ink`、`--rail`、`--rail-ink` 三个 Token。组件内不得出现散落十六进制。

### 3.1 Meridian Day（晨线）

| Token | 值 | 用途 |
|---|---:|---|
| `--canvas` | `#F4F5F7` | App 背景 |
| `--surface` | `#FFFFFF` | 主工作表面 |
| `--surface-raised` | `#FFFFFF` | Dialog/Popover（配 `--shadow-dialog`） |
| `--surface-subtle` | `#FAFAFB` | 对话列、Inspector、次级区域 |
| `--surface-muted` | `#F0F1F4` | Hover、Disabled、弱分组 |
| `--ink` | `#1E222B` | 主文字 |
| `--muted` | `#5C6270` | 次级文字 |
| `--faint` | `#6E7382` | 元数据（白底上 ≈4.8:1，达标） |
| `--line` | `#E5E7EC` | 常规边界 |
| `--line-strong` | `#D8DBE2` | 输入、强边界、时间线虚线 |
| `--brand` | `#4C51CE` | 品牌、主要操作、选中 |
| `--brand-hover` | `#3F44B8` | 品牌 Hover |
| `--brand-contrast` | `#FFFFFF` | 品牌底上的文字 |
| `--brand-soft` | `#EBEBFA` | 品牌弱背景（选中行、用户消息） |
| `--brand-ink` | `#3A3E9E` | brand-soft 上的文字/图标（新增） |
| `--rail` | `#232949` | 图标轨背景（新增） |
| `--rail-ink` | `#A9AECC` | 图标轨未激活图标（新增） |
| `--ember` | `#C0803C` | 低频叙事暖色（大厅地平线圆点等） |
| `--ember-soft` | `#F7EDD6` | 暖色弱背景 |
| `--focus` | `#1071A6` | Focus ring（与品牌靛蓝可区分） |
| `--overlay` | `rgba(16, 19, 28, 0.46)` | Modal 遮罩 |
| `--shadow-dialog` | `0 28px 90px rgba(16, 19, 28, 0.24)` | 浮层阴影 |

### 3.2 Meridian Night（夜航）

| Token | 值 | 用途 |
|---|---:|---|
| `--canvas` | `#14161E` | App 背景 |
| `--surface` | `#1C1F2A` | 主工作表面 |
| `--surface-raised` | `#262A3A` | Dialog/Popover |
| `--surface-subtle` | `#171A24` | 对话列、Inspector、次级区域 |
| `--surface-muted` | `#262A38` | Hover、Disabled、弱分组 |
| `--ink` | `#E8EAF2` | 主文字 |
| `--muted` | `#A0A5B5` | 次级文字 |
| `--faint` | `#858B9F` | 元数据（交付稿 `#7A8095` 对比不足 4.5:1，已提亮） |
| `--line` | `#262A38` | 常规边界 |
| `--line-strong` | `#3A3F50` | 输入、强边界、时间线虚线 |
| `--brand` | `#7B7FE8` | 品牌、主要操作、选中 |
| `--brand-hover` | `#9095F0` | 品牌 Hover |
| `--brand-contrast` | `#101321` | 品牌底上的文字（夜间 Primary 用深字） |
| `--brand-soft` | `#252A48` | 品牌弱背景 |
| `--brand-ink` | `#B9BDF2` | brand-soft 上的文字/图标（新增） |
| `--rail` | `#10131C` | 图标轨背景（右侧加 1px `#23273A` 分隔，新增） |
| `--rail-ink` | `#8A8FA8` | 图标轨未激活图标（新增） |
| `--ember` | `#E0B268` | 低频叙事暖色 |
| `--ember-soft` | `#35301E` | 暖色弱背景 |
| `--focus` | `#7CC4E0` | Focus ring |
| `--overlay` | `rgba(0, 0, 6, 0.72)` | Modal 遮罩 |
| `--shadow-dialog` | `0 30px 96px rgba(0, 0, 0, 0.6)` | 浮层阴影 |

夜间 Primary 按钮统一走 `--brand` + `--brand-contrast`（亮靛蓝底深字），与
v0.07 夜间规范的模式一致，全局唯一；不得机械复用白字。

## 4. 语义状态 Token

品牌靛蓝、营火橙和身份色不得替代下列状态色。`soft` 只作为弱背景；正文和图标
使用对应前景色。审批等待一律 `attention`，危险一律 `danger`。

| 语义 | Day 前景 / 弱背景 | Night 前景 / 弱背景 |
|---|---:|---:|
| `success` | `#2A7248` / `#E7F4EB` | `#7FC796` / `#1F3327` |
| `attention` | `#7A5A18` / `#F7EDD6` | `#E0B268` / `#3B3320` |
| `danger` | `#A2463F` / `#F5E1DE` | `#E28A82` / `#3C2524` |
| `info` | `#3D6383` / `#E1EAF1` | `#89ACC7` / `#223441` |
| `neutral` | `#5C6270` / `#F0F1F4` | `#A0A5B5` / `#262A38` |

实现变量使用 `--success / --success-soft` 等成对名称。状态必须同时包含文字和
图标或形状；弱背景本身不构成状态。Day `success` 前景相对交付稿
（`#2E7D4F`，实测 4.46:1）已按 WCAG 4.5:1 要求微调加深。

## 5. 证据区域 Token

命令、日志、Diff、审计详情和结构化 JSON 使用独立中性表面，不继承品牌纹理或
身份色。

| Token | Day | Night |
|---|---:|---:|
| `--evidence-canvas` | `#F7F8FA` | `#12151F` |
| `--evidence-surface` | `#FCFCFD` | `#161923` |
| `--evidence-ink` | `#2A2E38` | `#E6E9F0` |
| `--evidence-muted` | `#5C6270` | `#A0A5B5` |
| `--evidence-line` | `#E5E7EC` | `#2A2E3C` |
| `--diff-add` | `#245E3E` | `#92C5A0` |
| `--diff-add-soft` | `#E3F1E6` | `#1B3325` |
| `--diff-remove` | `#873B36` | `#F0A09A` |
| `--diff-remove-soft` | `#F6E2E0` | `#3A2323` |
| `--diff-hunk-soft` | `#E4EBEF` | `#1E3038` |

- Diff 同时使用 `+/-`、行结构和颜色。
- `stdout`、`stderr`、系统错误和退出状态必须有文字标签。
- 大段输出局部滚动或折叠，不能撑破 App Shell。
- 证据区域不使用衬线字体、品牌图案、角色底色、光晕或透明模糊。

## 6. 成员身份色

沿用现有 `--identity-1..8` 昼/夜双色板与 `AgentProfile.id` 稳定映射
（`theme.ts` 映射逻辑不动）：

| 索引 | Day | Night |
|---:|---:|---:|
| 1 | `#A65F4A` | `#E49A7F` |
| 2 | `#39777A` | `#7DB8B6` |
| 3 | `#74628F` | `#A99AD0` |
| 4 | `#9A6A32` | `#D5A56B` |
| 5 | `#4F729B` | `#8FB5D9` |
| 6 | `#8A5C75` | `#D49AB6` |
| 7 | `#547245` | `#91B47C` |
| 8 | `#8C6146` | `#C99D7C` |

- 映射只依赖稳定 ID，不依赖名称、Camp、Assignee、Lead 或 Runtime。
- 同一成员跨 Camp 和重启保持同色；允许不同成员在大规模场景中复用色板。
- 用法收紧为：头像环（2px 边）、名字文字色、小方点。
- 身份色不进入正文、状态、选中、按钮、禁用或大面积消息背景。

### 6.1 成员身份图像例外

“不使用图片纹理和插画”的一般规则仅对下列受控成员身份表面开放窄例外：

- 成员列表、成员详情；
- 新建/编辑成员的内置预设、单图裁切和实际尺寸预览；
- `@` 提及候选；
- 新对话与 Camp 的 Default Lead/成员选择身份位。

其他表面继续禁止角色插画，尤其是消息正文、命令、Diff、Task、审批、审计、错误、
恢复、Memory 正文、设置背景、App Shell 和大厅装饰。风景图、概念板、角色纹理和
大面积身份色均不进入生产界面。

身份图像必须通过受控 `avatarRef` 和共享 `MemberAvatar` / `MemberPortrait` 解析：

- 紧凑尺寸使用 glyph 或用户裁切的 icon；内置预设的 64px 尺寸使用 bust；
- 详情使用 portrait；用户自定义图在 Day/Night 使用同一 source，不加主题滤镜；
- 空值、未知引用、缺文件、摘要不符和 `onError` 使用首 grapheme/中性 fallback；
- 昼夜内置 portrait 保持主体比例、主要姿态和构图稳定，避免主题切换时身份跳变；
- 身份色环和名称颜色继续来自稳定 `AgentProfile.id`，不得烘焙进图片；
- 图像不编码 Runtime readiness、状态、权限、Capability、Lead 或 Camp membership。

## 7. 字体、间距与表面

- 正文使用系统无衬线栈，13px；次级 12/12.5px，页头标题 13px/700。
- **全局取消衬线字体**（连大厅也不用，靠留白与品牌图形承担品牌感）；删除
  Noto Serif 类引用。
- 等宽使用 `ui-monospace / SF Mono / Menlo`，用于：时间戳（10–11px）、
  路径/命令（11–11.5px）、大写状态标签（`RUN` `PASS` `WAITING APPROVAL`
  `RUNNING` `DONE`，10–11px，letter-spacing 0.5px）、计数徽标。
- 间距只使用 `4 / 8 / 12 / 16 / 20 / 24 / 32px`。
- 圆角：控件 6px，行内块/证据块 7–8px，卡片 10px，Dialog 12px。
- 普通面板、消息、Inspector 行和 Task 行不使用阴影；阴影只属于真正浮层。
- 除第 6.1 节明确的成员身份图像外，不使用图片纹理和插画。

## 8. 品牌图形与 App 图标

品牌 SVG 为几何重画版，内嵌代码，无外部资产；界面内一律使用下列图形：

```svg
<!-- 星标（图标轨/侧栏） -->
<svg width="20" height="20" viewBox="0 0 24 24"><path d="M12 1 L14.2 9.8 L23 12 L14.2 14.2 L12 23 L9.8 14.2 L1 12 L9.8 9.8 Z" fill="currentColor"/></svg>
<!-- 星 + 地平线（大厅/空状态） -->
<svg width="96" height="66" viewBox="0 0 72 56">
  <path d="M36 4 L38.8 15.2 L50 18 L38.8 20.8 L36 32 L33.2 20.8 L22 18 L33.2 15.2 Z" fill="var(--brand)"/>
  <path d="M8 52 Q36 35 64 52" stroke="var(--brand)" stroke-width="2" fill="none" stroke-linecap="round"/>
  <circle cx="36" cy="46.5" r="3" fill="var(--ember)"/>
</svg>
```

App 图标为 `build/icon.png`（1024×1024，macOS 圆角矩形规范：824×824 内容区、
185px 圆角、四周透明留白）与 `build/icon.svg`（同构矢量源）。electron-builder
从 `build/icon.png` 自动生成各平台图标；替换后重新打包验证 Dock、DMG 与
「关于」窗口显示。

## 9. 界面规格

几何基线 1440×920（首次启动默认），最小窗口 1040×700，不出现整页横向滚动。
窗口尺寸与位置持久化在 `userData/window-state.json`，重启恢复；大屏下内容列
上限见各节（消息列 `min(880px, 92%)`，普通内容页 1400px，大厅保持 680px）。

### 9.1 App Shell：图标轨 + 对话列

替换现有 220px 单侧栏（`CampNavigation.tsx`）。

**图标轨** 默认 52px（icon-only），`--rail` 底；右缘可拖拽/双击在 52px ↔
176px 间切换，展开时图标旁显示文字标签（新对话/成员/记忆/设置/Core 状态），
偏好持久化为纯 UI 状态。拖拽手柄为可聚焦 separator（Enter 切换、左右方向键
收放）。46px 浅色标题栏始终横跨整窗，图标轨与对话列从标题栏下方开始；
macOS 红绿灯通过 `trafficLightPosition` 固定在标题栏左上（x = 12），不随
图标轨宽度或页面切换移动。

- 顶部：星标 logo 20px（Day 白色，Night `#9EA3F5`），下方间隔 10px；展开时
  显示「Rovai-ai」字标。
- 按钮 32×32，圆角 8px，图标色 `--rail-ink`；激活/当前视图：`--brand` 底 +
  白图标。顺序：＋新对话、◎成员、⌂记忆（右上角 7px `--ember` 圆点表示有待
  确认提案，aria-label 须带数量）、（弹性空间）、⚙设置、Core 状态点 7px
  （success/danger，title + 可访问名称）。
- 全部 icon-only 按钮必须有 aria-label 与 Tooltip。

**对话列** 224px，`--surface-subtle` 底，右侧 1px `--line`：

- 顶部「跳转到对话…」输入框：`--surface` 底、`--line` 边、7px 圆角、右侧
  `⌘K` mono 徽标（10px，`--surface-muted` 底）。触发命令面板（Radix Dialog）。
- 分组标题 10.5px/700，`--faint`，letter-spacing 0.6px：「大厅」「项目」
  （项目行尾计数用 mono 10px）。
- Camp 行：12.5px，padding 5px 10px，圆角 6px；前缀 6×6 方点（圆角 2px）：
  有运行 `--success` 实色 / 待审批 `--attention` / 静止 `--line-strong`。
  Hover `--surface-muted`。
- 选中行：`--brand-soft` 底 + `--brand-ink` 文字（650）+ 左侧 2px `--brand`
  竖条；选中强于 Hover。
- 项目组可折叠（▾/▸），「查看全部 N 个」逻辑保留。行尾 ••• 菜单
  （重命名/删除）保留，删除走 danger Dialog，现有文案不变。

### 9.2 Camp 工作区

`CampWorkspace.tsx` + `App.tsx` 顶栏。

**上下文栏** 46px（替换 60px 顶栏），`--surface` 底 + 1px `--line` 下边：

- 左：面包屑 `rovai-ai › 重构 MCP 设置页`（项目 12px `--faint`，标题
  13px/700）+「第 N 天」mono 徽标（10px，`--surface-muted` 底，N = 距 Camp
  创建天数，纯展示）。
- 右：`RUN n` 徽标（mono 11px，`--brand-soft` 底 `--brand-ink` 字 + 6px
  圆点）、`◆ APPROVAL n`（`attention-soft` 底 attention 字）、「停止」quiet
  按钮。徽标数为 0 时隐藏该徽标。顶栏停止若保留，必须与 Composer 的停止调用
  同一 CampTurn 命令和状态机，不得形成不同取消范围。

**时间线消息流**：中央列宽 `min(880px, 92%)` 居中（Composer 同宽），上
padding 20px：

- 轨迹线：列左留 36px，`left: 10px` 处 2px dotted `--line-strong` 竖线，
  贯穿整日。
- 节点挂在线上（绝对定位，圆心对齐竖线），类型固定：
  - **日界**：11px 圆环（`--surface` 底 + 3px `--line-strong` 环）+ mono
    标签 `7月26日 周日 · DAY 3`（11px，`--faint`，letter-spacing 0.5px）。
  - **用户消息**：9px `--brand` 实心圆。气泡：`--brand-soft` 底、圆角 10px、
    padding 10px 14px、max-width 640px；头行「你」（11.5px/700
    `--brand-ink`）+ mono 时间（10px `--faint`）；正文 13px/1.6。
  - **Agent 消息**：13px 圆环（`--surface` 底 + 3px 身份色环）。头行：名字
    （11.5px/700，身份色）+ mono `codex-cli · 09:43`；正文卡：
    `--surface-subtle` 底 + 1px `--line`、圆角 10px、13px/1.65。身份色只出现
    在环与名字。
  - **命令/证据（EXEC）**：7px `--line-strong` 菱形（方块旋转 45°）。块：
    1px `--line` 圆角 8px；头行 `--evidence-canvas` 底 mono 11.5px：`$ 命令`
    + 右侧 `PASS/FAIL`（success/danger 700）+ `12.4s · exit 0 · cwd
    apps/desktop`；输出区 `--evidence-surface` 底 mono 11px
    `--evidence-muted`，长输出折叠/局部滚动。stdout/stderr/退出码必须有文字
    标签。
  - **审批**：11px 圆环（`ember-soft` 底 + 3px `--ember` 环）。卡：1px
    `#EAD9AE`（Night `#57492A`）边、`attention-soft` 头带：`◆ 等待你的审批 —
    写入文件` 12.5px/700 attention 字，右侧 mono `洛可 · run a1f3`；体：范围
    路径（mono）、原因、执行引擎名称、阻塞影响，以及每个原生选项的 scope/lifetime
    和后果。操作区渲染当前请求冻结的全部 native options，不补造执行引擎未提供的
    「允许一次／本 Session 允许／拒绝／取消」选项；本地化按钮必须保留 exact
    option identity。最安全的 deny/cancel 类选项排在前并获得初始焦点。
  - **正在工作**：9px 身份色细环。行内：名字（身份色 700）+ 描述 +
    `RUNNING 14s` mono 徽标（`--brand-soft` / `--brand-ink`）。持续显示目的，
    不长期只显示 Thinking。
  - **执行披露**：每个 AgentRun 邻接自己的最终消息或终态行。外层运行中默认展开，
    头行显示成员、`RUNNING`、持续时间和证据数；内层 Thinking 在 reasoning 流结束
    后折叠，Progress 保持展开，Steps 默认折叠。终态时三者与外层统一自动折叠为
    `Worked for 28m 34s`/`运行 28分34秒 · 已停止`，用户可重新展开。reasoning
    summary、进展、计划与步骤使用安全 GFM；tool/command/file 使用结构化证据块。
    reload/restart 后从 SQLite 权威记录回显，不以 live event ring 作为真源。
  - **Task 事件**：7px 中性方点 + 单行紧凑卡，显示标题、`原状态 → 新状态`、
    负责人和时间；点击打开 Task Inspector 当前状态。卡片冻结事件时字段，后续
    Task 变化不改写历史。
  - **A2A 事件**：7px 双环或带方向箭头的中性节点，显示`发送方 → 接收方`、
    `请求已接受/结果已收到/已停止/失败`和时间；不显示私有正文、Run ID、Inbox ID
    或 correlation。卡片严格位于实际 Camp sequence，不按角色人为重排。
- 节点间距 14px；同一发言者连续消息可省略头行。

Agent 最终正文、reasoning summary、narration、plan 和 step 的 Markdown 只允许
安全 GFM：标题、列表、表格、引用、行内/围栏代码和安全链接。Raw HTML、脚本、
事件属性、危险 scheme、iframe/object/embed 与远程图片/媒体不执行也不加载。
工具参数、stdout/stderr、Diff 和文件结果按结构化纯文本/代码展示。用户消息始终
按原始纯文本展示，不解释 Markdown，并同时支持原生选择与明确复制操作。

**Composer**：与消息列同宽 780px 居中，上边 1px `--line`：单个圆角 8px 输入盒
（1px `--line-strong`），内部右侧 `Enter` mono 提示 +「发送」primary
（12px/650，圆角 6px）。占位「继续提问、补充约束或交付下一项职责…」。@提及
浮层沿用 AgentMentionTextarea，显示全部在队成员及各自独立的执行引擎状态；发送
被 Core 接受后才清空草稿。文本框不因无 Lead、无执行引擎或执行引擎未就绪而禁用；
发送按钮只因空文本或正在提交而禁用，准入失败用 Toast 说明原因并保留焦点。可见
label 保留（视觉上可 sr-only，但可访问名称必须存在）。`Enter` 发送，`Shift+Enter`
换行；输入法组合态与 @候选选择优先，不得误提交。Camp 没有可继承的在队成员
且 Lead 为空时，提交 Toast 使用「当前无可用成员」。

当 snapshot 表明当前 CampTurn 仍有执行资格时，Composer 输入继续可编辑，草稿不
清空，原发送位置替换为 danger「停止」按钮。按钮必须同时用文字和 danger 语义表达，
不能只变红；点击后进入「正在停止…」并防重复。停止作用于当前 CampTurn 的全部
AgentRun 与 A2A 后代。`⌘/Ctrl + Enter` 在停止态无动作，不得成为取消快捷键。
整棵执行树 fencing 完成后立即恢复「发送」，即使仍有外部效果待确认；对应 Run
披露显示「已停止 · 结果待确认」，不得继续锁住 Composer 或伪装成已回滚。

Composer 的 `@` 候选、插入文本和发送后的可见正文统一使用 `@成员名称`，结构化
`agentProfileId` 才是路由依据。历史消息和 Camp 标题中的旧 `@handle` 仍在展示层
投影为 `@成员名称`，不重写历史正文；不再追加括号 handle，因为成员名称已全局唯一。

进入 Camp 的等待态只覆盖 Lead reconciliation 与一次 SQLite 权威 snapshot；
事件轮询必须从该 snapshot 的 sequence marker 继续，不得再次请求初始 snapshot。
App 启动、compose 和 Camp 打开均不触发执行引擎探测。成员页或诊断页正在检测本机
执行引擎时，Camp 打开和消息交互不得排队等待检测完成。

**Inspector** 320px，`--surface-subtle` 底 + 左 1px `--line`：

- Tab 行（手动激活）：活动 / 任务 / 审批（mono 计数徽标 attention 配色）/
  审计；激活态 700 + 2px `--brand` 下边线。
- 活动行：36px mono 时间列 + 内容（成员名（身份色）+ 动作对象 + 第二行 mono
  大写状态：`RUNNING` = brand-ink、`WAITING APPROVAL` = attention、
  `PASS/DONE` = success）。行间 1px `--line` 分隔，无卡片嵌套。
- 底部固定 mono 元信息：`run a1f3 · lease ok · core v0.11`。

### 9.3 大厅 / 新对话配置 Dialog

「新对话」不再进入未持久化的全屏 Composer。全局入口在当前主视图上打开配置
Dialog；Project 分组的 `＋` 先打开系统目录选择器，验证成功后以精确 Git worktree
预选状态打开同一 Dialog。系统选择器取消时不打开 Dialog，也不产生 Toast 或持久状态。

Dialog 使用 Radix Dialog 与现有 overlay/focus primitive：

- 常规宽度 `min(760px, calc(100vw - 48px))`，最大高度不超过 viewport 减 32px；
  Body 独立滚动，Header/Footer 保持可见。`1040×700` 下仍保持双列协作模式；不足
  760px 时改为单列并把左右 padding 收敛到 16px。
- Header 标题「创建新对话」20px/700；说明只表达“确定工作环境与协作方式”，不得
  承诺创建后可调整成员、模式或项目归属。右上关闭按钮至少 30×30，使用共享
  focus ring。
- Body 顺序固定为 Project、成员与 Lead、协作方式、折叠的「可选配置」。区段之间用
  whitespace 或单条 `--line` 分隔，不建立卡片墙。
- Footer 左侧用 `--faint` 汇总 Lobby/Project、成员数、并肩协作和 Lead；右侧依次为
  quiet「取消」与 primary「创建」。按钮文案不承载命令语义，不显示未实现的快捷键。

**Project**：

- selector 首项「不关联项目」，中间为 Navigation Read Side 已知的具体 Project 路径，
  末项「选择本地 Git 项目…」；
- 已知 worktree 即使共享 Repository Scope 也可作为不同路径选项出现；
- 全局入口默认「不关联项目」；Project `＋` 和系统选择器结果默认选中已验证路径；
- 取消整个 Dialog 不保存选择；创建失败保留选择；
- 不出现“之后仍可移动到项目”等尚未开放承诺。

**成员与 Lead**：

- 只列 `present` 成员，按稳定 Member Order 排列，初次打开全部勾选；
- trigger 显示头像叠放、已选数量与摘要；展开区显示身份、角色和 Runtime
  Readiness，但 Readiness 不影响可选择性；
- 最后一名成员不可取消。用户尝试时保持勾选，并在控件附近显示
  「至少选择 1 位成员」；不提供“清空全部”；
- Lead selector 只包含已选成员。初值为第一位 Runtime Ready 成员；若无人 Ready，
  使用第一位成员。手工选择在该成员仍被选中时保持；移除当前 Lead 后自动切到剩余
  稳定顺序第一名；
- Runtime 未配置或未就绪不禁用「创建」，因为执行准入发生在后续发送。

**协作方式**：

- 左侧「并肩协作」启用、默认选中；说明为成员共同参与，未显式寻址时发送给 Lead，
  不能写成“同时投递给全部成员”；
- 右侧「领队统筹」禁用并标记「暂未开放」，不得显示“推荐”，不得允许键盘或指针
  选中；
- mode 持久状态不在创建后的普通工作区对外展示。

**可选配置**：

- 默认折叠，展开后只提供对话名称；
- 名称留空提示最终创建为「未命名对话」，不承诺异步或模型生成；
- 本地显示 80 字符边界，但 Core 的 Unicode scalar 校验才是权威；
- 手工超限时就地报错并禁用提交，不静默截断。

交互与状态：

- Dialog 打开时焦点落到第一个可操作的 Project control；Tab/Shift+Tab 被困在 Dialog，
  `Escape`、关闭与取消在非提交态关闭并把焦点返回原入口；
- 提交期间锁定会改变 Draft 的控件并防止重复创建。失败保持 Dialog、所有字段和用户
  选择，错误在相关字段或 footer alert 呈现，必要时刷新候选但不得静默改值；
- 成功后关闭 Dialog、刷新 Navigation、选择新 Camp、进入普通 Camp workspace 并聚焦
  Composer。新 Camp 已经耐久，不显示“发送第一条消息后保存”或中间 Draft 页面；
- 大厅背景可保留星 + 地平线和「继续未完成的事」，但没有直接发送消息的 Composer；
  用户必须先创建 Camp；
- Day/Night、200% zoom、reduced-motion、`1440×920` 与 `1040×700` 必须通过无横向
  溢出和 focus-return 验收。大厅不新增插画、等级或 RPG 元素。

### 9.4 成员页

`MemberManagement.tsx`。

- 页头 46px：「成员」13px/700 + 说明 12px `--faint`「长期身份，跨 Camp 保持
  记忆与身份色」；右「＋ 新建成员」primary。
- 主体是一个 `max-width: 1180px` 的单一 Workbench surface，不做成员卡片墙：
  常规宽度使用约 294px 名册 + 自适应详情；窄宽度缩小名册但保持同一信息顺序。
  表面使用 1px `--line`、10px 圆角和内部行分隔，不给每个子区重复阴影。
- 名册只分为「在队」与「暂时离队」。永久移除成员完全不显示，不增加“已移除”
  分组。跨组拖拽只更新 Member Order，不能改变 Presence；最新 Member Order 会
  影响新 Camp 初始 Lead 和未来失效 Lead 的修复，但不会替换仍有效的现任 Lead。
- 名册行使用共享 `MemberAvatar(size="list")`、姓名、角色和两个独立维度：
  - 所处分组/明确文字表达 Presence；
  - 右侧状态表达执行引擎：`已就绪`、`需要检查`、`未配置执行引擎`。
  执行引擎状态不得移动成员分组，也不得用整行 opacity 降低普通文字对比。错误
  状态提供修复路径。
- 成员详情身份头在常规宽度使用 208×260 portrait，窄屏使用 152×190；内置伙伴按
  Day/Night 选择受测 portrait，自定义伙伴使用同一规范化 source、`object-fit:
  contain`。读取失败显示中性 fallback，不能留下空白或破图。
- 身份头按 `名称 → role/persona → stored roleDescription` 排列。名册、详情、
  创建/编辑 Dialog 和 MCP 成员选择均不得显示内部 handle。详情不显示或存储
  motto/traits，也不得从 `avatarRef`、预设或角色描述实时派生。
- 身份头附近显示「在队／暂时离队」徽标和对应操作。暂时离队与重新归队直接提交
  Presence 命令并用 Toast 反馈，不弹出 Camp successor Dialog；成员页不读取或
  管理 Camp membership。
- 详情不显示长期记忆数量、Camp 数量、消息数量或历史足迹统计卡。身份、角色、
  instructions 和 Agent运行时是本页主信息；统计分析需要独立产品范围。
- 运行区域标题使用「Agent运行时」，字段继续统一使用「执行引擎」。模型、模型 options
  和权限继续由 Adapter descriptor 渲染；不得用跨 Adapter 虚构的通用权限三档
  取代原生字段。清除执行引擎不改变 Presence。
- Agent运行时后提供默认折叠的「高级设置」。用户展开后才读取并显示 Camp 共享
  摘要模型，可选自动回退、执行引擎默认模型或明确模型；设置不属于当前成员，
  不新增独立「上下文」设置菜单。
- 页面末尾是独立危险区「永久移除成员」。Dialog 要求输入成员名称确认，明确说明
  该成员将从名册和所有活动入口消失且不能恢复，但身份、头像、执行引擎配置、
  Memory 和历史记录会保留。非终态 AgentRun 是唯一 blocker；Default Lead 和
  Task 不在成员页交接。
- 创建/编辑 Dialog 的单图裁切舞台在可用宽度内为 280–336px，交互数学使用实际测量
  尺寸；支持拖动、缩放、方向键、重置与 28/32/34/44px 预览。舞台不默认使用
  `role="application"`，所有操作有可见说明或可访问名称。
- 历史 Camp 可以继续显示 removed 身份的原头像、姓名和角色，但该身份位不可点击
  进入成员详情，也不出现在 `@`、Lead 或 Task 新指派候选中。

### 9.5 记忆页

`MemoryLibrary.tsx`。

以下为 v0.21 已接受合同；当前 Renderer 仍是 v0.18 实现基线，不能据此推断已经完成。

- 记忆是图标轨一级页面，进入后隐藏对话列；设置分区不再包含记忆入口。
- 页头：「长期记忆」+ 说明「应用级 · 由你治理；伙伴可形成经验与默契，家园共识
  需你确认」；
  右侧「导出…」quiet、「＋ 新增长期记忆」primary。
- 四项数据使用一个带内部竖分隔的紧凑摘要条，不做统计卡墙：
  「正在沿用 / 待确认家园共识提议 / 伙伴来源 / 建议复核」。
- 应用级策略标题固定为「允许伙伴写入长期记忆」，默认开启。正文完整显示：
  「开启后，伙伴可以直接新增或修订自己的伙伴经验与当前协作默契，并提交等待你
  确认的家园共识提议。关闭只阻止之后的伙伴写入，不改变已有记忆和提议。」
  不追加第二段辅助说明。
- 有 pending 时显示单行 attention 提示「N 条家园共识提议等待确认」，从“查看提议”
  打开 Radix 右侧 Drawer；Drawer 逐条提供拒绝、编辑后接受和接受，批量只允许拒绝。
  Companion/Relationship 的直接伙伴写入已经生效，不进入该 Drawer。
- Scope 使用三个紧凑横向 Tab：
  「家园共识 / 伙伴经验 / 协作默契」；治理状态在下一行独立过滤：
  「全部 / 伙伴来源 / 建议复核 / 已停止沿用」。
- 主体是单一列表 + 固定右侧详情 Workbench。列表明确展示 Companion 归属成员，
  Relationship 同时展示双方与 `A ↔ B · 双方适用` 或
  `A → B · 仅对该方向适用`。Kind 继续使用文字 + 形状双编码：
  `偏好 ○ / 约定 □ / 经验 ◇`。
- 列表与详情显示「伙伴形成 / 伙伴提议 · 你已采纳 / 用户创建」及最近 Revision
  Actor；这些来源不改变 Active Memory 的效力或优先级，也不存在“标记为已确认”
  操作。修订、安排复核、停止沿用和遗忘集中在详情。
- 每次伙伴直接写入显示可关闭的非阻塞通知，并提供“查看”深链到对应 Scope 和
  Memory；Hearth Proposal 使用独立 attention 通知并打开提议 Drawer，二者都不回显
  完整正文。
- `1440×920` 和 `1040×700` 都保持双列；最小窗口下列表不小于 480px、详情不小于
  320px，二者独立滚动，不能改成覆盖式详情 Drawer。

完整信息架构、文案、状态映射、操作和验收见
[长期记忆页设计](long-term-memory.md)；当前领域边界见
[ADR-0069](../adr/0069-single-effective-memory-and-scope-bounded-agent-mutation.md)。

### 9.6 设置页

`McpSettings.tsx` 等。

- 布局：设置为全页视图——进入后隐藏对话列，只保留图标轨 + 220px 设置分区
  导航（`--surface-subtle`）+ 内容区；导航顶部提供「← 返回 App」按钮，返回
  进入设置前的主视图。分区：技能 / MCP / 外观 / 诊断；激活样式同对话列选中
  行；底部 `Core 正常 · v{version}`（success 圆点 + 文字）。
- MCP 库内容页：页头（标题 + 说明「应用级外部 MCP Server；按成员分配，不自动
  暴露给所有 Agent」+「从本机导入…」quiet +「＋ 添加 Server」primary）。
- 真源路径条：mono 11px，`--evidence-canvas` 底 1px `--line` 圆角 8px：
  `真源文件 ~/.rovai/mcp.json` + 右侧「在 Finder 中显示」链接。
- Server 行：开关（34×18 圆角胶囊，开 `--brand` / 关 `--line-strong`，须有
  可访问名称）+ 名称 700 + 传输徽标（mono 10px：`STDIO` = brand-soft、
  `HTTP` = attention-soft）+ 命令/URL mono 10.5px `--faint`（HTTP 行标注
  「凭证不随导入复制」）+ 成员分配 16px 身份色方块组（title = 成员名）+
  `•••`。停用行整行 `--surface-subtle`、名称 `--muted`、标「已停用 · 从
  Cursor 导入」。
- 页脚说明 11.5px `--faint`：「改动只保存到本机真源文件，并从下一个 AgentRun
  开始生效；Rovai-ai 不修改各执行引擎自己的 MCP 配置。」

## 10. 交互、动效与无障碍

- Hover：行/按钮 `--surface-muted` 底，120–180ms opacity/transform；选中态
  永远强于 Hover。
- Focus：2px `--focus` ring（`outline-offset: 1px`），不被 Sticky/overflow
  裁切；Tab 使用手动激活模式。
- 主题切换：原子替换 `data-theme`，无全局 transition；`system | day | night`
  偏好逻辑、`appearance.json` 持久化、首绘前解析全部不变。
- 审批卡初始焦点在执行引擎提供的最安全 deny/cancel 类选项；危险操作只出现在
  菜单/Dialog 并用 `--danger`。
- Loading/Empty/Error/Disabled/Recovery 状态全部保留现有语义与文案结构；
  空状态解释原因并给一个明确下一步。
- 图标轨的徽标点（记忆提案、Core 异常）必须同时有 aria-label 数字/文字。
- 动效限于 120–180ms 的透明度或 2–4px 小位移；遵循
  `prefers-reduced-motion`；禁止光晕、脉冲、粒子、视差和大幅弹簧。
- 普通文字至少 `4.5:1`；大文字、组件边界和状态指示遵循 WCAG 2.2 AA。
- 可点击目标至少 `28×28px`，主要操作优先 `32×32px`。
- 状态使用颜色、图标、文字或结构的组合；Icon-only 控件提供可访问名称。
- 重要运行和审批变化可以使用 `aria-live`，不得为流式输出逐字播报。

## 11. 状态管理

领域状态以 ADR-0057/0058 为准，不在 Renderer 派生或复制。新增的纯 UI 状态：
命令面板开合（⌘K）、Inspector 当前 Tab、对话列分组折叠（沿用现有）、成员拖拽
排序（调用 Member Order 命令）和成员 Workbench 当前选择。
「第 N 天」由 Camp 创建时间派生，为可测试纯函数（放 `ui-model.ts`）。

## 12. 实施约束

- 共享色值只在主题 Token 层定义；组件不得出现主题分支硬编码颜色。
- 允许使用 `color-mix()` 生成 Hover 等轻量派生值，但基础语义必须来自本规范
  Token。
- 不新增 UI 框架、CSS-in-JS、字体、图标库、动画库或状态管理库。
- 设计参考稿为 HTML 预览画布，不是可直接复制的生产代码；在现有代码库
  （React + Radix + 原生 CSS Variables）中重建设计，复用现有组件结构与测试。
- 修改 Token 时必须同时验证 Day/Night 对比度、状态区分和全部使用者。
- 实现落点：`apps/desktop/src/renderer/src/styles.css`、`theme.ts`、
  `CampNavigation.tsx`、`App.tsx`、`CampWorkspace.tsx`、
  `MemberManagement.tsx`、`MemoryLibrary.tsx`、`McpSettings.tsx`、
  `SkillSettings.tsx`（样式跟随）。

## 13. 实施顺序建议（checkpoints）

1. **Token 迁移**：`styles.css` 昼/夜 Token 全量替换 + 新增
   `--brand-ink / --rail / --rail-ink`；`theme.ts` 文案；删除衬线字体引用；
   全局回归 Loading/Empty/Error/Disabled。
2. **App Shell**：CampNavigation 拆为图标轨 + 对话列（⌘K 命令面板可先
   占位）；顶栏改 46px 上下文栏。
3. **时间线消息流** + Composer（CampWorkspace）：节点体系、证据块、审批卡。
4. **Inspector** Tab 行与活动行样式。
5. **大厅 compose 视图** + 品牌 SVG。
6. **成员 / 记忆 / 设置**三页按第 9 节规格重排。
7. 每步跑 typecheck、Renderer 测试与 1440×920 / 1040×700 双尺寸昼夜截图
   验收；全部完成后删除无使用者的旧绿色 Token 与散落色值。
