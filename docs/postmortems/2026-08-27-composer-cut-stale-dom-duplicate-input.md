---
document_type: postmortem
incident_id: INC-2026-08-27-COMPOSER-CUT-STALE-DOM
incident_date: 2026-08-27
status: closed
systems:
  - desktop-composer
  - structured-mention-editor
  - contenteditable-dom-ownership
  - clipboard-cut-transaction
  - desktop-acceptance
  - ci-gate
last_updated: 2026-08-27
---

# Camp Composer 剪切事务未托管导致原生输入快照串接

> **药师寺惠的小结：** 这次最容易误导人的是 `beforeinput/deleteByCut` 看起来已经在拦截了——它确实
> 调了 `preventDefault`，让人以为剪切已经被应用接管。但 cut 事务的规范入口是 `cut` 事件本身，浏览器
> 在 `deleteByCut` 触发前就已经按原生路径动了 React 受控的 `<br>` 和 caret host，Fiber 与真实 DOM
> 从此分叉，下一个原生字符就落进了已经不存在的旧子树，多个编辑阶段的快照被缝在一起。教训是：对
> contenteditable 上的任何剪切/粘贴事务，应用必须在浏览器动 DOM 之前同步接管，`beforeinput` 只是
> 最后一道兜底，不能当主防线；而判断这条边界是否真的守住，只看代码 `preventDefault` 不够，必须让
> 真实 Chromium 剪一次、再输入一次，同时比对 DOM、Draft、editor identity 与错误集合。

## 摘要

2026-08-27，用户在 macOS Desktop 的 Camp Composer 中输入数字 `123` 后按空格，输入框立刻出现
多份重复内容（“编辑时”现象）。更早的同会话消息也出现中文短句被整段复制、再逐字缩短的相同指纹。
坏内容已经原样写入 `camp_message`，因此不是消息列表的视觉重复。

调查确认：旧 Composer 只在 `onBeforeInput` 中处理 `deleteByCut`，没有显式 `onCut`。当用户执行
`Command+X` 剪切后，Chromium 仍按原生剪切事务修改 `contenteditable` 子树，React 受控的 `<br>`、
caret host 与文本壳层被浏览器删除或改写。后续原生输入落在已经与 React Fiber 不一致的 stale DOM 上，
多个编辑/删除阶段的 DOM 快照被串接进正文，形成“完整句子→逐字缩短”和“数字串连续多份”两类指纹。
这不是 Core 重复发送（每次只落一条用户消息），也不能证明是腾讯输入法自行重复。

最终修复（PR #92，commit `a0ea7a03`）按批复三层落地：`StructuredMentionComposer.handleCut` 在浏览器
改 DOM 前同步写 `clipboardData`、调用 `preventDefault()`、从结构化模型删除选区，cut 只产生一次业务
状态提交；`readStructuredContent` 增加 `isNativeEmptyEditorFiller` 空态归一化，识别 Chromium 清空
后留下的裸占位 `<br>`；`structured-mention-model.ts` 提供归一化正反选区、夹紧 offset、保持 token
原子的 `selectedStructuredMentionContent` 公共 helper；`accept-structured-mentions-ui.mjs` 新增
`--cut-only` 真实 CDP `Cut` 回归，覆盖 `123 → SelectAll → Command+X → 输入 7` 与原生
`execCommand('delete')` 空态两条路径，断言 Draft、剪贴板、editor identity、`.app-shell`/`.camp-workspace`
挂载、错误集合与空态 BR 计数。

模型层单元测试 12/12 通过。但本复盘必须如实记录四项未闭合证据：cut 回归脚本未纳入 CI
（`.github` 无引用，`pnpm test` 不含该脚本）；渲染层 JSX 属性名 `data:empty-break` / `data:line-break`
（冒号）与读取层 `dataset.editorEmptyBreak` / `dataset.editorLineBreak`（对应连字符
`data-editor-empty-break` / `data-editor-line-break`）以及 accept 选择器
`[data-editor-empty-break]` / `[data-editor-line-break]` 三方不完全一致，`isEditorCaretBreak` 在当前
渲染下恒为 false，空态识别靠 `bareBreakCount <= 1` 兜底恰好工作；批复要求的补充场景（末尾换行、
Member/All-members Mention、Skill 文本降级、部分与反向选区、折叠选区、连续剪切）仅有模型单元层
间接覆盖，端到端 cut 路径未覆盖；本复盘受理队员未在本机独立复现旧包红 / 新包绿，红绿结论的证据
强度为“作者声明 + 静态代码对照”，非“独立复现”。

