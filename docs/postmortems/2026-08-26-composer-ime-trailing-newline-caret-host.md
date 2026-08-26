---
document_type: postmortem
incident_id: INC-2026-08-26-COMPOSER-IME-TRAILING-NEWLINE
incident_date: 2026-08-26
status: closed
systems:
  - desktop-composer
  - structured-mention-editor
  - contenteditable-dom-ownership
  - macos-ime
  - desktop-acceptance
last_updated: 2026-08-27
---

# Camp Composer 行尾换行破坏中文输入法首字符组合

> **爱丽丝的小结：** 这次最容易误导我们的证据恰好也是真的：旧的 IME 对账任务确实可能
> 越过下一轮组合，空编辑器也确实可能失去 DOM 所有权，但它们都不是用户仍能复现的最后一根刺。
> 真正的问题藏在一个看似普通的行尾 `\n` 里——模型已经换行，浏览器却没有给下一行一块能让
> 光标和输入法共同站稳的地方。以后面对输入法缺陷，我们既要检查状态机，也必须让真实浏览器
> 证明字符最终落在了哪里。

## 摘要

2026-08-26，用户报告 macOS Desktop 的 Camp Composer 在腾讯拼音下存在一组连续症状：输入
`123213213` 后，第一次 `Shift+Enter` 看起来不换行，需要第二次才出现换行；无论换行前后，
接下来输入的第一个拼音字母都不能正常进入中文组合，只表现为英文。截图中的系统候选条说明
输入法仍参与了部分按键处理。

最初调查发现两个真实缺陷：上一轮 `compositionend` 延迟到 `requestAnimationFrame` 的 DOM
对账可能跨入下一轮 `compositionstart`；空 `contenteditable` 也没有稳定的 React 文本壳层。
两项修复分别加入组合代次校验、取消过期 frame 和空编辑器 shell，完成测试、打包与安装后，
用户仍然复现原症状。这证明最初修复处理了相邻风险，却没有覆盖用户的决定性触发条件。

第三轮调查改用打包 Electron、真实 Chromium 原生输入和腾讯拼音事件链逐层缩小范围，最终确认：
Composer 将模型中的换行直接渲染为 React 文本节点中的字面 `\n`。当这个 `\n` 位于正文末尾时，
Chromium 没有建立稳定的末行光标盒。一次 `Shift+Enter` 已把 `123213213\n` 写入模型，但视觉和
Accessibility tree 都无法可靠表现新行；下一次原生字符会被插入到终端 `\n` 之前，实际顺序变成
`123213213n\n`。IME 的 marked text 因此不能稳定锚定到下一行，形成“第一次换行无效”和“首字母
变英文”的同一条因果链。

最终修复把模型换行渲染为原生 `<br data-editor-line-break>`，并在终端换行后增加一个不计入模型、
可承载原生输入和 IME marked text 的零宽 caret host。浏览器先把字符写入该宿主，React 再把它
安全收敛回结构化正文。组合代次防护继续保留，防止旧 frame 触碰下一轮 IME 会话。

修复后的 Electron 回归得到 `123213213\nn`，字符位于 `<br>` 之后，编辑器实例和焦点均保持，
没有 React DOM 异常。腾讯拼音真实键盘序列产生 `keyCode=229`、`isComposing=true` 和
`compositionupdate("ni")`，并始终绑定在同一个下一行编辑器宿主。完整 80 个测试文件、560 项
测试与 TypeScript 检查通过；daily macOS arm64 包完成签名、哈希和安装校验。

本复盘不归咎个人。最初的状态机假设有截图、事件语义和真实代码缺陷支持；问题在于验证 seam
只证明了“组合期不误处理按键”和“编辑器没有在合成中被旧 frame 重挂”，没有证明用户最在意的
最终事实：一次换行后，真实 Chromium 和系统输入法会把第一个字符放到哪一行。

## 事故元数据

