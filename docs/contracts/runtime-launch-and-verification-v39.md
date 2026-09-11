---
document_type: contract
name: Runtime Launch and Verification
version: v39
status: accepted
source_version: v1.58
last_updated: 2026-09-12
---

# Runtime Launch and Verification v39

继承 [v38](runtime-launch-and-verification-v38.md)。本版替代 Claude Code 的 help 别名目录，接入统一
Runtime Model Catalog；其他 Runtime、认证、Provider、原生权限、正式 Run 和 Session 恢复策略不变。

## Claude Code 非生成目录发现

Claude Code 深检继续检查版本、所需 CLI 参数和 `auth status`。帮助文本只证明参数支持，不能提供模型目录。
目录请求通过当前选中的原生 executable、现有 active PATH overlay 与继承环境执行：

```text
claude --print --input-format stream-json --output-format stream-json --verbose --no-session-persistence
```

只发送一个具有唯一 `request_id` 的 `control_request`，其 `request` 为 `{"subtype":"initialize"}`。
只有相同 ID 的成功 `control_response.response.response.models` 数组构成目录证据。其他 ID 的响应、
`system.init.model`、当前模型、日志和帮助文本均不得补造候选。空、缺失或不可解析的数组不能建立 Ready。
不发送用户消息、Prompt、工具批准、模型选择或生成请求；需要额外交互的初始化明确失败。

Probe 不覆盖原生 HOME、`CLAUDE_CONFIG_DIR`、Provider、认证、权限模式、model 或 settings；继承调用环境
和 cwd，与现有统一安装级目录作用域保持一致，不建立项目专属缓存。原生初始化可能运行用户配置的启动
hooks、联网读取账号目录或初始化本地状态；Rovai 只请求控制初始化，使用 `--no-session-persistence` 禁止
该探测会话持久化。临时验证必须从隔离验证调用方发起。单次握手 30 秒 deadline，stdout/行长/stderr 有界，
成功、拒绝、协议错误、EOF、超时和取消均由 `RuntimeProbeProcess` 清理进程树。

## 规范化与模型身份

统一 `ModelDescriptor` additive 增加可选字段：

```ts
description?: string | null
runtimeMetadata?: Record<string, unknown> | null
```

Claude 原生单条 model entry 原样保存在 `runtimeMetadata`；不得把周围的 account、命令、hooks 或完整初始化
响应写入此字段。它保留原生别名、`resolvedModel`、显示名称、描述及明确报告的能力；未知元数据只保留，
不推导权限或功能支持。旧 descriptor 无这两个字段时按缺失读取，其他 Runtime 的现有规范化行为保持不变。

- `value` → `id`，精确保留选择标识；`displayName` → `displayName`，缺失时使用原生选择标识。
- `description` 原样保留；显示名、标识、描述在选择器中分开呈现。
- 只从明确的 `supportedEffortLevels` 生成 effort 选项；`supportsEffort=false` 时不提供选项。
  不固定模型家族、不枚举 effort 值、不从别名或名称推断具体模型版本。
- 空或控制字符标识、重复标识及与内部 sentinel 冲突的条目拒绝整次目录，不静默裁剪成部分成功。
- Rovai 的“运行时默认”仍使用既有内部 sentinel；它不携带推测的模型能力，也不向 CLI 发送 `--model`。
  原生目录若返回 `value=default`，作为独立的原生显式选择保留，执行时透传该标识。
- 显式选择的实际执行仍透传 `--model <id>`，由原生 one-shot 进程确认参数结果。原生 `system.init` 的实际模型
  观察继续走现有 Run 状态/Evidence 路径，不回写候选目录或队员模型配置。

## Ready、缓存与失败

成功初始化、合法非空模型目录产生 `model.catalog.initialize` 能力证据；仅 help/auth 成功不再构成 Claude
当前 Machine Ready。新 snapshot 提交和执行前验证使用同一证据要求；旧冻结配置缺少证据时进入现有
Dispatch Preflight。

沿用统一安装快照、Check Manager、60 秒重检/24 小时过期、单飞刷新与失败 Attempt。升级前的 help 别名快照
没有原生 entry 证据，不能作为可选或 LKG 目录，也不能用于保存新的显式选择；队员已保存配置保持原值。
原生目录的 LKG 可以继续按统一 stale 规则服务；fingerprint 变化保留 LKG 时，模型 entry 证据仍可读取，
但不能证明新 executable Ready。

目录失败、当前版本不支持初始化、超时和异常响应均通过现有公开 Runtime failure 与 catalog
`unavailable`/`invalidated`/`expired` 状态呈现；没有硬编码 fallback。刷新失败只记录失败 Attempt，保留
上次原生成功时间和用户选择，不能刷新成功时间、把旧缓存冒充 fresh 或把当前模型当作目录。

## 验证

现有 Adapter 映射测试拥有任意模型标识、元数据、能力、未知 effort、损坏目录与序列化矩阵；统一缓存测试
拥有旧目录拒绝与 native LKG 状态；进程测试拥有无 Prompt 控制交换、精确关联、环境继承与错误清理。
真实 Runtime smoke 单独显式执行，仅证明该安装的初始化目录，不证明模型生成、配额或平台完整资格。