本复盘不归咎个人。批复明确要求“真实红绿回归完成前不批准合并或发布”，但 PR #92 在红绿证据未进 CI、
属性名未对齐的情况下已合并至 `origin/main`。问题不在谁按了合并键，而在“本地验证通过”与“CI 可重复
守护”之间缺少强制门禁。

## 事故元数据

| 字段 | 值 |
|---|---|
| 发现方式 | 用户在真实 Camp 中输入 `123` 加空格后立即看到多份重复，并明确反馈“编辑时”立即出现 |
| 受影响路径 | Camp Composer、Structured Mention DOM 投影、`onBeforeInput(deleteByCut)` 兜底、原生剪切事务、草稿持久化 |
| 触发条件 | 在 Composer 中执行 `Command+X` 剪切选区后继续原生输入；浏览器原生剪切修改了 React 受控 contenteditable 子树 |
| 用户可见症状 | 按一次空格，输入框立刻出现多份 `123`；中文短句出现“整句→逐字缩短”的重复指纹 |
| 直接影响 | 草稿与已发送消息正文被重复串接，用户无法通过重新输入稳定规避 |
| 数据完整性 | 坏内容已原样写入 `camp_message`；不是消息列表视觉重复 |
| 权限影响 | 无 |
| 平台范围 | 在 macOS + Electron/Chromium 上确认；根因是 contenteditable + React + 原生剪切事务边界，不应假定只限单一输入法 |
| 事故状态 | 主路径修复已实现并合入 main；CI 门禁、属性名对齐、补充场景端到端覆盖仍待跟踪 |

## 分析范围与证据状态

- 仓库：Rovai-ai；分析基线 `origin/main` `8499eba7`（含 PR #92）；PR #92 实施 commit `a0ea7a03`。
- 用户证据：序列 1–9 中 `123` + 空格立即多份、中文短句整段复制并逐字缩短、用户明确回复“编辑时”。
- 队员诊断证据：序列 5 奥黛丽确认坏内容已写入 `camp_message`，排除 Core 重复发送，最强嫌疑为
  `compositionend → requestAnimationFrame → syncNativeDom → React 受控回写/selection 恢复` 竞态。
- 批复证据：序列 11 雾切响子给出“有条件通过”，要求显式 `onCut` 同步接管、公共 helper、空态窄条件、
  真实 CDP `SelectAll`/`Cut` 回归，且“真实红绿回归完成前不批准合并或发布”。
- 代码证据：`StructuredMentionComposer.tsx` 的 `handleCut`（666–690 行）、`isNativeEmptyEditorFiller`
  （1079–1107 行）、`selectedStructuredMentionContent`（structured-mention-model.ts 71–83 行）、
  `cutSelectionWithMetaX`（accept 脚本 2850–2868 行，`commands: ['Cut']`）。
- 自动化证据：`structured-mention-model.test.ts` 12 项通过；`accept-structured-mentions-ui.mjs --cut-only`
  含 `123 → SelectAll → Cut → 7` 与原生 `execCommand('delete')` 空态两条断言链。
- CI 证据：`.github` 无 `accept-structured-mentions` 引用；`pnpm test` 不含 accept 脚本；cut 回归
  从未在 CI 执行。
- 属性名证据：`react-dom/server` 验证 `{ 'data:empty-break': 'true' }` 渲染为 `<br data:empty-break="true"/>`；
  `isEditorCaretBreak` 检查 `dataset.editorEmptyBreak`（对应 `data-editor-empty-break`）与
  `dataset.editorCaretBreak`（对应 `data-editor-caret-break`）；渲染层 JSX 第 777 行 `data:empty-break`、
  第 1116 行 `data:line-break`、第 1121 行 `data:caret-host`，均与读取层属性名不完全一致。
