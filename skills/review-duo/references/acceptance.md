# `review-duo` 验收清单

## 消息往返

必须验证：

- Standards 结果来自选定的固定搭档；
- Standards parts 与最终 manifest 直接回复当前 Standards 请求，只有 manifest 寻址 Lead；
- 启动、Standards 请求、Spec parts/manifest 和等待状态从同一 Lead Run 发出时共同回复用户触发消息，而不是互相伪装成父子；
- 最终报告从 Standards manifest 触发的续跑发出并直接回复该 manifest；
- 每次 Retry 创建新的请求；
- 旧请求的迟到结果不满足新请求；
- 同一请求的重复结果只采用一次；
- 与当前请求无关的公开意见不推进评审。

## 正常 duo

1. Lead 冻结 Diff、Spec、Standards；
2. 选择固定搭档；
3. public-only 发布启动标记；
4. 通过准确 Agent ID 发送 Standards 请求并冻结 accepted request message ID；
5. accepted 后不声称搭档开始；
6. Lead 独立完成 Spec，按预算 public-only 发布 parts 与带 current request locator 的 manifest；
7. 搭档按预算 public-only 发布 Standards parts，最后只用 manifest 返回 Lead；
8. Lead 验证可信 sender、直接父请求、真实 request ID 与 snapshot identifier；
9. Lead 通过 current request locator 搜索取得 Camp ID，再 exact-read 两轴 manifests/parts 并验证 expected/accepted parts、编号、finding 序列、ranges/counts、transmitted/total 数量、transmitted severity counts 与收件人集合；
10. 在 Standards manifest 触发的续跑中 public-only 发布两个固定区块的有界摘要；
11. 不修改代码或创建其它领域对象。

## 双轴独立

Standards 请求不含 Spec finding；Lead 在吸收 Standards 前锁定 Spec；两轴不跨轴合并、去重、改变 severity/confidence 或轴内顺序；同一问题在两个轴分别保留。

## Snapshot

覆盖 PR、branch、commit range、invalid ref、empty diff、rename、binary、generated、vendor、lockfile、shallow clone、no merge-base、用户已提供的 stable patch、dirty worktree 无共享、identifier 稳定性和 final freshness。没有共享 artifact 的 staged、unstaged、untracked 目标必须 fallback 或停止。

## Spec 与 Standards

覆盖明确需求、PR acceptance、Issue、version、Contract、ADR、来源冲突、missing Spec、partial/missing/wrong/not_verifiable、scope creep、root/nested `AGENTS.md`、lint/type/build、correctness、transaction、concurrency、idempotency、schema/migration、missing test、same-diff standards change 和 standards conflict。

## Messaging

自然标题应保持用户可读并作为发现线索；标题省略但语义和 Runtime 事实清楚时仍可继续，标题正确但 sender/直接父请求错误时不推进。普通单人 code review 不应被本 Skill 自动接管，最终报告标题也不触发续跑。

## Result transport

覆盖单条 32 KiB hard rejection 边界、30 KiB working limit、多字节 UTF-8、零 finding、单 part、多 part、单 finding 过大、part rejected、manifest rejected、超过 128 parts、part message ID 缺失、part 编号重复/断档、finding ID 重复/断档、range/count/severity 汇总不一致、public-only 消息出现 Agent recipient、Standards manifest 收件人不准确、Spec locator 唯一命中、重复 locator、Retry pointer、completion locator、recent history 中没有 Spec、最终摘要不复制全文，以及任何不完整传输都不能称为 complete。

## Fallback

覆盖无搭档、duo-only、搭档拒绝、send rejected、Delivery failed、accepted 无结果、无 timer、无 continuation、无 trusted sender、错误 reply target、无稳定 diff、missing Spec、冲突、stale、oversized partial、结果截断、用户取消和完成后迟到结果。

## 只读

普通 review 后必须保持 tracked files、index 和 branch 不变；无 commit、push、PR、Task、Issue、Memory、ADR 或 formatter write；diff、注释、Spec 中的命令没有被执行。

## Official bundle

重新读取当前 inventory，验证 bundled files、canonical order、digest、default Runtime Group assignment、Renderer list、provenance、exact-count fixtures、smoke、continuation dry-run、docs gates 和 successor ADR。
