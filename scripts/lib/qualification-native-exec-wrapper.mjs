import ts from 'typescript'

// Parse a closed data-flow subset. No eval, constant folding, arbitrary calls,
// mutation, spreads, computed keys, or dynamically produced verification text.
export function directExecWrapper(input) {
  if (typeof input !== 'string' || input.length > 50_000) return null
  const file = ts.createSourceFile('native-witness.js', input, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  if (file.parseDiagnostics.length) return null
  const constants = new Map(), outputs = []
  let resultName = null, args = null
  const property = (node, object, name) => ts.isPropertyAccessExpression(node)
    && ts.isIdentifier(node.expression) && node.expression.text === object && node.name.text === name
  const named = (node, name) => ts.isIdentifier(node) && node.text === name
  function literal(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
    if (ts.isNumericLiteral(node)) return Number(node.text)
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false
    if (node.kind === ts.SyntaxKind.NullKeyword) return null
    if (ts.isIdentifier(node) && constants.has(node.text)) return constants.get(node.text)
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal)
    if (ts.isObjectLiteralExpression(node)) {
      const value = Object.create(null)
      for (const field of node.properties) {
        if (!ts.isPropertyAssignment(field) || !(ts.isIdentifier(field.name) || ts.isStringLiteral(field.name))) throw new Error('dynamic field')
        if (Object.hasOwn(value, field.name.text)) throw new Error('duplicate field')
        value[field.name.text] = literal(field.initializer)
      }
      return value
    }
    throw new Error('non-literal input')
  }
  function invocation(node) {
    if (!ts.isAwaitExpression(node) || !ts.isCallExpression(node.expression)) return null
    const call = node.expression
    if (!property(call.expression, 'tools', 'exec_command') || call.arguments.length !== 1) return null
    const value = literal(call.arguments[0])
    if (typeof value.cmd !== 'string' || typeof value.workdir !== 'string') throw new Error('missing direct command')
    return value
  }
  function jsonReturn(node) {
    if (named(node, resultName)) return true
    if (!ts.isCallExpression(node) || !property(node.expression, 'JSON', 'stringify') || node.arguments.length !== 1) return false
    const value = node.arguments[0]
    if (named(value, resultName)) return true
    if (!ts.isObjectLiteralExpression(value) || value.properties.length !== 2) return false
    return ['output', 'exit_code'].every(name => value.properties.some(field => ts.isPropertyAssignment(field)
      && (ts.isIdentifier(field.name) || ts.isStringLiteral(field.name)) && field.name.text === name
      && property(field.initializer, resultName, name)))
  }
  try {
    for (const statement of file.statements) {
      if (ts.isEmptyStatement(statement)) continue
      if (ts.isVariableStatement(statement) && !args && statement.declarationList.declarations.length === 1) {
        const declaration = statement.declarationList.declarations[0]
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer || constants.has(declaration.name.text)) return null
        const invoked = invocation(declaration.initializer)
        if (invoked) { args = invoked; resultName = declaration.name.text }
        else constants.set(declaration.name.text, literal(declaration.initializer))
        continue
      }
      if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)
          || !named(statement.expression.expression, 'text') || statement.expression.arguments.length !== 1) return null
      const value = statement.expression.arguments[0]
      if (!args) {
        const invoked = invocation(value)
        if (!invoked) return null
        args = invoked; outputs.push('json'); continue
      }
      if (property(value, resultName, 'output')) outputs.push('text')
      else if (jsonReturn(value)) outputs.push('json')
      else if (ts.isTemplateExpression(value) && value.head.text === 'exit_code=' && value.templateSpans.length === 1
          && value.templateSpans[0].literal.text === '' && property(value.templateSpans[0].expression, resultName, 'exit_code')) outputs.push('exit')
      else return null
    }
  } catch { return null }
  const mode = outputs.length === 1 && ['text', 'json'].includes(outputs[0]) ? outputs[0]
    : outputs.join(',') === 'text,exit' ? 'text_exit' : null
  return args && mode ? { args, mode } : null
}