- 限制：受理队员未在本机独立执行 `--cut-only` 的旧包红 / 新包绿；属性名不一致为静态分析 + `react-dom/server`
  验证得出，未在真实 Chromium 内确证断言实际取值。

## 关键结论与证据

| 结论 | 状态 | 证据 | 限制或反证 |
|---|---|---|---|
| 用户看到的多份重复是“编辑时”而非“发送后” | 已确认 | 序列 9 用户明确回复“编辑时”；序列 7“只要输出 123 打空格都能复制” | 用户未提供物理按键事件日志，但“立即出现”已足够定位到编辑路径 |
| 坏内容已写入持久化消息，非视觉重复 | 已确认 | 序列 5 奥黛丽核到 `camp_message` 含重复正文；数字串可拆为 `12321123` 连续 5 份再接 7→1 缩短前缀 | 重复指纹指向多个编辑阶段 DOM 快照串接，不是 Core 重复发送 |
| 旧 Composer 缺少显式 `onCut`，仅靠 `deleteByCut` 兜底 | 已确认 | 修复前 `StructuredMentionComposer.tsx:556` 只有 `if (nativeEvent.inputType === 'deleteByCut')`；无 `onCut`、无 `handleCut` | `deleteByCut` 在 `beforeinput` 中 `preventDefault`，但实测中浏览器仍执行了原生删除（序列 10 用户描述） |
| 浏览器原生剪切修改了 React 受控子树，产生 stale DOM | 已确认 | 旧实现下 React Fiber 与浏览器执行后的 DOM 不一致；后续原生输入落入 stale 子树，快照被串接 | 本受理队员未在本机独立构造该竞态的红例，结论建立在用户现象 + 队员诊断 + 代码静态对照之上 |
| `handleCut` 在浏览器改 DOM 前同步接管 cut 事务 | 已确认 | 666–690 行：折叠选区放行 → `preventDefault()` → `selectedStructuredMentionContent` 取选中 → `createStructuredMessageClipboardData` 同步写剪贴板 → `replaceStructuredSelection(state, [])` 单次提交 | IME composition 期间 `preventDefault()` 并 `return`（667–670 行），符合批复“composition 期间拒绝剪切” |
| `selectedStructuredMentionContent` 作为公共 helper 不暴露低层 slice | 已确认 | structured-mention-model.ts 71–83 行导出，内部调用 `normalizeStructuredMentionContent` + `clampOffset` + `sliceStructuredMentionContent`；测试 217–235 行覆盖反向选区与原子 token | 符合批复第 1 点 |
| 空态归一化是窄条件 | 部分确认 | `isNativeEmptyEditorFiller`（1079–1107 行）要求无有效文本、无 Mention/Skill、无 `data-editor-line-break`，单裸 BR 计入 `bareBreakCount <= 1` | `isEditorCaretBreak` 检查的属性名与渲染层不一致（见下），当前靠 `bareBreakCount` 兜底工作，非靠 `isEditorCaretBreak` |
| 真实 CDP `Cut` 回归已落地 | 已确认 | `cutSelectionWithMetaX`（2850–2868 行）用 `Input.dispatchKeyEvent` + `commands: ['Cut']`；`selectWholeEditor` 用真实 Range 选区；`pbpaste` 验证系统剪贴板 | 非 synthetic `ClipboardEvent`，符合批复第 3 点 |
| 回归断言 `emptyBreakCount === 1` 在当前渲染下可能取 0 | 静态风险 | accept 选择器 `[data-editor-empty-break="true"]` 不匹配渲染的 `data:empty-break`（冒号）；`react-dom/server` 验证属性名保留冒号 | 未在真实 Chromium 内确证；若属实，该断言会假阴性失败，但因 CI 不跑该脚本，未被捕获 |
| 红绿回归已通过 | 未独立确认 | PR #92 作者声明 + 代码静态对照；模型单元 12/12 通过 | 本受理队员未在本机跑 `--cut-only` 的旧包红 / 新包绿；CI 也不跑该脚本 |

