// Run rendering and interaction logic against a minimal DOM contract.
// This verifies code/data integration, not browser layout or accessibility.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'), nodes=new Map();
class Element {
  constructor(id){this.id=id;this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.textContent='';this.innerHTML='';this.events={};}
  addEventListener(name,fn){this.events[name]=fn;}
  setAttribute(key,value){this[key]=value;}
  showModal(){this.open=true;}
  close(){this.open=false;}
  getBoundingClientRect(){return {left:0,width:1000};}
  setPointerCapture(){this.captured=true;}
}
const html=fs.readFileSync(path.join(root,'web/index.html'),'utf8');
for(const [,id] of html.matchAll(/id="([^"]+)"/g))nodes.set(id,new Element(id));
for(const [,id] of html.matchAll(/id="([^"]+)"[^>]*\bchecked/g))nodes.get(id).checked=true;
const sandbox={console,Intl,Date,Map,Blob,URL,setTimeout,clearTimeout,location:{hash:''},history:{replaceState(){}},
 document:{documentElement:{dataset:{}},getElementById(id){assert(nodes.has(id),`Missing HTML element ${id}`);return nodes.get(id);},addEventListener(){},createElement(){return {click(){}};}},
 fetch:async url=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(path.join(root,url),'utf8'))})};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root,'web/timeline.js'),'utf8'),sandbox);
