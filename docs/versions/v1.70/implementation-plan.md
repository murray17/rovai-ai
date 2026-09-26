---
document_type: implementation-plan
version: v1.70
authority: version-implementation-and-verification
status: in_progress
last_updated: 2026-09-27
---

# v1.70 实施计划

1. 发布普通文件形式的 Rovai 受管 Skills，统一执行 Host 路径与安全同步；旧导入 Library、Revision 与项目入口留存，新 Run 停止项目投影，Core 启动不自动清理旧项目文件。
2. 新建队员 × 五项工具箱配置，迁移时所有队员只默认开启 `member-studio`，其余四项关闭；设置页按第九版交互稿提供即时保存、批量选择、完整说明和失败回退。
3. 只读发现各 Harness 的用户级与当前项目 Skill，支持来源身份、路径、部分失败和按 Core 实例有界缓存；Settings 只展示用户级，会话候选按全队并集。
4. 冻结消息局部来源与 Run 的 Skill 选择／解析；新 Bootstrap 与动态索引依已确认的 [Skills revision 5](model-context-change.md) 生成。追加 [historyHint revision 5](model-context-change-history-hint-additional.md)：保留 Skills migration 173／主线公开 30／10／7，新增 174／公开 31／10／8，claim 冻结 `P` 与额外可见消息判断；旧 Binding／Manifest 按原证据与字节有界恢复，分支专有冲突 173 不自动升级。
5. 同步当前 Architecture、Contracts、UI 和文档路由；按「诊断与修复」HTML 交互稿交付单项旧入口问题和显式统一清理，执行定向验证、文档门禁、隔离 App 验收与真实任务 Gate，并记录未覆盖的真实 Runtime 条件。
6. 既有 Skills PR #517 与 historyHint PR #529 已合入 `main`。撤回 #529 增加的“已有 Native Session 缺失 Bootstrap Evidence 即拒绝”判断，保留冻结复用和校验；验证受影响 Runtime 首轮、续轮与目标 Camp 现有重试入口，再经任务分支 PR 合入 `main` 并安装本机日常 App。保护运行中的 App 与日常数据，不把构建当作验收。

实施状态：进行中。2026-09-25 的新指令要求对 #529 的 Bootstrap 门禁回退执行真实 Runtime 首轮／续轮和目标 Camp 重试验证；此前停止测试的要求已被该指令覆盖。容量临界估算低估仍不在本次修复范围。验收、PR 和日常安装分别记录，安装不替代执行验证。

后续独立修复：按已确认的 [Charter 精简稿 revision 1](model-context-change-charter-simplification.md) 替换公开 Camp 的通用正文，去掉 `Authority boundaries` 小标题，等待队友规则只保留在正文末尾，CLI Contract 的发送回执说明保持原文。实际 Charter 与 Binding 兼容摘要均轮换至 16，旧 Bootstrap 和冻结输入不回写；验证结果见同一说明及 PR #534。

