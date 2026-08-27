---
document_type: ui-prototype-readme
status: design-review
last_updated: 2026-08-25
---

# 执行台连续 Tool 聚合交互稿

这是一份生产实现前的高还原度 HTML 交互稿。它以当前 Camp Workspace、Inspector、Run Pulse、
ExecutionDrawer、Run stage 与 Tool 四轨为母版，只比较“最大连续 Tool 序列”如何收束为一条可展开摘要。

## 查看

直接打开 `index.html`，或从仓库根目录运行：

```text
python3 -m http.server 4173 --directory docs/prototypes/execution-tool-grouping
```

然后访问 `http://127.0.0.1:4173/`。

## 可评审交互

- 切换 A 当前操作、B 状态账本、C 最近轨迹；
- 切换运行中、全部完成、存在失败与等待审批；
- 点击“推进一步”，观察当前命令和计数原位更新；
- 在底部与右侧之间移动同一个 ExecutionDrawer；
- 切换 Porcelain Day / Steel Night；
- 点击连续 Tool 组查看全部 Tool 行，再单独展开某条 Tool 的完整公开结果；
- 在结果区按 Escape 返回对应 Tool summary；
- 收起 Drawer 后，从奥黛丽的 Agent 过程入口重新打开。

## 评审重点

1. **A 是否足够**：折叠时能否立刻回答“现在在做什么”，终态能否诚实表达成功与异常。
2. **展开层级是否自然**：组 summary → 全部 Tool 行 → 单条完整结果三层是否符合审计心智。
3. **右侧是否仍可扫读**：310px / compact 260px Inspector 是否优先保留当前命令和状态。
4. **位置切换是否可信**：底部仍保留普通 Inspector；右侧只在既有 Inspector 增加“执行”Tab，不生成第二套执行台。

## 冻结边界

- 分组只发生在 Renderer，并且只聚合同一 Run 内最大连续 Tool 序列；
- narration、plan、diagnostic、公开 failure 与 recovery blocker 会切断组；
- 展开组不批量读取或挂载完整结果；
- 失败、停止、等待审批和仅记录不能被“已完成”掩盖；
- 示例数据仅用于交互评审，不代表 Runtime 或 Core 能力。

## 文件

- `index.html`：自包含、高还原、双主题、底部/右侧可切换的交互稿；
- `PROJECT_DESIGN.md`：方案比较、生产映射、状态文案与交互边界。
