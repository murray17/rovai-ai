---
document_type: implementation-plan
version: v1.71
authority: version-implementation-and-verification
status: in_progress
last_updated: 2026-09-27
---

# v1.71 实施与验证

1. 原子升级通知来源、独立偏好与状态筛选；历史事实和游标不变、不补发。
2. 在 Core 以全部 Run Input、发布消息来源与 Delivery 结算判断一轮完成；不进入调度控制流。
3. 使命/任务实际状态转换同事务发出通知，用户操作、同状态、标题变化及命令 replay 不重复通知。
4. 三组设置、具体来源卡片、精确使命/任务/单聊导航、前台同 Camp 静默与按身份合并。
5. 定向验证、通用文档门禁、隔离 Renderer 验收、独立审查；提交 PR 并按 Principal 授权合入 main。

## 测试准入与边界

- 新纯 SQL owner `round_waits_for_all_inputs_fanout_and_transitive_deliveries_without_merging_a_camp` 使用生产投影 SQL
  和最小关系 fixture，拥有跨批次、多输入、fanout、waiting A2A、失败/取消及幂等的完成判断。旧 per-Run owner
  无法表示这一新图合同。最小命令：`cargo test -p rovai-core --lib notification::round_tests`。
- 新 extended owner `notification_model_upgrade_preserves_attention_and_preferences_without_backfill` 拥有唯一新增
  v1.70/schema 124 兼容入口，验证旧事实、偏好、游标、重启及破损结构拒绝。事务重建无法由纯字段测试证明。
  最小命令：`cargo test -p rovai-core --features extended-tests --lib notification_model_upgrade`。
- Mission/Task/Single Chat 沿用既有命令与私有 terminal owner，增加真实通知投影断言；导航沿用已有 viewed/顺序
  owner，终态小点期望替换为已发布 Agent 消息。历史通知读写不变量继续拥有独立旧数据 fixture：从真实 pre-175 schema 提取并重命名旧 CampTurn source adapters，仅为历史水合/ack/retention 构造事实，不恢复生产准入。新增 v175 逆向转换只供历史 migration fixture 使用，不是生产 downgrade。
- Renderer 沿用 settings/controller/navigation owner，覆盖状态筛选、来源问题、重复提醒、quiet scope、CAS 错误恢复、
  焦点与精确定位。Electron fixture 使用独立临时 userData，不读取日常数据库、不启动真实 Runtime。

## 验证记录

已通过定向通知历史/事务/保留 21 项、真实 Mission/Task/Single Chat/Delivery/导航 owner 5 项，Migration owner 另验证末尾 receipt 写入失败后的原子回滚、外键恢复与重启。前端完整 Vitest 214 文件 / 2222 项通过；类型检查与通用文档测试、基于 `af0e8e6f` 的 CI 文档门禁通过。

隔离 Electron 已通过真实设置保存/筛选/失败重试、三组布局、day/night/窄屏、卡片 quiet/队列/计时和精确 Run Portal。
新增任务/使命导航验收发现 compact 执行预览遮挡目标；已将两类导航纳入既有精确目标面板显露逻辑，复验进行中。
最终工作区检查、独立审查和 PR 状态仍待记录。未授权日常 App 安装，本次以代码、PR 和隔离验收交付。
