---
document_type: ui-prototype-readme
status: design-review
target_version: v1.29
last_updated: 2026-08-27
---

# Workspace Diff Evidence UI 设计稿

这是 v1.29 terminal file-change presentation rows 与最终 `Workspace Diff` 的高还原度 HTML 设计评审稿。
修订稿采用最新结论：Runtime 文件变更只来自可靠终态 Evidence；一条 FileChange Evidence / Canonical
Activity 的 `changes[]` 直接扁平渲染为多条单文件行，不显示 Codex `apply_patch`，也没有“编辑了 N 个文件”聚合层。
Claude 原生 Edit 的成功 matching result 使用同一行形态，但展开只显示 exact old/new 片段，不显示推测行号或 hunk。
完整 Diff Review 只属于 Workspace Change Window。原型以当前 Camp Workspace、默认底部执行台、条件式
310px Inspector、Execution Drawer、Porcelain Day / Steel Night 和既有 evidence/diff token 为母版。

本目录不是实现证据。所有文件名、行号、执行和差异内容均为合成 fixture；当前实现状态仍由
[`v1.29 implementation-plan`](../../versions/v1.29/implementation-plan.md)拥有。

## 查看

从仓库根目录运行：

```text
python3 -m http.server 4173
```

然后访问：

```text
http://127.0.0.1:4173/docs/prototypes/workspace-change-window/
```

## 可评审交互

- 在“会话历史 / Workspace Evidence”之间切换；
- 在执行台“底部 / 右侧”两种既有承载位置之间切换；两处 Tool list 都占满 Run card 横向空间，且没有
  “共享工作区观察”；
- 切换“Codex 终态 / Claude Edit / 无可靠终态”：Codex 把同一 Activity 的两个 change 直接显示为两条“修改 xxx”文件行，
  Claude Edit 显示一条无行号的 exact mutation；无可靠终态会移除全部文件 presentation rows；
- 同时查看旧卡片 A 与新卡片 B；两张卡片都只显示 `Files Changed`、统计、顶格文件行和无边框的中性
  “View”方向提示，没有时间、“已保存”或底部运行说明；点击卡片上半区打开默认文件，点击文件行直接在
  同一 Review 中选中该文件；
- 在第一张 Workspace Evidence 卡片内展开第四个文件；
- 切换当前 Window 的 `complete / no_changes / unavailable / pending`，观察只有 `complete` 才新增会话卡片，
  其余状态不在执行台新增共享观察 UI；
- 展开现有“已执行 N 项操作”集合，再分别展开两条“修改 xxx”文件行查看各自的 inline patch；没有
  `apply_patch` 父行、文件数汇总、文件跳转或 Operation Diff Review；文件 Activity 与相邻 `pnpm test`
  都在同一通用集合内，组内行与 diff 顶格使用完整宽度；
- 切换 Porcelain Day / Steel Night；
- 选择文件并查看以白色上下文、浅绿新增、浅红删除为主的差异；仍带 `+ / −`、双行号和结构标签；
- 使用键盘完成场景、历史卡片、文件、状态和主题切换。

## 评审重点

1. `Files Changed` 卡片是否足够简洁；无边框“View”是否只作为方向提示，同时让上半区和每条文件行都成为
   清晰、无嵌套冲突的 Review 入口；
2. B 出现后 A 是否仍明显可打开，且 UI 没有重新读取当前工作区或依赖 Git ref 的暗示；
3. `no_changes / unavailable / pending` 是否真正不生成卡片，也不向执行台添加共享观察组件；
4. Workspace Evidence 是否始终表达共享 Window 的净变化，而不是“某位 Agent 的修改”；
5. `apply_patch` 与“编辑了 N 个文件”是否都已消失，`changes[]` 是否直接成为同级单文件 rows；
6. 每条“修改 xxx”文件行是否进入现有“已执行 N 项操作”集合并能独立展开 inline patch；组内顶格布局是否
   明显改善 diff 可读宽度，同时不暗示 presentation rows 是多条权威 Activity；没有可靠 terminal Evidence
   时是否真正不渲染入口、占位或推测结果；
7. 默认底部执行台与右侧承载是否都保持同一 Run / Tool 语义，并让 Tool list 使用完整横向空间；
8. 全宽 Review 是否只由 Workspace Evidence 卡片进入，并在临时收起 Inspector 后提供足够的 diff 空间；
   红/绿/白 Evidence 配色是否接近 Codex 的清爽阅读感，但仍属于 Rovai 的 token 与组件世界。

## 文件

- `index.html`：自包含结构与交互、双主题、响应式的 HTML 设计稿；
- `PROJECT_DESIGN.md`：生产映射、信息架构、状态矩阵与非目标。