## 影响

本次缺陷直接污染了用户消息正文：草稿与已发送消息都被重复串接，且指纹具有规律性（整句复制再逐字
缩短、数字串连续多份再接缩短前缀），说明这不是偶发渲染抖动，而是多个编辑阶段快照被系统性缝合。

用户承受的编辑成本：

- 按一次空格立即看到多份 `123`，无法通过重新输入稳定规避；
- 中文短句出现“整句→逐字缩短”的重复，破坏输入节奏；
- 坏内容已经发送进 Camp，需要事后清理或解释；
- 前序 PR #87 的 caret-host 修复在同一会话被怀疑“改错了”，降低了用户对修复链路的信任；
- 用户需要在“是否继续信任 Composer”和“是否回滚”之间反复权衡。

数据层面：`camp_message` 已含损坏正文。本复盘不主张批量清理历史 `"\n"` 草稿或损坏消息，因为无法
安全区分历史损坏与用户有意内容；清理应由独立数据治理流程处理。

## 发现与响应

用户在序列 1–9 中连续报告多份重复，并明确“编辑时”立即出现。序列 5 奥黛丽把坏消息写入
`camp_message`、数字指纹拆解和“最强嫌疑是 composition→raf→syncNativeDom→React 回写竞态”三点
固化下来，并排除 Core 重复发送与腾讯输入法自行重复。

序列 10 用户给出三层修复建议：显式 `onCut` 同步接管、`readStructuredContent` 空态兜底、真实 Electron
红绿回归。序列 11 雾切响子批复“有条件通过”，补正三点（公共 helper 不暴露低层 slice、`handleCut`
须覆盖 compositionend 后窗口且只提交一次、空态判定窄条件），并明确验收要求：真实 CDP `SelectAll`/
`Cut`、不得 synthetic dispatch、先红后绿、等待 300 ms Draft 持久化后同时断言 content/body/剪贴板/
DOM/editor identity/`#root`/`.app-shell`/无 `removeChild`/无 `NotFoundError`/无 Renderer reload，
随后覆盖纯文本、末尾换行、Mention、Skill、部分与反向选区、折叠选区与连续剪切。

PR #92 按批复实施并合入 `origin/main`（commit `a0ea7a03`）。但合入时 cut 回归未进 CI，属性名未对齐，
补充场景端到端覆盖未补齐。序列 12 Principal 指示“这个问题已经修复了，写个复盘报告 pr 到 main”。

本受理队员在写复盘前对修复落地做了静态对照，最小反馈循环固定为：

```text
拉取 origin/main 至 a3fc9acb
  -> grep StructuredMentionComposer.tsx 确认 handleCut / onCut 存在
  -> 读 handleCut（666-690）确认 preventDefault 在写 clipboardData 之前
  -> 读 isNativeEmptyEditorFiller（1079-1107）确认空态窄条件
  -> 读 selectedStructuredMentionContent（model 71-83）确认公共 helper 不暴露 slice
  -> 读 cutSelectionWithMetaX（accept 2850-2868）确认 Input.dispatchKeyEvent + commands:['Cut']
  -> 读 selectWholeEditor（2571-2589）确认真实 Range 选区、非 synthetic ClipboardEvent
  -> pnpm vitest run structured-mention-model.test.ts
  -> node -e react-dom/server 验证 data:empty-break 渲染后属性名
```

对照结论：`handleCut` 主路径、`isNativeEmptyEditorFiller` 空态归一化、`selectedStructuredMentionContent`
公共 helper、`cutSelectionWithMetaX` 真实 CDP Cut、`selectWholeEditor` 真实 Range 选区均已落地，符合
批复主方向。模型单元测试 12/12 通过（`vitest run` 输出 `1 file, 12 tests, 508ms`）。
`react-dom/server` 对 `{ 'data:empty-break': 'true' }` 渲染输出 `<br data:empty-break="true"/>`，
对 `{ 'data-editor-empty-break': 'true' }` 输出 `<br data-editor-empty-break="true"/>`，确认渲染层
保留冒号、读取层需要连字符，三方不一致成立。但属性名不一致、CI 缺口、补充场景缺位三项风险无法在
静态对照中闭合，故如实记入纠正措施，不替它们合上。

