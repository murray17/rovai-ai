---
document_type: ui-design-system
authority: renderer-ui-detail
status: accepted
design_direction: meridian
theme_modes:
  - day
  - night
last_updated: 2026-07-27
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
  按钮。徽标数为 0 时隐藏该徽标。

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
    路径（mono）、原因、允许/拒绝后果各一行；操作右对齐：「拒绝」quiet +
    「允许一次」primary。初始焦点给最安全项（拒绝）。
  - **正在工作**：9px 身份色细环。行内：名字（身份色 700）+ 描述 +
    `RUNNING 14s` mono 徽标（`--brand-soft` / `--brand-ink`）。持续显示目的，
    不长期只显示 Thinking。
- 节点间距 14px；同一发言者连续消息可省略头行。

**Composer**：与消息列同宽 780px 居中，上边 1px `--line`：单个圆角 8px 输入盒
（1px `--line-strong`），内部右侧 `⌘⏎` mono 提示 +「发送」primary
（12px/650，圆角 6px）。占位「继续提问、补充约束或交付下一项职责…」。@提及
浮层沿用 AgentMentionTextarea，显示全部在队成员及各自独立的执行引擎状态；发送
被 Core 接受后才清空草稿。文本框不因无 Lead、无执行引擎或 Runtime 未就绪而禁用；
发送按钮只因空文本或正在提交而禁用，准入失败用 Toast 说明原因并保留焦点。可见
label 保留（视觉上可 sr-only，但可访问名称必须存在）。Camp 没有可继承的在队成员
且 Lead 为空时，提交 Toast 使用「当前无可用成员」。

**Inspector** 320px，`--surface-subtle` 底 + 左 1px `--line`：

- Tab 行（手动激活）：活动 / 任务 / 审批（mono 计数徽标 attention 配色）/
  审计；激活态 700 + 2px `--brand` 下边线。
- 活动行：36px mono 时间列 + 内容（成员名（身份色）+ 动作对象 + 第二行 mono
  大写状态：`RUNNING` = brand-ink、`WAITING APPROVAL` = attention、
  `PASS/DONE` = success）。行间 1px `--line` 分隔，无卡片嵌套。
- 底部固定 mono 元信息：`run a1f3 · lease ok · core v0.11`。

### 9.3 大厅 / 新对话（compose 视图）

主区垂直居中，`--canvas` 底：

- 星 + 地平线 SVG（96×66，见第 8 节），下 14px。
- 标题「新对话」22px/700（letter-spacing -0.2px）；副行 12.5px `--muted`：
  有初始 Lead 时显示
  `发送第一条消息后保存对话 · 默认由 {成员名}（Default Lead）接收`（名字 700
  `--ink`）；没有已配置执行引擎的在队成员时显示
  `可以先写下消息；发送时会检查可用执行引擎`，不能伪造默认接收者。
- Composer 卡 680px：`--surface` 底、1px `--line-strong`、圆角 10px、轻阴影
  `0 1px 2px rgba(30, 34, 43, 0.05)`；上部占位文本区（min-height 52px，
  占位：有项目时 `描述你想在 {project} 中完成的事情…`，否则 `聊聊想法、问个
  问题，或打个招呼…`）；下部工具行（上边 1px `--line`）：初始 Lead chip
  （14px 身份色方块 + `{成员名} · {已就绪/需要检查}`，1px `--line` 边圆角
  6px）、`@ 添加成员`
  虚线边 chip、右侧 `⌘⏎ 发送` mono 提示 +「发送」primary。
- 初始 Lead 按当前 Member Order 选择第一位“在队且已完整配置执行引擎”的成员；
  临时 Runtime 健康状态不使界面静默跳到后一位。`@` 候选显示全部在队成员，
  Runtime 状态是独立说明而不是身份过滤。
- 文本框不因没有 Lead、没有执行引擎或 Runtime 未就绪而禁用；发送按钮只在文本
  为空或正在提交时禁用。Core 准入失败时不创建 Camp，保留草稿和焦点，并以 Toast
  说明具体成员/执行引擎问题；没有任何已配置执行引擎的在队成员时使用
  「当前没有已配置执行引擎的成员」。
