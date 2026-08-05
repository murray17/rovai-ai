---
document_type: implementation-plan
version: v0.40
authority: implementation-plan-and-acceptance
status: in_progress
implementation_authorized: true
last_updated: 2026-08-05
---

# v0.40 实施与验收计划

> 当前门禁：设计与实施已获用户确认；完成全量回归和真实 Runtime MCP smoke 后方可晋升完成。

## Checkpoint 0：设计与权威切换

- [x] 确认 Cross-Camp History Search 的 Agent、Camp membership、Presence、删除和 Memory
  边界；
- [x] 确认 ContextManifest 冻结精确其他 Camp 集合、Camp 发现元数据与全局公开消息边界，
  实时授权只能收窄；
- [x] 确认 `camp.list`、`camp.search`、`history.search` 只返回 Top-K，不分页；
- [x] 冻结三个发现接口的 limit：`camp.list` 默认 20 / 最大 50，`camp.search` 默认 10 /
  最大 20，`history.search` 默认 15 / 最大 30；
- [x] 确认四工具只处理原始 CampMessage，不读取 Summary；
- [x] 确认 `item` 正文切片、`around` 可见条数邻域与有界前缀、`thread/timeline` sequence
  集合分页；
- [x] 确认任意 Thread 锚点、根解析与首次锚点包含语义；
- [x] 确认本期不扩展消息删除语义，只延续既有 tombstone 过滤；
- [x] 冻结搜索输入：`camp.search(query, limit?)`；`history.search` 额外支持 `campIds` 与
  CampMessage `createdAt` 日期范围；
- [x] 确认历史附件只返回元数据，不返回路径或内容，也不进入搜索索引；
- [x] 确认未上线 App 采用 clean break，不保留旧 Run、旧工具或旧字段兼容面；
- [x] 定义 Cross-Camp History Search、Cross-Camp History Fence 与 Camp Discovery Snapshot
  并更新 `CONTEXT.md`；
- [x] 起草 proposed ADR-0106；
- [x] 起草四工具精确 Schema、排序、响应预算、错误与授权执行顺序；
- [x] 起草 proposed ADR-0108，记录发现 Top-K 与 sequence 原文读取的模型表面；
- [x] v0.39 完成后将 v0.40 原子晋升为唯一 current；
- [x] 用户整体确认后冻结 [tool-contract.md](tool-contract.md)；
- [x] 接受 ADR-0106/ADR-0108，并维护 ADR-0051/ADR-0050 的局部替代说明；
- [x] 用户确认完整共享理解；
- [x] 用户另行明确授权进入生产代码实施。

## Checkpoint 1：Clean Break Migration 与 Cross-Camp History Fence

- [x] 使用实际下一个空闲 Migration 编号；不因文档版本号猜测数据库版本号；
- [x] 为 ContextManifest 增加明确 history fence version 与 global public-message boundary；
- [x] 新增由 ContextManifest 拥有、但不外键到 live Camp 的规范化 Camp Discovery Snapshot
  子表及必要索引；
- [x] 在 Manifest 物化的同一权威读快照内派生 AgentProfile、当前 Camp、全局边界、精确其他
  Camp 集合、冻结 title 和 `lastVisibleActivityAt`；
- [x] 旧终态 Manifest 保留为历史证据；旧 queued/running/waiting Run 以明确代际错误失败，
  不补写 Fence、不恢复旧工具；
- [x] 使已有 Native Binding 失效，保留 Rovai Conversation 数据但禁止下一 Run Resume 仍带
  旧 Charter/工具记忆的 Runtime Session；
- [x] Camp 删除、成员离开与 Presence removed 不改写 Snapshot，只让实时 join fail closed；
- [x] Inspector / Read Model 明确区分 legacy Manifest 与完整 History Fence，不把 proposed 设计
  展示成已执行事实。

## Checkpoint 2：授权深模块与 Top-K 发现

- [x] 以一个 Core-owned Camp History Retrieval 深模块集中拥有 Run 认证、当前/其他 Camp
  classification、Fence、实时授权、查询和统一错误；handler 不自行拼授权 SQL；
- [x] 实现 `camp.list` 的冻结名称 literal match、exact/prefix/substring 优先级、最近排序与
  Top-K 截断；
- [x] 实现 `camp.search` 当前 Camp 正文查询，以及 `history.search` 的 Camp 交集与
  `createdAt` 半开日期范围；
- [x] 复用 CampMessage FTS5 trigram 与 reference index；删除已无读取方的 `camp_summary_fts`、
  triggers 与 rebuild 分支，Summary 表和按区间组成逻辑保持不变；
- [x] 所有 query 作为 literal 处理并完整转义；少于 3 个 Unicode scalar 时在已授权候选中
  使用 substring scan；长短查询都最多评估 `limit × 8` 条已授权候选（`camp.search` 最多
  160，`history.search` 最多 240），并明确区分 `truncated` 与 `searchIncomplete`；
- [x] 相关性排序在授权、Fence、Camp 与日期过滤之后执行；跨 Camp tie-break 使用 message-sent
  global sequence，不把 title 当正文命中；FTS5 全局 `bm25()` 只能用于识别实现风险，不能
  作为返回排名，因为其 corpus statistics 包含未授权 Camp；
