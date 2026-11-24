'use strict';
let summarySequence=0,summaryAllCases=[],summaryLibrary=null,summaryErrorCount=0;
const summaryState={harness:'all',range:'all',metric:'responses',sort:'tokens'};
const summaryPhaseMeta={
  model_candidate:['Model wait · inferred','#4dbb91'],tool:['Tools','#5b8def'],wait:['Explicit waits','#f0a65a'],
  compaction:['Compaction','#a780d8'],unknown:['Unclassified','#a8b3ad'],stall:['Out of scope · inferred','#d6dcd7']
};
const summaryNumber=value=>Number.isFinite(value)?Math.max(0,value):0;
const summaryPercent=(value,total)=>total?value/total*100:0;
const summaryPercentLabel=(value,total)=>{const p=summaryPercent(value,total);return `${p>0&&p<1?p.toFixed(1):Math.round(p)}%`;};
const summaryDate=value=>new Intl.DateTimeFormat('en',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(value));
const summaryShortDate=value=>new Intl.DateTimeFormat('en',{month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(value));
const summaryHumanize=value=>String(value).replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
function summaryData(cases){
  const totals={sessions:cases.length,agents:0,children:0,multiAgent:0,responses:0,tools:0,turns:0,input:0,cached:0,uncached:0,output:0,reasoning:0,tokens:0,wall:0,net:0,outOfScope:0,messages:0,reports:0};
  const groups={harness:{},tools:{},models:{},days:{},time:{},collaboration:{}};
  const sessions=[];
  const ensure=(group,key,shape)=>group[key]||(group[key]={...shape});
  const dayFor=value=>ensure(groups.days,new Date(value).toISOString().slice(0,10),{sessions:0,responses:0,tools:0,input:0,output:0,tokens:0});
  const addDay=key=>{dayFor(key).sessions++;};
  for(const c of cases){
    const usage=c.usage||{},input=summaryNumber(usage.input_tokens),cached=Math.min(input,summaryNumber(usage.cached_input_tokens)),output=summaryNumber(usage.output_tokens);
    const wall=Math.max(0,c.end-c.start),scale=new NetTimeline(c,true),net=Math.max(0,scale.forward(c.end)-scale.forward(c.start));
    const agents=c.agents||[],children=Math.max(0,agents.length-1),harness=c.harness||'Unknown',dayKey=new Date(c.start).toISOString().slice(0,10);
    addDay(dayKey);const h=ensure(groups.harness,harness,{sessions:0,responses:0,tools:0,tokens:0});
    totals.agents+=agents.length;totals.children+=children;totals.multiAgent+=children>0?1:0;totals.input+=input;totals.cached+=cached;totals.output+=output;totals.reasoning+=summaryNumber(usage.reasoning_output_tokens);totals.wall+=wall;totals.net+=net;
    h.sessions++;h.tokens+=input+output;
    add(groups.collaboration,children?'Collaborative':'Single agent');
    const session={id:c.id,title:c.title||caseTitle(c),harness,start:c.start,end:c.end,agents:agents.length,children,responses:0,tools:0,input,cached,output,tokens:input+output,wall,net,outOfScope:wall-net,turns:0,anonymization:!!c.anonymization};
    for(const edge of c.edges||[]){if(edge.kind==='message')totals.messages++;if(edge.kind==='report')totals.reports++;}
    for(const a of agents){
      totals.turns+=(a.turns||[]).length;session.turns+=(a.turns||[]).length;
      for(const r of a.rounds||[]){
        const model=r.model||'Unavailable',m=ensure(groups.models,model,{responses:0,input:0,output:0,tokens:0}),responseDay=dayFor(r.time??c.start);
        const ri=summaryNumber(r.usage?.input_tokens),ro=summaryNumber(r.usage?.output_tokens);
        totals.responses++;session.responses++;h.responses++;responseDay.responses++;responseDay.input+=ri;responseDay.output+=ro;responseDay.tokens+=ri+ro;m.responses++;m.input+=ri;m.output+=ro;m.tokens+=ri+ro;
      }
      for(const s of a.spans||[])if(s.kind==='tool'){
        const label=s.label||'Unavailable';totals.tools++;session.tools++;h.tools++;dayFor(s.time??s.start??c.start).tools++;groups.tools[label]=(groups.tools[label]||0)+1;
      }
      for(const s of a.activities||[])groups.time[s.phase||'unknown']=(groups.time[s.phase||'unknown']||0)+Math.max(0,s.end-s.start);
    }
    sessions.push(session);
  }
  totals.uncached=Math.max(0,totals.input-totals.cached);totals.tokens=totals.input+totals.output;totals.outOfScope=Math.max(0,totals.wall-totals.net);
  return {totals,groups,sessions};
}
function add(group,key,value=1){group[key]=(group[key]||0)+value;}
function summaryIcon(name){
  const paths={
    sessions:'<rect x="4" y="5" width="16" height="14" rx="3"/><path d="M8 3v4m8-4v4M4 10h16M8 14h3m2 0h3"/>',
    responses:'<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="M19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/>',
    tools:'<path d="M8 9l-4 3 4 3m8-6 4 3-4 3m-3-9-2 12"/>',
    tokens:'<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m8 9 4-2 4 2-4 2-4-2Zm0 4 4 2 4-2"/>',
    time:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}
function summaryStatCard(icon,label,value,sub,accent,exactValue){
  return `<article class="summary-kpi" style="--summary-accent:${accent}"><div class="summary-kpi-top"><span>${escapeHTML(label)}</span><i>${summaryIcon(icon)}</i></div><strong${exactValue!=null?` title="${escapeHTML(exactValue)}"`:''}>${escapeHTML(value)}</strong><p>${sub}</p></article>`;
}
function summaryKpis(t){
  const cards=[
    ['sessions','Sessions',fmt(t.sessions),`${fmt(t.agents)} agent lanes · ${fmt(t.multiAgent)} collaborative`,'#4dbb91',exact(t.sessions)],
    ['responses','Model responses',fmt(t.responses),`${t.sessions?(t.responses/t.sessions).toFixed(1):'0'} per session · ${fmt(t.turns)} turns`,'#7c8df0',exact(t.responses)],
    ['tools','Tool calls',fmt(t.tools),`${t.responses?(t.tools/t.responses).toFixed(1):'0'} per response · model issued`,'#f0a65a',exact(t.tools)],
    ['tokens','Total tokens',fmt(t.tokens),`${fmt(t.input)} input · ${fmt(t.output)} output`,'#a780d8',exact(t.tokens)],
    ['time','Net observed time',duration(t.net),`${summaryPercentLabel(t.net,t.wall)} of wall · ${duration(t.outOfScope)} out of scope`,'#5b8def',null]
  ];
  return cards.map(c=>summaryStatCard(...c)).join('');
}
function summaryOptions(options,current){return options.map(([value,label])=>`<option value="${value}"${value===current?' selected':''}>${label}</option>`).join('');}
function summaryBucketStart(value,bucket){
  const d=new Date(value);d.setUTCHours(0,0,0,0);
  if(bucket==='week')d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);
  if(bucket==='month')d.setUTCDate(1);
  return d;
}
function summaryTrendSeries(days){
  const keys=Object.keys(days).sort();if(!keys.length)return {points:[],bucket:'day'};
  const span=new Date(keys.at(-1))-new Date(keys[0]),bucket=span>540*86400000?'month':span>45*86400000?'week':'day';
  const start=summaryBucketStart(keys[0],bucket),end=summaryBucketStart(keys.at(-1),bucket),points=[];
  for(let cursor=start;cursor<=end;){
    const key=cursor.toISOString().slice(0,10);points.push({key,date:new Date(cursor),sessions:0,responses:0,tools:0,tokens:0});
    cursor=bucket==='month'?new Date(Date.UTC(cursor.getUTCFullYear(),cursor.getUTCMonth()+1,1)):new Date(cursor.getTime()+(bucket==='week'?7:1)*86400000);
  }
  const byKey=new Map(points.map(p=>[p.key,p]));
  for(const [key,values] of Object.entries(days)){
    const point=byKey.get(summaryBucketStart(key,bucket).toISOString().slice(0,10));if(!point)continue;
    for(const field of ['sessions','responses','tools','tokens'])point[field]+=values[field];
  }
  return {points,bucket};
}
function summaryTrend(groups){
  const {points,bucket}=summaryTrendSeries(groups.days),metric=summaryState.metric,labels={responses:'Responses',tools:'Tool calls',tokens:'Tokens',sessions:'Sessions'};
  const W=760,H=260,L=54,R=20,T=20,B=202,iw=W-L-R,ih=B-T,values=points.map(p=>p[metric]),max=Math.max(1,...values);
  const coords=points.map((p,i)=>[L+(points.length===1?iw/2:i*iw/(points.length-1)),B-p[metric]/max*ih,p]);
  const line=coords.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' '),area=coords.length?`${line} L${coords.at(-1)[0]},${B} L${coords[0][0]},${B} Z`:'';
  let chart='';
  for(let i=0;i<=4;i++){const y=T+ih*i/4;chart+=`<line x1="${L}" x2="${W-R}" y1="${y}" y2="${y}" class="summary-chart-grid"/><text x="${L-10}" y="${y+4}" text-anchor="end" class="summary-chart-label">${fmt(max*(4-i)/4)}</text>`;}
  const tickCount=Math.min(5,points.length),ticks=points.length?(tickCount===1?[0]:Array.from(new Set(Array.from({length:tickCount},(_,i)=>Math.round(i*(points.length-1)/(tickCount-1)))))):[];
  for(const i of ticks){const [x,,p]=coords[i],label=bucket==='month'?new Intl.DateTimeFormat('en',{month:'short',year:'2-digit',timeZone:'UTC'}).format(p.date):summaryShortDate(p.date);chart+=`<text x="${x}" y="232" text-anchor="middle" class="summary-chart-label">${label}</text>`;}
  if(coords.length)chart+=`<defs><linearGradient id="summaryActivityGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4dbb91" stop-opacity=".38"/><stop offset="1" stop-color="#4dbb91" stop-opacity=".02"/></linearGradient></defs><path d="${area}" fill="url(#summaryActivityGradient)"/><path d="${line}" fill="none" stroke="#299c75" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  for(const [x,y,p] of coords){const period=bucket==='week'?`Week of ${summaryDate(p.date)}`:bucket==='month'?new Intl.DateTimeFormat('en',{month:'long',year:'numeric',timeZone:'UTC'}).format(p.date):summaryDate(p.date);chart+=`<circle cx="${x}" cy="${y}" r="4" class="summary-chart-point"><title>${period} · ${exact(p[metric])} ${labels[metric].toLowerCase()}</title></circle>`;}
  const peak=points.length?points.reduce((a,b)=>b[metric]>a[metric]?b:a):null,unit=bucket==='day'?'active days':bucket==='week'?'weeks':'months';
  return `<section class="summary-card summary-trend"><div class="summary-card-heading"><div><div class="eyebrow">ACTIVITY OVER TIME</div><h3>Usage rhythm</h3><p>${points.filter(p=>p[metric]>0).length} active ${unit} · ${bucket==='day'?'Daily':bucket==='week'?'Weekly':'Monthly'} view, UTC</p></div><label class="summary-inline-select"><span class="sr-only">Activity metric</span><select id="summaryMetric">${summaryOptions([['responses','Responses'],['tools','Tool calls'],['tokens','Tokens'],['sessions','Sessions']],metric)}</select></label></div><div class="summary-trend-chart">${points.length?`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${labels[metric]} over time">${chart}</svg>`:'<div class="summary-empty-chart">No activity in this selection.</div>'}</div><div class="summary-chart-foot"><span><i></i>${labels[metric]} per ${bucket}</span><strong>${peak?`Peak · ${fmt(peak[metric])} on ${summaryShortDate(peak.date)}`:'No recorded activity'}</strong></div></section>`;
}
function summaryDonut(parts,center,label,description){
  const total=parts.reduce((sum,p)=>sum+p.value,0);let offset=0;
  const segments=parts.filter(p=>p.value>0).map(p=>{const start=offset;offset+=summaryPercent(p.value,total);return `${p.color} ${start}% ${offset}%`;});
  return `<div class="summary-donut" role="img" aria-label="${escapeHTML(description)}" style="background:${segments.length?`conic-gradient(${segments.join(',')})`:'var(--line)'}"><div><strong>${escapeHTML(center)}</strong><span>${escapeHTML(label)}</span></div></div>`;
}
function summaryLegend(parts,format=fmt){const total=parts.reduce((sum,p)=>sum+p.value,0);return `<div class="summary-legend-list">${parts.map(p=>`<div><i style="background:${p.color}"></i><span>${escapeHTML(p.label)}</span><strong>${escapeHTML(format(p.value))}<small>${summaryPercentLabel(p.value,total)}</small></strong></div>`).join('')}</div>`;}
function summaryTokens(t){
  const parts=[{label:'Uncached input',value:t.uncached,color:'#4dbb91'},{label:'Cached input',value:t.cached,color:'#b9dfc9'},{label:'Output',value:t.output,color:'#f0a65a'}];
  return `<section class="summary-card summary-tokens"><div class="summary-card-heading"><div><div class="eyebrow">CONTEXT & OUTPUT</div><h3>Token anatomy</h3><p>Where recorded token volume comes from</p></div></div><div class="summary-token-layout">${summaryDonut(parts,fmt(t.tokens),'total tokens',`${exact(t.tokens)} total tokens`)}${summaryLegend(parts)}</div><div class="summary-insight"><span>Cache share</span><strong>${summaryPercentLabel(t.cached,t.input)} <small>of input</small></strong></div><p class="summary-card-note">Cached input is part of input, never added twice. ${fmt(t.reasoning)} reasoning tokens are included in output.</p></section>`;
}
function summaryTools(t,groups){
  const rows=Object.entries(groups.tools).sort((a,b)=>b[1]-a[1]),top=rows.slice(0,7),max=Math.max(1,...top.map(r=>r[1]));
  return `<section class="summary-card summary-tools"><div class="summary-card-heading"><div><div class="eyebrow">TOOL REPERTOIRE</div><h3>Most-used tools</h3><p>${rows.length} distinct tools across ${fmt(t.sessions)} sessions</p></div><span class="summary-header-stat">${t.responses?(t.tools/t.responses).toFixed(1):'0'}<small>calls / response</small></span></div><div class="summary-tool-list">${top.map(([label,value],i)=>`<div class="summary-tool-row"><span class="summary-rank">${String(i+1).padStart(2,'0')}</span><div><div><span title="${escapeHTML(label)}">${escapeHTML(label)}</span><strong>${fmt(value)}<small>${summaryPercentLabel(value,t.tools)}</small></strong></div><div class="summary-tool-meter"><span style="width:${summaryPercent(value,max)}%"></span></div></div></div>`).join('')||'<div class="summary-empty-chart">No tool calls recorded.</div>'}</div>${rows.length>top.length?`<p class="summary-card-note">Showing the top ${top.length} of ${rows.length} tools. Counts exclude nested executions.</p>`:'<p class="summary-card-note">Model-issued calls only; nested executions are excluded.</p>'}</section>`;
}
function summaryWorkflow(groups){
  const order=['model_candidate','tool','wait','compaction','unknown','stall'],known=new Set(order),entries=Object.entries(groups.time).sort((a,b)=>order.indexOf(a[0])-order.indexOf(b[0]));
  entries.sort((a,b)=>(known.has(a[0])?order.indexOf(a[0]):order.length)-(known.has(b[0])?order.indexOf(b[0]):order.length));
  const parts=entries.map(([phase,value])=>({label:summaryPhaseMeta[phase]?.[0]||summaryHumanize(phase),value,color:summaryPhaseMeta[phase]?.[1]||'#8fa39a'})),total=parts.reduce((s,p)=>s+p.value,0);
  return `<section class="summary-card summary-workflow"><div class="summary-card-heading"><div><div class="eyebrow">OBSERVED WORKFLOW</div><h3>Where agent time goes</h3><p>Classified intervals across every agent lane</p></div></div><div class="summary-workflow-layout">${summaryDonut(parts,duration(total),'agent time',`${duration(total)} of classified agent time`)}${summaryLegend(parts,duration)}</div><p class="summary-card-note">Model wait and silence are inferred. Parallel agents can contribute overlapping time.</p></section>`;
}
function summaryEcosystem(t,groups){
  const models=Object.entries(groups.models).sort((a,b)=>b[1].responses-a[1].responses).slice(0,4),harnesses=Object.entries(groups.harness).sort((a,b)=>b[1].sessions-a[1].sessions);
  return `<section class="summary-card summary-ecosystem"><div class="summary-card-heading"><div><div class="eyebrow">WAYS OF WORKING</div><h3>Collaboration & models</h3><p>How sessions and agents are organized</p></div></div><div class="summary-collaboration"><div><strong>${summaryPercentLabel(t.multiAgent,t.sessions)}</strong><span>of sessions use linked sub-agents</span></div><div class="summary-collab-track"><span style="width:${summaryPercent(t.multiAgent,t.sessions)}%"></span></div><div class="summary-collab-stats"><span><strong>${fmt(t.children)}</strong> linked sub-agents</span><span><strong>${fmt(t.messages)}</strong> messages</span><span><strong>${fmt(t.reports)}</strong> reports</span></div></div><div class="summary-subheading">Recorded model mix <span>responses</span></div><div class="summary-model-list">${models.map(([label,m])=>`<div><div><span title="${escapeHTML(label)}">${escapeHTML(label)}</span><strong>${fmt(m.responses)}<small>${summaryPercentLabel(m.responses,t.responses)}</small></strong></div><div class="summary-model-meter"><span style="width:${summaryPercent(m.responses,models[0]?.[1].responses||1)}%"></span></div></div>`).join('')||'<p class="muted">No model responses recorded.</p>'}</div><div class="summary-harnesses">${harnesses.map(([label,h])=>`<span><i></i>${escapeHTML(summaryHumanize(label))}<strong>${fmt(h.sessions)}</strong></span>`).join('')}</div></section>`;
}
function summarySessionTable(sessions,library){
  const sort=summaryState.sort,sorted=[...sessions].sort((a,b)=>b[sort]-a[sort]||b.tokens-a.tokens),rows=sorted.slice(0,8),labels={tokens:'Total tokens',responses:'Responses',tools:'Tool calls',net:'Net time',wall:'Wall time',agents:'Agents'};
  return `<section class="summary-card summary-sessions"><div class="summary-card-heading"><div><div class="eyebrow">SESSION EXPLORER</div><h3>Standout sessions</h3><p>Top ${rows.length} of ${sessions.length} · select a session to inspect its trace</p></div><label class="summary-inline-select"><span class="sr-only">Sort sessions</span><select id="summarySessionSort">${summaryOptions(Object.entries(labels),sort)}</select></label></div><div class="summary-table-wrap"><table><thead><tr><th>SESSION</th><th>HARNESS</th><th>AGENTS</th><th>RESPONSES</th><th>TOOLS</th><th>TOKENS</th><th>NET / WALL</th></tr></thead><tbody>${rows.map(s=>{const masked=s.anonymization||library?.anonymization,title=masked?caseTitle(s):s.title;return `<tr><td><button class="summary-session-link" data-case="${escapeHTML(s.id)}" title="${escapeHTML(title)}"><strong>${escapeHTML(title)}</strong><span>${summaryDate(s.start)} · ${escapeHTML(s.id.slice(0,8))}</span></button></td><td><span class="summary-harness-tag">${escapeHTML(s.harness)}</span></td><td>${s.agents}${s.children?`<small>+${s.children} linked</small>`:''}</td><td>${fmt(s.responses)}</td><td>${fmt(s.tools)}</td><td><strong title="${exact(s.tokens)}">${fmt(s.tokens)}</strong></td><td>${duration(s.net)}<small>${duration(s.wall)} wall</small></td></tr>`;}).join('')}</tbody></table></div></section>`;
}
function summaryFilteredCases(){
  let cases=summaryAllCases.filter(c=>summaryState.harness==='all'||(c.harness||'Unknown')===summaryState.harness);
  if(summaryState.range!=='all'&&cases.length){const latest=Math.max(...cases.map(c=>c.start)),cutoff=latest-Number(summaryState.range)*86400000;cases=cases.filter(c=>c.start>=cutoff);}
  return cases;
}
function renderSummary(){
  const cases=summaryFilteredCases(),{totals:t,groups,sessions}=summaryData(cases);
  $('summaryHarness').value=summaryState.harness;$('summaryRange').value=summaryState.range;
  const latest=cases.length?Math.max(...cases.map(c=>c.start)):null;
  $('summaryStatus').innerHTML=`Showing <strong>${cases.length}</strong> of ${summaryAllCases.length} sessions${latest?` · through ${summaryDate(latest)}`:''}${summaryErrorCount?` · ${summaryErrorCount} file/import errors`:''}`;
  if(!cases.length){$('summaryStats').innerHTML='';$('summaryCharts').innerHTML='<section class="summary-card summary-no-results"><div class="summary-empty-glyph">⌁</div><h3>No sessions in this view</h3><p>Try another harness or a wider time range.</p><button id="summaryClearFilters" class="button">Clear filters</button></section>';return;}
  $('summaryStats').innerHTML=summaryKpis(t);
  $('summaryCharts').innerHTML=summaryTrend(groups)+summaryTokens(t)+summaryTools(t,groups)+summaryWorkflow(groups)+summaryEcosystem(t,groups)+summarySessionTable(sessions,summaryLibrary);
}
async function refreshSummary(){
  const seq=++summarySequence;
  $('refreshSummary').disabled=true;$('summaryStatus').textContent='Reading normalized database…';
  try{
    let library;
    try{library=await fetchJSON('/api/library');if(!Array.isArray(library.cases))throw Error('No library API');}
    catch{library=await fetchJSON('/data/index.json');}
    const results=await Promise.all(library.cases.map(async row=>{
      try{return {caseData:classifyStalls(await fetchJSON('/data/'+encodeURIComponent(row.file)))};}
      catch(error){return {error:row.file};}
    }));
    if(seq!==summarySequence)return;
    summaryAllCases=results.filter(r=>r.caseData).map(r=>r.caseData);summaryLibrary=library;summaryErrorCount=results.filter(r=>r.error).length+(library.errors?.length||0);
    const harnesses=[...new Set(summaryAllCases.map(c=>c.harness||'Unknown'))].sort();
    if(summaryState.harness!=='all'&&!harnesses.includes(summaryState.harness))summaryState.harness='all';
    $('summaryHarness').innerHTML=`<option value="all">All harnesses</option>${harnesses.map(h=>`<option value="${escapeHTML(h)}">${escapeHTML(summaryHumanize(h))}</option>`).join('')}`;
    index=library;renderCases();renderSummary();
  }catch(error){$('summaryStatus').textContent='Could not refresh summary. '+error.message;}
  finally{if(seq===summarySequence)$('refreshSummary').disabled=false;}
}
function showPage(summary){
  $('summaryPage').hidden=!summary;$('sessionPage').hidden=summary;
  $('tracesTab').setAttribute('aria-pressed',String(!summary));$('summaryTab').setAttribute('aria-pressed',String(summary));
  if(summary)refreshSummary();
}
$('summaryTab').addEventListener('click',()=>showPage(true));
$('tracesTab').addEventListener('click',()=>showPage(false));
$('refreshSummary').addEventListener('click',refreshSummary);
$('summaryHarness').addEventListener('change',()=>{summaryState.harness=$('summaryHarness').value;renderSummary();});
$('summaryRange').addEventListener('change',()=>{summaryState.range=$('summaryRange').value;renderSummary();});
document.addEventListener('change',e=>{
  if(e.target.id==='summaryMetric'){summaryState.metric=e.target.value;renderSummary();}
  if(e.target.id==='summarySessionSort'){summaryState.sort=e.target.value;renderSummary();}
});
document.addEventListener('click',e=>{if(e.target.closest('#summaryClearFilters')){summaryState.harness='all';summaryState.range='all';renderSummary();}});
function applyTheme(dark){
  document.documentElement.dataset.theme=dark?'dark':'light';
  $('themeButton').textContent=dark?'Light mode':'Dark mode';$('themeButton').setAttribute('aria-pressed',String(dark));
}
let darkTheme=false;
try{darkTheme=localStorage.getItem('swimlane-theme')==='dark';}catch{}
applyTheme(darkTheme);
$('themeButton').addEventListener('click',()=>{
  darkTheme=!darkTheme;applyTheme(darkTheme);
  try{localStorage.setItem('swimlane-theme',darkTheme?'dark':'light');}catch{}
});
