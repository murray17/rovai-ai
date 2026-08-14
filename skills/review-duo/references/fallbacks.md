# 降级与失败处理

只在正常 duo 流程无法继续时读取本文件。

所有降级必须可见。不要把缺少搭档、缺少 Spec、stale 或 partial 包装成完整双人通过。

## 无合格搭档

用户没有要求 duo-only 时，说明没有合格搭档，改为 `solo fallback`，当前队员先做 Standards 并锁定，再做 Spec 并锁定，最终明确不具备双人独立性。

Solo 没有 Standards request message ID，也不能 self-route。两轴仍按预算发送 public-only parts 与 manifest，但 manifest 的 request/locator 字段写 `not_applicable_solo`，Standards manifest 不带 `--to`；当前 Run 使用自己刚形成且尚在上下文中的 canonical 结果发布有界最终摘要。不得伪造 duo locator、向自己发送，或把 solo manifest 描述为搭档回传。

用户要求必须双人时停止，不虚构第二位 reviewer。

## 搭档拒绝或不可用

只有搭档明确拒绝、已不在场、无法接收、无法访问 snapshot，或请求明确投递失败时允许更换一次。

accepted 但暂时没有回复不属于不可用。

更换搭档后创建新的 Standards 请求。旧请求的迟到结果不能推进新请求。

## Send rejected / Accepted 无结果

Send rejected 时先读取 `rovai send --help` 修正一次。仍失败时按用户允许 solo 或 duo-only 决定降级或停止。

Accepted 无结果时保持 pending。允许发布一次等待消息、回答状态、让用户主动选择 solo 或取消。

不允许 sleep、轮询、自动代写、发明超时或静默替换搭档。

## 无 continuation、sender 或 reply relation

如果搭档回复无法回到 Review Lead，或无法确认它回复的是当前 Standards 请求，就不启动伪 duo；使用 solo fallback 或停止。

无法把 Standards 请求、Spec 或 final 任意挂到“启动”标记下面不是能力缺失；当前 Core 本来就只回复当前 Run 的触发消息。按本 Skill 的真实因果链执行，不新增伪 session 字段，也不寻找不存在的 reply flag。

## 缺少稳定 diff

没有 Git、PR 或稳定 patch 时，要求用户提供 patch、PR 或 commit range，或停止。

Dirty worktree 无用户已提供的稳定共享 patch/附件时，要求用户先提交或提供 patch，或选择 solo / 停止。Skill-only v1 不承诺创建和分发共享 artifact，不能声称完成同一 snapshot 的 duo。

## 缺少或冲突来源

Spec 缺失时 Standards 继续，Spec 为 `not_assessed`。

Spec 或 Standards 冲突时检查不受影响部分，冲突部分 blocked，引用冲突来源，不自行选更有利版本，最终通常为 partial。

## Stale 与超大 diff

旧结果可发布，但顶部标记旧 snapshot 与当前目标不同。用户要求当前结果时创建新启动消息。

超大 diff 使用稳定 Coverage Manifest 和 chunks。无法完整覆盖时设为 partial，列出 covered、limited、unreviewed、原因和不能排除的风险。不静默抽样，不增加第三位隐藏 reviewer。

结果正文与 diff 体量分别受控。每条发送先按 UTF-8 bytes 验证 30 KiB 工作上限；finding 按稳定轴内顺序分 parts，最后 manifest 列出 accepted part IDs 和 digest。任何 part rejected、缺失、超过 128 parts、locator 不唯一或 digest 不匹配时，把 transport 与轴状态降为 `partial`/`failed`，最终报告标记 `assembly partial`。不要用截断结果、recent history 或记忆补齐后声称 complete。

## Binary、generated 与测试

Binary 为 metadata only，generated 为 limited，vendor 通常 skipped，lockfile 检查 manifest consistency。

测试、build、lint 或 formatter 会修改 workspace 时不运行，标记 `not_run`，不编造结果。

## Partner 结果损坏

结构缺失但语义明确时只做格式整理。

无法确定 snapshot、finding 边界、severity、confidence 或 coverage 时，创建新的格式修正请求。仍失败则 Standards 为 partial 或 failed，不由 Lead 代填判断。

## 取消与后续修复

用户取消后停止，迟到结果不自动重开。

完成后用户要求修复属于新的写入阶段：重新确认 finding 和当前代码状态，不把原 review request 当作修改授权。
