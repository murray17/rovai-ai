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

// A second closed shape: Promise.all of literal exec calls, followed by a
// delimiter-separated concatenation of their unmodified output properties.
export function parallelExecWrapper(input) {
  if (typeof input !== 'string' || input.length > 50_000) return null
  const file=ts.createSourceFile('parallel-witness.js',input,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS)
  const statements=file.statements.filter(s=>!ts.isEmptyStatement(s))
  if (file.parseDiagnostics.length || statements.length!==2 || !ts.isVariableStatement(statements[0])) return null
  const declarations=statements[0].declarationList.declarations
  if (declarations.length!==1 || !ts.isIdentifier(declarations[0].name)) return null
  const name=declarations[0].name.text,init=declarations[0].initializer
  const property=(node,object,key)=>ts.isPropertyAccessExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text===object&&node.name.text===key
  if (!init || !ts.isAwaitExpression(init) || !ts.isCallExpression(init.expression) || !property(init.expression.expression,'Promise','all') || init.expression.arguments.length!==1) return null
  const array=init.expression.arguments[0]
  if (!ts.isArrayLiteralExpression(array) || array.elements.length<2 || array.elements.length>4) return null
  const calls=[]
  for (const call of array.elements) {
    if (!ts.isCallExpression(call) || !property(call.expression,'tools','exec_command') || call.arguments.length!==1 || !ts.isObjectLiteralExpression(call.arguments[0])) return null
    const args={}
    for(const field of call.arguments[0].properties){
      if(!ts.isPropertyAssignment(field)||!(ts.isIdentifier(field.name)||ts.isStringLiteral(field.name))||Object.hasOwn(args,field.name.text))return null
      const value=field.initializer
      if(ts.isStringLiteral(value)||ts.isNoSubstitutionTemplateLiteral(value))args[field.name.text]=value.text
      else if(ts.isNumericLiteral(value))args[field.name.text]=Number(value.text)
      else if(value.kind===ts.SyntaxKind.TrueKeyword||value.kind===ts.SyntaxKind.FalseKeyword)args[field.name.text]=value.kind===ts.SyntaxKind.TrueKeyword
      else return null
    }
    if(typeof args.cmd!=='string'||typeof args.workdir!=='string')return null
    calls.push(args)
  }
  if(new Set(calls.map(c=>c.cmd)).size!==calls.length)return null
  const expression=statements[1]
  if(!ts.isExpressionStatement(expression)||!ts.isCallExpression(expression.expression)||!ts.isIdentifier(expression.expression.expression)||expression.expression.expression.text!=='text'||expression.expression.arguments.length!==1)return null
  const parts=[]
  function flatten(node){
    if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.PlusToken){flatten(node.left);flatten(node.right);return}
    if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)){if(typeof parts.at(-1)==='string')parts[parts.length-1]+=node.text;else parts.push(node.text);return}
    if(ts.isPropertyAccessExpression(node)&&node.name.text==='output'&&ts.isElementAccessExpression(node.expression)&&ts.isIdentifier(node.expression.expression)&&node.expression.expression.text===name&&ts.isNumericLiteral(node.expression.argumentExpression)){parts.push(Number(node.expression.argumentExpression.text));return}
    throw new Error('modified output')
  }
  try{flatten(expression.expression.arguments[0])}catch{return null}
  if(typeof parts[0]!=='string')parts.unshift('')
  if(typeof parts.at(-1)!=='string')parts.push('')
  const indices=parts.filter(p=>typeof p==='number')
  if(parts.length!==calls.length*2+1||new Set(indices).size!==calls.length||indices.some(i=>!Number.isInteger(i)||i<0||i>=calls.length)||parts.some((p,i)=>i%2===0?typeof p!=='string'||i>0&&i<parts.length-1&&!p:typeof p!=='number'))return null
  return {calls,parts,mode:'parallel_text'}
}

export function splitParallelOutput(wrapper, text) {
  if(typeof text!=='string'||!text.startsWith(wrapper.parts[0]))return null
  let cursor=wrapper.parts[0].length;const outputs=[]
  for(let i=1;i<wrapper.parts.length;i+=2){
    const delimiter=wrapper.parts[i+1],last=i+2>=wrapper.parts.length
    let end=last?text.length-delimiter.length:text.indexOf(delimiter,cursor)
    if(end<cursor||!text.slice(end).startsWith(delimiter)||!last&&text.indexOf(delimiter,end+delimiter.length)!==-1)return null
    outputs[wrapper.parts[i]]=text.slice(cursor,end);cursor=end+delimiter.length
  }
  return cursor===text.length?outputs:null
}
