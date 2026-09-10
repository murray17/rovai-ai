import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { at, sanitizeReportLinks } from './report-html.ts'
import { renderDailyHtml } from './daily-report.ts'
import { digest } from './daily.ts'

type Obj=Record<string,unknown>
const obj=(v:unknown):Obj=>v&&typeof v==='object'&&!Array.isArray(v)?v as Obj:{}
const read=async(path:string):Promise<unknown>=>JSON.parse(await readFile(path,'utf8'))
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max

// This same finite reference vocabulary is given to the analysis model and
// checked at registration. It does not rewrite a model's invalid references.
export function dailyAnalysisSchema(pack:unknown,inputDigest:string):Obj {
  const source=obj(pack),paths:string[]=[]
  const visit=(value:unknown,path:string,maximumDepth:number):void=>{
    if(path.includes('.')&&path.length<=240&&at(source,path)!==undefined)paths.push(path)
    if(paths.length>4096)throw new Error('analysis.reference_vocabulary_limit')
    if(path.split('.').length>=maximumDepth)return
    if(value&&typeof value==='object')for(const [key,child] of Object.entries(value)){
      if(/^[A-Za-z0-9_-]+$/.test(key))visit(child,`${path}.${key}`,maximumDepth)
    }
  }
  // Cite complete deeper subtrees instead of multiplying every historical leaf
  // in the schema. All values remain available in the frozen analysis input.
  for(const key of ['yesterday','comparableHistory','changes','versions','coverage'])visit(source[key],key,key==='comparableHistory'?3:5)
  const ids=Array.isArray(source.samples)?source.samples.map(sample=>obj(sample).evidenceId).filter((id):id is string=>typeof id==='string'):[]
  const item={type:'object',additionalProperties:false,required:['text','metricPaths','evidenceIds'],properties:{
    text:{type:'string',minLength:1,maxLength:2000},metricPaths:{type:'array',maxItems:paths.length?12:0,items:paths.length?{type:'string',enum:paths}:{type:'string'}},
    evidenceIds:{type:'array',maxItems:ids.length?12:0,items:ids.length?{type:'string',enum:ids}:{type:'string'}}}}
  return {type:'object',additionalProperties:false,$defs:{statement:item},required:['schemaVersion','reportId','inputDigest','model','facts','hypotheses','recommendations'],properties:{
    schemaVersion:{type:'integer',const:1},reportId:{type:'string',const:source.reportId},inputDigest:{type:'string',const:inputDigest},
    model:{type:'object',additionalProperties:false,required:['provider','snapshotId'],properties:{provider:{type:'string',minLength:1,maxLength:160},snapshotId:{type:'string',minLength:1,maxLength:240}}},
    facts:{type:'array',minItems:1,maxItems:12,items:{$ref:'#/$defs/statement'}},hypotheses:{type:'array',maxItems:12,items:{$ref:'#/$defs/statement'}},recommendations:{type:'array',maxItems:12,items:{$ref:'#/$defs/statement'}}}}
}

export function validateAnalysis(submission:unknown,pack:unknown,expectedDigest:string):Obj {
  const input=obj(submission),source=obj(pack)
  if(input.schemaVersion!==1||input.reportId!==source.reportId||input.inputDigest!==expectedDigest||digest(pack)!==expectedDigest)throw new Error('analysis.input_identity_mismatch')
  const model=obj(input.model)
  if(!text(model.provider,160)||!text(model.snapshotId,240))throw new Error('analysis.model_identity_missing')
  if(Object.keys(model).some(key=>!['provider','snapshotId'].includes(key)))throw new Error('analysis.unexpected_model_field')
  const samples=Array.isArray(source.samples)?source.samples.map(obj):[]
  const ids=new Set(samples.map(sample=>sample.evidenceId))
  for(const kind of ['facts','hypotheses','recommendations']){
    const entries=input[kind]
    if(!Array.isArray(entries)||entries.length>12||kind==='facts'&&entries.length===0)throw new Error('analysis.invalid_section')
    for(const entry of entries){
      const item=obj(entry)
      if(!text(item.text,2000)||!Array.isArray(item.metricPaths)||!Array.isArray(item.evidenceIds)
          ||item.metricPaths.length+item.evidenceIds.length<1||item.metricPaths.length>12||item.evidenceIds.length>12)throw new Error('analysis.missing_evidence_reference')
      for(const path of item.metricPaths)if(typeof path!=='string'||path.length>240||!/^(yesterday|comparableHistory|changes|versions|coverage)(\.[A-Za-z0-9_-]+)+$/.test(path)||at(source,path)===undefined)throw new Error('analysis.metric_path_unresolved')
      for(const id of item.evidenceIds)if(typeof id!=='string'||!ids.has(id))throw new Error('analysis.evidence_id_unresolved')
      if(Object.keys(item).some(key=>!['text','metricPaths','evidenceIds'].includes(key)))throw new Error('analysis.unexpected_field')
    }
  }
  if(Object.keys(input).some(key=>!['schemaVersion','reportId','inputDigest','model','facts','hypotheses','recommendations'].includes(key)))throw new Error('analysis.unexpected_field')
  return input
}