受限于 Principal 在序列 14 指示“你别搞了，安心写复盘报告”，本受理队员未在本机执行 `--cut-only` 的
旧包红 / 新包绿。前序 composer-ime 复盘的详细度很大程度上来自“真实打包 Electron + 腾讯拼音 + 原生
输入”的运行时数据（如 `123213213n\n`、`keyCode=229`、`compositionupdate("ni")`）；本复盘的对应
证据是静态代码对照 + `react-dom/server` 属性名验证 + 单元测试通过数，运行时数据缺位。若需补齐该层
详细度，需重新授权执行 `--cut-only` 并记录真实 Chromium 的 DOM、Draft、剪贴板与错误集合。

## 时间线

时间区间为 2026-08-27（Asia/Shanghai）。精确分钟级时间未作为结构化事故事件持久化，下表保持阶段顺序。

| 阶段 | 事件 |
|---|---|
| 初始报告 | 用户输入 `123` 加空格后立即看到多份重复；同会话中文短句出现“整句→逐字缩短”指纹。 |
| 诊断 | 奥黛丽确认坏内容写入 `camp_message`，排除 Core 重复发送与输入法自行重复，锁定 composition→raf→syncNativeDom 竞态域。 |
| 修复方案 | 用户提出显式 `onCut` + 空态兜底 + 真实红绿回归三层方案。 |
| 批复 | 雾切响子“有条件通过”，要求公共 helper、单次提交、窄空态、真实 CDP Cut、先红后绿、补充场景覆盖；红绿完成前不批准合并发布。 |
| 实施与合入 | PR #92（`a0ea7a03`）实施三层修复并合入 `origin/main`；cut 回归未进 CI，属性名未对齐，补充场景未补齐。 |
| 复盘受理 | 药师寺惠对修复做静态对照，确认主路径落地，记录四项未闭合证据，撰写本复盘。 |

## 技术根因

### 剪切事务未被应用托管，浏览器绕过 React 修改 DOM

旧 Composer 只在 `onBeforeInput` 中处理 `inputType === 'deleteByCut'`，没有显式 `onCut`。`beforeinput`
的 `preventDefault` 在实测中不足以阻止 Chromium 执行原生剪切事务：浏览器仍会删除 `contenteditable`
选区内的 React 受控节点（`<br data-editor-line-break>`、`<span data-editor-caret-host>`、文本壳层），
React Fiber 与执行后的 DOM 不一致。后续原生输入落入 stale 子树，多个编辑阶段的 DOM 快照被串接进
正文。

旧实现的 cut 处理近似为：

```tsx
const handleBeforeInput = (event: FormEvent<HTMLDivElement>): void => {
  // ...
  if (nativeEvent.inputType === 'deleteByCut') {
    event.preventDefault()            // 太晚：浏览器已开始原生剪切事务
    setQuery(null)
    emitState(replaceStructuredSelection(editorState(selection), []))
  }
}
// 编辑器上没有 onCut
<div contentEditable onBeforeInput={handleBeforeInput} /* ... */ />
```

W3C Clipboard API 规定：取消 `cut` 事件会阻止浏览器删除选区，应用必须自行更新模型。旧实现没有
在 `cut` 事件上 `preventDefault`，因此浏览器按原生路径删除，应用也没有机会同步重写模型。

### 修复后的 cut 事务边界

`handleCut` 在浏览器改 DOM 前同步完成三件事：写 `event.clipboardData`（`text/plain` 与结构化
`text/html`）、调用 `event.preventDefault()`、从结构化模型 `replaceStructuredSelection(state, [])`
删除选区。`emitState` 只触发一次业务状态提交，避免先提交中间 `onChange` 再剪切后再提交一次。
IME composition 期间（`isComposingRef.current`）直接 `preventDefault()` 并 `return`，不从未对账的
DOM 推导模型。

修复后的 cut 事务近似为：