- [x] 合法但不可见的 `history.search.campIds` 静默移除，任何计数或 snippet 都不得先于授权。

## Checkpoint 3：统一 `camp.read`

- [x] 使用 mode-tagged strict union Schema 实现 `item`、`around`、`thread`、`timeline`，全部要求
  明确 campId，未知字段拒绝；
- [x] `item` 按 Unicode scalar 实现 4,000 字符正文切片、body length/truncation/next offset，
  并返回最多 10 项不含路径和内容的附件元数据；
- [x] `around` 按过滤后的实际消息条数选择前 5/后 10 默认邻域，始终包含锚点，不提供 cursor；
- [x] 集合模式保留逻辑 items，在 16,000 字符总预算内确定性分配最多 500 字符原文前缀，
  不因长正文丢条目；集合只返回 attachment count；
- [x] `thread` 接受任意可见锚点并解析 root；首次页包含锚点，后续 sequence cursor 严格排除；
- [x] `timeline` 的无 cursor before/after 分别从可见末尾/开头开始；显式 cursor 使用严格不等式；
- [x] thread/timeline 结果统一 sequence ASC，before 的 next cursor 取本页最小 sequence，after
  取最大 sequence，且只在 `hasMore` 时返回整数；
- [x] 所有不可见 Camp/消息、Camp-ID mismatch、越界、撤权、删除和 tombstone 统一为
  `camp.read_unavailable`。

## Checkpoint 4：Team MCP 工具目录原子切换

- [x] 删除五个 `context.*` 常量、输入类型、handler、catalog definition、alias、测试与旧参数
  parser；删除模型可读 Summary 路径和无读取方的 Summary FTS，但保留 Core 内部 Summary
  生成与上下文组成；
- [x] 新增四个 canonical definitions 与 strict input/output Schema，并加入统一 Team Gateway
  认证和 receipt envelope；
- [x] 同步换代 Attested Team protocol、built-in catalog digest、Antigravity alias map 与各
  Runtime tool projection；
- [x] Charter/description 只教“发现 Top-K → 稳定 ID 读取 → sequence 连续阅读”，明确
  `camp.list` 不搜正文、search 不搜 title、四工具不读 Summary 或附件内容；
- [x] 保证 `campId`、`messageId`、sequence 与 campIds 只进入定位/过滤层，不能进入 capability
  或授权派生。

## Checkpoint 5：回归、专项安全与文档晋升

- [ ] 覆盖当前 Camp / 其他 Camp、后加入、后离开、Presence removed、Camp delete、跨 Run
  sequence 重用和 ID 猜测矩阵；
- [ ] 覆盖边界后消息、边界后 rename、冻结最近顺序、空 Camp fallback 与同一调用事务一致性；
- [x] 覆盖中文 1/2 字、FTS literal 注入、`%`/`_`/`\\`、精确 reference、日期时区与半开边界；
- [ ] 覆盖 Top-K 无 cursor、相关性重排、短查询 scan bound、响应预算不丢集合项和 Unicode
  scalar offset；
- [x] 覆盖 around 计数、thread 任意锚点、四种首末页、严格 cursor、不连续 sequence 与
  hasMore/nextCursor；
- [ ] 覆盖附件元数据上限、路径/内容字段不存在、Summary 结果不可达与旧工具 unknown；
- [x] 通过相关 Rust tests、format、clippy、Team catalog parity 和至少一个真实 Runtime MCP
  smoke；
- [x] 用户确认后将 tool contract 设为 frozen、接受 ADR-0106/0108、更新 ADR-0050/0051 的
  supersession 注释；
- [ ] 只有完成验收并有事实证据后，才能把 implementation status 标记为 complete。

## 当前实施证据（2026-08-05）

- Migration v51、ContextManifest History Fence、Camp History Retrieval 深模块和十二工具目录
  已实现；旧 `context.*` 代码与 Summary FTS 读取路径已移除。
- `cargo test -p rovai-core`：292 个 lib tests 与 61 个 binary tests 通过，7 个手动 Runtime
  smoke 按测试标记忽略；`cargo clippy --workspace --all-targets -- -D warnings` 通过。
- `pnpm typecheck`、`pnpm test` 与 `pnpm build:desktop` 通过。
- `ROVAI_TEAM_BUILTIN_CATALOG=1 pnpm smoke:team-context` 使用 Codex CLI 0.146.0 完成真实
  credentialed Runtime 验证：十二个 canonical tools 均有完成 evidence，四个新 Camp 工具、
  Task、Memory、Hearth proposal 与 A2A leaf 全部成功。
- 本版本仍保持 `implementation_status: in_progress`，直到 Checkpoint 5 中尚未勾选的完整安全
  与分页矩阵被补齐，不以一次成功 smoke 代替全部验收。

## 最低验收维度

最终计划至少覆盖：实时授权、跨 Camp 隔离、边界封顶、冻结发现元数据、中文短查询、Top-K
截断、日期范围、timeline/thread sequence 边界与方向、稳定 ID 猜测、统一不可见错误、正文与
响应硬上限、附件路径不可达、旧工具 clean break，以及 Memory 边界不被静默绕过。
