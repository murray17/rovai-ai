---
document_type: ui-style-index
authority: renderer-ui-routing
status: accepted
design_direction: porcelain-day-steel-night
target_version: cross-version
last_updated: 2026-10-30
---

# Rovai AI UI 规范

先读根目录 [DESIGN.md](../../DESIGN.md)，再按目标读取以下最小文档集。
五套配色共享组件、交互和状态；全局规则不在页面文档中重复。

## 主题

- [主题注册、偏好解析与新增流程](themes/README.md)
- [Porcelain Day](themes/porcelain-day.md)、[Steel Night](themes/steel-night.md)
- [晨雾](themes/horizon.md)、[朝霞](themes/classic-red.md)、[绯夜](themes/ember.md)
- [新主题模板](themes/_template.md)

完整色值归主题合同与生产 Token block；组件使用语义 Token，不按主题分叉业务结构。

## 复杂组件

从[组件索引](components/README.md)读取目标合同：App Shell、会话、文件预览、Team、使命、
Automation、队员、设置能力、Mention、提醒、渠道与首次训练。
基础 Button、Input、Dialog、Popover 直接遵循 `DESIGN.md`。

## 页面局部 Brief

- [队员工作区](surfaces/member-workspace.md)
- [记忆工作区](surfaces/memory-workspace.md)
- [设置工作区](surfaces/settings-workspace.md)
- [运行监控](surfaces/runtime-monitoring.md)
- [新对话 Dialog](surfaces/new-conversation-dialog.md)

Brief 只补充页面信息优先级、构图与局部约束。没有匹配 brief 时读取现有组件与测试，不创建空占位。

## Web、Mobile 与平台

- [Web 连接恢复](host-web-connection-recovery.md)
- [远程连接设置](host-remote-connection.md)
- [Desktop/Web 对照与验收](host-web-parity.md)
- [Mobile WebUI](host-web-mobile.md)
- [Windows 展示与交互差异](windows-interaction-delta.md)

平台规则只拥有窗口、输入、系统主题和本机能力差异，不建立另一套产品结构。

## QA 与工作流

- [全部配色覆盖矩阵](qa/theme-matrix.md)
- [无障碍基线](qa/accessibility.md)
- [桌面 UI 验收](../development/ui-acceptance.md)
- [Coding Agent UI 与设计文档工作流](../development/coding-agent-ui-workflow.md)

修改 UI 后按[最小验证矩阵](../development/local-workflow.md#最小验证矩阵)执行检查。
原型按[本地原型规则](../README.md#本地原型)保存；不能替代生产组件验收。

## 权威边界

- Architecture / Contract 拥有领域、权限、持久化、Runtime 与恢复语义；从[当前决定路由](../decisions/CURRENT.md)进入。
- [当前版本](../versions/README.md)拥有范围、进度和实施证据；Version Decisions 保存决定理由。
- `DESIGN.md` 拥有全局设计；主题合同拥有完整 Token；组件合同拥有复杂交互；brief 拥有局部构图。
- 代码与测试证明实现。发现文档—实现漂移时指出双方与本次修复范围；`accepted` 不代表已完成验收。

## Runtime 平台路由

Runtime 入口消费 Core 的[平台准入](../contracts/runtime-platform-admission-v2.md)与[产品范围](../architecture/runtime-catalog-boundaries.md)。
设置、引导、队员选择和 CLI 使用同一准入。所有 Runtime 不展示 Preview／测试／实验标签或资格记录未齐备的提示，
仅呈现实际安装、登录与运行状态及可处理的错误；内部平台准入与诊断证据保留。