```tsx
const handleCut = (event: ClipboardEvent<HTMLDivElement>): void => {
  if (disabled || isComposingRef.current) { event.preventDefault(); return }
  const selection = currentSelection()
  if (selection.anchor === selection.focus) return        // 折叠选区放行，让原生 cut 不删内容
  event.preventDefault()                                  // 在浏览器动 DOM 之前
  const selectedContent = selectedStructuredMentionContent(state)
  const structuredClipboard = createStructuredMessageClipboardData(selectedContent, members)
  event.clipboardData.setData('text/plain', structuredClipboard?.text ?? fallbackText)
  if (structuredClipboard) event.clipboardData.setData('text/html', structuredClipboard.html)
  setQuery(null)
  emitState(replaceStructuredSelection(state, []))         // 单次业务提交
}
<div contentEditable onBeforeInput={handleBeforeInput} onCut={handleCut} /* ... */ />
```

空态归一化 `isNativeEmptyEditorFiller` 作为第二层兜底：即使某个平台绕过 `onCut`，整个编辑器只剩
裸占位 `<br>`、空壳或纯 caret sentinel 时，`readStructuredContent` 归一化为 `[]`，不再把空输入框
保存成 `"\n"`。空态时的渲染投影为：

```html
<span data-editor-segment="text" data-editor-empty="true">
  <br data:empty-break="true" />
</span>
```

`isNativeEmptyEditorFiller` 遍历整棵编辑器：无有效文本、无 `data-editor-line-break`、无
Mention/Skill token，且裸 BR 计数 `bareBreakCount <= 1` 时判定为空，`readStructuredContent` 直接
返回 `[]`，跳过把裸 BR 读成 `"\n"` 的旧路径。

### 属性名边界：渲染与读取未完全对齐

渲染层 JSX 用 `data:empty-break`、`data:line-break`、`data:caret-host`（冒号形式），而读取层
`isEditorCaretBreak` 检查 `dataset.editorEmptyBreak` / `dataset.editorCaretBreak`（对应连字符
`data-editor-empty-break` / `data-editor-caret-break`），accept 选择器也用
`[data-editor-empty-break]` / `[data-editor-line-break]`。`react-dom/server` 验证属性名保留冒号。

当前空态识别“恰好工作”：单个裸 BR 的 `bareBreakCount === 1` 满足 `<= 1` 兜底，不依赖
`isEditorCaretBreak`。但 `isEditorCaretBreak` 在当前渲染下恒为 false，是死代码；accept 断言
`emptyBreakCount === 1` 可能取 0（选择器不匹配 `data:empty-break`）。该风险未在真实 Chromium 内确证，
但静态证据强度足以列为待修正项。

## 促成因素

### `beforeinput/deleteByCut` 被当作 cut 事务的充分防线

`beforeinput` 的 `preventDefault` 在多数输入类型上有效，但 cut 事务的规范入口是 `cut` 事件本身。
把 `deleteByCut` 当主路径，等于在浏览器已经开始执行原生剪切后才试图拦截。

### 本地验证被当作 CI 守护

PR #92 的红绿证据只存在于作者本地。`accept:structured-mentions-ui` 是独立 npm script，不在
`pnpm test` 内，`.github` 也不引用。没有强制门禁阻止“本地通过但 CI 不跑”的回归被合入。

### 属性名风格在同一 JSX 块内不一致

同一渲染块内，`data-editor-segment`（连字符）与 `data:empty-break`（冒号）混用。读取层和 accept
选择器按连字符风格编写，渲染层部分属性按冒号风格编写。风格不一致在“单 BR 兜底”下不暴露，但
`isEditorCaretBreak` 因此成为死代码。

### 补充场景端到端覆盖缺位

批复要求覆盖末尾换行、Member/All-members Mention、Skill 文本降级、部分与反向选区、折叠选区与
连续剪切。`acceptComposerCutRegression` 只有纯文本 `123 → cut → 7` 与原生 `execCommand('delete')`
空态两条。反向选区与原子 token 有模型单元层 `selectedStructuredMentionContent` 覆盖，但 Mention/Skill/
部分选区/连续 cut 的端到端断言缺位。

## 既有防护为何没有阻止事故