Windows 旧入口后续修复：本机已登记项目的 `.dsh/skills/cli-operations` 与 `.dsh/skills/memory-stewardship` 留在磁盘，而旧 observation 为零；修复前隔离测试中 `legacy_entry_count=0`、显式清理 `removed=0`。按 [D05](decisions.md#v1-70-d05) 扩展 Windows 只读诊断与显式名称清理，仅检查已登记项目、固定 group 路径和九个名称；普通 reconcile 与启动边界不变。定向回归覆盖无 observation 的 `.dsh` 及另一组目录、未知名称保留。

## 设置页还原修正（2026-09-24）

- Skills 和工具箱复用 MCP 分隔线的宽度、拖动、键盘、取消和复位逻辑，独立保存各页宽度；刷新、查看说明按交互稿恢复图标与字号。隔离 UI 验收脚本覆盖两页的真实指针拖动和边界、键盘、取消、复位、重新进入的宽度记忆、窄屏切换及按钮尺寸。
- Qoder 用户级发现补入 `~/.agents/skills`，与已有项目级 `.agents/skills` 对齐；`QODER_CONFIG_DIR` 只覆盖 Qoder 专属根，不替换共享目录。来源依据为 [QoderAI 的 Skill Discovery Reference](https://github.com/QoderAI/better-harness/blob/main/references/agent-customize/skill-discovery.md#qoder)。
- Rust 沿用 `runtime_directory_overrides_change_native_candidates_without_explicit_refresh` owner，将 Codex 的两个配置根输入扩展为 Codex/Qoder × 默认/两次覆盖根矩阵，并确认共享用户来源持续可见；保留原 cache invalidation 输入，不新增测试函数或数据库 fixture。修复前 Qoder 输入缺失 shared 项。最小命令：`cargo test -p rovai-core --lib native_skills::tests --features extended-tests`。

## Principal 正文寻址（2026-09-26）

- [x] Principal 已确认：无参数的合法正文提及可通知；复用显示名行首连续提及规则；参数与正文合并；PublicOnly 允许用户提及。
- [x] Principal 已确认：展示必须读取用户实际昵称；完成后以 PR 合入 main。
- [x] 实现共享解析、现有身份/通知投影、昵称与非前缀 Markdown；不改变 Bootstrap/CLI 文本与 Context 格式，不回写历史。
- [x] 执行定向 Rust、Renderer/quote、类型检查、文档门禁与默认 Rust workspace 验证；基线失败单独记录如下。PR CI 与合入结论以对应 PR 的 checks/merge 状态为准。

测试准入：新增纯函数 owner `principal_alias_uses_leading_clusters_and_merges_explicit_attention` 覆盖新寻址入口及其独立
位置/排除语义；原 Agent alias owner 无法表达 Principal 身份与显式 attention 合并。数据库效果扩展既有
`current_user_attention_is_orthogonal_atomic_and_replay_safe` 和 PublicOnly owner；不新增重复数据库 fixture。
最小验证命令：`cargo test -p rovai-core --lib principal_alias_uses_leading_clusters_and_merges_explicit_attention`。

验证记录：共享 parser、quote、attention/PublicOnly 和 slow alias owner 覆盖 Unicode 空白、混合提及、
重复通知去重、重放与引用；slow alias owner 的数据库断言同步到当前 `camp_message_delivery`，保留既有输入。
Renderer 的 213 个测试文件 / 2210 项通过，类型检查、Desktop/Web 构建及独立临时 userData 的 Electron
quote 选择/复制验收通过。共享 quote fixture 补入重复行首、实体编码碰撞、定义/引用语法变化和缩进昵称；
Standards / Spec 双向审核的问题修复后复验。

全量入口存在独立于此改动的基线失败：`pnpm test` 的两项 benchmark 断言仍引用已失效的 context 测试名和
v1.67 指纹，已在基线 `573a061f` 的独立源码归档中复现；默认 Rust workspace 的 runtime-platform
evidence owner 中 macOS register digest 与同一基线文档字节不符。相关输入文件与基线一致，本次不改写冻结证据。

## 侧栏按范围读取（2026-09-27）

按 Principal 修订后的 [D06](decisions.md#v1-70-d06) 实施，取代 Camp 中先前包含持久化分组变化记录的方案。
保留行、分组、完整快照；复用 Core 事务、camp_view_state 与现有刷新协调器；新增持久化表为 0。
三项 camp 字段、三个索引、事务触发器及一次回填清单见
[Storage migration](../../architecture/desktop-navigation-refresh.md#storage-migration)，接口见
[Navigation Read v1](../../contracts/navigation-read-v1.md)。正常读取不访问 event_log。

- 普通进入不发全局失效，首屏后只验证目标行；已读无变化不写、不发通知，回执直接返回权威行。
- 状态变化按行，用户活动/成员变化按组，SQL 返回该组前 N 条和总数；删除前取得所属组，删除后补位。
- 窗口外置顶按 ID 读取；漏通知/未知范围通过摘要完整恢复，保留现有聚焦/20 秒兜底。
- 使命使用独立失效提示；技能候选改为使用选择器时读取；不新增同步版本、日志或优先队列。

测试准入：新 migration owner `navigation_summary_migration_preserves_tables_backfills_and_rolls_back_with_events`
独立拥有 schema 124→125 的回填、表名集合不变、receipt 失败整体回滚、事件/摘要同事务及重启边界；必须用 SQLite，
既有 migration owner 不覆盖这三个事实。最小命令为
`cargo test -p rovai-core --lib --features extended-tests navigation_summary_migration`。
新 read owner `navigation_reads_no_history_and_scoped_work_does_not_grow_with_other_groups` 拥有跨组工作量边界，
在 SQLite authorizer 禁止读取 event_log 时验证行/组/完整/分页/已读；旧 CampOpen 容量 owner 不拥有侧栏查询。
增加 2,000 个无关 Camp 和 50,000 条历史事件后，行查询保持 320 VM 步，组查询 1,082→1,083 步（索引范围终止比较）。
最小命令为 `cargo test -p rovai-core --lib --features extended-tests navigation_reads_no_history`。
排序、已读、通知、窗口/旧响应和删除补位扩展既有 owner；v39 人工替换单个表的混合 fixture 直接验证其迁移边界，
不将保留后续 receipts 的混合 schema 伪装成可准入的当前数据库。支持来源的完整升级仍由现有 admission/upgrade owner 验证。

验证：默认 Rust workspace 430 项通过（1 项已有 ignore）；Vitest 初轮 214 文件/2,222 项通过，
同步主线 `762370b1` 后 215 文件/2,235 项通过；类型检查、Desktop/Web 构建通过。
生产 BusinessApp 的独立 Electron fixture 记录普通 A→B 请求，断言没有全侧栏、分组、使命或技能扫描及重复已读；
导航外壳、10 项 CampOpen 集成与按范围协调器测试通过。Migration/范围测试及终态/删除通知 seam 定向通过。
Node 组合中随 schema 升级的 Product Contract Fingerprint 断言更新为 125 并复验。

全量扩展不能报告全绿：剩余 v99 的旧 Bootstrap fixture 与 Task tool 的旧 version 断言，均在未修改基线
`54a1bb477fedaee26dfb40122a2be7a297ac6038` 的独立源码归档中复现同样失败；未改写旧冻结证据或 Task 合同。
使命板初轮 4/6 项集成通过，另 2 项停在项目选择器滚动断言，其中真实指针滚动失败亦在同一基线独立复现。
随后主线修正空项目 fixture 并合入移动端变更，任务分支同步后使命板 6/6 通过，保留首次失败记录。
这些结果与已通过的切换请求边界分开记录，不将构建或 RPC 耗时当作日常 App 点击到绘制验收。

隔离 Core 复测在同步主线前执行：基线 `54a1bb47` 与本次工作树均用 Debug 构建；同一新建 fixture（342 Camp、18 组、57,000 条
人工历史事件），每项 30 次请求。完整侧栏中位数 61.76→9.95ms，排在完整侧栏后的打开请求 38.47→13.24ms；
本次单行/单组分别 0.61/0.87ms。独立 CampOpen 中位数为 1.56→2.95ms，不能宣称打开本身也变快；本次确认的
收益是移除切换带起的全局历史聚合和无关读取。样本按阶段顺序执行，存在调度/缓存影响；RPC 结果不等于点击到绘制。
