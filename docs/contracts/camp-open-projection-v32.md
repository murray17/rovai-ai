---
document_type: protocol-contract
contract: camp-open-projection-v32
status: accepted
version: 32
source_version: v1.72
last_updated: 2026-11-07
---

# Camp Open Projection v32

继承 [v31](camp-open-projection-v31.md)。结构化消息新增 Core 已发布的 `project_file_reference`，
携带 threadId、rawReference、pathAtSend 与 labelAtSend，保留每次出现及正文位置。
历史显示由已保存字段计算短标签，复制与模型正文使用统一的完整路径 URI 投影，不读取文件来重建历史。

应用内打开历史文件时重新验证来源，并用 expectedPathAtSend 收紧目标；根或符号链接目标变化时不可换绑。
范围、封闭字段、字节预算及恢复见 [Project File Reference v1](project-file-reference-v1.md)与
[已确认 R1](../versions/v1.72/model-context-change-project-file-reference.md)。

## 公开执行列表的会话归属

沿用 [v31](camp-open-projection-v31.md#公开执行列表的会话归属)，本次不改变执行列表归属。
