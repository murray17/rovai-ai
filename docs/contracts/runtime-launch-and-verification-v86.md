---
document_type: contract
name: Runtime Launch and Verification
version: v86
status: accepted
source_version: v1.72
last_updated: 2026-11-11
---

# Runtime Launch and Verification v86

继承 [v85](runtime-launch-and-verification-v85.md) 的目录、执行与恢复边界。
按 User sequence 86，仅将 Kilo 正式执行改为进程级默认 allow；Bootstrap、模型/effort、MCP、
生命周期、原生审批转交与平台资格保持。

## Kilo 执行进程默认权限

正式 ACP Host 的统一启动入口在通用/成员环境合并后、创建受管子进程前，固定写入：

```text
KILO_PERMISSION={"*":"allow"}
```

该值覆盖继承环境或成员环境中的同名变量，不写回用户配置文件、系统环境或已保存成员配置。
每个执行进程启动时设置一次；同 Host 的首轮、后继 Run 和 Steer 共用，不增加逐请求 ACP 设置或提示词指令。
健康检查和模型目录共用的环境配置入口保持继承值，不借此强制其权限。

Rovai 通过启动环境默认设置 allow，由 Kilo 原生加载、合并并执行。具体工具、Agent、项目规则、
插件与原生限制仍按 Kilo 的顺序和语义作最终判断；这不是所有操作必然免审批或免拒绝的保证。
原生仍发出的权限请求继续由共享 Approval 展示并回传用户选择，Core 不据默认值自动批准。

不恢复产品权限档位、权限 Hook 或 `KILO_PURE` 覆盖。旧成员的退役 permission 字段继续忽略，
其窄兼容与历史冻结记录保持。问卷及后台子代理开关独立保留，instructions 的有序追加不变。

## 展示与验证

权限行继续只读“原生规则”；已有点击说明准确呈现进程默认 allow，并给出具体工具规则示例。
具体交互由[队员配置 UI](../ui/components/member-identity.md#队员配置页)拥有，不增加用户通知。
官网不新增此权限策略说明，移除当前分支尚未发布的旧全局 ask 示例。
验证与未验证范围见[实施记录](../versions/v1.72/kilo-bulk-models-probe.md#user-sequence-86执行进程默认-allow)。
