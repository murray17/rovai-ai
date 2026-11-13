import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

// A child process detects unhandled asynchronous error events without installing
// a process-wide exception handler that could hide the production failure.
const run = promisify(execFile)
const fixture = String.raw`
const assert = require('node:assert/strict');
const net = require('node:net');
const {once} = require('node:events');
const {dirname, resolve} = require('node:path');
const {pathToFileURL} = require('node:url');
const {createRequire} = require('node:module');
(async () => {
 const entry = require.resolve('@larksuiteoapi/node-sdk');
 const sdk = process.argv[1] === 'es'
   ? await import(pathToFileURL(resolve(dirname(entry), '../es/index.js')).href)
   : require(entry);
 const {WSClient, LoggerLevel, createLarkChannel} = sdk;
 const {WebSocketServer} = createRequire(entry)('ws');
 const logger = {error(){},warn(){},info(){},debug(){},trace(){}};
 const options = {appId:'cli_0123456789abcdef',appSecret:'fixture-secret',logger,loggerLevel:LoggerLevel.error,handshakeTimeoutMs:20};
 const sockets = new Set();
 const server = net.createServer(socket => { sockets.add(socket); socket.on('close',()=>sockets.delete(socket)); socket.on('data',()=>{}); });
 server.listen(0,'127.0.0.1'); await once(server,'listening');
 const url = 'ws://127.0.0.1:'+server.address().port;
 for(let i=0;i<3;i++) {
   const client = new WSClient(options);
   client.wsConfig.updateWs({connectUrl:url});
   assert.equal(await client.connect(),false);
   client.close();
 }
 const cancelled = new WSClient({...options,handshakeTimeoutMs:10000});
 cancelled.wsConfig.updateWs({connectUrl:url});
 const waiting = cancelled.connect(); cancelled.close();
 assert.equal(await waiting,false);
 await new Promise(resolve=>setTimeout(resolve,30));
 for(const socket of sockets) socket.destroy();
 await new Promise(resolve=>server.close(resolve));

 let endpoints=0, ready=0, failures=[];
 const live = new WebSocketServer({host:'127.0.0.1',port:0}); await once(live,'listening');
 const httpInstance={request:async()=>{
   endpoints++;
   if(endpoints>1) return {code:1,data:{},msg:'fixture busy'};
   return {code:0,data:{URL:'ws://127.0.0.1:'+live.address().port+'?device_id=fixture&service_id=1',ClientConfig:{PingInterval:60,ReconnectCount:1,ReconnectInterval:0.01,ReconnectNonce:0}}};
 }};
 const client = new WSClient({...options,httpInstance,onReady:()=>ready++,onReconnectAttemptFailed:event=>failures.push(event),onError:()=>{}});
 await client.start({eventDispatcher:{invoke:async()=>{}}});
 for(let i=0;i<100&&!ready;i++) await new Promise(resolve=>setTimeout(resolve,2));
 assert.equal(ready,1);
 for(const socket of live.clients) socket.terminate();
 for(let i=0;i<100&&!failures.length;i++) await new Promise(resolve=>setTimeout(resolve,2));
 assert.equal(failures.length,1); assert.equal(failures[0].code,1);
 assert.equal(failures[0].nextConnectTime,null); assert.equal(failures[0].retryable,true);
 client.close(); const stoppedAt=endpoints;
 await new Promise(resolve=>setTimeout(resolve,40)); assert.equal(endpoints,stoppedAt);
 await new Promise(resolve=>live.close(resolve));

 let finishEndpoint; let calls=0;
 const late=new WSClient({...options,httpInstance:{request:()=>{calls++;return new Promise(resolve=>finishEndpoint=resolve);}}});
 await late.start({eventDispatcher:{invoke:async()=>{}}}); late.close();
 finishEndpoint({code:1,data:{},msg:'busy'});
 await new Promise(resolve=>setTimeout(resolve,40));
 assert.equal(calls,1); assert.equal(late.pendingSocket,undefined);

 const channel=createLarkChannel({...options,initialConnectRetry:false});
 let identity;
 channel.fetchBotIdentity=()=>new Promise(resolve=>identity=resolve);
 const connecting=channel.connect();
 await channel.disconnect();
 await assert.rejects(connecting);
 identity({openId:'ou_fixture',name:'Fixture'});
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(channel.rawWsClient,undefined);

 for(const code of [1,1000040350,514,403]) {
   let error;
   const first=new WSClient({...options,initialConnectRetry:false,httpInstance:{request:async()=>({code,data:{},msg:'private upstream text'})},onError:e=>error=e});
   await first.start({eventDispatcher:{invoke:async()=>{}}});
   for(let i=0;i<100&&!error;i++) await new Promise(resolve=>setTimeout(resolve,1));
   assert.equal(error.code,code);assert.equal(error.retryable,code!==514&&code!==403);
   first.close();
 }

 const requestOptions=[];
 const scoped=createLarkChannel({...options,identityTimeoutMs:20,httpInstance:{request:async config=>{
   requestOptions.push(config); return new Promise((resolve,reject)=>config.signal.addEventListener('abort',()=>reject(new Error('aborted')), {once:true}));
 }}});
 await assert.rejects(scoped.connect());
 assert.ok(requestOptions.length>0);
 assert.ok(requestOptions.every(config=>config.timeout===20 && config.signal.aborted));
 assert.equal(scoped.rawWsClient,undefined); await scoped.disconnect();

 const stableServer=new WebSocketServer({host:'127.0.0.1',port:0});await once(stableServer,'listening');
 let initialRequests=0;
 const stable=createLarkChannel({...options,initialConnectRetry:false,includeRawEvent:true,safety:{dedup:{ttl:600000},chatQueue:{enabled:true}},httpInstance:{request:async()=>{
   if(++initialRequests===1)return {code:1,data:{},msg:'busy'};
   return {code:0,data:{URL:'ws://127.0.0.1:'+stableServer.address().port+'?device_id=fixture&service_id=1',ClientConfig:{PingInterval:60,ReconnectCount:1,ReconnectInterval:0.01,ReconnectNonce:0}}};
 }}});
 stable.fetchBotIdentity=async()=>({openId:'ou_bot',name:'Bot'});
 let handled=0;stable.on('cardAction',()=>{handled++});
 const click=id=>({schema:'2.0',header:{event_type:'card.action.trigger',event_id:id,app_id:options.appId},event:{context:{open_message_id:'om_same',open_chat_id:'oc_same'},operator:{open_id:'ou_owner'},action:{tag:'button',value:{action:'same'}}}});
 await assert.rejects(stable.connect());
 await stable.connect();assert.equal(stable.getConnectionStatus().state,'connected');await stable.dispatcher.invoke(click('event-one'),{needCheck:false});
 stable.cancelConnect();await stable.connect();
 await stable.dispatcher.invoke(click('event-one'),{needCheck:false});
 await stable.dispatcher.invoke(click('event-two'),{needCheck:false});
 assert.equal(handled,2);await stable.disconnect();
 for(const socket of stableServer.clients)socket.terminate();await new Promise(resolve=>stableServer.close(resolve));
 let rateError;
 const limited=new WSClient({...options,initialConnectRetry:false,onError:error=>rateError=error,httpInstance:{request:async()=>{throw {response:{status:429,headers:{'retry-after':'120'}}}}}});
 await limited.start({eventDispatcher:{invoke:async()=>{}}});
 for(let i=0;i<100&&!rateError;i++)await new Promise(resolve=>setTimeout(resolve,1));
 assert.equal(rateError.code,429);assert.equal(rateError.retryAfterMs,120000);assert.equal(rateError.retryable,true);limited.close();
 console.log('lifecycle-ok');

})().catch(error=>{console.error(error);process.exitCode=1});
`

describe('Feishu SDK connection lifecycle', () => {
  it.each(['lib', 'es'])('cleans timeout, cancellation and retries in %s', async flavor => {
    const result = await run(process.execPath, ['-e', fixture, flavor], {
      cwd: process.cwd(), timeout: 10_000, maxBuffer: 128 * 1024
    })
    expect(result.stdout).toContain('lifecycle-ok')
    expect(result.stderr).not.toMatch(/Unhandled|uncaught/i)
  }, 15_000)
})
