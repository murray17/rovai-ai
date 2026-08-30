---
document_type: implementation-plan
version: v1.33
status: in_progress
last_updated: 2026-08-31
---

# Camp Fast 实施与验收

基线 `53d6e99a4662676cb7b3794681f1be74bf619b2f`；分支 `codex/fast-camp-member-mvp`。
用户已授权独立 worktree 实施、PR 到 main 并合并。原始下载原型仅作参考，后续修订的最小方案拥有范围。

## 实施

1. Migration 117、保存绑定代次、Camp preference、事务命令/receipt、异步检查 fence 和 Run freeze。
2. Claude 原生认证、单 settings argv、on/off/cooldown；Codex 原生 metadata、schema 能力门禁、每 Turn 覆盖。
3. Usage observed tier 优先级、未知撤回估价、原生成本保留。
4. 既有成员浮层、一次用量提示、默认恢复、焦点稳定、布局与隔离 Electron 回归。
5. 合同后继、版本切换、完整本地回归、独立复核、PR CI 与合并清理。

## Rust 测试准入

新增 owner 只覆盖此前不存在的合同，不为 UI 微调创建镜像测试：

| Owner | 修复前失败输入 / 独立性质 | 最小命令 |
| --- | --- | --- |
| `camp_fast` 原生资格纯函数矩阵 | 未知 auth、自定义 endpoint、缺模型 tiers 被误认为合格；两种原生输入形状分别拥有最低层 parser | `cargo test -p rovai-core --lib camp_fast::tests` |
| `camp_fast` 持久化生命周期 | 普通重测丢选择、切回旧绑定复活选择、Run 中途读到新覆盖；必须通过 SQLite/receipt/freeze seam | 同上 |
| `db` v117 migration | v1.29/schema 70 已有成员升级后丢绑定或被默认开启；新列/trigger 的升级是独立兼容入口 | `cargo test -p rovai-core --lib db::tests::v117` |
| `health` metadata 进程 seam | 原生检查未使用选定 executable/实际 cwd、丢 config includeLayers 或模型分页；纯 parser 不能验证进程参数和 RPC | `cargo test -p rovai-core --bin rovai-core health::tests::native_fast` |
| `claude` Session 观察 | 非当前 Session 的 Fast 结果污染状态，cooldown 被丢失；该新 metadata route 无既有 owner | `cargo test -p rovai-core --bin rovai-core claude::tests::native_fast` |

扩展既有 Claude session argv owner 覆盖新建/resume × 三态及单一 settings；扩展 Codex turn request/schema
owner 覆盖精确字段/省略/持久字段拒绝；扩展现有 pricing/monitoring owner 覆盖请求 Fast、实际 Standard 和
unknown 撤回。未删除、禁用或复制旧 Rust 测试。

## 验证记录

验证在隔离 worktree 进行，不启动日常 App，不使用日常 Electron userData。UI fixture 运行生产
CampWorkspace，通过关闭的模拟 API 供给数据，无 Core/SQLite/真实 Runtime；native auth/schema 只检查
metadata，不发起模型请求。完整检查结果在完成后记录。

本机边界：Claude 2.1.220 仅报告 `oauth_token`、订阅类型为空；Codex 0.147.0 标准与 experimental schema
均无 `serviceTierForTurn`。两者均按未知/不支持隐藏，不能宣称本机原生 Fast 端到端成功。
