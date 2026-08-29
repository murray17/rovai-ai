---
document_type: contract
contract: run-process-detail-surface-v25
authority: agent-process-shell-command-detail-layout
status: accepted
source_version: v1.29
last_updated: 2026-08-30
---

# Run Process Detail Surface v25（Shell 命令与输出连续呈现）

本合同完整继承 [Run Process Detail Surface v24](run-process-detail-surface-v24.md) 的 `activity-v2` 五域、
Renderer 中文标题、七类图标、类型化搜索词，以及更早版本的连续 Tool 分组、live-tail、两级 disclosure、
惰性全文读取和执行台位置。v25 只收敛公开 Shell command disclosure 的文本格式、结果面颜色和左侧对齐；
不改变 Canonical Activity、Evidence 白名单、脱敏、operation identity、lifecycle、outcome、Tool 分组或
其他 Tool detail。

## 1. 命令与输出格式

任一 Shell Activity 只要同一公开 payload 提供 command，Renderer 就使用统一 formatter 生成 disclosure：

- 第一行固定为 `$ ` 紧接完整、归一化且已脱敏的 command；
- 存在非空公开 output 时，从下一行立即连续显示 ANSI 清理后的完整内容；
- command 与 output 之间不插入空白行，也不显示“命令”或“输出”标签；
- output 自身的换行保持不变；没有 output 时只显示 command 行；
- Codex、Claude Bash、ACP execute、Runtime recovery 与完整 Evidence 恢复路径复用同一格式，不从其他字段
  猜测或补写 command。

## 2. Shell 结果面与对齐

Shell command 与 output 必须位于同一个可聚焦、可滚动的完整结果 region，不增加装饰性标题、复制层或第二份
DOM。Shell 结果使用主题专属 `--shell-result-canvas`；其他 Tool 结果、Evidence、fenced code 与 narrative
inline code 继续使用各自既有 token，不被 Shell 颜色覆盖。

Shell detail 的左边界与 Tool summary 的 16px Terminal 类型图标左边界同轴，不再缩进到标题文本轨。
其他 Tool detail 保持既有缩进。底部执行台与 Inspector 必须复用相同 DOM、颜色、对齐、键盘滚动和惰性读取
行为。

## 3. 验收

- command 与 output 精确呈现为 `$ pnpm test\ntests passed`；无 output 时精确呈现为 `$ true`；
- ANSI 清理、命令归一化和敏感参数脱敏继续生效，且不出现“命令 / 输出”标签或空白分隔行；
- Codex、Claude Bash、ACP execute 与完整 Evidence 恢复 fixture 使用同一 formatter；
- 只有 Shell 结果消费 `--shell-result-canvas`，其他 Tool 结果继续消费 `--evidence-canvas`；
- Shell 结果左边界与 Terminal 图标同轴，其他 Tool detail 的四轨布局和缩进不变；
- Day/Night、底部/Inspector、200% zoom、惰性全文读取、焦点返回和键盘滚动行为保持既有合同。

## References

- [Run Process Detail Surface v24](run-process-detail-surface-v24.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
- [Porcelain Day](../ui/themes/porcelain-day.md)
- [Steel Night](../ui/themes/steel-night.md)
