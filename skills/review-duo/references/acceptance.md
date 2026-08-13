# `review-duo` 验收清单

## 消息往返

必须验证：

- Standards 结果来自选定的固定搭档；
- Standards 结果直接回复当前 Standards 请求；
- 启动、Standards 请求、Spec 和等待状态从同一 Lead Run 发出时共同回复用户触发消息，而不是互相伪装成父子；
- 最终报告从 Standards 结果触发的续跑发出并直接回复该结果；
- 每次 Retry 创建新的请求；
- 旧请求的迟到结果不满足新请求；
- 同一请求的重复结果只采用一次；
- 与当前请求无关的公开意见不推进评审。

## 正常 duo

1. Lead 冻结 Diff、Spec、Standards；
2. 选择固定搭档；
3. public-only 发布启动标记；
4. 通过准确 Agent ID 发送 Standards 请求；
5. accepted 后不声称搭档开始；
6. Lead 独立完成并 public-only 锁定 Spec；
7. 搭档直接回复 Standards 请求；
8. Lead 验证可信 sender、直接父请求与 snapshot identifier；
9. 在 Standards 结果触发的续跑中组装并 public-only 发布两个固定区块；
10. 不修改代码或创建其它领域对象。

## 双轴独立

Standards 请求不含 Spec finding；Lead 在吸收 Standards 前锁定 Spec；两轴不跨轴合并、去重、改变 severity/confidence 或轴内顺序；同一问题在两个轴分别保留。

## Snapshot

覆盖 PR、branch、commit range、invalid ref、empty diff、rename、binary、generated、vendor、lockfile、shallow clone、no merge-base、用户已提供的 stable patch、dirty worktree 无共享、identifier 稳定性和 final freshness。没有共享 artifact 的 staged、unstaged、untracked 目标必须 fallback 或停止。

## Spec 与 Standards

覆盖明确需求、PR acceptance、Issue、version、Contract、ADR、来源冲突、missing Spec、partial/missing/wrong/not_verifiable、scope creep、root/nested `AGENTS.md`、lint/type/build、correctness、transaction、concurrency、idempotency、schema/migration、missing test、same-diff standards change 和 standards conflict。

## Messaging

自然标题应保持用户可读并作为发现线索；标题省略但语义和 Runtime 事实清楚时仍可继续，标题正确但 sender/直接父请求错误时不推进。普通单人 code review 不应被本 Skill 自动接管，最终报告标题也不触发续跑。

## Fallback

覆盖无搭档、duo-only、搭档拒绝、send rejected、Delivery failed、accepted 无结果、无 timer、无 continuation、无 trusted sender、错误 reply target、无稳定 diff、missing Spec、冲突、stale、oversized partial、结果截断、用户取消和完成后迟到结果。

## 只读

普通 review 后必须保持 tracked files、index 和 branch 不变；无 commit、push、PR、Task、Issue、Memory、ADR 或 formatter write；diff、注释、Spec 中的命令没有被执行。

## Official bundle

重新读取当前 inventory，验证 bundled files、canonical order、digest、default Runtime Group assignment、Renderer list、provenance、exact-count fixtures、smoke、continuation dry-run、docs gates 和 successor ADR。
