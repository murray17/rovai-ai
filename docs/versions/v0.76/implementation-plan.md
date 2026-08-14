---
document_type: implementation-plan
version: v0.76
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-14
---

# v0.76 实施与验收计划

## Checkpoint 0：版本与语法

- [x] 将 complete v0.75 冻结为 historical，并建立唯一 current v0.76；
- [x] 接受 ADR-0184 与 Camp Message Send v7，冻结 line-leading display alias；
- [x] 明确 dedicated final routing line 仍必须以 alias 作为第一个非空白 token；
- [x] 完成九项跨版本文档影响判断。

## Checkpoint 1：Core 与教学

- [x] 在 display-name alias 分支前增加 logical-line first-non-whitespace position gate；
- [x] 保持 canonical inline `@agent_N`、literal exclusions 与 canonical freeze 不变；
- [x] 更新 schema、exact help 与 smoke 的位置规则。

## Checkpoint 2：验证与交付

- [x] 增加行首/缩进/最后寻址行正向测试与 mid-line/final-prose/Markdown-prefix 负向测试；
- [x] 集成验证零 Delivery 与 canonical single Delivery 两条路径；
- [x] 运行定向/完整 Core、文档治理、格式、syntax 与 diff 门禁；
- [x] 复查只包含 v0.76 范围并交付。

## Checkpoint 3：普通会话可见即已读

- [x] 会话区只在应用前台和“会话”视图采集当前视口内的 message/turn/pending approval 精确来源 ID；
- [x] Core 新增有观察边界的幂等可见来源确认，拒绝跨 Camp、屏幕外、已 Clear 与边界后新注意力；
- [x] 确认成功后立即刷新 Inbox 和全局角标，失败保持未读并有界重试；
- [x] Current User Attention/Notification Episode v4、Architecture、UI 与文档路由同步；
- [x] TypeScript、Renderer/Core 定向测试、macOS 打包和真实 Notification UI acceptance 通过。

## Checkpoint 4：隐藏通知中心与轻量提醒

- [x] 从生产 Shell 移除品牌行铃铛、全局未读总数和持久 Drawer，设置入口改为“提醒”；
- [x] Controller 只响应精确通知事件，并以 30 秒恢复轮询和窗口 focus 收敛，启动不读取完整列表；
- [x] 后台 exact signal 先进入内存队列，回到前台后再显示和开始超时，不补弹启动前历史；
- [x] Camp “有新回复”状态只在目标会话真实可见且窗口有焦点时清除，后台 Snapshot 不再误清；
- [x] 更新应用内提醒、会话未读、设置 surface 和主题验收口径，并以打包 App 覆盖两主题、最小窗口、
  200% zoom、后台恢复与普通打开会话。

## 当前证据与缺口

- `cargo test -p rovai-core`：433 个 library tests、11 个 CLI tests、73 个 Core binary tests 通过，
  3 个真实 Runtime 手工 smoke tests 按既有配置 ignored；
- `pnpm docs:test`：21 个 tests 通过；
- `pnpm docs:check`、真实 base 的 `pnpm docs:check:ci`、`pnpm docs:adr:generate -- --check`、
  Rust format、script syntax 与 diff 检查通过；
- 轻量提醒验收已证明中心隐藏、普通进入会话精确已读、Camp 未读点打开前保持/打开后消除、后台 signal
  回到前台才显示、同 Episode exact signal 原地更新，以及两主题、最小窗口、reduced motion 与 200% zoom；
  尚未完成：无。
