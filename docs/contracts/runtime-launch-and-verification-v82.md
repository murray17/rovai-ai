---
document_type: contract
name: Runtime Launch and Verification
version: v82
status: accepted
source_version: v1.72
last_updated: 2026-11-10
---

# Runtime Launch and Verification v82

继承 [v81](runtime-launch-and-verification-v81.md)。Kilo 的逐模型 `effort` 目录复用
[v64 的健康／完整目录分离](runtime-launch-and-verification-v64.md#minimax-健康结果与完整参数目录)，
该部分原先仅限 MiniMax 的规则扩展到 Kilo；其他 Runtime 保持。

完整 `CatalogOpen` 在既有临时探测 Session 中逐个选择原生模型 ID，读取该模型实际返回的 `effort`，
再恢复初始模型。初始模型直接保留首次返回的选项和当前值，不重复选择后覆盖它的默认档位。
查询不发送 `session/prompt`，不修改成员的执行 Session 或用户全局默认模型。
没有档位时保持空选项；单个候选拒绝选择、返回其他模型或选项不足，不丢弃其余有效目录，
也不把当前模型档位复制到未观察的其他模型。

普通检查不遍历模型。Check Manager 区分两种意图，同目标／同意图仍复用；
首次目录请求需要完整检查回退时，仍完成逐模型读取才发布目录成功。
已有完整目录和成功时间不被同一有效身份下的部分健康结果覆盖；
失效目录不因部分结果恢复有效，也不使用健康成功时间补推完整目录成功。
沿用既有缓存、检查时限、失败保留及身份失效规则，不新增缓存、字段、队列或探测管理器。

目录仍只服务展示，显式模型和参数的保存、冻结、原生执行及未知值处理遵循
[v74](runtime-launch-and-verification-v74.md)。Kilo 使用 `effort`，MiniMax 使用 `thinkingEffort`；
两者共用收集和投影流程，原生参数不做别名推断。其他输入、权限、Steer 和平台资格保持。
实施及实际范围见[模型选项记录](../versions/v1.72/kilo-model-options.md)。