- `onBeforeInput(deleteByCut)` 能 `preventDefault`，但不是 cut 事务规范入口，不足以阻止浏览器原生删除。
- PR #87 的 caret host 与 composition generation 防护了行尾换行与 IME 跨代，但不覆盖剪切事务边界。
- `readStructuredContent` 旧实现把裸 BR 读成 `"\n"`，没有空态归一化兜底。
- `pnpm test` 与 `.github` CI 不含 `accept-structured-mentions-ui`，cut 回归无强制守护。
- 单元测试 seam 用 `renderToStaticMarkup` 与纯函数，无法观察真实 Chromium 剪切事务对 React 子树的修改。
- 打包与安装门禁验证产物真实性，不推断交互缺陷已修复。

## 不属于根因的事项

- 不是 Core 重复发送；每次只落一条用户消息（序列 5 已排除）。
- 不是腾讯输入法自行重复；同一指纹在纯文本原生输入路径也可解释。
- 不是 PR #87 caret-host 修复“改错了”；两次问题在同一条 contenteditable→React 边界上，但 PR #87
  解决的是行尾换行光标宿主，cut 事务未托管是独立缺口。不应回滚 PR #87。
- 不是用户需要按多次空格的产品设计；单次空格应产生单份内容。
- 不是 Mention/Skill token 原子性本身破坏 cut；最小复现只包含纯文本数字。

## 解决与恢复

本次完成以下修复（PR #92，`a0ea7a03`）：

1. `StructuredMentionComposer.handleCut` 在浏览器改 DOM 前同步写 `clipboardData`、`preventDefault()`、
   从结构化模型删除选区，cut 只产生一次业务状态提交。
2. IME composition 期间 `handleCut` 直接 `preventDefault()` 并 `return`，不从未对账 DOM 推导模型。
3. `readStructuredContent` 增加 `isNativeEmptyEditorFiller` 空态归一化，识别 Chromium 清空后的裸占位 BR。
4. `structured-mention-model.ts` 导出 `selectedStructuredMentionContent` 公共 helper，归一化正反选区、
   夹紧 offset、保持 token 原子，不暴露低层 `sliceStructuredMentionContent`。
5. `accept-structured-mentions-ui.mjs` 新增 `--cut-only` 真实 CDP `Cut` 回归，覆盖
   `123 → SelectAll → Command+X → 输入 7` 与原生 `execCommand('delete')` 空态，断言 Draft、剪贴板、
   editor identity、`.app-shell`/`.camp-workspace` 挂载、错误集合与空态 BR 计数。
6. `structured-mention-model.test.ts` 新增 `selectedStructuredMentionContent` 反向选区与原子 token 测试，
   12 项通过。

## 纠正措施

状态反映本复盘发布时可用的证据。开放事项需映射到当前维护计划；本复盘不创造新的产品合同。

| ID | 措施 | 责任角色 | 优先级 | 状态 | 证据或目标 |
|---|---|---|---|---|---|
| CCUT-01 | 用显式 `onCut` 同步接管 cut 事务，`deleteByCut` 降级为兼容兜底 | Camp Renderer | P0 | 已完成 | `handleCut`（StructuredMentionComposer.tsx 666–690）、`onCut={handleCut}`（768） |
| CCUT-02 | `readStructuredContent` 增加空态归一化，识别裸占位 BR | Camp Renderer | P0 | 已完成 | `isNativeEmptyEditorFiller`（1079–1107） |
| CCUT-03 | 提供 `selectedStructuredMentionContent` 公共 helper，不暴露低层 slice | Camp Renderer | P0 | 已完成 | structured-mention-model.ts 71–83；测试 217–235 |
| CCUT-04 | 新增真实 CDP `Cut` 红绿回归 | Desktop Acceptance | P0 | 已完成 | `cutSelectionWithMetaX`（2850–2868）、`acceptComposerCutRegression`（2276–2415） |
| CCUT-05 | 对齐渲染层与读取层/选择器的 BR 属性名 | Camp Renderer | P0 | 待跟踪 | 渲染 `data:empty-break`/`data:line-break`（冒号）与读取 `dataset.editorEmptyBreak`/`dataset.editorLineBreak`、选择器 `[data-editor-empty-break]`/`[data-editor-line-break]` 不一致；需在真实 Chromium 确证 `emptyBreakCount` 实际取值后统一为同一风格 |
| CCUT-06 | 把 `accept:structured-mentions-ui` 纳入 CI 门禁 | Engineering Process | P0 | 待跟踪 | `.github` 无引用，`pnpm test` 不含该脚本；至少 `--cut-only` 与 `--ime-newline-only` 应在 PR CI 执行 |
| CCUT-07 | 补齐 cut 补充场景端到端覆盖 | Desktop Acceptance | P1 | 待跟踪 | 末尾换行、Member/All-members Mention、Skill 文本降级、部分选区、折叠选区、连续剪切 |
| CCUT-08 | 在交互修复交付模板中区分“本地红绿”与“CI 可重复红绿” | Engineering Process | P1 | 待跟踪 | PR 模板或开发指南后续改动 |
| CCUT-09 | 评估可重复控制系统输入法的 macOS 专用自动化 runner | Desktop QA | P2 | 已计划 | 承接 INC-2026-08-26-COMPOSER-IME-TRAILING-NEWLINE 的 CIME-06 |

