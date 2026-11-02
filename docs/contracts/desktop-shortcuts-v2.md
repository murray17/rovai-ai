---
document_type: protocol-contract
contract: desktop-shortcuts-v2
status: accepted
version: 2
source_version: v1.72
last_updated: 2026-11-01
---

# Desktop Shortcuts v2

继承 [desktop-shortcuts-v1](desktop-shortcuts-v1.md) 未被下述条款替代的规则。

本机 shortcuts schemaVersion **2**。一次性迁移 v1：execution/members/dm/tasks 无论旧绑定、自定义或 null，统一 Mod+1/2/3/4；其他占用这些组合的动作清空，其他键位、mouse.side1/side2 和 sendMode 保留。原子写入新完整配置；v2 后续启动、Host 切换与 Task 开关均不重置。

迁移写盘失败不改旧文件，内存采用规范化键位并返回 migrationPending，设置行内允许显式重试。动作集合由共享命令目录定义；Task 关闭只改变可用性，不新增第二份配置。

项目目录保留 `project-files` 开关，默认 `Mod+Shift+E`；旧配置缺少该项时补默认值，组合已被用户占用则保留空绑定。
文件搜索只在目录中提供，移除独立 `quick-open` 动作及默认 `Mod+P`。读取旧配置时仅去掉该动作的键盘绑定、
将指向该动作的鼠标侧键置空，保留其他键位与发送方式；不在读取时重写 v2 配置，后续显式保存使用当前动作集合。

关闭时 Task 行、录制、键盘/侧键绑定均不可用，事件不消费。正在录制 Task 则取消，其他录制继续。别的动作使用隐藏 Task 组合时在同一保存中清除 Task 旧绑定，不显示隐藏冲突；重开不抢回。Windows Main app-command 在 preventDefault/send 前按当前窗口 Host capability 判断，未知 false，导航/Renderer loss 清空该投影。
