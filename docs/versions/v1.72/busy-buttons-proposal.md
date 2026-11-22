---
document_type: implementation-proposal
version: v1.72
authority: proposed-busy-button-feedback
status: accepted
revision: 1
confirmation_status: confirmed
last_updated: 2026-11-22
---

# 提交中按钮统一执行文档 R1

起因：编辑消息后点“保存”，按钮先变灰变宽，再在同一帧连同编辑器一起消失，过渡不协调。全仓同类写法有 75 处。
本文给出统一规则、逐处改动清单、代码与 CSS、测试更新和验收标准，可以直接按顺序实施。

- 交互稿：`docs/prototypes/busy-buttons-20261122/index.html`（Git 忽略，存放在原型制作时的主检出目录）。
  画面由生产 `BusinessApp` 在夹具中渲染，可切换返回时间、慢放 4×、日夜主题。交互稿里的 CSS（`build.mjs`）就是本文第 1、3、4 节的样式原型。
- 基线：`main@892ef6dcc`。下文行号都以此为准，实施前用文中的 `rg` 命令重新定位。

## 0. 现状（实测）

| 场景 | 按钮宽度 | “取消”位移 | 提交中不透明度 |
| --- | --- | --- | --- |
| 消息编辑 · 保存 `ThreadMessageEditor.tsx:286` | 42 → 76px（“正在保存…”） | 左移 34px | 0.52 |
| 撤回消息 `ThreadWorkspace.tsx:7170` | 52 → 88px（“正在撤回…”） | 左移 36px | 0.52 |
| 重命名对话 `ThreadNavigation.tsx:701` | 77 → 75px（“保存中…”） | 右移 2px | 0.52 |
| 删除对话 `ThreadNavigation.tsx:715` | 52 → 88px（“正在删除…”） | 左移 36px | 0.52 |

根因有三处：

- **按钮文字替换**：提交中把文字换成“正在…”，按钮宽度随之变化。按钮组右对齐，所以相邻按钮被挤动，违反 DESIGN.md 中
  “fixed-position controls must not shift their hit area”。
- **整组变淡**：`styles.css:63` 的 `button:disabled { opacity: .52 }` 让被点的按钮和同组按钮一起变淡，深色主按钮变成灰块。
  本机返回通常很快，这些变化只闪一下。
- **完成没有过渡**：编辑器在同一帧塌成单行气泡（`ThreadWorkspace.tsx:5459`）；`.app-dialog` 只有 170ms 入场动画，没有退场。

生产里已有正确做法：“停止执行”确认框（`ConversationRunPresence.tsx:167`，`conversation-run-presence.css:51-53`）保留文字占位，原位叠一个转圈。

## 规则（规范性）

1. **宽度不变**：提交中不替换按钮文字。文字留在原位占位，转圈叠在同一位置。
2. **外观不变**：被点的按钮保持启用时的填充和颜色，不套用 disabled 的变淡、变灰。仍然使用原生 `disabled` 防止重复提交，
   不改变现有提交语义；同时设 `aria-busy="true"`。同组其他控件照旧禁用。
3. **150ms 后再出现**：150ms 内返回时，被点的按钮外观完全不变。超过 150ms，文字 90ms 淡出，转圈 120ms 淡入，同组被禁用的控件在同一时刻用 120ms 变暗。
4. **同一个转圈**：14px、跟随文字颜色、900ms 匀速，图形复用 `ExecutionStatusGlyph status="cancelling"`。
5. **退场快于入场**：编辑器 90ms 淡出，保存后的气泡延迟 60ms 再用 150ms 淡入；弹窗退场 110ms（入场是 170ms）。
   减少动态效果时转圈静止，淡入淡出跳过；Mobile Web 弹窗不加退场动画。
6. **失败立即恢复**：文字立即回来，不等动画；错误仍按各处现有方式显示，草稿保留。
7. **读屏**：按钮的可访问名称保持原文字（例如“保存”），由 `aria-busy` 表达忙碌。本次不新增 live region，与现状一致（现状按钮被禁用后，文字变化同样不会被播报）。

## 不在范围内

