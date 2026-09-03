---
document_type: decision-governance
authority: version-decision-governance
last_updated: 2026-08-19
---

# 版本决策治理

本目录拥有 Rovai-ai 的决策理由治理。当前规范分别由 [Architecture](../architecture/README.md)、[Contracts](../contracts/README.md)、[`CONTEXT.md`](../../CONTEXT.md)、[UI](../ui/README.md)和 [Development](../development/README.md)拥有；版本 `decisions.md` 只解释为何作出重要改变，不是当前实现或规范真源。

## 文档模型

- 一个版本最多一份 `docs/versions/<version>/decisions.md`；没有重要决定时可以没有该文件。
- 一个文件可以包含多个相互独立的决定章节，不再执行“一项决定一个文件”。
- 当前版本使用版本内稳定 ID，例如 `V1.11-D01`。ID 只在该版本内递增、唯一且不可复用；禁止新增 `ADR-NNNN` ID。
- 当前版本目录由 [`docs/versions/README.md`](../versions/README.md) 的唯一 `current_version` 动态解析，不在治理脚本中硬编码。
- 版本变为 `historical` 后，其决定正文冻结。只允许追加标题明确的勘误，或者修复链接和元数据；不得根据当前实现重写当时的背景、选择、后果或被拒绝方案。

## 决定准入

只有以下三项全部成立，才增加版本决定：

1. 改变成本较高，未来修改会产生明显迁移、兼容、安全、数据、协议或组织成本；
2. 维护者仅看当前代码或规范无法理解为什么采用该方案；
3. 存在真实可行的替代方案，并因明确约束作出了取舍。

局部可逆实现、任务步骤、测试进度、发布清单、UI 微调、当前事实的重复描述，以及没有真实替代方案的结论不进入决策记录。它们分别留在代码、测试、当前 Version、UI 或无需长期记录。

## 当前规范同步

一项已确认决定改变当前系统语义时，必须在同一变更中更新真正拥有该语义的当前权威：

- 组件职责、权威边界、数据/控制流和进程关系：`docs/architecture/`；
- 字段、状态、Envelope、错误、幂等、并发、恢复和可测试行为：`docs/contracts/`；
- 领域术语和概念边界：`CONTEXT.md`；
- Renderer/UX 合同：`docs/ui/`；
- 开发与运维规则：`docs/development/`。

决定章节保留背景、最终选择、主要后果和真实替代方案，但不复制完整字段表、SQL、状态机、测试矩阵或实施清单。当前权威必须能在不读取历史决定的情况下独立指导实现。

## 当前决定导航

[`CURRENT.md`](CURRENT.md) 按稳定主题连接当前 Architecture、Contract、Context/UI/Development 入口和重要理由来源。它是人工导航，不创造规范，也不推断实现完成。

新增或修改当前决定时，必须把相应当前权威章节纳入导航；只有历史理由变化而当前语义不变时，不应制造新的当前规范。

## 数字 ADR clean break

独立、顺序编号的 ADR 已停止使用。迁移后：

- [`ADR-MIGRATION-MANIFEST.json`](ADR-MIGRATION-MANIFEST.json) 是一次性、自包含且不可扩充的迁移基线，保存原路径、完整 Front Matter、完整正文、hash、目标文件和目标锚点；
- [`AUTHORITY-COVERAGE.md`](AUTHORITY-COVERAGE.md) 把迁移时每份当前有效 ADR 的规范内核映射到当前权威章节，其 Front Matter 的 `resolution_source` 固定指向一次性迁移裁决；
- [`LEGACY-MAP.md`](LEGACY-MAP.md) 提供旧 ADR ID、来源版本和新位置查找；
- 各历史版本 `decisions.md#adr-NNNN` 保存经过确定性允许变换后的等价正文；
- 迁移基线 commit 和 Git 历史保存原文件形态。

这是文件 URL clean break：不保留逐 ADR stub，也不承诺旧 GitHub URL 可访问。历史内容、旧 ID 和来源可追溯，但旧路径兼容不属于目标。

Manifest 只证明本次迁移，禁止随着新版本或新决定扩充。历史 ADR block 与 Manifest 的规范化正文必须完全一致；勘误只能追加在 block 外，不得改写迁移正文。

## 历史勘误

历史版本需要勘误时，在文件末尾追加独立的 `## 历史勘误：<日期与主题>`，明确：

- 原表述和问题；
- 修正后的解释；
- 不改写原决定正文的理由；
- 可复核依据。

勘误不是新的当前决定。若当前语义发生变化，必须在唯一 current 版本增加新决定并同步当前权威文档。

## 自动治理

```bash
pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=<目标 base SHA> pnpm docs:check:ci
```

PR 的 `CI / gate` 使用 base commit 运行 diff-aware 检查；合并到 `main` 后不再自动重复执行。校验动态检查：数字 ADR 为零、版本决策元数据、当前版本内 ID、Manifest 自包含完整性、历史正文等价、Legacy Map 一一对应、覆盖处理方式与当前有效标志一致、当前权威类型/文件/fragment 精确存在、`replaced/retired` 与固定迁移裁决来源一一对应、CURRENT 链接、全仓 Markdown 本地链接/fragment，以及 historical decisions 的 Git-base 冻结。语义准入和规范内核是否真正完整仍是人工审阅责任，不能用关键词或行数启发式替代。
