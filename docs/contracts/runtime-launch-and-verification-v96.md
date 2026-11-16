---
document_type: contract
name: Runtime Launch and Verification
version: v96
status: accepted
source_version: v1.72
last_updated: 2026-11-15
---

# Runtime Launch and Verification v96

继承 [v95](runtime-launch-and-verification-v95.md)，按 User sequence 146 收窄 Goose 新建 Session
和目标参数查询对无关默认配置、临时 Session 清理的依赖。MCP 尽力撤回、共享 Fleet、Bootstrap 和平台资格不变。

## 显式 Provider 提前交给原生

Goose 正式执行创建新 Session 时，若本轮选择为显式 `provider/model`，现有 `session/new`
请求的 `_meta.provider` 使用该路由中的 Provider。目标模型参数探测创建临时 Session 时同样处理。
路由继续使用同一解析入口，模型和 effort 沿现有原生 setter 应用，同值省略仍依据原生回显。

未显式选择模型时不添加 Provider；同 Host 继续和精确冷恢复的 Session 定位不改变。
不修改原生配置、系统环境，不增加 Provider 回退、重试、配置副本或缓存。
本条不保证历史 Session 的失效 Provider 可以冷恢复，也不把所有默认 Provider 故障都描述成创建失败。

## 参数结果与临时清理解耦

完整目录继续不创建 Session。目标参数查询实际创建且取得精确 ID 后，仍尝试一次原生 `session/delete`。
删除等待使用 `min(原探测截止点, 删除开始 + 500 ms)`，包括写入与响应；提前完成就继续。
500 ms 是 Rovai 的本地清理预算，不是原生工具执行期限，也不增加查询总期限。

| 结果 | 返回与清理 |
| --- | --- |
| 查询成功，删除成功 | 返回有效模型选项，原生探测 Session 已删除 |
| 查询成功，删除报错或未确认 | 保留有效选项，只记清理诊断；不声称 Session 已删除 |
| 查询失败 | 返回原查询错误，已知临时 Session 仍尽力删除 |
| 没有取得 Session ID | 不猜测删除对象 |
| 受管探测进程无法完成回收 | 保持既有 probe cleanup 故障处理，不伪造收尾成功 |

删除失败或未确认时可能留下原生探测 Session。接受这一局部代价，不新增后台删除、重试队列、扫描器、
文件、表或数据库直写。探测进程继续由现有 `RuntimeProbeProcess::finish` 收尾。

## 验证边界

扩展既有 live-model 和 health owners，保留当前选择、缺回显、错误、精确清理、sessionless 目录和 MCP 场景。
核对无默认 Provider 时显式 Provider 能直接创建 Session；查询成功后删除错误／不回包仍发布本次有效选项，
不能用旧缓存冒充新查询成功。查询错误和进程收尾失败仍失败。

官方二进制原生对照与实际 Core 调用分别验收，使用独立配置和 loopback Provider。
无响应 MCP 初始化的上游限制独立保留；本轮不修改扩展 timeout、Core 恢复期限或官方安装。