async function contained(root:string,name:string):Promise<string>{
  const path=await realpath(join(root,name))
  if(!path.startsWith(`${root}${sep}`)||!(await lstat(path)).isFile())throw new Error('Analysis evidence escapes report directory')
  return path
}

// This receipt records a submitted analysis and reference validation, not a new
// model invocation or proof that the explanation is correct. Statistics are immutable.
export async function recordDailyAnalysis(directory:string,submission:unknown):Promise<Obj>{
  const root=await realpath(resolve(directory))
  const lock=await open(join(root,'.analysis.lock'),'wx',0o600)
  try{
    const reportPath=await contained(root,'report.json'),report=obj(await read(reportPath))
    const pack=await read(await contained(root,'analysis-input.json'))
    if(report.status!=='available'||report.schemaVersion!==2)throw new Error('Only a complete current statistics report accepts analysis')
    const inputDigest=String(report.analysisInputDigest)
    if(digest(pack)!==inputDigest||obj(pack).reportId!==report.reportId)throw new Error('Prepared input no longer matches immutable statistics')
    const id=randomUUID(),relative=`analyses/${id}`
    await mkdir(join(root,'analyses'),{recursive:true,mode:0o700})
    if((await lstat(join(root,'analyses'))).isSymbolicLink())throw new Error('Analysis directory must not be a symlink')
    const destination=join(root,relative);await mkdir(destination,{mode:0o700})
    const write=async(name:string,value:unknown):Promise<void>=>writeFile(join(destination,name),`${JSON.stringify(value,null,2)}\n`,{flag:'wx',mode:0o600})
    const record:Obj={schemaVersion:1,id,reportId:report.reportId,inputDigest,statisticsFileDigest:createHash('sha256').update(await readFile(reportPath)).digest('hex'),completedAt:new Date().toISOString(),status:'complete',model:obj(submission).model??null,modelIdentityAuthority:'submitted_not_independently_verified',outputFile:`${relative}/analysis.json`,validation:'identity_and_reference_existence_only'}
    try{
      record.content=validateAnalysis(submission,pack,inputDigest)
      const content=obj(record.content)
      const paths=new Set(['facts','hypotheses','recommendations'].flatMap(kind=>(content[kind] as Obj[]).flatMap(item=>item.metricPaths as string[])))
      record.citedMetrics=Object.fromEntries([...paths].sort().map(path=>[path,at(pack,path)]))
    }catch(error){record.status='failed';record.failureCode=(error as Error).message;record.content=null}
    await write('analysis.json',submission);await write('record.json',record)
    const temporary=join(root,`.analysis-${id}.json`)
    await writeFile(temporary,`${JSON.stringify(record,null,2)}\n`,{flag:'wx',mode:0o600});await rename(temporary,join(root,'analysis-status.json'))
    const trend=obj(await read(await contained(root,'trend-data.json')))
    const html=join(root,`.report-${id}.html`)
    await writeFile(html,await sanitizeReportLinks(root,renderDailyHtml(report,trend.points,pack,record)),{flag:'wx',mode:0o600});await rename(html,join(root,'report.html'))
    return record
  }finally{await lock.close();await unlink(join(root,'.analysis.lock'))}
}
