---
document_type: version-overview
version: v1.52
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: complete
model_context_change: false
last_updated: 2026-09-06
---

# Rovai-ai v1.52：项目预览子文件独立恢复

前置：[v1.51](../v1.51/README.md)。本版本保留既有文件来源、Viewer、布局、权限和窗口内 Camp 恢复流程；只让已经
通过 Markdown、HTML 或 Patch 预览打开且位于当前 Camp workspace 内的普通子文件取得自己的稳定工作区来源。

## 范围与当前状态

- Main 在 `child_of_handle` 成功打开后，独立查询当前目录 Camp 的既有 workspace authority；只有子文件 canonical
  path 位于该根内且可形成无歧义相对引用时，才返回可选 `restoreRequest`。
- 独立来源固定使用既有 `camp_workspace` request，以 workspace root 为相对基准；不复用父 capability root、显示路径
  或 Renderer 目录，不新增 Core 方法、IPC、来源类型或授权范围。
- Renderer 成功安装时优先采用 Main 返回的恢复来源；同一 Tab 后续再由临时 child 打开时保留稳定业务来源，窗口
  快照因而可以在 A→B→A 后重验子文件。
- `previewKey` 与 Main 确认的稳定项目相对 source key 共同去重；同一项目文件从消息、工作区或预览 child 打开时复用
  冷 Tab 的稳定 ID，而不改变消息、附件或 Evidence 的来源语义。
- 父文件关闭、释放或删除不影响已经形成的子文件来源；A→B→C 每一层都直接指向 workspace root，不建立父链。
- 外部、临时、Root Grant child 以及系统应用格式不获得稳定来源；恢复仍无 reveal、系统启动、确认、选择目录或授权
  challenge 副作用。
- UI 结构、布局和文案不改；目标删除后的恢复继续显示既有居中轮廓与“找不到这个文件”。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.51 冻结为 historical；本概览、[实施计划](implementation-plan.md)、版本索引与前后链接建立唯一 current v1.52 |
| Decisions | 已更新 | [V1.52-D01](decisions.md#v1-52-d01)记录用独立 workspace locator 取代父能力链；CURRENT 已纳入导航 |
| Contracts | 已更新 | [File Preview v8](../../contracts/file-preview-v8.md)增加成功结果的可选独立恢复来源及安装、去重和失败边界 |
| Architecture | 已更新 | [File Preview Architecture](../../architecture/file-preview.md)同步 Main 独立 workspace 投影与 Renderer 稳定来源安装职责 |
| UI | 已更新 | [Camp 文件预览区](../../ui/components/file-preview.md)记录子文件跨 Camp 恢复与稳定 Tab 身份；布局、Viewer 和失败视觉不变 |
| Runtime Activity | 确认无需更新 | AgentRun Activity、Evidence 写入与执行台映射不变；文件预览仍是 Desktop 本地阅读行为 |
| Runtime compatibility | 确认无需更新 | 不改变 Runtime Adapter、协议、模型、平台准入或 Native Session |
| Documentation routing | 已更新 | 文档任务导航、Contracts/Architecture 索引、版本指针与当前决定导航均指向 File Preview v8 |
| Root README | 确认无需更新 | 项目定位、安装方式、平台与 Runtime 支持范围不受窗口内项目文件恢复增强影响 |

## References

- [实施与验收](implementation-plan.md)
- [版本决定](decisions.md)
- [File Preview v8](../../contracts/file-preview-v8.md)
- [File Preview Architecture](../../architecture/file-preview.md)
- [Camp 文件预览区](../../ui/components/file-preview.md)