| 字段 | 值 |
|---|---|
| 发现方式 | 用户在真实 Camp、真实腾讯拼音下连续复现，并在两次安装修复后明确反馈“还是这样” |
| 受影响路径 | Camp Composer、Structured Mention DOM 投影、光标映射、IME composition 与 Shift+Enter |
| 触发条件 | 文本末尾插入模型换行，随后输入首个原生字符或开始中文组合 |
| 用户可见症状 | Shift+Enter 看似要按两次；换行前后首个拼音字母表现为英文 |
| 直接影响 | 中文消息编辑被打断，用户需要重复换行、删除英文首字母或重新开始输入 |
| 数据完整性 | 未发现已发送 CampMessage 损坏；问题发生在发送前 Draft 与编辑器 DOM 同步阶段 |
| 权限影响 | 无 |
| 平台范围 | 在 macOS + 腾讯拼音 + Electron/Chromium 上确认；同类 contenteditable 终端换行风险不应假定只限该输入法 |
| 事故状态 | 根因已修复并加入确定性 Electron 回归；跨系统输入法自动化继续跟踪 |

## 分析范围与证据状态

- 仓库：Rovai-ai；最初分析基线 `ab943c33bb1ee5fda5752e31ba461c19ef0734c9`。
- 用户证据：原始症状描述、候选条截图、两次安装后再次复现的反馈。
- 代码证据：`StructuredMentionComposer.tsx` 的 composition 生命周期、DOM/model 投影、逻辑选区
  映射和 React ownership reset。
- 自动化证据：`StructuredMentionComposer.test.ts` 的静态投影测试，以及
  `accept-structured-mentions-ui.mjs --ime-newline-only` 的打包 Electron 回归。
- 平台证据：Chromium DevTools Protocol 的原生 `Input.insertText`，以及 Computer Use 驱动的腾讯
  拼音真实按键与 composition 事件记录。
- 安装证据：`dist` 与 `/Applications/Rovai AI.app` 的 `app.asar` SHA-256 一致，arm64 和 deep
  codesign 校验通过；运行中的旧进程没有被强行终止。
- 限制：CI 不能稳定控制每台 macOS 主机的第三方输入法候选选择，因此系统输入法验证仍是受控
  macOS 验收证据；确定性的字符落点由 Chromium 原生输入回归长期守护。

## 关键结论与证据

| 结论 | 状态 | 证据 | 限制或反证 |
|---|---|---|---|
| 一次 Shift+Enter 已写入模型换行 | 已确认 | 旧实现下 Draft 与序列化 DOM 均为 `123213213\n`，键盘事件被正确 `preventDefault` | Accessibility tree 没有可靠显示终端文本换行，因此用户看到“没换行” |
| 终端字面 `\n` 不能作为稳定的下一行输入宿主 | 已确认 | 旧打包 App 中，原生输入后结果为 `123213213n\n`，编辑器仍聚焦且未先重挂 | 这不是业务模型顺序错误，而是 Chromium 对终端文本 LF 的原生插入位置 |
| 第一次 Shift+Enter 与首字母英文是同一根因的连续表现 | 已确认 | 换行缺少末行光标盒，下一次 marked text/字符锚点回到 LF 之前；症状在每次末尾换行后重复 | 候选栏真实开启时，Enter/Shift+Enter 先归 IME 仍是正常平台行为 |
| 旧 composition frame 是真实风险但不是最终根因 | 已确认 | `compositionend` 曾延迟一帧，旧 `compositionstart` 不取消它；代次修复后用户仍复现 | 代次防护仍有价值，不能因不是最终根因而回滚 |
| 空编辑器 shell 是真实 ownership 风险但不足以解决本症状 | 已确认 | 空 DOM 原生输入可改变 React 子树；稳定 shell 修复后，数字末尾换行仍复现 | 用户能正常输入数字，决定性失败发生在终端换行后的下一个输入 |
| 使用第二个 React-owned caret `<br>` 会引入删除冲突 | 已确认 | 浏览器输入时移除 caret `<br>`；React 随后再次删除它，触发 `NotFoundError: removeChild`，并短暂产生重复 `n` | 因此不能只把一个文本 LF 机械替换成两个由 React 管理的 BR |
| 零宽 caret host 同时满足行框和 DOM 所有权边界 | 已确认 | 浏览器把 `n`/marked text 写入 host 而不移除宿主；模型读取忽略 sentinel、保留真实字符，React 安全收敛 | host 必须在长度、序列化、选区和 placeholder 逻辑中都按零长度处理 |
| 修复后腾讯拼音从下一行开始真实 composition | 已确认 | `n/i` 事件为 `keyCode=229`、`isComposing=true`、`compositionupdate("ni")`；editor identity 始终为 1 | 候选最终选择受输入法状态影响，不作为确定性 CI 断言 |

