---
document_type: ui-prototype-design
authority: directional-input
status: accepted
implementation_status: complete
target_surface: camp-conversation-drop-zone
design_direction: porcelain-day-steel-night
last_updated: 2026-08-13
---

# Camp 全会话区文件与文件夹拖入设计

## 1. 产品上下文

- **目标用户：** 在 Finder 中整理资料，并希望把文件或一个完整目录交给当前 Camp 队员处理的用户。
- **目标表面：** ordinary Camp 的主会话列，从消息时间线顶部到 Composer 底部；包括空状态、消息流、Agent 执行台、Approval Dock、Runtime Recovery Dock 与 Composer。
- **不属于目标：** 左侧导航、右侧 Inspector、执行过程 Drawer、Dialog、Popover、设置页和 Quick Chat 首页。
- **核心任务：** 用户不必精确瞄准 Composer；把 Finder 项目拖入主会话列任意位置，都能明确看到它们将进入当前消息草稿。
- **成功标准：** 接收范围一眼可辨、最终归属明确、原会话仍可阅读、不会把 Inspector 或导航误表现成放置区，Day/Night 使用同一 DOM 与 Token。
- **附件语义：** 普通文件保持现有 Prepared Attachment 语义；文件夹作为一个有层级的受管只读快照进入附件队列，不展开成多个顶层附件，也不保留原始本机路径。

## 2. 现有 UI 读取

- **视觉词汇：** Neutral Porcelain + Steel Day / Steel Night；开放阅读平面、克制结构线、低饱和 Steel 强调、紧凑附件卡。
- **必须保留：** 时间线的阅读连续性、消息流之后且 Composer 之前的 Agent 执行台、Composer 作为消息草稿唯一归属、右侧 Inspector 的独立边界、现有 52px 附件队列。
- **复用 Token：** `--conversation-surface`、`--input`、`--surface-raised`、`--brand`、`--brand-soft`、`--brand-ink`、`--line-strong`、`--shadow-float`、`--focus-soft`。
- **需要演进：** 当前只有 Composer 获得拖入描边和实色遮罩；接收面扩展后，反馈必须从“小输入框靶点”升级为“主会话列边界 + Composer 归属提示”。
- **避免：** 全窗口蒙层、把 Inspector 一并染色、过大的上传插画、云上传词汇、虚构扫描完成、绝对路径、渐变和高饱和蓝。

## 3. 设计方向

- **产品身份句：** 一个安静、可信、把本机内容安全交给协作队员的桌面工作区。
- **方向：** `Quiet Steel Landing Frame`——用一圈内收 Steel 接收框定义可放置区域，用紧凑居中提示解释动作，同时让下方 Composer 获得更强的归属描边。
- **不采用：** 整页内容模糊或大面积不透明 Dropzone；它会打断阅读，也会让拖入看起来像离开当前 Camp 的独立上传流程。
- **辨识重点：** 用户先看见“整个主会话列可以放”，再看见“内容会进入下方当前消息”。
- **保持安静：** 原消息、任务卡、审批内容不重排、不隐藏、不动画漂移。

## 4. 设计依据

1. **当前生产 CampWorkspace**
   - 转移：主会话列与 Inspector 的现有网格边界、790/1040px 阅读宽度、Composer 附件队列。
   - 不转移：当前只覆盖 Composer 的不透明放置遮罩。
2. **现有 Attachment Composer 原型**
   - 转移：拖入后进入同一 Draft、preparing/error 原位反馈、路径不外露。
   - 调整：原型曾要求反馈收敛到 Composer；本轮经用户确认扩展至完整主会话列。
3. **Porcelain Day + Steel Night 规范**
   - 转移：所有颜色来自既有 Token，同一 DOM 支持两主题，Steel 只承担稳定动作和结构强调。

## 5. 拖入画面

### 5.1 主会话列接收框

- 覆盖第一网格列的两行，即 `timeline-pane + conversation-controls`，不跨入 Inspector。
- Overlay 相对主会话列内收 `10px`；使用 `1.5px` Steel 虚线边框、`10px` 圆角和极弱 `brand-soft` 透明底。
- 时间线保持可读，只降低约 8% 对比；不使用 blur。
- Agent 执行台继续常驻于消息流之后，展示真实的每 Agent 过程入口和状态；接收框覆盖其所在主会话列，但落点提示不得遮挡执行台标题、队员入口或状态。
- Overlay `pointer-events: none`，不改变拖放命中或滚动结构。
- Inspector、左侧导航保持原色，借强结构分隔线明确“这里不是放置区”。

### 5.2 居中落点提示

- 位于当前可见时间线 viewport 的视觉中心，而不是整页文档中心；长会话滚动位置不改变。
- 使用约 `300 × 92px` 的紧凑浮层：`surface-raised`、1px `line-strong`、10px 圆角和克制浮层阴影。
- 左侧是文件叠放在文件夹前的 32px 线性图标，沿用现有文件夹线条语言；不使用云、上传箭头或插画。
- 主文案：**“松手添加到当前消息”**。
- 次文案：**“支持文件与文件夹 · 将安全复制到附件队列”**。
- 当 Drag payload 可可靠识别为单个目录时，次文案可变为：**“文件夹将保存为只读快照，原文件不会移动”**；无法识别时保持通用文案，不猜测。

### 5.3 Composer 归属反馈

- Composer 不再渲染覆盖输入内容的不透明 `.composer-drop-overlay`。
- 拖入期间 Composer 使用 `brand` 边框与 `focus-soft` 外环；输入内容、Mention、已有附件仍清晰可见。
- Composer 顶缘显示一个不占布局的 20px 小标签：**“将添加到这条消息”**，与居中提示形成目的地呼应。
- 不自动聚焦、不移动光标、不展开 Mention/Skill 菜单。

