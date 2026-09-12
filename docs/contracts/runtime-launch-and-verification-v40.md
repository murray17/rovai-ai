---
document_type: contract
name: Runtime Launch and Verification
version: v40
status: accepted
source_version: v1.58
last_updated: 2026-09-12
---

# Runtime Launch and Verification v40

继承 [v39](runtime-launch-and-verification-v39.md)。本版增加本机、按 Runtime Kind 保存的启动设置；
原有平台准入、协议、权限、模型与 Session 规则继续有效。路径选择不提升 Runtime 平台资格。

## 本机启动设置

Core 在 `runtime_startup_setting` 中拥有每种 Runtime 的单一配置。Migration 151 将精确的
v1.58 / schema 100 来源迁移为 v1.58 / schema 101；表、receipt 和 authority marker 同事务提交。
现有安装、队员、事件及历史运行证据不迁移到新的身份。配置不属于成员资料、Camp、公共事件或模型上下文。

```ts
interface RuntimeStartupConfiguration {
  programPath: string | null
  environment: { name: string; value: string }[]
}
interface RuntimeStartupSettings {
  runtimeKind: AdapterKind
  revision: number
  configuration: RuntimeStartupConfiguration
}
```

`programPath=null` 表示自动发现；明确保存该值后不再回退到旧 managed installation 的手动路径。
尚无设置记录时沿用已有发现行为，并在编辑器中呈现旧的显式安装路径。非空路径必须为本机绝对路径，
选中的文件须经既有入口验证。macOS 的官方 ZCode / Antigravity App bundle 归一到相应入口；ZCode
仍以官方 bundled script 和原生 Node headless owner 启动，不打开 GUI。Windows 继续使用既有受验证
command-shim 解析，不能退回任意 Shell 字符串。

显式路径是封闭候选：不可用、被移动或入口无效时报告缺失，不能静默切换到 PATH 中另一份程序。
“恢复自动”重新使用 App 的发现环境。环境变量中的 PATH 作为目标进程的 PATH，自动发现仍由
Runtime Search Environment 拥有；需要指定另一份程序时通过 `programPath` 选择。

## 环境与生效边界

变量名修剪首尾空白，采用 ASCII 字母或下划线开头，后续仅字母、数字、下划线；名字最长 256 字节。
名字不能重复，Windows 比较忽略大小写，Unix 保留大小写。`ROVAI_` 前缀由应用管理，编辑器拒绝覆盖。
最多 128 项，单值最多 65536 字节，总计最多 128 KiB；值保留空串和空白，拒绝 NUL。

配置由 Core 私有数据库持久化，只有 Desktop 的 owner 请求返回完整编辑值。公共事件、health、
目录、诊断和模型输入不新增环境变量字段；Debug 只输出变量数量。Renderer 默认遮蔽值。

新进程以继承环境为基础，叠加对应 Runtime 的设置，再应用协议所需的受管理字段与既有专属配置优先级。
例如 Qwen 的私有 Home、Kimi 专属 `KIMI_MODEL_*` 文件和 Built-in 绑定继续由原 owner 管理。
Grok、ZCode 等读取原生配置的代码使用同一 Runtime overlay；版本、显式检查、Fast 检查和正式启动
使用相应配置。不得调用 `set_var` 修改 Core 环境，不修改 Shell 配置、机器环境变量或其他 Runtime。

保存同时使该 managed installation 的旧 capability snapshot 过期、重置认证/可用性为未验证并推进安装与搜索代数。新的
Search Environment 是不可变快照；检查持有自己的快照，迟到结果继续受既有 generation fence 约束。
保存不调用 Fleet 强制失效或终止已有进程；当前进程及子进程继续使用创建时捕获的环境，下一次进程
启动使用保存的配置。重新启动 App 后从数据库恢复配置。

## Owner RPC 与草稿检查

Desktop allowlist 增加四个方法，不增加 Built-in 或 Agent CLI 操作：

| 方法 | 入参 | 结果和副作用 |
| --- | --- | --- |
| `runtime.startup.get` | `runtimeKind` | 返回当前配置和 revision；没有记录时 revision 为 0 |
| `runtime.startup.inspect` | `runtimeKind, configuration` | 对草稿执行路径发现与既有有界版本检测，不保存 |
| `runtime.startup.check` | `runtimeKind, configuration` | 通过现有 Check Manager 对草稿深检，不保存、不发布产品 Ready |
| `runtime.startup.save` | `runtimeKind, expectedRevision, configuration` | 格式与显式入口验证通过后原子保存，返回新配置与 revision |

保存不以认证、模型目录或深检成功为前提。并发编辑使用 revision CAS；旧 revision 不能覆盖不同配置。
当前值完全相同的重试返回已保存 revision，不推进代数。保存失败保留旧持久状态，Renderer 保留草稿并允许重试。

草稿结果仅返回 `status, executablePath, reportedVersion`。状态为 `missing / recognized /
version_unverified / authentication_required / ready / check_failed`；版本检查只证明相应浅检测，
不能以通用 `--version` 输出替代深层协议身份或认证验证。

草稿深检复用 Check Manager 的全局最多两项、每 Kind 最多一项、90 秒总 deadline 和进程树清理。
不同草稿不能合并到正在检查的产品配置；结果不覆盖安装快照、模型缓存或公共 checking/Ready。
Desktop 为此请求保留 95 秒响应窗口。用户编辑变化后不能展示较旧草稿的结果。

## 启动设置呈现

程序路径选择后自动浅检，结果紧邻路径；“检查状态”检查当前草稿。安装已识别但已知未登录时显示
“已识别程序，需要登录”，允许保存。环境变量按名字和值逐行编辑，默认不添加空状态解释或重复生效提示。

“放弃更改”和“保存”一直显示；初始、干净或提交期间禁用，发生内容变化后启用。
变量格式错误在提交时定位到对应行，不以无说明的禁用状态阻断保存。保存或放弃后回到禁用状态，
编辑回原值也视为干净。状态与格式化范围由[设置工作区](../../apps/desktop/.impeccable/surfaces/settings-workspace.md)约束。
