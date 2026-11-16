import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

// A child process detects unhandled asynchronous error events without installing
// a process-wide exception handler that could hide the production failure.
const run = promisify(execFile)
const fixture = String.raw`
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');
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
 const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
 const until = async predicate => { for(let i=0;i<500&&!predicate();i++) await pause(2); assert.ok(predicate(), 'condition did not settle'); };
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

 // A real peer sends its HTTP 101 only after the handshake deadline. The
 // half-open server socket permits that write even after the client cancels.
 let lateUpgrade=false, installed=0, pings=0, outboundFrames=0, dispatched=0;
 const latePeers=new Set();
 const delayedUpgrade=net.createServer({allowHalfOpen:true}, socket=>{
   latePeers.add(socket);socket.on('error',()=>{});socket.on('close',()=>latePeers.delete(socket));
   let request='';let scheduled=false;
   socket.on('data', chunk=>{
     request+=chunk.toString();
     if(scheduled||!request.includes('\r\n\r\n'))return;
     scheduled=true;
     const key=/Sec-WebSocket-Key: (.*)\r\n/i.exec(request)[1].trim();
     const accept=require('node:crypto').createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
     setTimeout(()=>{
       lateUpgrade=true;
       socket.end('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
     },70);
   });
 });
 delayedUpgrade.listen(0,'127.0.0.1');await once(delayedUpgrade,'listening');
 let handshakeError;
 const afterDeadline=new WSClient({...options,initialConnectRetry:false,onError:error=>handshakeError=error,httpInstance:{request:async()=>({code:0,data:{
   URL:'ws://127.0.0.1:'+delayedUpgrade.address().port+'?device_id=fixture&service_id=1',
   ClientConfig:{PingInterval:60,ReconnectCount:-1,ReconnectInterval:0.04,ReconnectNonce:0.1}
 }})}});
 const install=afterDeadline.wsConfig.setWSInstance.bind(afterDeadline.wsConfig);
 afterDeadline.wsConfig.setWSInstance=socket=>{if(socket)installed++;install(socket)};
 afterDeadline.pingLoop=()=>pings++;
 afterDeadline.sendMessage=()=>outboundFrames++;
 await afterDeadline.start({eventDispatcher:{invoke:async()=>{dispatched++}}});
 await until(()=>handshakeError);
 assert.equal(handshakeError.code,'handshake_timeout');
 await until(()=>lateUpgrade);await pause(30);
 assert.equal(installed,0);assert.equal(pings,0);assert.equal(outboundFrames,0);assert.equal(dispatched,0);
 afterDeadline.close();for(const socket of latePeers)socket.destroy();await new Promise(resolve=>delayedUpgrade.close(resolve));

 let endpoints=0, ready=0, failures=[], terminalErrors=0;
 const live = new WebSocketServer({host:'127.0.0.1',port:0}); await once(live,'listening');
 const httpInstance={request:async()=>{
   endpoints++;
   if(endpoints>1) return {code:1,data:{},msg:'fixture busy'};
   return {code:0,data:{URL:'ws://127.0.0.1:'+live.address().port+'?device_id=fixture&service_id=1',ClientConfig:{PingInterval:60,ReconnectCount:1,ReconnectInterval:0.01,ReconnectNonce:0}}};
 }};
 const client = new WSClient({...options,httpInstance,onReady:()=>ready++,onReconnectAttemptFailed:event=>failures.push(event),onError:()=>terminalErrors++});
 await client.start({eventDispatcher:{invoke:async()=>{}}});
 for(let i=0;i<100&&!ready;i++) await new Promise(resolve=>setTimeout(resolve,2));
 assert.equal(ready,1);
 for(const socket of live.clients) socket.terminate();
 for(let i=0;i<100&&!failures.length;i++) await new Promise(resolve=>setTimeout(resolve,2));
 assert.equal(failures.length,1); assert.equal(failures[0].code,1);
 assert.equal(failures[0].nextConnectTime,null); assert.equal(failures[0].retryable,true);
 await pause(40);assert.equal(terminalErrors,1);
 client.close(); const stoppedAt=endpoints;
 await new Promise(resolve=>setTimeout(resolve,40)); assert.equal(endpoints,stoppedAt);

 // Infinite SDK recovery reports each actual failure with the same planned
 // timestamp it will use; the initial nonce wait produces no failure event.
 let loopEndpoints=0, loopReady=0, loopSockets=0, loopErrors=0;
 const rounds=[];
 live.on('connection',()=>loopSockets++);
 const looping=new WSClient({...options,httpInstance:{request:async()=>{
   if(++loopEndpoints>1)return {code:1,data:null};
   return {code:0,data:{URL:'ws://127.0.0.1:'+live.address().port+'?device_id=fixture&service_id=1',
     ClientConfig:{PingInterval:60,ReconnectCount:-1,ReconnectInterval:0.04,ReconnectNonce:0.1}}};
 }},onReady:()=>loopReady++,onError:()=>loopErrors++,onReconnectAttemptFailed:info=>{
   assert.equal(info.nextConnectTime,looping.getReconnectInfo().nextConnectTime);
   assert.ok(info.nextConnectTime>=Date.now()+30);rounds.push(info);
 }});
 await looping.start({eventDispatcher:{invoke:async()=>{}}});await until(()=>loopReady);
 const random=Math.random;Math.random=()=>1;
 for(const socket of live.clients)socket.terminate();
 await until(()=>looping.getConnectionStatus().state==='reconnecting');
 await pause(30);assert.equal(loopEndpoints,1);assert.equal(rounds.length,0);
 await until(()=>rounds.length===2);Math.random=random;
 assert.deepEqual(rounds.map(info=>info.attempt),[1,2]);assert.equal(loopErrors,0);
 looping.close();const closedEndpoints=loopEndpoints,closedSockets=loopSockets;
 await pause(180);assert.equal(loopEndpoints,closedEndpoints);assert.equal(loopSockets,closedSockets);assert.equal(rounds.length,2);

 // Direct WSClient callers retain default first-connect retries, without an
 // attempt-failed notification before their first successful onReady.
 let defaultRequests=0, defaultReady=0, initialFailures=0;
 const defaults=new WSClient({...options,onReady:()=>defaultReady++,onReconnectAttemptFailed:()=>initialFailures++,httpInstance:{request:async()=>{
   if(++defaultRequests===1)return {code:1,data:null};
   return {code:0,data:{URL:'ws://127.0.0.1:'+live.address().port+'?device_id=fixture&service_id=1',
     ClientConfig:{PingInterval:60,ReconnectCount:-1,ReconnectInterval:0.04,ReconnectNonce:0.1}}};
 }}});
 defaults.wsConfig.updateWs({reconnectNonce:0,reconnectInterval:10});
 await defaults.start({eventDispatcher:{invoke:async()=>{}}});await until(()=>defaultReady);
 assert.equal(defaultRequests,2);assert.equal(initialFailures,0);defaults.close();

 let finishEndpoint; let calls=0;
 const late=new WSClient({...options,httpInstance:{request:()=>{calls++;return new Promise(resolve=>finishEndpoint=resolve);}}});
 await late.start({eventDispatcher:{invoke:async()=>{}}}); late.close();
 const socketsBeforeLate=loopSockets;
 finishEndpoint({code:0,data:{URL:'ws://127.0.0.1:'+live.address().port+'?device_id=fixture&service_id=1',ClientConfig:{PingInterval:60,ReconnectCount:-1,ReconnectInterval:0.04,ReconnectNonce:0.1}}});
 await new Promise(resolve=>setTimeout(resolve,40));
 assert.equal(calls,1); assert.equal(late.pendingSocket,undefined);assert.equal(loopSockets,socketsBeforeLate);
 await new Promise(resolve=>live.close(resolve));

 const channel=createLarkChannel({...options,initialConnectRetry:false});
 let identity;
 channel.fetchBotIdentity=()=>new Promise(resolve=>identity=resolve);
 const connecting=channel.connect();
 await channel.disconnect();
 await assert.rejects(connecting);
 identity({openId:'ou_fixture',name:'Fixture'});
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(channel.rawWsClient,undefined);

 for(const code of [1,1000040350,514,403]) for(const data of [{},null,undefined]) {
   let error;
   const first=new WSClient({...options,initialConnectRetry:false,httpInstance:{request:async()=>({code,data,msg:'private upstream text'})},onError:e=>error=e});
   await first.start({eventDispatcher:{invoke:async()=>{}}});
   for(let i=0;i<100&&!error;i++) await new Promise(resolve=>setTimeout(resolve,1));
   assert.equal(error.code,code);assert.equal(error.retryable,code!==514&&code!==403);
   first.close();
 }

 for(const code of [514,403]) {
   let error;
   const rejected=new WSClient({...options,initialConnectRetry:false,onError:value=>error=value,httpInstance:{request:async()=>{
     throw {response:{status:code===514?401:403,data:{code,data:null}}};
   }}});
   await rejected.start({eventDispatcher:{invoke:async()=>{}}});await until(()=>error);
   assert.equal(error.code,code);assert.equal(error.retryable,false);rejected.close();
 }

 // The identity scope includes token exchange. Both resolved OpenAPI errors
 // and rejected HTTP responses preserve the same classification and pacing.
 for(const phase of ['token','identity']) for(const mode of ['body','http']) for(const code of [99991400,429,99991401,514,403]) {
   const identityFailure=createLarkChannel({...options,httpInstance:{request:async config=>{
     if(phase==='identity'&&config.url.includes('/auth/'))return {code:0,app_access_token:'fixture-app',tenant_access_token:'fixture-tenant',expire:3600};
     const headers={'x-ogw-ratelimit-reset':'180','retry-after':'60'};
     if(mode==='http')throw {response:{status:code===99991400||code===429?429:403,data:{code,data:null},headers}};
     return {headers,data:{code,data:null}};
   }}});
   await assert.rejects(identityFailure.connect(),error=>{
     assert.equal(error.cause.connection,true);assert.equal(error.cause.code,code);
     assert.equal(error.cause.retryable,code===99991400||code===429);
     assert.equal(error.cause.retryAfterMs,180000);return true;
   });
   await identityFailure.disconnect();
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
 const stable=createLarkChannel({...options,initialConnectRetry:false,includeRawEvent:true,safety:{dedup:{ttl:600000},chatQueue:{enabled:true}},httpInstance:{request:async config=>{
   if(config.url.includes('/auth/'))return {code:0,app_access_token:'fixture-app',tenant_access_token:'fixture-tenant',expire:3600};
   if(config.url.includes('/im/v1/messages'))return {code:0,data:{message_id:'om_http'}};
   ++initialRequests;
   if(initialRequests===1)return {code:1,data:null};
   if(initialRequests===3)return {code:514,data:null};
   return {code:0,data:{URL:'ws://127.0.0.1:'+stableServer.address().port+'?device_id=fixture&service_id=1',ClientConfig:{PingInterval:60,ReconnectCount:1,ReconnectInterval:0.01,ReconnectNonce:0}}};
 }}});
 stable.fetchBotIdentity=async()=>({openId:'ou_bot',name:'Bot'});
 let registered=0;const register=stable.registerDispatcherHandlers.bind(stable);
 stable.registerDispatcherHandlers=()=>{registered++;register()};
 let stableError;stable.on('error',error=>stableError=error);
 let handled=0;stable.on('cardAction',()=>{handled++});
 const click=id=>({schema:'2.0',header:{event_type:'card.action.trigger',event_id:id,app_id:options.appId},event:{context:{open_message_id:'om_same',open_chat_id:'oc_same'},operator:{open_id:'ou_owner'},action:{tag:'button',value:{action:'same'}}}});
 await assert.rejects(stable.connect());
 await stable.connect();assert.equal(stable.getConnectionStatus().state,'connected');await stable.dispatcher.invoke(click('event-one'),{needCheck:false});
 for(const socket of stableServer.clients)socket.terminate();
 await until(()=>stableError);assert.equal(stableError.cause.code,514);assert.equal(stableError.cause.retryable,false);
 const recovery=stable.connect();assert.equal(stable.connect(),recovery);await recovery;
 assert.equal(registered,1);assert.equal(stable.getConnectionStatus().state,'connected');
 await stable.dispatcher.invoke(click('event-one'),{needCheck:false});
 await stable.dispatcher.invoke(click('event-two'),{needCheck:false});
 assert.equal(handled,2);
 const raw=stable.rawClient;stable.cancelConnect();
 const sent=await raw.im.v1.message.create({params:{receive_id_type:'chat_id'},data:{receive_id:'oc_fixture',msg_type:'text',content:'{"text":"fixture"}'}});
 assert.equal(sent.data.message_id,'om_http');await stable.connect();assert.equal(stable.rawClient,raw);
 await stable.dispatcher.invoke(click('event-one'),{needCheck:false});assert.equal(handled,2);assert.equal(registered,1);
 await stable.disconnect();
 await assert.rejects(stable.connect(),error=>error.cause.code==='cancelled');
 for(const socket of stableServer.clients)socket.terminate();await new Promise(resolve=>stableServer.close(resolve));
 let rateError;
 const limited=new WSClient({...options,initialConnectRetry:false,onError:error=>rateError=error,httpInstance:{request:async()=>{throw {response:{status:429,headers:{'retry-after':'120'}}}}}});
 await limited.start({eventDispatcher:{invoke:async()=>{}}});
 for(let i=0;i<100&&!rateError;i++)await new Promise(resolve=>setTimeout(resolve,1));
 assert.equal(rateError.code,429);assert.equal(rateError.retryAfterMs,120000);assert.equal(rateError.retryable,true);limited.close();
 // Exercise the SDK's real default Axios response interceptor: an HTTP 200
 // business rejection still needs both platform pacing headers.
 let endpointReply={code:99991400,data:null};
 const endpointServer=http.createServer((request,response)=>{
   request.resume();
   response.writeHead(200,{'content-type':'application/json','retry-after':'120','x-ogw-ratelimit-reset':'180'});
   response.end(JSON.stringify(endpointReply));
 });
 endpointServer.listen(0,'127.0.0.1');await once(endpointServer,'listening');
 let businessRateError;
 const defaultLimited=new WSClient({...options,domain:'http://127.0.0.1:'+endpointServer.address().port,
   initialConnectRetry:false,onError:error=>businessRateError=error});
 try {
   await defaultLimited.start({eventDispatcher:{invoke:async()=>{}}});
   await until(()=>businessRateError);
   assert.equal(businessRateError.code,99991400);
   assert.equal(businessRateError.retryable,true);
   assert.equal(businessRateError.retryAfterMs,180000);
   endpointReply={code:0,data:{URL:'ws://127.0.0.1:1?device_id=fixture&service_id=1',
     ClientConfig:{PingInterval:60,ReconnectCount:-1,ReconnectInterval:120,ReconnectNonce:30}}};
   const defaultSuccess=new WSClient({...options,domain:'http://127.0.0.1:'+endpointServer.address().port});
   try {
     assert.deepEqual(await defaultSuccess.pullConnectConfig(),{ok:true});
     assert.equal(defaultSuccess.wsConfig.getWS('connectUrl'),endpointReply.data.URL);
   } finally { defaultSuccess.close(); }
 } finally {
   defaultLimited.close();endpointServer.closeAllConnections();
   await new Promise(resolve=>endpointServer.close(resolve));
 }
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
