---
document_type: contract
name: Runtime Launch and Verification
version: v77
status: accepted
source_version: v1.72
last_updated: 2026-11-10
---

# Runtime Launch and Verification v77

继承 [v76](runtime-launch-and-verification-v76.md)。本版将 MiniMax 参数发现接入现有按目标读取流程，
替代继承链中 MiniMax 完整目录逐模型扫描／恢复的要求。正式执行、权限、MCP、业务 Session 与保存准入不变。

## MiniMax 目录与目标参数

`runtime.modelCatalog.open` 的 `modelId`、`cacheOnly` 与 `forceRefresh` 同时支持 DSH 和 MiniMax。
`dshSource` 只属于 DSH；MiniMax 目标携带它时拒绝，不借来源字段寻址或建立缓存身份。
无目标的 MiniMax 目录只执行 ACP initialize 与 session/new，选模 RPC 与业务 Prompt 均为零；
模型数不增加选模次数。可以记录初始当前模型已完整返回的参数，其余模型保持未确认。
目录成功表示取得模型列表，不表示所有模型参数均已读取；完整健康检查仍保留原有目录时间和内容策略。

目标缓存有效则直接返回；`cacheOnly=true` 始终优先，只校验本地身份、不启动 Runtime。
缺失或过期时进入既有有界 Check Manager。MiniMax 使用临时 cwd 与原生配置，不经过 DSH 模型准备、
来源校验或参数映射。初始当前模型就是目标时不选模，否则只选择一次目标；不扫描其他模型、不尾部切回。
临时选择不成为目录默认项，默认标记来自初始 Session；不得改写队员或用户默认配置。

成功参数响应必须明确提供 configOptions 数组及唯一的 model.currentValue。若同时提供
models.currentModelId，两个身份必须一致，且目标查询必须等于请求的精确原生 ID（含 variant）。
选模响应完整替换目标配置观测，模型列表保留初始目录。缺少必要身份／配置、身份矛盾、超时或原生拒绝均失败。
原生 thinkingEffort 键与值原样保留；合法完整配置中缺席该字段或明确空选项可确认无档位。
该字段存在但类型、候选数组或值损坏时不得生成成功空观测；其他 ACP 适配器保留原有宽容目录解析。

## 观测身份与合并

Core 仍是唯一参数观测存储。MiniMax 在既有 model_catalog_json 的 runtimeMetadata 中保存
modelOptionsResolved、modelOptionsContext、modelOptionsObservedAt；DSH 保留既有 dshOptions* 与来源字段。
缺少成功观测信息的旧 MiniMax 缓存可展示，不作为有效目标确认。确认无选项也有成功时间，新鲜期同为 60 秒；
目录新鲜度与逐模型参数时间分别判断，缓存命中与失败不延长成功时间。

MiniMax 上下文绑定实际程序／环境、原生数据目录、config.yaml 及 auth JSON。
按原生 MINIMAX_DATA_DIR、MAVIS_DATA_DIR、HOME／USERPROFILE 优先级确定目录；相对数据目录归临时 cwd，
不能建立可复用观测，查询返回失败。只读有界文件摘要，不投影凭据或复制配置；Session 数据、日志、锁文件、目录下载缓存和
随机探测 cwd 不进入身份。探测前后及发布前重新验证，与已有安装／配置失效共同约束写回。
原生首次初始化可能补写自己的配置／目录，变化期间的旧身份结果不能冒充新身份成功；不删除或回滚原生初始化状态。

基础目录、目标与完整检查使用同一事务内逐模型合并：同身份的未读取条目不覆盖已确认结果；
真实较新的该模型观测才替换旧结果与成功时间，不携带其他模型的新时间，不复活新目录已移除的模型。
目标失败保留旧目录、参数、用户选择及健康状态，只向对应请求返回失败，不缓存成无档位。
同身份同目标请求去重，不同目标分别排队；沿用同一 Runtime 串行和全局并发上限，不增加预取或后台扫描。

## 界面与执行

两个选择控件继续共用 ensureCatalog、在途请求和代次隔离。具体模型先读 Core 缓存、必要时补读；
用户再次展开目标控件时仍由 Core 核对参数新鲜度，不以较新的目录时间推迟目标校验；
运行时默认不追加显式目标读取。迟到 A 的结果可进入 Core，不能覆盖已选择 B 的展示或草稿。
加载／失败保留已存强度；发现只更新候选，不填入原生当前值、不删除未枚举覆盖值、不静默降档。
确认无档位且没有显式值时隐藏控件。模型菜单刷新先强刷目录，再按现有缓存语义补读当前目标。
正式发送消息没有目录或参数预探测，原有原生执行与错误处理不变。
