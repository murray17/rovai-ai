# 词汇表格式

## 结构

```md
# {上下文名称}

{用一两句话说明这个上下文是什么，以及它为什么存在。}

## Language

**Order**:
{用一两句话给出紧凑定义。}
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request
```

## 规则

- 明确选择一个规范术语；把同义但不推荐的表达列入 `_Avoid_`。
- 每个定义限一两句话，解释概念是什么，不描述完整行为或实现。
- 只记录项目领域特有概念；一般编程概念不进入词汇表。
- 概念自然形成簇时使用小标题；单一紧密领域保持扁平结构。
- 多上下文仓库由根 `CONTEXT-MAP.md` 列出上下文、位置和关系；各上下文维护自己的 `CONTEXT.md`。
