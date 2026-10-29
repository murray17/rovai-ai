---
document_type: protocol-contract
contract: run-process-detail-surface-v57
authority: conversation-run-presence-surface
status: accepted
version: 57
source_version: v1.72
last_updated: 2026-10-29
---

# Run Process Detail Surface v57

继承 [v56](run-process-detail-surface-v56.md)，补充手动停止后的会话执行条与图标继续入口。

## 保留与收起

- 公开 Run 的 `status=cancelled` 且 `cancelReasonCode=user_requested_agent_run_stop` 时，
  会话执行条保留为静态“已停止”。仅保留该队员最新且尚未受理继续的 Run；私有单聊、其他取消原因
  和正常成功不新增保留条。普通公开 batch 失败继续沿用同一最新 Run 规则。
- 手动停止是既有取消终态，不新增 paused 状态。“已停止”使用既有静态停止图标；耗时取
  `startedAt` 至 `endedAt`，停止后不再增长，缺失可信时间时省略。
- 执行条沿用同一 Run 的最后公开回复或完整产物组；尚无输出时留在原启动锚点，不创建空消息或产物。
  紧接自己输出时省去重复身份。显示保留条期间，同一 Run 的“你已中断”历史标记不重复显示；
  保留条收起后，原消息／产物的历史标记仍可查看。
- 点击继续收到 Applied 后立即收起；权威 `hasAcceptedContinuation` 负责切群和刷新恢复。
  缓存首屏不提前恢复失败／停止条。继续已受理但尚未生成 Run 时不制造执行占位；新 Run 生成后
  只显示新 Run，正常完成后移除。每次主动继续的命令身份与未知回执核对沿用
  [AgentRun Continuation v4](agent-run-continuation-v4.md)。

## 图标操作与其他状态

- 停止条的“继续执行”与失败条的“重试”只显示既有 refresh 图标；悬浮标题和可访问名称保留各自文案。
  入口使用原停止按钮的位置及 28px 点击区，粗指针为 44px；可见键盘焦点保持。
  提交时禁用按钮并在原图标位置显示忙碌反馈，不改变行高或插入提交文字。
- 继续入口遵守现有公开 batch、原输入存在及输入过大拒绝限制；Core 继续负责成员、消息和会话准入。
  原 Run、公开消息、草稿与原输入保持不变。`failure.retryable` 不替代既有用户继续授权规则。
- `context_payload_too_large` 保留输入位置的详情入口，即使已有较新 Run；不提供对原输入的重试按钮。
  普通失败保留原错误详情，未受理或明确拒绝时仍可操作。
- 未形成 Run 的 Delivery 只沿用消息回执／执行台准备与排队展示；已创建 queued Run 和初始化显示
  “启动中…”。运行、审批等待、恢复等待、停止请求提交及成功收起均沿用既有规则。

不新增 Core 字段、持久化状态、调度规则或模型上下文。验证由既有 presence 投影单测、产物 Renderer
单测与 `pnpm test:run-presence-ui` 的真实组件浏览器 owner 覆盖。