## 影响

本次缺陷没有损坏已发送消息，也没有导致误发送。Composer 在 `isComposing` 时继续把 Enter、
Shift+Enter 和候选控制权交给 IME，因此现有安全边界避免了“选字时发送消息”这一更严重后果。

用户仍承受了明显的编辑成本：

- 第一次 Shift+Enter 已改变 Draft，但没有提供可信的视觉换行反馈；
- 第二次 Shift+Enter 才产生可见空行，使用户形成“必须按两次”的稳定认知；
- 下一次拼音的第一个字符落在错误的逻辑/视觉位置，输入法组合被打断或以拉丁字母提交；
- 问题在换行前后重复，让用户无法通过调整输入顺序稳定规避；
- 两次“已修复并安装”后仍复现，降低了用户对验收结论的信任，也增加了重复退出和重启成本。

## 发现与响应

用户首先提供了三个可观察症状和截图。调查从 IME 状态机入手，因为第一次 Shift+Enter 时出现候选条，
而代码也确实在 `compositionend` 后延迟执行 `syncNativeDom()`。第一轮修复为 composition reconciliation
增加 generation、editor identity 和当前 `isComposing` 校验；第二轮补上空编辑器文本 shell，避免第一个
原生输入替换无主 DOM。两轮都通过当时的单元测试、类型检查、打包和安装验证。

用户两次反馈“还是这样”后，调查不再把三个症状拆成独立按键问题，也不再以 synthetic composition
作为完成证据。新的最小反馈循环固定为：

```text
真实打包 Electron
  -> 清空 Composer
  -> 原生输入 123213213
  -> 一次 Shift+Enter
  -> 原生输入 n
  -> 同时读取 DOM、Draft、焦点和 editor identity
```

旧实现稳定得到 `123213213n\n`。这排除了“安装包仍旧”“Shift+Enter handler 没运行”和“必须先发生
host remount”等假设。随后用三个隔离 contenteditable 原型比较终端文本 LF、单个 BR、逻辑 BR +
caret BR，确认行框能修正插入方向，但 React-owned caret BR 会被浏览器删除并造成 ownership crash。
把 caret 宿主改成保留 DOM 身份的零宽 span 后，同一回归转绿。

最后使用真实腾讯拼音执行数字、一次 Shift+Enter、`n`、`i`。事件流证明组合从 `<br>` 后的 caret host
开始，旧 editor 始终存活。完成完整测试、daily package、签名/哈希校验和非终止安装后，才形成最终结论。

## 时间线

用户反馈与调查发生在 2026-08-26（Asia/Shanghai）。除构建和事件日志外，用户每次反馈的精确时间
没有作为结构化事故事件持久化，因此下表保持阶段顺序，不补造分钟级时间。