vm.runInContext(fs.readFileSync(path.join(root,'web/app.js'),'utf8'),sandbox);
vm.runInContext(fs.readFileSync(path.join(root,'web/summary.js'),'utf8'),sandbox);
const run=code=>vm.runInContext(code,sandbox);
run(`{
 const scale=new NetTimeline({start:0,end:1000000,agents:[{turns:[{start:0,end:1000},{start:900000,end:1000000}]}]},true);
 if(scale.forward(900000)!==1000 || scale.inverse(2000)!==901000)throw Error('Net timeline mapping failed');
 const stalled={start:0,end:1000000,agents:[{turns:[{start:0,end:1000000}],rounds:[{time:0},{time:1000000}],spans:[{time:100,start:100,end:999900}],messages:[]}]};
 const compressed=new NetTimeline(stalled,true);
 if(compressed.forward(1000000)!==200)throw Error('In-turn stall was retained');
 stalled.agents.push({turns:[{start:0,end:1000000}],rounds:Array.from({length:11},(_,i)=>({time:i*100000})),spans:[],messages:[]});
 if(new NetTimeline(stalled,true).gaps.length)throw Error('Parallel evidence was removed');
 const overlapping=new NetTimeline({start:0,end:1000000,agents:[{turns:[{start:0,end:1000000}]},{turns:[{start:900000,end:1000000}]}]},true);
 if(overlapping.gaps.length)throw Error('Active parallel turn was removed');
}`);
(async()=>{
 await new Promise(resolve=>setTimeout(resolve,50));
 assert.equal(nodes.get('status').textContent,'');
 assert(nodes.get('timeline').innerHTML.includes('<svg'));
 assert(!nodes.get('timeline').innerHTML.includes('NaN'));
 assert.equal(run('elapsed(0)'),'T');
 assert.equal(run('elapsed(90000)'),'T + 1 m 30 s');
 assert.equal(run('elapsed(3600000)'),'T + 1 h');
 // Small mouse movement must preserve the mark and select its original event.
 const bar=run('allEvents.find(e=>e.kind==="tool")');
 const canvas=nodes.get('timeline');
 const target={closest:()=>({dataset:{event:bar.id}})};
 canvas.events.pointerdown({button:0,clientX:400,pointerId:1,shiftKey:false,target});
 const before=canvas.innerHTML;
 canvas.events.pointermove({clientX:402,pointerId:1});
 assert.equal(canvas.innerHTML,before);
 assert(!canvas.captured);
 canvas.events.pointerup({clientX:402,pointerId:1});
 assert.equal(run('selected'),bar.id);
 assert.equal(nodes.get('inspectTitle').textContent,bar.label);
 // A real pan must not turn into bar selection.
 run('selected=null');
 canvas.events.pointerdown({button:0,clientX:400,pointerId:2,shiftKey:false,target});
 canvas.events.pointermove({clientX:430,pointerId:2});
 assert(canvas.captured);
 canvas.events.pointerup({clientX:430,pointerId:2});
 assert.equal(run('selected'),null);
 const idx=JSON.parse(fs.readFileSync(path.join(root,'data/index.json'),'utf8'));
 for(const c of idx.cases){
  await run(`loadCase(${JSON.stringify(c.id)})`);
  assert.equal(nodes.get('status').textContent,'');
  nodes.get('ledgerAgent').value='all';
  nodes.get('showActivity').checked=true;nodes.get('showActivity').events.change();
  for(const label of ['url(#inferredHatch)'])assert(nodes.get('timeline').innerHTML.includes(label));
  for(const a of run('trace.agents')){
   nodes.get('agentSelect').value=a.id;nodes.get('agentSelect').events.change();
   nodes.get('fitButton').events.click();
   assert(nodes.get('tokenChart').innerHTML.includes('<svg'));
   assert(!nodes.get('tokenChart').innerHTML.includes('NaN'));
  }
  for(const kind of ['activity','round','tool','execution','message','lifecycle','compaction','text']){
   const event=run(`allEvents.find(e=>e.kind===${JSON.stringify(kind)})`);
   if(event){run(`selectEvent(${JSON.stringify(event.id)})`);assert(nodes.get('inspectorBody').innerHTML.includes('Provenance'));}
   nodes.get('kindSelect').value=kind;nodes.get('kindSelect').events.change();
  }
  nodes.get('zoomIn').events.click();nodes.get('zoomOut').events.click();nodes.get('panRight').events.click();nodes.get('panLeft').events.click();
  if(c.agents>1)nodes.get('collabButton').events.click();
  nodes.get('showNested').checked=true;nodes.get('showNested').events.change();
  assert(!nodes.get('timeline').innerHTML.includes('NaN'));
  const activity=run('allEvents.find(e=>e.kind==="activity" && e.evidence_ids.length)');
  assert(activity);run(`selectEvent(${JSON.stringify(activity.id)})`);
  assert(nodes.get('inspectorBody').innerHTML.includes('SUPPORTING EVENTS'));
  assert(activity.evidence_ids.every(id=>run(`eventMap.has(${JSON.stringify(id)})`)));
  nodes.get('showActivity').checked=false;nodes.get('showActivity').events.change();
  assert(!nodes.get('timeline').innerHTML.includes('fill="url(#inferredHatch)"')); 
 }
 nodes.get('eventSearch').value='no-match-unique-test';nodes.get('eventSearch').events.input();assert(nodes.get('events').innerHTML.includes('No events match'));
 await run('refreshSummary()');
 assert(nodes.get('summaryCharts').innerHTML.includes('Usage rhythm'));
 assert(nodes.get('summaryCharts').innerHTML.includes('Token anatomy'));
 assert(nodes.get('summaryCharts').innerHTML.includes('Standout sessions'));
 assert(nodes.get('summaryStats').innerHTML.includes('out of scope'));
 assert(!nodes.get('summaryCharts').innerHTML.includes('NaN'));
 const sample=run(`summaryData([{id:'sample',title:'Sample',harness:'codex',start:0,end:300000,usage:{input_tokens:200,cached_input_tokens:120,output_tokens:40,reasoning_output_tokens:10},edges:[{kind:'message'},{kind:'report'}],agents:[{turns:[{id:'t1',start:0,end:1000},{id:'t2',start:299000,end:300000}],rounds:[{time:500,turn_id:'t1',model:'model-a',usage:{input_tokens:100,cached_input_tokens:60,output_tokens:20}},{time:299500,turn_id:'t2',model:'model-a',usage:{input_tokens:100,cached_input_tokens:60,output_tokens:20}}],spans:[{kind:'tool',label:'shell',time:100,start:100,end:200,turn_id:'t1'}],messages:[],activities:[{phase:'model_candidate',start:0,end:100},{phase:'tool',start:100,end:200}]}]}])`);
 assert.equal(sample.totals.sessions,1);assert.equal(sample.totals.responses,2);assert.equal(sample.totals.tools,1);
 assert.equal(sample.totals.tokens,240);assert.equal(sample.totals.cached,120);assert.equal(sample.totals.uncached,80);
 assert.equal(sample.totals.wall,300000);assert.equal(sample.totals.net,2000);assert.equal(sample.totals.outOfScope,298000);
 assert.equal(sample.totals.messages,1);assert.equal(sample.totals.reports,1);assert.equal(sample.groups.models['model-a'].responses,2);
 assert.equal(sample.groups.days['1970-01-01'].tokens,240);assert.equal(run('summaryData([])').totals.tokens,0);
 const dated=run(`summaryData([{id:'dated',title:'Dated',harness:'codex',start:0,end:90000000,usage:{input_tokens:2,output_tokens:1},agents:[{turns:[],rounds:[{time:86400000,model:'model-a',usage:{input_tokens:2,output_tokens:1}}],spans:[{kind:'tool',label:'Read',time:86400000}],activities:[]}]}])`);
 assert.equal(dated.groups.days['1970-01-01'].sessions,1);assert.equal(dated.groups.days['1970-01-01'].tokens,0);
 assert.equal(dated.groups.days['1970-01-02'].responses,1);assert.equal(dated.groups.days['1970-01-02'].tools,1);assert.equal(dated.groups.days['1970-01-02'].tokens,3);
 const singlePoint=run(`summaryTrend({days:{'2026-01-01':{sessions:1,responses:2,tools:1,tokens:240}}})`);
 assert(singlePoint.includes('<svg'));assert(!singlePoint.includes('NaN'));
 run(`summaryState.metric='tokens';summaryState.sort='net';renderSummary()`);
 assert(nodes.get('summaryCharts').innerHTML.includes('Tokens per day')||nodes.get('summaryCharts').innerHTML.includes('Tokens per week'));
 assert(!nodes.get('summaryCharts').innerHTML.includes('NaN'));
 nodes.get('summaryRange').value='30';nodes.get('summaryRange').events.change();assert(nodes.get('summaryStatus').innerHTML.includes('Showing'));
 nodes.get('summaryRange').value='all';nodes.get('summaryRange').events.change();
 run(`summaryState.metric='responses';summaryState.sort='tokens';renderSummary()`);
 nodes.get('themeButton').events.click();assert.equal(sandbox.document.documentElement.dataset.theme,'dark');
 nodes.get('themeButton').events.click();assert.equal(sandbox.document.documentElement.dataset.theme,'light');
 assert.equal(run(`escapeHTML('<script>"&')`),'&lt;script&gt;&quot;&amp;');
 nodes.get('methodButton').events.click();assert(nodes.get('methodDialog').open);nodes.get('closeMethod').events.click();assert(!nodes.get('methodDialog').open);
 console.log(`UI logic passed: ${idx.cases.length} cases, all agents, timeline, charts, inspector, filters, zoom, empty state, escaping, help.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