- 「继续未完成的事」区 680px：上边 1px `--line`，分组标题同对话列；每行：
  状态方点 + Camp 标题 + 右侧 mono 摘要（`1 项待审批` / `昨天 18:20`）。点击
  进入 Camp。为空时整区隐藏。
- 大厅不新增插画、等级或 RPG 元素。

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
  Runtime 状态不得移动成员分组，也不得用整行 opacity 降低普通文字对比。错误
  状态提供修复路径。
- 成员详情身份头在常规宽度使用 208×260 portrait，窄屏使用 152×190；内置伙伴按
  Day/Night 选择受测 portrait，自定义伙伴使用同一规范化 source、`object-fit:
  contain`。读取失败显示中性 fallback，不能留下空白或破图。
- 身份头按 `handle → display name → role/persona → stored roleDescription` 排列。
  详情不显示或存储 motto/traits，也不得从 `avatarRef`、预设或角色描述实时派生。
- 身份头附近显示「在队／暂时离队」徽标和对应操作。暂时离队与重新归队直接提交
  Presence 命令并用 Toast 反馈，不弹出 Camp successor Dialog；成员页不读取或
  管理 Camp membership。
- 详情不显示长期记忆数量、Camp 数量、消息数量或历史足迹统计卡。身份、角色、
  instructions 和运行配置是本页主信息；统计分析需要独立产品范围。
- 运行配置保留标题「运行配置」，字段统一使用「执行引擎」。模型、模型 options
  和权限继续由 Adapter descriptor 渲染；不得用跨 Adapter 虚构的通用权限三档
  取代原生字段。清除执行引擎不改变 Presence。
- 页面末尾是独立危险区「永久移除成员」。Dialog 要求输入唯一 handle，明确说明
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

- 页头：「长期记忆」+ 说明「应用级 · 你治理，Agent 只能提案」；右「导出…」
  「＋ 新增记忆」quiet。
- 页头下方显示应用级「自动形成伙伴经验」策略卡：默认关闭，用户只在此处主动
  开启或关闭；App 启动、新对话、成员配置和首次 AgentRun 均不显示策略弹窗。
  文案必须说明自动矩阵、未确认权威、个人上下文边界，以及关闭只影响未来形成。
- **提案区置顶**（有 pending 才显示）：attention 边框卡（1px `#EAD9AE` /
  Night `#57492A`，`attention-soft` 头带）：`◆ N 条提案等待你确认` + 小字
  「逐条决定；批量操作仅支持拒绝」。每条提案行：Kind 徽标 + 正文
  （12.5px/1.55）+ mono 来源行（10px：`洛可 提议 · 新增 · Hearth · 来源 run
  a1f3`，Relationship 提案标 `mutual/directed`）+ 右侧三按钮「拒绝」「编辑后
  接受」quiet、「接受」primary。stale 提案禁用接受并说明原因。
- Scope 过滤 chips：`全部 19 / Hearth 6 / Companion 9 / Relationship 4`，
  激活 `--brand-soft` / `--brand-ink`；行尾 mono `active 17 · retired 2`。
- 记忆列表：一个 1px `--line` 圆角 10px 容器，内部行分隔：Kind 徽标
  （文字 + 形状双编码：`偏好 ○` = attention 配色、`约定 □` = success 配色、
  `经验 ◇` = brand 配色，10.5px/700）+ 正文 + mono 元行（`Hearth · rev 3 ·
  2 周前 · 复查：8月10日`）+ `•••`（修订/退役/遗忘，遗忘为 danger 且确认
  Dialog 说明不可逆）。

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
  开始生效；Rovai-ai 不修改各 Runtime 自己的 MCP 配置。」

## 10. 交互、动效与无障碍

- Hover：行/按钮 `--surface-muted` 底，120–180ms opacity/transform；选中态
  永远强于 Hover。
- Focus：2px `--focus` ring（`outline-offset: 1px`），不被 Sticky/overflow
  裁切；Tab 使用手动激活模式。
- 主题切换：原子替换 `data-theme`，无全局 transition；`system | day | night`
  偏好逻辑、`appearance.json` 持久化、首绘前解析全部不变。
- 审批卡初始焦点在「拒绝」；危险操作只出现在菜单/Dialog 并用 `--danger`。
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
