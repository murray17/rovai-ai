---
document_type: protocol-contract
contract: channel-main-schema-join-v2
authority: channel-main-migration-ledger-convergence
status: accepted
version: 2
last_updated: 2026-08-31
---

# Channel/Main Schema Join v2

本合同保留 v1 的来源识别、编号与业务数据语义，只将汇合执行位置改为精确原 authority 的逐版本事务。
租约、票据、原位迁移、有限重试与旧 manifest 恢复由
[Desktop Runtime Availability v2](desktop-runtime-availability-v2.md)拥有；不建立渠道专用 migrator。

## 编号与来源

- 已安装渠道版 Migration 116–125 保留原含义，不重排、不清空账号、凭据、Bot、Camp 或历史执行。
- 126 安装 Pending Camp Input，127 安装 Camp Member Fast；两个 additive receipt 不独立推进渠道 Data Contract。
  128 在渠道 125 与 126/127 全部完成后封闭为 `v1.39 / projection schema 80`，这一历史含义不变。
- 后续 129 独立移除重复 Evidence 索引并推进 `v1.40 / projection schema 81`；不能把 128 改写成 129 的合同。
- 原 main 的 `v1.33 / schema 71 / activity-v2 / through 117` 与
  `v1.34 / schema 72 / activity-v2 / through 118` 是两种显式受支持来源。
  main 的 117/118 分别是 Pending/Fast，不可误认成渠道的同号迁移。

## 精确准入与原位汇合

原 main 来源必须同时满足完整前置 ledger、精确 Data Contract/classifier、无渠道 schema，以及 Pending/Fast
表、索引、触发器与必要列的已知 shape。只匹配版本字符串、部分 schema、缺失前置 receipt、混入渠道或未知更高 receipt
均不进入此分支；不做猜测性修复。消费票据后、任何写入前再次核对来源与全部 receipts。

只在已获 migration ticket 的 exact READ_WRITE/NOFOLLOW、无 CREATE 连接上重映射 main 117→126、118→127，
保留原 applied_at 和业务行；同一 IMMEDIATE 事务将渠道 marker 退回共享 `v1.29 / schema 70` 起点。
之后运行同一既有渠道迁移链，已映射的 126/127 不重建；Pending、编辑占用、Fast 选择、Runtime binding revision
与 Usage tier 原样保留。不创建 snapshot/backup，不替换或改名主文件，不改变业务 ID。

126/127 可以先于低编号渠道 receipt 存在，因此中间渠道 checkpoint 必须仍可准入和继续；127 缺少 126、128 缺少完整
前置链均拒绝。128 提交前以 schema metadata 复核关键表/列/索引/trigger，129 继续自己的唯一约束验证。
每一步的 schema/data/marker/receipt 原子提交；失败只回滚当前一步，先前 receipt 留待重启后继续，不回滚整库历史。

正常迁移后重新 admission，只能精确重开已达 current 的同一 main；若仍有缺失 migration 就继续链。
阻断或原 authority 消失均不建立空库。旧 manifest 兼容恢复仍独立保留，不是新升级的第二条策略。

## 验证归属

- `db` 的最小 in-memory admission 矩阵拥有 marker、缺失/替换 schema、混入渠道和未知 receipt 的拒绝。
- 既有 Pending/Fast migration tests 拥有新增 schema、默认值、原配置保留和缺失关键对象时拒绝 contract seal。
- `AuthorityMigrationRunner` 原有完整 fixture 改为原位升级 owner，覆盖旧主线、旧渠道、main Pending、main Fast 与
  joined-128 五种来源；同时验证 main 对象不变、业务/credential/Session 保留、无新 snapshot/manifest/backup。
- 原子失败测试覆盖当前步骤 DDL/receipt 回滚、之前步骤保留与恢复；真实强杀覆盖 receipt 重映射后、126 提交后，以及
  旧 snapshot 切换前后两侧。路径漂移和重开期间换库必须拒绝，Lumen 来源不产生 Rovai 空库。
- 所有 fixture 为隔离临时数据，不使用日常 SQLite 或真实渠道凭据。

## References

- [V1.36-D06：原编号汇合理由](../versions/v1.36/decisions.md#v1-36-d06)
- [V1.36-D07：原位事务取代默认快照](../versions/v1.36/decisions.md#v1-36-d07)
