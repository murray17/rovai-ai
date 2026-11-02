export const samples = {
  flow: 'flowchart TD\n A[入口] -->|中文标签| B[完成]',
  graph: 'graph LR\n A[开始] --> B[检查] --> C[结束]',
  sequence: 'sequenceDiagram\n participant A as 用户\n participant B as 系统\n A->>B: 打开文档\n B-->>A: 返回图形',
  class: 'classDiagram\n class Document {\n +String title\n +render()\n }\n Document --> Preview',
  state: 'stateDiagram-v2\n [*] --> Ready\n Ready --> Loading: 刷新\n Loading --> Ready: 完成',
  er: 'erDiagram\n DOCUMENT ||--o{ DIAGRAM : contains\n DOCUMENT {\n string title\n }',
  wide: 'flowchart LR\n' + Array.from({ length: 15 }, (_, i) => `A${i}[步骤 ${i}：文档审阅] --> A${i + 1}`).join('\n'),
  tall: 'flowchart TD\n' + Array.from({ length: 20 }, (_, i) => `A${i}[步骤 ${i}：继续审阅] --> A${i + 1}`).join('\n'),
  invalid: 'flowchart TD\n A[未闭合'
}
export const fence = (source) => '```mermaid\n' + source + '\n```'
export const document = '# Mermaid 文档审阅\n\n普通正文保持可读。\n\n' + Object.entries(samples).map(([name, source]) => `## ${name}\n\n${fence(source)}`).join('\n\n')