- 列表、分页、时间线里的“加载更多”类文字按钮和内容占位，保持原样（共 9 处，见 2.4）。
- 按钮以外的状态文字，例如 `role="status"` 段落、`NotificationSettings` 的“保存中…”。
- 其他约 20 种列表或预览转圈的规格统一，另行处理。
- 失败文案；归 [操作失败反馈](../../ui/components/app-shell-navigation.md#通用操作提示) 现行规则处理。
- `AboutUpdatesSettings` 的“检查更新”（已有独立的忙碌样式），以及 Composer 发送键（图标内转圈，宽度固定）。
- 焦点保持：被禁用的按钮会失去焦点，这是现状，本次不改。

## 阶段与交付

| 阶段 | 内容 | 建议 PR |
| --- | --- | --- |
| 1 | `BusyLabel` 组件与 CSS | PR A |
| 2 | 迁移 75 处按钮、更新测试、防回归扫描 | PR A |
| 3 | 消息编辑保存后的收起过渡 | PR B |
| 4 | 两个确认弹窗的退场动画 | PR B |
| 5 | DESIGN.md 与 UI 合同更新 | 随 PR A／B 各自更新 |

分支建议：`rovai/busy-buttons`（PR A）、`rovai/busy-transitions`（PR B）。PR B 依赖 PR A。

---

## 1. 阶段 1：`BusyLabel` 组件与 CSS

### 1.1 新文件 `apps/desktop/src/renderer/src/BusyLabel.tsx`

```tsx
import type { JSX, ReactNode } from 'react'
import { ExecutionStatusGlyph } from './ExecutionStatusGlyph'

// Keeps a busy button's label in layout; the spinner replaces it in place after 150ms (styles.css).
export function BusyLabel({ busy, children }: { busy: boolean; children: ReactNode }): JSX.Element {
  return (
    <span className="busy-label" data-busy={busy ? 'true' : undefined}>
      <span className="busy-label-content">{children}</span>
      <span className="busy-label-spinner" aria-hidden="true"><ExecutionStatusGlyph status="cancelling" /></span>
    </span>
  )
}
```

调用约定：按钮自身加 `aria-busy={busy}`，原有 `disabled` 逻辑不变；按钮里所有可见内容（包括前后图标）都放进 `BusyLabel`。

### 1.2 `styles.css`：放在 `.icon-button:hover:not(:disabled)`（约 834 行）之后

```css
/* Busy buttons (DESIGN.md Buttons): the label keeps the box; after 150ms a spinner replaces it in place. */
.busy-label { display: inline-grid; max-width: 100%; place-items: center; gap: inherit; }
.busy-label > * { grid-area: 1 / 1; }
.busy-label-content { display: inline-flex; min-width: 0; align-items: center; justify-content: center; gap: inherit; }
.busy-label-spinner { display: grid; place-items: center; opacity: 0; pointer-events: none; }
.busy-label-spinner svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; }
.busy-label[data-busy] > .busy-label-content { opacity: 0; transition: opacity 90ms ease-in 150ms; }
.busy-label[data-busy] > .busy-label-spinner { opacity: 1; transition: opacity 120ms ease-out 150ms; }
.busy-label[data-busy] > .busy-label-spinner svg { animation: busy-label-turn 900ms linear infinite; }
@keyframes busy-label-turn { to { transform: rotate(360deg); } }
/* The pressed button keeps its enabled look while busy; other controls in the same group dim on the same beat. */
:root button[aria-busy="true"]:disabled:has(> .busy-label) { opacity: 1; cursor: progress; }
:is(form, .app-dialog-footer, .compact-footer, .revision-editor-actions):has(.busy-label[data-busy]) :is(button, input, textarea):disabled {
  transition: opacity 120ms ease-out 150ms;
}
@media (prefers-reduced-motion: reduce), (forced-colors: active) {
  .busy-label[data-busy] > .busy-label-spinner svg { animation: none; }
}
```

要点：

- 内容和转圈叠在同一个网格单元，宽度始终等于原文字（加图标）的宽度。
- 非忙碌状态下没有 transition，失败时文字立即回来（规则 6）。
- `:root …:has(> .busy-label)` 的特异性是 (0,4,1)，高于 `.compact-dialog button:disabled`（`styles.css:8915`）和设置页各变体的 disabled 规则。

### 1.3 会改变颜色的 disabled 变体，排除忙碌态

- `member-editor.css:1207`：`.member-editor-save:disabled` → `.member-editor-save:disabled:not([aria-busy="true"])`
- `styles.css:5912`：`.channel-row-action:disabled` → `.channel-row-action:disabled:not([aria-busy="true"])`
- 用下面的命令再检查一遍，有新的变体照此处理：
  `rg -n ":disabled" apps/desktop/src/renderer/src/*.css | rg "background|color:"`。

`member-editor.css:1204` 的 `.member-editor-save-row .member-editor-cancel:disabled { visibility: hidden }` 保持不变：
`visibility` 不改变布局，属于现有设计。

---

## 2. 阶段 2：迁移

### 2.1 改写方式

```tsx
// 纯文字
<button className="primary-button" type="submit" disabled={busy}>{busy ? uiAttribute('正在保存…') : uiAttribute('保存')}</button>
<button className="primary-button" type="submit" disabled={busy} aria-busy={busy}><BusyLabel busy={busy}>{uiAttribute('保存')}</BusyLabel></button>

// 图标 + 文字：图标一起放进去
<button …><DialogControlIcon name="save" />{saving ? uiAttribute('正在保存…') : uiAttribute('保存')}</button>
<button … aria-busy={saving}><BusyLabel busy={saving}><DialogControlIcon name="save" />{uiAttribute('保存')}</BusyLabel></button>

// UiText 写法
<UiText zh={busy ? '正在删除…' : '删除'} />
<BusyLabel busy={busy}><UiText zh="删除" /></BusyLabel>

// 多状态标签：只去掉忙碌分支，其余分支原样保留
{busy ? uiAttribute('正在保存…') : editor?.kind === 'revise' ? uiAttribute('保存修订') : uiAttribute('保存记忆')}
<BusyLabel busy={busy}>{editor?.kind === 'revise' ? uiAttribute('保存修订') : uiAttribute('保存记忆')}</BusyLabel>
```

- `busy` 必须是“这个按钮正在提交”的条件。例如共享 `busy` 状态的写法 `busy === 'download'`，原样搬过去。
- 不要删除 `locales/en.json` 里的词条：其他地方可能还在用，目录测试只检查覆盖率。

### 2.2 A 类：改为 `BusyLabel`（75 处）

| 位置 | class | 原提交中文字 | 说明 |
| --- | --- | --- | --- |
| `AppUpdatePrompt.tsx:78` | `quiet-button compact` | 正在打开… |  |
| `AppUpdatePrompt.tsx:84` | `primary-button compact` | 正在开始… |  |
| `ArchiveSettings.tsx:306` | `compact-primary archive-delete-confirm` | 正在删除… | `UiText` 写法 |
| `AutomationEditor.tsx:200` | `primary-button` | 正在保存… |  |
| `BusinessApp.tsx:934` | `quiet-button` | 正在导出… |  |
| `BusinessApp.tsx:5193` | `quiet-button` | 正在导出… |  |
| `BusinessApp.tsx:5301` | `quiet-button` | 正在读取… | `UiText` 写法 |
| `CapabilityDeleteDialog.tsx:57` | `danger-button` | 正在删除… |  |
| `ChannelSettings.tsx:562` | `primary-button compact` | 保存中… | 图标＋文字 |
| `ChannelSettings.tsx:819` | `channel-row-action` | 处理中… | 多状态标签；配合 1.3 |
| `ChannelSettings.tsx:1123` | `primary-button` | 正在提交审批… |  |
| `ChannelSettings.tsx:1132` | `primary-button` | 核对中…／发布中… | 多状态标签 |
| `CoreSubsystemNotice.tsx:46` | `quiet-button` | 正在重试… |  |
| `CurrentUserProfileEditor.tsx:141` | `quiet-button compact` | 正在读取… |  |
| `CurrentUserProfileEditor.tsx:162` | `member-editor-primary member-editor-save` | 正在保存… | 图标＋文字；`busy` 只取 `status === 'saving'`，保留“重试保存”分支 |
| `CurrentUserProfileEditor.tsx:172` | `primary-button` | 正在处理… |  |
| `DiagnosticsCenter.tsx:239` | `primary-button` | 正在检查… | 删掉按钮内旧的 `.diagnostics-spinner` |
| `DiagnosticsCenter.tsx:242` | `quiet-button` | 正在导出… |  |
| `DiagnosticsCenter.tsx:387` | 动态 class | 正在处理… |  |
| `DiagnosticsCenter.tsx:435` | `quiet-button compact` | 正在处理… |  |
| `FileChangesPreview.tsx:197` | `agent-run-file-review-open-current` | 正在打开… | 图标＋文字 |
| `GeneralSettings.tsx:401` | `primary-button compact` | 正在保存… | 图标＋文字 |
| `GeneralSettings.tsx:524` | `quiet-button` | 正在重置… |  |
| `GeneralSettings.tsx:574` | `primary-button` | 正在开启… |  |
| `HtmlFileViewer.tsx:165` | — | 重试中… |  |
| `HtmlFileViewer.tsx:175` | — | 重试中… |  |
| `LegacyEnvironmentIssue.tsx:39` | `quiet-button compact` | 正在记录… |  |
| `McpSettings.tsx:403` | `primary-button` | 正在导入… |  |
| `McpSettings.tsx:452` | 动态 class | 正在保存… | 图标＋文字 |
| `MemberAvatarEditor.tsx:103` | `member-editor-primary avatar-picker-upload` | 正在处理头像… |  |
| `MemberIdentityEditor.tsx:464` | 动态 class | 正在保存… | 图标（仅编辑时）＋文字 |
| `MemberManagement.tsx:931` | `quiet-button` | 正在读取… |  |
| `MemberManagement.tsx:941` | `danger-button` | 正在移除… |  |
| `MemberManagement.tsx:1428` | `member-editor-primary member-editor-save` | 正在保存… | 图标＋文字 |
| `MemberManagement.tsx:1550` | `quiet-button` | 正在重新检测… | 多状态标签 |
| `MemberManagement.tsx:1625` | `quiet-button runtime-product-check` | 正在检查… | 文字＋尾部图标 |
| `MemberRuntimeApplyDialog.tsx:265` | `primary-button apply-primary` | 正在读取… | 多状态标签 |
| `MemoryLibrary.tsx:885` | `danger-button` | 正在遗忘… |  |
| `MemoryLibrary.tsx:1192` | `quiet-button compact` | 正在刷新… | 多状态标签 |
| `MemoryLibrary.tsx:1221` | `quiet-button compact` | 正在清除… |  |
| `MemoryLibrary.tsx:1239` | `primary-button` | 正在保存… |  |
| `MemoryLibrary.tsx:1304` | `primary-button` | 正在保存… | 多状态标签 |
| `MemoryReviewDialog.tsx:166` | `primary-button` | 正在保存… | `UiText` 写法，多状态 |
| `MessageExport.tsx:209` | `primary-button` | 正在生成… | 图标＋文字 |
| `MessageQuotes.tsx:225` | — | 引用中… | 图标＋文字 |
| `MissionBoard.tsx:315` | `compact-primary` | 正在保存… | 多状态标签 |
| `MissionBoard.tsx:330` | `compact-primary` | 正在安排清理… |  |
| `MissionBoard.tsx:348` | `compact-primary mission-delete-confirm` | 正在删除… |  |
| `MissionBoard.tsx:684` | `compact-cancel` | 正在安排重试… |  |
| `MissionBoard.tsx:719` | `mission-new mission-start` | 正在开始… | 图标＋文字 |
| `MissionDelivery.tsx:70` | `compact-cancel` | 正在安排重试… | 多状态标签 |
| `NewConversationDialog.tsx:516` | `compact-primary` | 正在新建… | 多状态标签 |
| `NewConversationDialog.tsx:528` | `compact-primary` | 正在新建… |  |
| `OnboardingFlow.tsx:556` | `primary-button … onboarding-primary` | 正在准备… | 文字＋尾部图标；删掉 `!busy &&`，图标一起放进去 |
| `OnboardingFlow.tsx:639` | `quiet-button onboarding-defer` | 正在进入… |  |
| `ProjectRenameDialog.tsx:71` | `primary-button conversation-primary-button` | 保存中… |  |
| `RuntimeInstallationGuide.tsx:72` | `primary-button` | 正在检测… | 多状态标签 |
| `RuntimeMonitoring.tsx:278` | `quiet-button` | 正在刷新… |  |
| `RuntimeMonitoring.tsx:281` | `primary-button` | 正在导出… |  |
| `RuntimeStartupSettings.tsx:266` | `quiet-button member-editor-save` | 正在保存… | 图标＋文字 |
| `ShortcutSettings.tsx:149` | `primary-button` | 保存中… | 多状态标签 |
| `SingleChatPanel.tsx:1768` | `single-chat-end-button` | 结束中… |  |
| `SingleChatPanel.tsx:1999` | `danger-button` | 结束中… |  |
| `StructuredMentionComposer.tsx:1137` | — | 刷新中… |  |
| `ThreadMessageEditor.tsx:286` | `primary-button conversation-primary-action` | 正在保存… | 本次问题来源 |
| `ThreadNavigation.tsx:701` | `primary-button conversation-primary-button` | 保存中… |  |
| `ThreadNavigation.tsx:715` | `danger-button` | 正在删除… |  |
| `ThreadNavigation.tsx:728` | `danger-button` | 正在移除… |  |
| `ThreadWorkspace.tsx:7170` | `danger-button` | 正在撤回…／正在删除… | 撤回和删除共用；`busy` 为 `withdrawingMessageId !== null` |
| `ThreadWorkspace.tsx:8856` | — | 正在核对… |  |
| `ThreadWorkspace.tsx:9676` | `primary-button conversation-primary-button` | 正在邀请… |  |
| `ThreadWorkspace.tsx:9754` | `danger-button` | 正在移出… |  |
| `ThreadWorkspace.tsx:12351` | `primary-button conversation-primary-button task-submit` | 正在保存… | 多状态标签 |
| `ThreadWorkspace.tsx:12372` | `danger-button` | 正在取消… |  |
| `WindowCloseSettings.tsx:125` | `primary-button` | 正在处理… | `text(zh, en)` 写法 |

### 2.3 B 类：只删文字替换（1 处）

`ComposerPrimaryAction.tsx:55`：Composer 的“邀请并发送”。`is-invite` 已经有最小宽度和图标内转圈。把
`{busy ? uiAttribute('正在邀请…') : uiAttribute('邀请并发送')}` 改为 `{uiAttribute('邀请并发送')}`；
图标内转圈与 `aria-label`（“正在邀请并发送”）保持不变。

### 2.4 C 类：不改（9 处，列入防回归扫描的白名单）

都是列表／时间线里的加载入口或内容占位，不在按钮组里，自带的转圈和文字保留：

| 位置 | 文字 |
| --- | --- |
| `AutomationEditor.tsx:109` | 正在读取…（更早的执行记录） |
| `ConversationRunSource.tsx:78` | 正在读取原消息… |
| `ExecutionToolGroup.tsx:906` | 正在加载… |
| `ImageGallery.tsx:458` | 正在读取图片… |
| `ThreadNavigation.tsx:1032` | 正在读取…（查看更多） |
| `ThreadReferenceMenu.tsx:92` | 加载中… |
| `ThreadWorkspace.tsx:5213` | 正在加载更早消息… |
| `ThreadWorkspace.tsx:10457` | 正在载入引用… |
| `ThreadWorkspace.tsx:11521` | 正在加载执行记录…／正在加载… |

### 2.5 防回归扫描：新增 `apps/desktop/src/renderer/src/busy-button-labels.test.ts`

参照 `interface-language-catalog.test.ts` 用 TypeScript AST 遍历渲染层的 `.tsx`（不含测试），规则如下：

- 对每个标签名为 `button` 的 `JsxElement`，检查其子树里的 `ConditionalExpression`（包括 `UiText` 的 `zh` 属性值）。
- 只要某个分支的字符串字面量匹配 `/^正在.+…$|^.{1,6}中…$/` 就报错；属性值（`aria-label`、`title`）不在检查范围。
- 白名单是 2.4 的 9 个按钮、10 条文案。每条记录匹配文件、按钮的 `className` 和 `onClick` 属性以及文案。
- 断言确实扫描到源码，且全部命中项与白名单按表达式和出现次数精确匹配。

先在 `main@892ef6dcc` 上跑一次，确认扫描有效：按按钮去重后，应命中 2.2 和 2.3 的全部 76 个按钮。同一个按钮可能有多条文案，例如 `ThreadWorkspace.tsx:7170`。
全部迁移后应为 0。

### 2.6 依赖旧文案的测试与夹具（必须同步改）

| 位置 | 现在断言 | 改为 |
| --- | --- | --- |
| `apps/desktop/src/renderer/src/new-conversation-dialog-structure.test.ts:16` | 源码包含 `{busy ? uiAttribute("正在新建…") : uiAttribute("新建")}` | 改为断言新的源码片段（`<BusyLabel busy={busy}>` 与 `aria-busy={busy}`） |
| `scripts/fixtures/shortcut-settings/task-drafts.cjs:17` | `.task-submit` 文字为“正在保存…” | `aria-busy === 'true'`、`disabled === true`，文字不含“正在” |
| `scripts/fixtures/member-editor/main.cjs:466` | 等待 `disabled && !textContent.includes('正在保存')` | 等待 `disabled && getAttribute('aria-busy') !== 'true'`（否则保存进行中就会提前通过） |
| `scripts/fixtures/member-editor/main.cjs:658` | 表单文字包含“正在保存” | `!!form.querySelector('button[aria-busy="true"]')` |

再全面搜一遍，有命中就逐条确认：

```sh
rg -n "正在(保存|撤回|删除|新建|邀请|移出|移除|导出|处理|生成|遗忘|取消|开启|重置|检测|导入|提交审批|安排|读取|打开|开始|准备|进入|记录|刷新|清除|核对|检查|重试|重新检测|处理头像)…|(保存|处理|核对|发布|结束|引用|重试|刷新)中…" \
  scripts apps/web apps/desktop/src --glob '*.{test.ts,test.tsx,mjs,cjs}' --glob '!**/locales/**'
```

### 2.7 新增单测：`apps/desktop/src/renderer/src/BusyLabel.test.ts`

用 `renderToStaticMarkup` 验证以下几点：

- `busy=false` 时没有 `data-busy`，`busy=true` 时为 `data-busy="true"`；
- 两种状态下 `.busy-label-content` 都包含原文字；
- 转圈 `aria-hidden="true"`；
- 可访问文字只包含原文字，不出现“正在”。

---

## 3. 阶段 3：消息编辑保存后的收起过渡

只用于“保存成功后关闭编辑器”。取消、冲突放弃、会话切换仍然直接关闭。

### 3.1 `ThreadWorkspace.tsx`

- `import { createPortal } from 'react-dom'`（75 行）改为 `import { createPortal, flushSync } from 'react-dom'`。
- 在 `startMessageEdit`（约 5435 行）附近新增：

```tsx
// Saved edits fold back into the bubble: the editor fades out, then the saved bubble fades in (styles.css).
const closeMessageEditorAfterSave = (messageId: string): void => {
  const close = (): void => setMessageEdit(current => current?.id === messageId ? null : current)
  const row = (): HTMLElement | null | undefined =>
    timelineScrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`)
  const before = row()?.querySelector<HTMLElement>('.message-surface > .message-bubble:has(> .revision-editor)')
  if (!before || typeof document.startViewTransition !== 'function'
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    close()
    return
  }
  const root = document.documentElement
  before.style.viewTransitionName = 'message-edit-out'
  root.classList.add('message-edit-transition')
  const transition = document.startViewTransition(() => {
    flushSync(close)
    const after = row()?.querySelector<HTMLElement>('.message-bubble[data-message-quote-body]')
    if (after) after.style.viewTransitionName = 'message-edit-in'
  })
  transition.ready.catch(() => undefined)
  void transition.finished.catch(() => undefined).finally(() => {
    root.classList.remove('message-edit-transition')
    row()?.querySelector<HTMLElement>('.message-bubble[data-message-quote-body]')?.style.removeProperty('view-transition-name')
  })
}
```

- `renderMessageEditor` 里的 `onSaved`（约 5459 行）改为
  `onSaved={async () => { await messageMutationCommitted(); closeMessageEditorAfterSave(message.id) }}`。
  `messageMutationCommitted()` 先把新内容读回来，所以过渡的新画面已经是保存后的气泡。

### 3.2 `styles.css`：放在 `.revision-editor-actions` 规则组之后（约 9826 行）

```css
/* A saved edit folds back: the editor leaves in 90ms, the saved bubble arrives 60ms later (closeMessageEditorAfterSave). */
html.message-edit-transition::view-transition-old(root),
html.message-edit-transition::view-transition-new(root) { animation-duration: 150ms; }
::view-transition-old(message-edit-out) { animation: 90ms ease-in both message-edit-out; }
::view-transition-new(message-edit-in) { animation: 150ms ease-out 60ms both message-edit-in; }
@keyframes message-edit-out { to { opacity: 0; } }
@keyframes message-edit-in { from { opacity: 0; } }
```

说明：

- 先淡出、后淡入，是为了避免两种排版的文字叠在一起；交互稿对比过同时交叉淡化和“形变”，两者都会让文字重叠或被裁切。
- 根节点的时长只在加了 `message-edit-transition` 类时生效，不影响以后别处的 View Transition。
- 不支持 View Transitions 的 Web 浏览器、jsdom 和减少动态效果时都直接关闭，与现状一致。
- 带附件的消息只有气泡参与淡入淡出，附件组按现状直接切换。

---

## 4. 阶段 4：确认弹窗退场

本次只给交互稿里的两个弹窗加退场动画：

- `ThreadWorkspace.tsx` 的撤回／删除消息确认（`open={messageRemoval !== null}`，约 7138 行）；
- `ThreadNavigation.tsx` 的 `camp-action-dialog`（`open={action !== null}`，约 679 行），覆盖重命名、删除对话、移除项目。

其余 `AppDialogContent` 暂不加。原因：仓库里约 21 处弹窗用 `open={x !== null}`，正文读的就是这个 `x`。关闭时 `x` 已经变成 `null`，
如果退场期间继续渲染，正文会变空或切成另一种文案。

`ProjectRenameDialog` 的 `Dialog.Root` 一直是 `open`，由父组件卸载，无法做退场动画，本次不处理。

### 4.1 新 Hook：`apps/desktop/src/renderer/src/use-closing-snapshot.ts`

```ts
import { useLayoutEffect, useRef } from 'react'

