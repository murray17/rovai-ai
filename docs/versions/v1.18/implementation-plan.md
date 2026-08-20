---
document_type: implementation-plan
version: v1.18
authority: implementation-and-acceptance-status
status: complete
last_updated: 2026-08-20
---

# v1.18 Codex 执行台真实命令预览实施计划

## 1. 治理与展示合同

- [x] 冻结 v1.17，建立唯一 current v1.18 与 [V1.18-D01](decisions.md#v1-18-d01)；
- [x] 建立 Run Process Detail Surface v17，并同步 UI、Runtime Activity Registry 与文档路由；
- [x] 明确不修改 Evidence wire、Canonical classifier、数据库或其他 Runtime 的公开输入边界。

## 2. Renderer 实施

- [x] Codex structured read/list/search 保留中文语义标题，其他 `commandExecution` 使用脱壳后的真实命令；
- [x] Node inline/heredoc、复合 Git/Shell、路径/引号/Unicode 和多种 wrapper 使用同一确定性规范化；
- [x] 敏感 flag、assignment、Authorization header 与 `rovai send` 正文确定性脱敏；
- [x] Tool 行单行视觉省略，展开详情分别显示完整脱敏命令与公开输出；
- [x] 其他九 Runtime 的既有标题矩阵保持不变。

## 3. 验证与发布

- [x] Renderer 单测覆盖结构化中文标题、单命令、复合命令、Node inline/heredoc、脱敏与详情分区；
- [x] 通过 docs、TypeScript、Vitest、Desktop build、Runtime Activity UI 验收与 Impeccable detector；
- [x] 从治理提交 worktree 完成功能提交，fast-forward main 并 push；
- [x] 完成 macOS arm64 package、签名/架构校验与 `/Applications` 安装交接。

## References

- [v1.18 版本概览](README.md)
- [V1.18-D01](decisions.md#v1-18-d01)
- [Run Process Detail Surface v17](../../contracts/run-process-detail-surface-v17.md)