## 6. 放下后的连续状态

- `drop` 后接收框与居中提示立即消失，避免给人仍可撤回的错觉。
- Composer 附件队列原位出现 preparing 卡，保持 Finder 拖入顺序。
- 普通文件沿用现有卡；文件夹卡使用文件夹图标：
  - 扫描中：`项目资料` / `正在检查文件夹…`
  - 准备中：`项目资料` / `正在创建只读快照…`
  - Ready：`项目资料` / `128 个文件 · 18.4 MiB · 只读快照`
  - Error：原位显示有界原因，例如“文件数量超过限制”或“包含不支持的项目”。
- 文件夹卡仍计为一个顶层附件；内容层级由受管快照保留。
- 任一 preparing/error 项继续阻止发送，不允许部分发送。

## 7. 交互与边界

- 只有 `DataTransfer.types` 包含 `Files` 才进入拖入态；网页链接、选中文本、内部队员排序和普通 DOM 拖动不触发。
- 指针从主会话列进入 Inspector、导航或其他非接收表面时，接收态立刻退出并将 `dropEffect` 设为 `none`。
- 在主会话列任意子节点间移动不得闪烁；使用共享区域 drag-depth 或等价的稳定边界算法。
- Dialog、Popover 或执行 Drawer 打开时，底层会话列不接收 Drop；避免文件在用户操作浮层时意外进入草稿。
- Drop 不发送消息，只修改当前 Core-owned Draft。
- 跨 Camp 导航、Draft revision 串行化、数量/大小限制和失败保留继续遵守现有附件合同。

## 8. 可访问性与动效

- 进入有效接收区时用 `aria-live="polite"` 宣告：“已进入当前消息附件区域，释放以添加文件或文件夹。”
- Drop 后宣告准备项目数量；失败使用附件卡原位可读错误，不只依赖 Toast。
- 虚线、图标、文案和稳定位置共同表达状态，不能只靠 Steel 颜色。
- 显示/隐藏使用 `120ms` opacity；`prefers-reduced-motion` 下取消过渡。
- 拖放不是键盘等价入口；本轮不擅自增加回形针或文件选择器，这仍是后续可访问性产品决策。

## 9. 响应式与主题

- 接收框永远以实际第一网格列为边界；Inspector 在 310/260px 或收起时都不改变语义。
- 2K 宽屏只扩大阅读内容与 Composer，居中提示仍保持紧凑，不随列宽无限放大。
- 1040–1179px 窄布局缩小 Overlay inset 至 `7px`、提示宽度至 `280px`；文案不换成图标-only。
- Day 与 Night 使用完全相同的结构和透明度层级，主题差异只来自既有 Token。

## 10. 实现映射

- **主要文件：**
  - `apps/desktop/src/renderer/src/CampWorkspace.tsx`
  - `apps/desktop/src/renderer/src/styles.css`
  - `packages/contracts/src/index.ts`
  - `apps/desktop/src/preload/index.ts`
  - `apps/desktop/src/main/index.ts`
  - `crates/rovai-core/src/camp_attachment.rs`
- **Renderer：** 将 Drag listeners 从 `<form class="composer">` 提升到主会话列共享接收层；增加非交互 Overlay 和 folder preparing/ready 卡投影。
- **Core：** 文件夹必须在 Core 内安全遍历、复制、冻结和摘要；Renderer 不读取绝对路径或自行递归。
- **模型：** 附件需要显式 `kind: file | directory`、目录文件数和总字节数；不得用 MIME 字符串暗示目录类型。
- **文档：** ADR-0169 局部替代 ADR-0080 的“目录失败关闭”条款；Camp Attachment v1 与当前 UI 合同记录字段、安全和呈现。CampSnapshot 由 28 升为 29，v0.65 后续规划相应预留 30。

## 11. 设计稿交付与评估

- 交互式 HTML 同时提供 `idle / dragging-files / dragging-folder / preparing / ready / error` 状态切换。
- 至少输出 Day 1440×960、Night 1440×960 和 Day 1040×800 三张拖入态截图。
- 检查接收框不覆盖 Inspector；居中提示不遮住 Agent 执行台、Approval Dock 的关键状态与操作；Composer 归属清晰。
- 检查长中文文件夹名、混合文件和文件夹、空时间线、已有附件以及 Inspector 收起状态。
- 与当前实现比较：命中区域更宽、目的地更明确，同时不降低会话阅读性或制造第二个上传流程。

## 12. Packaged App 验收证据

`pnpm accept:conversation-drop-zone-ui` 在 arm64 macOS 打包产物中使用真实目录完成 Drop，并确认
Core 返回 `kind=directory`、`fileCount=3`、`mediaType=inode/directory` 与 ready 状态。验收同时覆盖
Day/Night、1440×920、1040×700、Agent 执行台可见、Execution Drawer 阻止底层 Drop、Inspector 与
“任务 / 队员”菜单不变、无横向溢出和原始绝对路径不泄漏。

- [Day 1440×920 拖入态](acceptance/conversation-drop-zone-day-1440x920.png)
- [目录只读快照 Ready 卡](acceptance/conversation-drop-zone-ready-directory.png)
- [Night 1440×920 拖入态](acceptance/conversation-drop-zone-night-1440x920.png)
- [Day 1040×700 紧凑拖入态](acceptance/conversation-drop-zone-day-1040x700.png)