// While a dialog plays its exit motion, render the last values it showed while open.
export function useClosingSnapshot<T>(open: boolean, value: T): T {
  const last = useRef(value)
  useLayoutEffect(() => { if (open) last.current = value })
  return open ? value : last.current
}
```

### 4.2 `AppDialog.tsx`

`AppDialogContentProps` 增加 `exitMotion?: boolean`。为 `true` 时在 className 中加 `app-dialog-exits`。

### 4.3 两个弹窗的改法

- Overlay 的 className 加 `app-dialog-exits`，`AppDialogContent` 传入 `exitMotion`。
- 正文用到的所有状态都从快照读取，`Dialog.Root open` 仍然用实时值：
  - `ThreadWorkspace`：`const removalView = useClosingSnapshot(messageRemoval !== null, { messageRemoval, withdrawingMessageId, withdrawalError })`。
    `deletingMessage`、标题、描述、按钮文字和 `BusyLabel busy` 都从 `removalView` 推导。
  - `ThreadNavigation`：`const actionView = useClosingSnapshot(action !== null, { action, actionBusy, renameTitle, … })`。
    把这个弹窗正文读到的状态全部放进去（tone、各分支、输入值、错误）。
- 成功后 `setAction(null)`／`setMessageRemoval(null)` 和 `finally` 里清除忙碌状态在同一批次里提交，
  快照里保留的是关闭前那一帧，所以退场期间转圈（如果已经出现）会保持，不会闪回文字。

### 4.4 `styles.css`：放在 `@keyframes app-dialog-in`（约 6476 行）之后

```css
/* Opt-in exit (AppDialogContent exitMotion): leaves faster than app-dialog-in enters. */
.dialog-overlay.app-dialog-exits[data-state="closed"] { animation: app-dialog-overlay-out 110ms ease-in both; }
.dialog-content.app-dialog.app-dialog-exits[data-state="closed"] { animation: app-dialog-out 110ms ease-in both; }
@keyframes app-dialog-overlay-out { to { opacity: 0; } }
@keyframes app-dialog-out { to { opacity: 0; transform: translate(-50%, calc(-50% + 4px)) scale(.992); } }
@media (prefers-reduced-motion: reduce) {
  .dialog-overlay.app-dialog-exits[data-state="closed"],
  .dialog-content.app-dialog.app-dialog-exits[data-state="closed"] { animation: none; }
}
html[data-mobile-web="true"] .dialog-overlay.app-dialog-exits[data-state="closed"],
html[data-mobile-web="true"] .dialog-content.app-dialog.app-dialog-exits[data-state="closed"] { animation: none; }
```

Radix Dialog 1.1.19 的 `Presence` 在 `data-state="closed"` 时，只有 `animation-name` 变化才会等 `animationend` 再卸载；
`animation: none` 时立即卸载。所以减少动态效果和 Mobile Web 的行为与现状一致。

---

## 5. 阶段 5：文档

- `DESIGN.md` 的 Components → Buttons 一条末尾追加（英文，与原文一致）：
  `Busy buttons keep their label, size and tone; after 150ms the shared BusyLabel spinner replaces the label in place. Do not swap the label for in-progress text.`
- `docs/ui/components/conversation-workspace.md` 第 146 行一段（编辑、撤回和删除）追加一句：
  “保存成功后编辑器先淡出，再显示保存后的气泡；减少动态效果时直接切换。”（PR B）
- 本文 `status` 在实施完成后改为 `accepted`，并补“实施结果”一节，写明实际改动数、测试命令和结果。
- 运行 `pnpm docs:test`、`pnpm docs:check`。

---

## 6. 验证

### 6.1 命令（按 `docs/development/local-workflow.md` 最小验证矩阵）

PR A：

```sh
pnpm typecheck
pnpm exec vitest run apps/desktop/src/renderer/src/BusyLabel.test.ts \
  apps/desktop/src/renderer/src/busy-button-labels.test.ts \
  apps/desktop/src/renderer/src/new-conversation-dialog-structure.test.ts \
  apps/desktop/src/renderer/src/interface-language-catalog.test.ts