| 阶段 | 事件 |
|---|---|
| 初始报告 | 用户输入 `123213213` 后观察到 Shift+Enter 需两次、首拼音字母变英文，并提供候选条截图。 |
| 第一轮调查 | 定位 `compositionend -> requestAnimationFrame(syncNativeDom)` 可跨下一轮 composition；加入取消与 generation 防护。 |
| 第一次安装后 | 用户反馈“还是这样”，证明 stale frame 不是完整解释。 |
| 第二轮调查 | 补充空编辑器稳定 shell、原生首字符和 composition ownership 验收。 |
| 第二次安装后 | 用户再次反馈“还是这样”，触发重新定义最小反馈循环。 |
| 决定性红测 | 旧打包 App 一次换行后，原生 `n` 得到 `123213213n\n`；字符位于终端 LF 之前。 |
| 原型验证 | 原生 line box 修正落点；React-owned caret BR 被浏览器移除并触发 `removeChild` 冲突。 |
| 最终修复 | 使用逻辑 `<br>` + 零宽 caret host；更新 DOM 读取、长度、选区、placeholder 与 ownership 判断。 |
| 最终验收 | Electron 红测转绿；腾讯拼音产生真实 composition；560 项测试、类型检查、打包与安装门禁通过。 |

## 技术根因

### 模型换行被错误等同于浏览器行框

结构化正文以字符串 `\n` 表示换行，这是合理的领域模型。但旧 Renderer 直接把整个
`segment.text` 放入 React 文本节点，并依赖 `white-space: pre-wrap` 显示换行。这个策略对中间换行
通常可见，却没有保证终端换行后存在可容纳 caret 和 IME marked text 的 DOM 位置。

旧投影近似为：

```html
<span data-editor-segment="text">123213213\n</span>
```

逻辑选区可以声称位于 offset 10，Draft 也可以保存 `\n`，但 Chromium 的原生编辑算法仍要在 DOM
节点边界选择插入点。终端文本 LF 没有独立节点和末行 host，下一字符最终写到 LF 之前。

修复后的投影为：

```html
<span data-editor-segment="text">
  123213213
  <br data-editor-line-break="true">
  <span data-editor-caret-host="true">&#x200B;</span>
</span>
```

`<br>` 拥有一个逻辑字符长度；caret host 和 sentinel 长度为零。浏览器可以在下一行把原生输入写进
host，`readStructuredContent()` 会去掉 sentinel、保留真实字符，再由 React 投影为普通文本。

### DOM 所有权需要同时满足浏览器和 React

第一次原型修复使用第二个 caret `<br>` 来撑起末行。它解决了插入方向，却违反了另一条边界：
浏览器输入时会删除这个占位 BR，React 的旧 Fiber 仍认为它存在。下一次 commit 尝试再次删除同一节点，
触发 `NotFoundError`，整个 Renderer root 可能清空。

零宽 span 的关键不是视觉技巧，而是所有权协议：浏览器修改宿主内部文本，却保留 React-owned 宿主
本身；React 随后可以安全删除或替换仍在父节点下的宿主。`editorDomMatchesReactProjection()` 也把
caret host 视为可接受的 native mutation seam，而不是立即重挂整个 contenteditable。

### IME 状态机缺陷放大了现象，但不是字符落点根因

旧 `compositionend` frame 确实可能晚于下一轮 `compositionstart` 执行。若 DOM 不匹配，它会重挂 editor、
恢复焦点和选区，进一步打断 IME。修复后的 frame 携带 generation 和 editor identity，新 composition
会取消旧 frame，回调也会再次检查当前是否仍在组合。

这项修复是必要防护，但用户的决定性红测不需要发生跨代 frame：单凭终端 LF 和下一次 Chromium 原生
输入就能失败。因此 postmortem 将它归类为促成因素和独立缺陷，不把它继续称为最终根因。

## 促成因素

### 截图和真实代码缺陷共同强化了过早假设

候选条说明 IME 正在处理第一次 Shift+Enter；代码又存在明显的 stale frame 窗口。两项证据使“编辑器
在 composition 边界被重挂”成为高概率假设。这个假设值得修，但我们过早把“高概率且真实”升级成了
“已经解释全部症状”。

### 单元测试 seam 无法观察浏览器原生插入位置

原有 `StructuredMentionComposer.test.ts` 主要使用 `renderToStaticMarkup` 和纯函数测试。它能证明静态
结构、提交判断与 query 算法，不能挂载真实 contenteditable，也不能让 Chromium 决定字符插在终端 LF
的哪一侧。

### synthetic composition 证明了事件分支，没有证明平台行为