## 复发判据

出现以下任一情况即视为本事故复发：

- 在 Composer 中 `Command+X` 剪切选区后，继续原生输入出现多份重复或“整句→逐字缩短”指纹；
- 剪切后 Draft 不是 `[]`、body 不是 `""`，而是 `"\n"` 或残留旧正文；
- 剪切后 editor identity 改变、`.app-shell`/`.camp-workspace` 卸载，或出现 `removeChild`/`NotFoundError`；
- 剪贴板内容与原选区不一致；
- cut 回归只用 synthetic `ClipboardEvent` dispatch，未经过 Chromium 原生 `Cut` 命令；
- `readStructuredContent` 把空编辑器读成 `"\n"` 或非空内容；
- CI 仍不跑 `--cut-only` 回归，或 `emptyBreakCount` 断言因属性名不匹配而假阴性通过。

## 经验

剪切与粘贴是对称的边界：粘贴时应用必须把外部内容安全收敛进受控模型，剪切时应用必须在浏览器把
受控 DOM 删掉之前接管整个事务。把 `beforeinput/deleteByCut` 当作 cut 的充分防线，等于在浏览器已经
开始动手后才喊停。

“本地通过”与“CI 可重复守护”不是同一层证据。本地红绿是发现修复方向的手段，CI 门禁是阻止回归被
合入的强制门。当红绿脚本不进 CI、属性名未对齐时，合入键本身就是一次无守护的发布。

属性名风格在同一 JSX 块内不一致，是比业务逻辑更隐蔽的缺陷：它在“单 BR 兜底”下不暴露，却让
`isEditorCaretBreak` 静默成为死代码。渲染层、读取层、断言层三处的属性名必须保持同一风格，且最好
由单一常量定义，避免同名异写。

受理队员的小结不能为了好看的闭合而替未闭合项合上。这次我能给的是“修复主路径已落地、模型单元通过”，
不是“全链路已闭环”。属性名对齐、CI 纳入、补充场景覆盖、独立红绿复现，四项必须留在纠正措施里继续
跟踪，直到各自有可重复证据。

## 参考资料

- [Structured Mention Composer 实现](../../apps/desktop/src/renderer/src/StructuredMentionComposer.tsx)
- [Structured Mention 模型与公共 helper](../../apps/desktop/src/renderer/src/structured-mention-model.ts)
- [Structured Mention 模型单元测试](../../apps/desktop/src/renderer/src/structured-mention-model.test.ts)
- [Structured Mention Electron UI 验收（含 `--cut-only`）](../../scripts/accept-structured-mentions-ui.mjs)
- [前序复盘：Composer 行尾换行与 IME 首字符组合](2026-08-26-composer-ime-trailing-newline-caret-host.md)
- [W3C Clipboard API：overriding the cut event](https://www.w3.org/TR/clipboard-apis/#overriding-the-cut-event)
- [本地开发与 App 隔离流程](../development/local-workflow.md)
