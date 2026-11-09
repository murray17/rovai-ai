---
document_type: protocol-contract
contract: run-process-detail-surface-v59
authority: conversation-run-presence-surface
status: accepted
version: 59
source_version: v1.72
last_updated: 2026-11-02
---

# Run Process Detail Surface v59

继承 [v58](run-process-detail-surface-v58.md)，将会话执行条的停止保留与继续入口改为按取消状态判断。

- 公开 Run 为 `cancelled` 时，不再按 `cancelReasonCode` 筛选保留资格，统一显示静态“已停止”。
  App 退出取消、手动停止、其他取消原因及旧记录缺失原因时使用相同规则。
- 仍仅保留每位队员最新且尚未受理继续的公开取消 Run；私有单聊与正常成功不保留。
  普通 batch 失败、输入过大拒绝、缓存首屏门禁、位置、最终耗时与新 Run 替换规则保持。
- 取消行的图标“继续执行”同样不检查取消原因；仍要求公开 batch、原输入存在且不属于输入过大拒绝。
  沿用现有 User 授权命令、Core 准入与 `hasAcceptedContinuation`，受理后跨切群／刷新保持收起。
- “你已中断”历史标记继续仅对应手动停止；App 退出或其他取消原因不使用该标记。
  保留执行条期间仍不重复显示同一 Run 的历史标记。

取消原因继续原样保存。本次不改变 Core 取消、退出、恢复、清理、调度或模型上下文，也不增加自动续跑。
验证复用 presence 投影、产物 Renderer 与 `pnpm test:run-presence-ui` 的浏览器 owner。
