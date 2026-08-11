---
document_type: prototype-design-brief
prototype: skill-identity-colors
authority: interaction-reference-only
status: accepted
target_version: v0.58
last_updated: 2026-08-11
---

# Skill 身份色与列表可读性设计简报

## 目标

在现有 Neutral Porcelain + Steel 设置壳层内，提高 Skill 列表的辨识度与文字可读性，
同时减少首层元数据噪声。原型只调整 Skill 内容区，不改变添加流程、Runtime 生效组、
启停语义、详情能力、删除边界或 Core Read Side。

## 已确认约束

1. Skill 在创建时获得 UUID；身份色只由稳定 `skill.id` 派生，名称、简介、来源、
   Revision 与启停状态都不参与颜色计算。
2. 使用 Renderer 已有的 FNV-1a 32-bit 算法与 `--identity-1..8` 色板：
   `index = fnv1a32(skill.id) % 8 + 1`。
3. 六个内置 Skill 不维护名称到颜色的特例表；它们和用户导入 Skill 走同一条 UUID 映射路径。
   同一 Skill 的内容更新与新 Revision 保留 UUID，因此颜色不变；删除后重新创建获得新 UUID，
   颜色可以变化。
4. 开关采用既有交互稿的 34×20 Steel Switch。列表不再显示“已启用 / 已停用”文字，
   但保留 `role="switch"`、`aria-checked` 与动作型可访问名称。
5. 首层移除全部来源明细行，包括“随 Rovai 安装 · Revision r1”、固定上游仓库与八位
   Revision，以及用户导入来源。来源明细统一进入“详情”。
6. 首层来源标签收敛为 `Rovai / GitHub / 用户导入`，不再显示“内置 / 三方”等后缀；
   完整来源、仓库与 Revision 继续只在详情展示。

## 信息层级

- 一级：38px 身份色标记、14px Skill 名称、12.5px 简介与 10.5px 短来源标签。
- 操作：投递范围、无文字 Switch、详情。
- 二级详情：来源、Library Revision、安装或更新时间、文件数与大小、内容摘要、来源边界说明；
  用户导入 Skill 的删除入口仍只在详情内出现。
- 关闭 Skill 时只弱化名称、简介和来源标签；身份色标记保持原色，避免关闭状态改变身份。

## 色彩职责

- 身份色：只进入 Skill 标记，不进入展开详情，也不表示来源、权限、Runtime、启停或风险。
- 展开详情：统一使用 Steel 结构轨与中性 Porcelain 表面，不随 Skill 身份色变化。
- 来源标签：使用 `Rovai / GitHub / 用户导入`三种短文案，不跟随身份色；完整来源信息进入详情。
- Switch：开启为 Steel，关闭为中性瓷灰；不使用 Skill 身份色，也不把开启解释为成功状态。
- 删除、等待释放与错误继续使用既有 danger / attention 语义色。

## 原型范围

原型提供搜索、本地/GitHub Tab、启停、投递范围菜单、详情展开和“8 色映射”标注面板。
所有原型状态只保存在当前页面内，不连接 Core、不读写真实 Skill Library；生产实现与验收状态以
`docs/versions/v0.58/implementation-plan.md` 和当前 Renderer 为准。