早期 Electron 验收通过手工 dispatch `compositionstart/input/compositionend` 修改 DOM。它能覆盖 stale
frame 和 ownership reset，却预先决定了 DOM 结果，因此绕过了浏览器最关键的 native editing algorithm。

### “打包成功”与“症状闭环”被混为同一层证据

类型检查、单测、签名、哈希和安装路径都正确证明新包被构建并安装；它们不证明新包修复了用户症状。
安装证据曾帮助排除“用户仍运行旧磁盘包”，但不能替代原始复现转绿。

### 第一次换行的视觉反馈与模型事实不一致

Draft 已包含换行，而 Accessibility tree 和可见末行没有稳定反馈。若只读取模型，会误判 Shift+Enter
已经完全正确；若只看截图，又会误判 handler 根本没有运行。必须同时观察模型、DOM 行框和原生插入点。

## 既有防护为何没有阻止事故

- `isComposing` 防护正确避免候选期间误换行或误发送，但不负责创建末行 caret box。
- `white-space: pre-wrap` 能显示多数文本换行，但不为 contenteditable 的终端 LF 提供可编辑 DOM 语义。
- ownership reset 能在浏览器包装或插入未知节点后重建 host，却不能安全处理已经被浏览器删除的
  React-owned descendant。
- 静态 Renderer 测试验证了字符串投影，却没有断言换行必须由原生 line box 表示。
- Electron 验收覆盖了 mention、selection、clipboard、reply 与 synthetic IME，没有“终端换行后下一次
  原生输入”的纵向切片。
- 打包和安装门禁验证了产物真实性，没有也不应该推断交互缺陷已修复。

## 不属于根因的事项

- 不是用户需要按两次 Shift+Enter 的产品设计；无真实 composition 时，一次按键应产生一个换行。
- 不是候选栏开启时 Composer 应抢走 Shift+Enter；组合期间按键继续归 IME。
- 不是 Draft 丢失第一次换行；旧实现已经持久化 `\n`，缺口在 DOM 行框和下一次输入落点。
- 不是旧安装包没有覆盖。最终调查前已比对运行路径、包体哈希和安装时间；决定性红测也直接在指定
  打包 App 上复现。
- 不是 Mention/Skill token 原子性本身破坏中文输入；本次最小复现只包含纯文本数字。
- 不是腾讯拼音单独违反事件规范；Chromium 原生输入在不经过第三方候选选择时也能确定性复现错误顺序。

## 解决与恢复

本次完成以下修复：

1. 使用原生 `<br data-editor-line-break>` 投影模型换行。
2. 为终端换行增加零宽 `data-editor-caret-host`，并从结构化正文、逻辑长度和序列化中排除 sentinel。
3. 更新 DOM selection offset/point 映射，让 BR 计为一个逻辑字符、caret host 计为零。
4. 让 native input 写入 caret host 后安全收敛为结构化文本，并保持 editor identity 与焦点。
5. 为 composition reconciliation 增加 generation、editor identity 和当前组合状态门禁；新 composition
   取消上一轮 frame。
6. 为真正空内容渲染稳定 shell，并更新 placeholder CSS，不再用 `:empty` 推断业务空状态。
7. 新增 `--ime-newline-only` Electron 验收：一次 Shift+Enter 后执行 Chromium 原生输入，断言 DOM、
   Draft、editor identity、focus 与错误集合。
8. 使用真实腾讯拼音复跑原步骤，确认下一行从第一字母开始进入 composition。
9. 完成 560 项测试、TypeScript 检查、daily macOS arm64 打包、签名/哈希验证和非终止安装。

## 纠正措施

状态反映本复盘发布时可用的证据。开放事项需要映射到当前维护计划；本复盘本身不创造新的产品合同。

