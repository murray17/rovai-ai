---
document_type: protocol-contract
contract: channel-storage-v2
authority: channel-credential-and-developer-session-storage
status: accepted
version: 2
last_updated: 2026-08-30
---

# Channel Storage v2 Contract

本合同继承 [Channel Storage v1](channel-storage-v1.md) 的 SQLite schema、Main-only API、秘密边界、账号原子连接、
普通发布 credential 事务和旧 `.bin` clean break。以下恢复规则替代 v1 中对应的启动检查与 completed 凭据恢复语义。
没有新增数据库字段或 Migration；`Data Contract v1.37 / projection schema 78 / Migration 124` 保持不变。

## 1. 飞书 Session 检查不等于失效

Main 内部 `FeishuDeveloperSessionService.inspect()` 返回封闭三态，不再使用 `null` 同时表达失效和检查失败：

```ts
type FeishuDeveloperSessionInspection =
  | { status: 'valid'; identity: FeishuDeveloperIdentity }
  | { status: 'invalid'; reason: 'missing' | 'expired' | 'identity_changed' }
  | { status: 'unavailable' }
```

- `valid`：在线读取完整且匹配保存身份的账号，并成功完成 Session revision CAS refresh。
- `invalid/expired`：页面明确进入可信 HTTPS 飞书/Lark 登录入口，包括该登录重定向导致的预期 `ERR_ABORTED`。
- `invalid/identity_changed`：在线完整身份与保存的 brand/user/tenant 不一致；不得先把新身份写入旧 Session。
- `invalid/missing`：本地没有 Session row；这不是读取存储失败。
- `unavailable`：SQLite 读取/保存、Cookie 恢复、网页加载、身份读取、CAS 冲突或过时检查等暂时无法确认的情况。

只有明确 invalid 才能触发 Core 的 account expire；该命令仍以 account/version CAS 原子更新状态并删除对应 Session。
unavailable 保留 SQLite Session 和当前账号，不调用 expire/disconnect，也不回退为重新扫码。需登录身份的发布操作此时
拒绝本次操作并允许稍后重试；已经拥有独立 App credential 的 Bot 不受影响。

恢复 Cookie 时可跳过已知到期的持久 Cookie；其他本地写入异常不能被当作成功恢复，下一次检查须能重试原 Session。
检查跨越账号切换或断开时，其迟到结果必须丢弃；refresh 只允许写入检查所属 Session 的 revision，不能覆盖新登录态。

## 2. 飞书 Bot 启动独立于后台账号检查

飞书 Host 先消费既有批量 published credential 查询，恢复可用 Bot 和消息 worker，再异步检查开发者账号。
后台网页慢、检查失败或账号状态更新失败都不得阻断、停止已恢复的 Bot。后台结果只有在 Host 仍运行、检查代次仍有效且
account/version 未改变时才能更新账号；用户连接、切换、断开和 Host 停止均使旧检查失效。

## 3. 钉钉 completed Bot 缺失凭据恢复

`completed` 只证明该应用曾发布成功，不证明当前 SQLite 仍持有 credential。显式重试必须先读取 exact credentialRef：

1. 凭据存在并匹配冻结 AppKey/Robot Code：直接恢复 Stream 和卡片验证。
2. 凭据缺失：验证当前开发者仍为 intent 冻结的账号，并核对 Bot 与 intent 的全部远端身份/ref；只读取原应用的
   App Secret、Robot 和原版本状态，经 Core 原子补写 credential 后恢复连接。
3. 凭据指向其他应用、绑定不一致、账号不匹配或原应用回读失败：本次操作 fail closed，保留原绑定供修复后重试。

凭据恢复复用 completed resume 的只读控制台路径，不创建 App、不上传头像、不重配权限/事件，也不创建或发布新版本。
读回或保存失败不进入 unknown-create 状态，不创建新 intent，不自动重建应用；后续重试仍使用同一冻结身份。

## 4. completed credential 事务例外

`channels.dingtalk.publicationIntent.storeCredential` 额外接受 completed intent 的原应用凭据补写。事务必须验证：

- expected intent version 精确匹配；
- intent 对应的 published Bot 仍存在，并匹配 agent/account/unified App/AppKey/Robot Code/credentialRef；
- 请求的 AppKey、Robot Code、credentialRef 与冻结身份一致，且没有其他 credential identity 冲突。

成功时插入/更新同一 credential row 并增加 credential/intent revision，保持 intent 的 `completed` 和
`lastCompletedStep`，不修改 Bot、Owner、App、版本、项目、Camp 或历史记录。任何拒绝整笔回滚。
这不是放开 completed 的一般状态转换；普通 advance 仍不能从 completed 重开发布。

## References

- [飞书渠道架构](../architecture/feishu-channel.md)
- [钉钉渠道架构](../architecture/dingtalk-channel.md)
- [Feishu Channel v2](feishu-channel-v2.md)
- [DingTalk Channel v3](dingtalk-channel-v3.md)
