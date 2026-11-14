---
document_type: contract
name: Runtime Launch and Verification
version: v92
status: accepted
source_version: v1.72
last_updated: 2026-11-14
---

# Runtime Launch and Verification v92

继承 [v91](runtime-launch-and-verification-v91.md)。本版分离 Goose 完整目录与目标模型参数查询，
省略新 Session 的重复默认设置。B/P 正文、投递位置、会话历史、权限、MCP、用量与平台资格不变。

## Goose 完整目录与健康

完整目录刷新沿现有受管 ACP 探测进程执行 initialize、`_goose/unstable/providers/list`
和 `_goose/unstable/defaults/read`，不创建或删除原生 Session，不调用模型 setter 或生成模型响应。
原生默认只标记 inventory 中实际存在的相同 Provider/model；缺失默认不猜测，也不补造模型。
目录条目不因 inventory 的 reasoning 标记而获得固定 effort 档位或“已读取参数”状态。
目录继续沿原有身份栅栏和缓存发布，不另建服务或直接读取 Goose 数据库。

健康检查需要 Session 能力时仍建立 Session，不能由纯目录成功推导 `session/new` 或认证成功。
它与目标参数探测创建的已知临时 Session，继续在同一原绝对期限内精确 `session/delete`；
失败、拒绝、未知 Session ID 与进程回收边界继承 v91。

## Goose 目标模型参数

目标查询只创建所需的临时原生 Session，按原生已报告的 Provider/model 选择状态决定是否设置。
已确认相同值时跳过；不同或未知时发送原生 setter，并用其最新返回决定下一步。
Provider 设置后若原生已经选择目标 model，不再重设 model；缺少返回快照使旧选择失效。
最终必须确认精确 Provider/model，不能把未确认或其他模型的参数记到目标上。
目标查询不发送 providers/list，不遍历其他模型；仅当前模型的原生 `thinking_effort` 是能力来源。
原生确认没有该选项可以缓存为空；查询失败不能解释为“模型没有档位”。

目标结果在现有目录事务内只更新该模型的选项与已有观察 metadata。
保留其他 Provider/模型、目录名称和原生默认标记，不推进完整目录的成功时间，不复活已删除条目。
完整刷新仍沿既有逐模型合并保留同配置、较新的有效参数观察；不增加参数存储或缓存管理器。

Renderer 复用 MiniMax/DSH 的目标队列、缓存预读、两个下拉的在途合并和迟到响应隔离。
已有完整目录可用时，选择或打开目标只读取该目标；完整目录缺失或过期时，先单独刷新目录一次，
再读取目标，不能把目标的局部结果作为完整目录使用。失败保留保存的原生选项。
三者的原生字段仍分别为 Goose `thinking_effort`、MiniMax `thinkingEffort`、DSH `reasoning_effort`。

## Goose 原生默认刷新

新 Session 已按 Goose 原生默认建立，成员选择 `runtime_default` 时不立即再次设置 `provider=goose`。
显式模型仍按 v91 省略已确认同值的设置。
Warm 以及精确冷恢复选择 `runtime_default` 时，保留原生 `provider=goose` 操作：
重新解析当前原生默认，并允许从显式选择返回默认，不将外部默认冻结为首次 Session 的值。
本版不改变默认配置的既有生效时机，不增加模型来源标记、配置哈希、文件监听或轮询器。
