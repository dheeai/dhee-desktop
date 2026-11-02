const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {InMemoryTransport}=require('@modelcontextprotocol/sdk/inMemory.js');
const {createProductionMcpServer}=require('../dist/mcp.js');
async function harness(execute){
 const runtime=await createProductionMcpServer(execute,()=>{});
 const client=new Client({name:'desktop-acceptance',version:'1'});
 const [serverTransport,clientTransport]=InMemoryTransport.createLinkedPair();
 await runtime.server.connect(serverTransport);await client.connect(clientTransport);
 return {runtime,client,close:async()=>{await client.close();await runtime.drain();await runtime.server.close();}};
}
const call=(client,request,options)=>client.callTool({name:'dhee_production_control',arguments:{request}},undefined,options);
test('exposes supported actions and forwards the original request with an abort signal',async()=>{
 let received;const h=await harness(async(request,options)=>{received={request,options};return {ok:true,result:{gatedAfter:'review:references'}};});
 try{const tools=await h.client.listTools();assert.equal(tools.tools.length,1);assert.equal(tools.tools[0].name,'dhee_production_control');
 const request={action:'assembly.run',projectDir:'/project',nodeId:'clip',expectedSelectionId:null};const result=await call(h.client,request);
 assert.deepEqual(received.request,{...request,branchId:'main'});assert.equal(typeof received.options.signal.addEventListener,'function');assert.equal(result.isError,false);assert.deepEqual(result.structuredContent,{ok:true,result:{gatedAfter:'review:references'}});
 }finally{await h.close();}
});
test('reports outer and nested execution failures honestly',async()=>{
 for(const response of [{ok:false,error:'blocked'},{ok:true,result:{ok:false,error:'runner failed'}}]){
 const h=await harness(async()=>response);try{const result=await call(h.client,{action:'project.status',projectDir:'/project'});assert.equal(result.isError,true);assert.deepEqual(result.structuredContent,response);}finally{await h.close();}
 }
});
test('rejects unsupported operations and oversized requests before execution',async()=>{
 let executions=0;const h=await harness(async()=>{executions++;return {ok:true,result:{}};});
 try{assert.equal((await call(h.client,{action:'raw.submit'})).isError,true);
 const oversized=await call(h.client,{action:'gpu.catalog',endpoint:'x'.repeat(1024*1024+1)});assert.equal(oversized.isError,true);assert.match(oversized.structuredContent.error,/1 MiB/);assert.equal(executions,0);
 }finally{await h.close();}
});
test('forwards cancellation and disconnect to active engine requests',async()=>{
 for(const mode of ['cancel','disconnect']){
 let started,aborted;const ready=new Promise(r=>{started=r;});const stopped=new Promise(r=>{aborted=r;});
 const h=await harness(async(_request,{signal})=>new Promise(resolve=>{signal.addEventListener('abort',()=>{aborted();resolve({ok:false,error:'stopped'});},{once:true});started();}));
 const controller=new AbortController();const pending=call(h.client,{action:'project.run',projectDir:'/project'},{signal:controller.signal}).catch(()=>{});
 await ready;if(mode==='cancel')controller.abort();else await h.client.close();await stopped;await pending;await h.close();
 }
});
const {StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const {join}=require('node:path');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const entry=join(__dirname,'../dist/mcpStdio.js');
test('compiled stdio server negotiates and executes a real scene check',{timeout:6000},async()=>{
 const client=new Client({name:'stdio-acceptance',version:'1'});
 const transport=new StdioClientTransport({command:process.execPath,args:[entry],stderr:'pipe'});
 try{await client.connect(transport);assert.equal((await client.listTools()).tools.length,1);
 const result=await call(client,{action:'scene.check',sceneIntent:{requirements:[{id:'posture',description:'Doctor stays seated',expected:'seated',sources:['frame']}],sources:[{id:'frame',inputKey:'image',sha256:'a'.repeat(64),evidence:'Recorded observation',facts:{posture:'seated'}}]}});
 assert.equal(result.isError,false);assert.equal(result.structuredContent.result.status,'consistent');assert.equal(result.structuredContent.result.creativeApproval,'required');
 }finally{await client.close();}
});
test('stdio server exits on EOF and oversized transport messages',{timeout:6000},async(t)=>{
 for(const oversized of [false,true]){
 const child=spawn(process.execPath,[entry],{stdio:['pipe','pipe','pipe']});t.after(()=>child.kill());child.stdin.on('error',()=>{});
 const exited=once(child,'exit');if(oversized)child.stdin.write('x'.repeat(2*1024*1024+1));else child.stdin.end();
 const [code,signal]=await exited;assert.equal(signal,null);assert.equal(code,0);
 }
});

test('tool discovery describes exact execution and human review inputs',async()=>{
 const h=await harness(async()=>({ok:true,result:{}}));
 try{const schema=(await h.client.listTools()).tools[0].inputSchema.properties.request;
 const variants=schema.anyOf || schema.oneOf;assert.ok(variants,'action-specific schemas');
 const action=v=>v.properties.action.const || v.properties.action.enum[0];
 const byAction=Object.fromEntries(variants.map(v=>[action(v),v]));
 assert.equal(Object.keys(byAction).length,16);
 for(const [name,fields] of Object.entries({'gpu.run':['expectedSelectionId','nodeId'],'gpu.jobs':['operation'],'review.decide':['gate','expectedFingerprint','decision','humanAcknowledged'],'gpu.prepare':['sceneIntent','workflow','inputs']})){
 for(const field of fields)assert.ok(byAction[name].properties[field],name+': '+field);
 }
 }finally{await h.close();}
});
test('compiled server handles a broken output pipe without an unhandled crash',{timeout:6000},async(t)=>{
 const child=spawn(process.execPath,[entry],{stdio:['pipe','pipe','pipe']});t.after(()=>child.kill());child.stdin.on('error',()=>{});
 let errors='';child.stderr.on('data',chunk=>errors+=chunk);const exited=once(child,'exit');
 child.stdout.destroy();child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'disconnect',version:'1'}}})+'\n');
 const [code,signal]=await exited;assert.equal(signal,null);assert.equal(code,0);assert.doesNotMatch(errors,/Unhandled 'error'/);
});
test('output disconnect aborts and drains an active stdio operation',{timeout:6000},async(t)=>{
 const script=`require(${JSON.stringify(entry)}).startProductionStdio(async(_request,{signal})=>new Promise(resolve=>{signal.addEventListener('abort',()=>{setTimeout(()=>{process.stderr.write('DRAINED\\n');resolve({ok:false,error:'aborted'});},50);},{once:true});process.stderr.write('ACTIVE\\n');}));`;
 const child=spawn(process.execPath,['-e',script],{stdio:['pipe','pipe','pipe']});t.after(()=>child.kill());child.stdin.on('error',()=>{});
 let output='',errors='';let started;const active=new Promise(r=>started=r);child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>{errors+=chunk;if(errors.includes('ACTIVE'))started();});
 const exited=once(child,'exit');const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
 send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'active-disconnect',version:'1'}}});
 send({jsonrpc:'2.0',method:'notifications/initialized'});
 send({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'dhee_production_control',arguments:{request:{action:'project.run',projectDir:'/project'}}}});
 await active;child.stdout.destroy();send({jsonrpc:'2.0',id:3,method:'ping'});
 const [code,signal]=await exited;assert.equal(signal,null);assert.equal(code,0);assert.match(errors,/DRAINED/);assert.doesNotMatch(errors,/Unhandled 'error'/);
});