| ID | 措施 | 责任角色 | 优先级 | 状态 | 证据或目标 |
|---|---|---|---|---|---|
| CIME-01 | 用原生 line break + 零宽 caret host 修复终端换行输入落点 | Camp Renderer | P0 | 已完成 | `renderEditorText`、DOM 读取与逻辑选区实现 |
| CIME-02 | 阻止 stale composition frame 跨入下一轮 IME 会话 | Camp Renderer | P0 | 已完成 | generation/editor/isComposing 门禁及单测 |
| CIME-03 | 增加打包 Electron 的终端换行原生输入红绿回归 | Desktop Acceptance | P0 | 已完成 | `--ime-newline-only` 在旧包红、修复包绿 |
| CIME-04 | 把“同一 editor、焦点保持、DOM 顺序、Draft 顺序、无 Renderer error”作为一个验收断言组 | Desktop Acceptance | P1 | 已完成 | `acceptImeNewlineRegression` |
| CIME-05 | 为受支持 macOS 输入法维护人工验收矩阵：纯文本、数字、连续换行、token 两侧、候选提交与取消 | Desktop QA | P1 | 已计划 | 测试文档与发布前清单 |
| CIME-06 | 评估可重复控制系统输入法的 macOS 专用自动化 runner，不把 synthetic composition 当作替代品 | Desktop QA | P2 | 已计划 | Probe 需记录 OS、输入法版本和候选状态边界 |
| CIME-07 | 为 contenteditable 变更评审增加 DOM 所有权检查：浏览器可能删除哪些 React-owned 节点 | Frontend Architecture | P1 | 已计划 | Renderer review checklist |
| CIME-08 | 在交互修复交付模板中区分 build/install 证据与原始用户症状转绿证据 | Engineering Process | P1 | 已计划 | PR 模板或开发指南后续改动 |

## 复发判据

出现以下任一情况即视为本事故复发：

- 没有真实 composition 时，一次 Shift+Enter 不能产生且只产生一个可见换行；
- 模型以换行结尾时，下一个原生字符落到该换行之前；
- 数字、英文、换行或结构化 token 之后的第一个拼音键未进入系统 IME composition；
- 浏览器输入会删除 React-owned caret 节点并引发 `removeChild`、重复字符或空白 Renderer root；
- composition 期间 editor 被旧 frame 重挂、失焦或恢复到上一轮选区；
- DOM、Draft 与可见正文对一次 composition commit 的计数不一致；或
- 回归只 dispatch synthetic composition，而没有经过 Chromium 原生输入路径。

候选栏真实开启时，第一次 Enter/Shift+Enter 被输入法用于确认候选本身不是复发；复发条件是 Composer
在没有真实 composition 时仍需要第二次换行，或应用破坏了下一轮组合宿主。

## 经验

输入法缺陷至少跨越三种所有权：领域模型拥有逻辑正文，React 拥有声明式节点，浏览器和 IME 在组合期
共同拥有可见 DOM 与 marked text。三者的字符串内容相同，不代表它们拥有相同的光标语义。

调试这类问题时，“状态机正确”与“字符落点正确”必须分别证明。事件日志可以告诉我们按键属于谁，
只有真实浏览器原生输入才能告诉我们字符最终站在哪里。最小反馈循环应从用户可见结果倒推：一次换行、
一个首字符、一个 editor identity、一个 Draft 顺序。任何没有覆盖这四项的绿测，都不足以关闭同类事故。

两次失败修复也提供了重要边界：修掉调查中发现的真实 bug 并不等于修掉报告中的 bug。每当用户说
“还是这样”，应立即把原始症状重新设为唯一终止条件，保留已证实的旁支修复，但撤销对根因已经闭合的
假设。

## 参考资料

- [Structured Mention Composer 实现](../../apps/desktop/src/renderer/src/StructuredMentionComposer.tsx)
- [Structured Mention Composer 单元测试](../../apps/desktop/src/renderer/src/StructuredMentionComposer.test.ts)
- [Structured Mention Electron UI 验收](../../scripts/accept-structured-mentions-ui.mjs)
- [Composer 样式与 placeholder 业务空状态](../../apps/desktop/src/renderer/src/styles.css)
- [桌面 UI 验收指南](../development/ui-acceptance.md)
- [本地开发与 App 隔离流程](../development/local-workflow.md)