pnpm test:shortcut-settings
node --test scripts/lib/member-editor.test.mjs
pnpm test:message-reedit-ui
pnpm test:channel-camp-naming
pnpm test:thread-fork
pnpm docs:check
```

PR B：PR A 的全部命令，加 `pnpm test:host-web-mobile`（确认 Mobile Web 弹窗仍然立即关闭）。

### 6.2 夹具补充断言

- **消息编辑**：`scripts/fixtures/thread-fork`。在 renderer 的 `thread.messages.edit` 处理里加一个可挂起的开关（参照交互稿
  `capture/fixture/proto-extra.ts` 的 `protoHold/protoRelease`）。在 `main.cjs:252` 点保存前后：
  - 挂起期间：保存按钮 `aria-busy="true"`；按钮宽度、x 坐标与“取消”的 x 坐标和点击前一致；文字仍为“保存”；
  - 等待 150ms 的延迟和 120ms 的淡入结束后，`.busy-label-spinner` 的不透明度为 1；
  - 放行后：编辑器关闭，出现 `.public-message-edited`，且 `html` 上不再有 `message-edit-transition`。
- **撤回、删除、重命名**：`message-reedit-ui.test.mjs`、`channel-camp-naming` 中“弹窗已关闭”的断言，从立即判断改为等待（退场 110ms）。
  例如 `message-reedit-ui.test.mjs:97` 改用 `wait('!document.querySelector(".message-withdraw-dialog")')`。

### 6.3 交互验收与人工复核

下列记录区分隔离夹具和独立开发版。人工复核使用具备独立 `userData` 与 Skill 文件目录的
`pnpm dev`，详见[本地开发与 App 隔离流程](../../development/local-workflow.md#开发版只使用-pnpm-dev)。

- [x] 编辑消息。分叉夹具验证保存和取消的位置、主按钮颜色及成功后的新气泡。隔离 Chromium 的 80ms 回执未出现转圈，独立开发版确认重载后仍保留新正文与「（已编辑）」。
- [x] 注入保存失败。分叉夹具验证原处显示错误、立即恢复保存文字并保留草稿。
- [ ] 确认弹窗。夹具验证撤回消息与重命名对话的 110ms 退场和关闭前内容，以及删除对话的按钮宽度。删除消息与删除对话确认退场待独立开发版目视复核。
- [ ] 减少动态效果。Chromium 模拟系统减少动态效果时，分叉夹具实测转圈静止，渠道会话夹具验证重命名弹窗直接关闭。消息保存时的直接切换待独立开发版目视复核。
- [x] 五套配色。分叉夹具实测删除对话与消息保存的转圈颜色跟随危险按钮与主按钮。
- [x] 通用、MCP、队员保存。隔离夹具挂起真实组件的保存请求，验证图标和文字被转圈替换、按钮尺寸一致、队员保存不变灰。MCP 保存和添加的图标均为 14px，按钮分别保持 28px 和 30px。
- [x] 紧凑窗口和缩放。渠道会话夹具验证 1040×700 和 200% 缩放下重命名确认文案完整单行，关窗夹具验证确认动作仍在可视范围内。

---

## 7. 风险与回退

| 风险 | 处理 |
| --- | --- |
| 带省略号截断的按钮放进 `inline-grid` 后不再截断 | 迁移时逐一检查这类按钮；需要截断的给 `.busy-label-content` 加 `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`，限定在该按钮的 class 下 |
| `:has()` 选择器的样式重算开销 | 只挂在 `form`、`.app-dialog-footer`、`.compact-footer`、`.revision-editor-actions` 和按钮本身，不用通配选择器 |
| View Transition 期间约 210ms 内点击无效。页面旧截图在实时内容上淡出约 150ms，流式输出可能出现短暂叠影 | 只在保存成功时触发，减少动态效果时直接切换。回退时恢复 `onSaved` 原实现并移除 3.2 的 CSS |
| Electron 测试断言弹窗“立即”消失 | 按 6.2 改为等待；回退时去掉 `exitMotion` 即可 |
| 75 处改动量大 | 按文件分提交；2.5 的扫描测试保证没有漏改，也不会误改 C 类 |

## 8. 实施结果

在独立 worktree 的 `rovai/busy-buttons` 从 `origin/main@892ef6dcc` 实施，随后合入
`origin/main@70efa2b4b` 的会话操作反馈更新。75 个按钮接入 `BusyLabel`，Composer 的邀请入口固定
文字并沿用自身图标。AST 扫描在提案基线命中 76 个目标按钮，迁移后为零。9 个加载入口保留原行为，
其中执行记录按钮有两条加载文案。

消息编辑保存重新读取正文后再收起，旧编辑器保留忙碌外观直到截图完成。两个确认弹窗使用关闭前的快照完成
110ms 退场。Mobile Web 和减少动态效果时立即卸载。失败时按钮文字立即恢复，错误与草稿沿用现有流程。

| 验证 | 结果 |
| --- | --- |
| `pnpm typecheck`、`pnpm exec vitest run apps/desktop/src/renderer/src` | 164 个文件、1865 项通过 |
| `pnpm test:shortcut-settings`、`pnpm test:thread-fork`、`pnpm test:message-reedit-ui`、`pnpm test:channel-camp-naming` | 通过。覆盖挂起期间几何、失败保留草稿、重命名退场时保留输入与转圈、Mobile Web 和减少动态效果立即关闭、200% 缩放时确认文字完整 |
| 隔离 Chromium 中的生产界面 | 80ms 返回时逐帧未出现转圈。1040×700 下五套配色的保存按钮宽度均为 41.5px，邻近取消按钮横坐标不变，转圈继承按钮前景色。实测编辑器淡出 90ms，气泡延迟 60ms 后淡入 150ms |
| `node --test scripts/lib/member-editor.test.mjs` | 基线和分支都在队员运行时列表的旧顺序断言失败，期望最后一项为 PI，实际为 Goose。队员忙碌态的静态断言通过 |
| `pnpm build:web`、`pnpm test:host-web-mobile` | Web 构建通过。Mobile Web 套件在基线和分支均为 2 项通过、4 项失败，失败落在导航间距、导航行状态节点、执行台横屏和独立 Server 设置选择器 |
| 独立 profile 的 `pnpm dev` | 创建隔离会话后，在实际编辑器保存消息。重载后保留新正文与「（已编辑）」标记 |
| `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=70efa2b4b pnpm docs:check:ci` | 通过 |

复审补验通过 `pnpm typecheck`、`TZ=UTC pnpm test`、Desktop/Web 构建与文档门禁。
MCP、通用设置、队员设置、会话操作、头像和关窗均使用隔离夹具。头像夹具验证预先挂载的状态区在文件选择期间更新，
Windows 关窗在 macOS 模拟的控制流中验证退出等待时只有退出按钮进入忙碌态。
