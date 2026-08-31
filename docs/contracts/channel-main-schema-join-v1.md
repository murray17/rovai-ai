---
document_type: protocol-contract
contract: channel-main-schema-join-v1
authority: channel-main-migration-ledger-convergence
status: accepted
version: 1
last_updated: 2026-08-31
---

# Channel/Main Schema Join v1

本合同只规定并行分支已使用同一迁移编号后的无损汇合。Camp Pending、Fast、渠道凭据与 Bot 的业务合同不变；
准入、备份、副本迁移和原子切换继续由 [Desktop Runtime Availability v1](desktop-runtime-availability-v1.md) 拥有。

## 编号与来源

- 已安装渠道版的 Migration 116–125 保留原含义，不重排、不清空账号、凭据、Bot、Camp 或历史执行。
- 合并后的 126 安装 Pending Camp Input，127 安装 Camp Member Fast；这两个 additive schema 的 receipt
  不独立推进渠道 Data Contract。128 在渠道 125 与 126/127 全部完成后封闭为 `v1.39 / projection schema 80`。
- 原 main 的 `v1.33 / schema 71 / activity-v2 / through 117` 与
  `v1.34 / schema 72 / activity-v2 / through 118` 是两种显式受支持来源。
  原 main 的 117/118 分别是 Pending/Fast，不可误认成渠道的同号迁移。

## 精确准入与汇合

原 main 来源必须同时满足完整前置 ledger、精确 Data Contract/classifier、无渠道 schema，以及 Pending/Fast
表、索引、触发器与必要列的已知 shape。只匹配版本字符串、仅有部分 schema、缺失前置 receipt 或未知更高 receipt
均不得进入此分支；不做猜测性修复。

只在已获 migration ticket 的 staging copy 内重映射 main 117→126、118→127，保留原 applied_at 和所有业务行；
同一事务将渠道 marker 退回共享的 `v1.29 / schema 70` 起点，然后运行完整渠道迁移链。已映射的 126/127 不重建，
已有 Pending、编辑占用、Fast 选择、Runtime binding revision 与 Usage tier 原样保留。

126/127 可以先于低编号渠道 receipt 存在，因此中间渠道 checkpoint 必须可继续迁移；127 缺少 126、128 缺少完整
前置链均拒绝。只有 128 完成才是新的 current authority。失败不发布 staging copy、不改原 authority，也不创建空库。

## 验证归属

- `db` 的 in-memory schema admission 测试拥有 marker、缺失/替换 schema、混入渠道和未知 receipt 的拒绝矩阵。
- 既有 Pending/Fast migration tests 拥有新增 schema、默认值与原配置保留。
- 既有 `AuthorityMigrationRunner` copy/switch 测试覆盖旧主线、旧渠道、main Pending 与 main Fast 四种来源，
  证明原 Camp/Draft、渠道 credential/Session、Pending 和 Fast 绑定经过真实 ticket/copy/switch 后保留。
- 原进程中断与 unknown authority 测试继续拥有恢复与不覆盖边界，不用日常 SQLite 做验收 fixture。
