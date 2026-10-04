---
document_type: protocol-contract
contract: skills-rebuild-v2
authority: skills-source-configuration-selection-and-model-index
status: accepted
version: 2
last_updated: 2026-09-27
---

# Skills Rebuild v2

本版继承 [Skills Rebuild v1](skills-rebuild-v1.md) 的来源、队员配置、Skill 选择、模型索引、冻结输入和历史恢复合同；扩展 Windows 旧项目入口的显式清理，并以目录级发现缓存替代 v1 的 32 组上下文缓存。模型输入 revision、Migration 和数据库 schema 均不变化。

## 原生目录发现缓存

每个 Core 实例在现有发现模块内按规范化 Skills 目录路径共享原始元数据和扫描错误；存在的目录解析到实际路径，不存在的目录使用规范化绝对路径。缓存不保存 Camp、队员、Runtime 过滤结果或 Skill 正文。容量上限为 128 个目录，LRU 淘汰，扫描完成后 300 秒过期；空目录和部分失败沿用现有 `skills/errors` 返回形状。过期只在下一次读取时重扫，请求等待结果，同目录在途扫描只执行一次。

Runtime 来源目录顺序、用户／项目范围和禁用配置每次重新计算；Skill 的原始入口路径用于展示和执行，规范文件路径用于来源身份与目录复用。一次 Camp 手动刷新在请求内记住已扫描目录，每个目录至多强制扫描一次；并发请求复用在途扫描。Settings 和 Camp 选择器仍按需请求，普通启动、项目切换和 Camp 打开不触发原生发现；来源登记与执行前重新验证继续按 v1 合同执行。

## Windows 无 observation 的旧入口

旧投影 observation 可能已经为空，但登记过的项目根目录里仍留有 `.dsh/skills` 等旧目录副本。Windows 的 `diagnostics.check` 在只读模式下，对 `skill_projection_root_state` 中 `active` 且当前可规范化访问的根，检查每个已知 `SkillDeliveryGroupKey` 项目 Skills 路径下九个固定 Rovai Skill 名称。`legacy-skill-entries.entryCount` 计算不同的已记录入口与这些现存无记录入口之和；没有记录的目录也可使该项为 `attention`。不枚举任意项目文件名，不写项目、数据库或 root access 状态。

用户点击该问题的“清理旧入口”后，`skills.cleanupLegacyEntries` 除处理 v1 的 observation 外，也处理上述 Windows 无记录候选。每个候选在删除前重新检查 root `active`、可访问性、运行中 Run、精确 group 路径和普通目录树；不跟随 reparse point。准入后只删除该 Skill 目录，没有 observation 就不补造或删除数据库记录。其他名称、未登记项目、macOS 链接和普通投影 reconcile 继续遵守 v1。

这九个名称的目录内容可能已被用户修改；用户显式清理仍以名称和路径为准。失败或无法确认的候选保留，并在原有 `LegacySkillCleanupReport` 计数中反映；重复操作不得扩大到未知名称或路径。
