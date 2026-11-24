'use strict';
const $ = id => document.getElementById(id);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => n == null ? '—' : Intl.NumberFormat('en', {notation:'compact', maximumFractionDigits:1}).format(n);
const exact = n => n == null ? 'Unavailable' : Number(n).toLocaleString();
const date = t => new Date(t).toLocaleDateString(undefined, {month:'short',day:'numeric'});
const time = t => new Date(t).toLocaleTimeString(undefined, {hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
const elapsed = ms => {const seconds=Math.max(0,Math.round(ms/1000));if(!seconds)return 'T';const h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),sec=seconds%60;return 'T + '+[h?h+' h':'',m?m+' m':'',sec?sec+' s':''].filter(Boolean).join(' ');};
const duration = ms => ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${(ms/1000).toFixed(1)} s` : ms < 3600000 ? `${(ms/60000).toFixed(1)} min` : `${(ms/3600000).toFixed(1)} h`;
const palette = ['#286750','#87aa93','#c97c4b','#658a99','#8b77ac','#bdad77','#a2aaa1'];
let timelineScale, dragStart=null, suppressClick=false;
let index, trace, allEvents = [], eventMap = new Map(), view = [0,1], selected = null, agentId, page = 0, loadSequence = 0;

async function fetchJSON(url) {
  const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json();
}
function agentName(id) { const a=trace.agents.find(a=>a.id===id); return a ? a.path==='/root' ? 'Main agent' : a.path.split('/').pop() : 'Unavailable agent'; }
function inView(e) { return e.time >= view[0] && e.time <= view[1] || e.start != null && e.start <= view[1] && (e.end ?? e.start) >= view[0]; }
function eventAttrs(e) { return `data-event="${escapeHTML(e.id)}" tabindex="0" role="button" aria-label="${escapeHTML(e.label)}" class="svg-event${selected===e.id?' selected':''}"`; }
function caseTitle(c) {return 'Session '+c.id.replace(/^claude-/, '').replace(/-/g,'').slice(0,12);}
function renderCases() {
  const q=$('caseSearch').value.toLowerCase();
  const cases=index.cases.filter(c=>(!$('multiOnly').checked || c.agents>1) && (caseTitle(c)+' '+c.id+' '+c.title).toLowerCase().includes(q));
  $('cases').innerHTML=cases.map(c=>`<button class="case-card ${trace?.id===c.id?'active':''}" data-case="${escapeHTML(c.id)}"><div class="case-date"><span>${date(c.started)} · ${escapeHTML(c.harness||"codex").toUpperCase()}</span><span class="dot-tag">${c.agents>1?'↗ '+(c.agents-1)+' sub-agents':'Single agent'}</span></div><strong title="${escapeHTML(index.anonymization?caseTitle(c):c.title)}">${escapeHTML(caseTitle(c))}</strong><div class="case-detail"><span>${c.rounds} responses</span><span>${c.calls} tools</span></div></button>`).join('') || '<div class="empty-state">No sessions match this filter.</div>';
}
async function loadCase(id) {
  const seq=++loadSequence;
  const item=index.cases.find(c=>c.id===id); if(!item) return;
  $('status').textContent='Loading session…';
  try {
    const data=await fetchJSON(`/data/${encodeURIComponent(item.file)}`); if(seq!==loadSequence)return;
    trace=classifyStalls(data); agentId=trace.agents[0].id; selected=null; page=0;
    allEvents=trace.agents.flatMap(a=>[...a.rounds,...a.spans,...a.messages,...(a.activities||[])]).sort((a,b)=>a.time-b.time || a.source.line-b.source.line);
    eventMap=new Map(allEvents.map(e=>[e.id,e]));
    view=trace.focus ? [...trace.focus] : [trace.start, trace.end];
    if(view[1]<=view[0])view[1]=view[0]+1000;
    $('caseTitle').textContent=trace.anonymization?'Session '+trace.id.slice(0,12):trace.title;
    $('caseMeta').textContent=`SESSION ${trace.id.slice(0,8)} / ${date(trace.start)} / ${trace.harness.toUpperCase()} ${trace.agents[0].cli_version || ''}`;
    const u=trace.usage;
    const stats=[['Agents',trace.agents.length,`${trace.agents.length-1} linked sub-agents`],['Model responses',allEvents.filter(e=>e.kind==='round').length,'Whole session · all agents'],['Tool calls',allEvents.filter(e=>e.kind==='tool').length,'Model-issued · excludes nested'],['Input tokens',fmt(u.input_tokens),'Cumulative · includes cached'],['Output tokens',fmt(u.output_tokens),'Cumulative · all agents']];
    $('stats').innerHTML=stats.map(([l,v,s])=>`<div class="stat"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${s}</div></div>`).join('');
    const options=trace.agents.map(a=>`<option value="${escapeHTML(a.id)}">${escapeHTML(agentName(a.id))}${a.nickname?' · '+escapeHTML(a.nickname):''}</option>`).join('');
    $('agentSelect').innerHTML=options; $('ledgerAgent').innerHTML='<option value="all">All agents</option>'+options;
    $('turnSelect').innerHTML='<option value="all">Entire session</option>'+trace.agents[0].turns.map((t,i)=>`<option value="${i}">${i+1}. ${escapeHTML(t.title.slice(0,80))}</option>`).join('');
    $('collabButton').disabled=!trace.focus;
    $('kindSelect').value='all'; $('eventSearch').value='';
    $('footer').textContent=`${trace.source_files.length} local source files · Imported ${new Date(index.imported_at).toLocaleString()} · No model or network API calls`;
    $('status').textContent=''; $('workspace').hidden=false;
    history.replaceState(null,'',`#${trace.id}`);
    renderCases(); renderView(); renderComposition(); renderInspector();
  } catch(e) { $('status').textContent=`Could not load this trace. ${e.message}`; }
}
function setView(start,end) {
  const whole=Math.max(1000,trace.end-trace.start), span=Math.min(whole,Math.max(1000,end-start));
  start=Math.max(trace.start,Math.min(start,trace.end-span)); view=[start,start+span];page=0;renderView();
}
function renderView() { renderTimeline();renderTokens();renderLedger();$('rangeLabel').textContent=`${$('netTime').checked?'Net elapsed':'Wall elapsed'} · ${duration(new NetTimeline(trace,$('netTime').checked).forward(view[1])-new NetTimeline(trace,$('netTime').checked).forward(view[0]))} window`; }
function renderTimeline() {
  const W=1000,L=160,R=24,row=64,top=40,H=top+trace.agents.length*row+22;
  timelineScale = new NetTimeline(trace, $('netTime').checked);
  const v0=timelineScale.forward(view[0]),v1=timelineScale.forward(view[1]);
  const x=t=>L+(timelineScale.forward(t)-v0)/Math.max(1,v1-v0)*(W-L-R), clip=t=>Math.max(L,Math.min(W-R,x(t)));
  let s=`<svg viewBox="0 0 ${W} ${H}" aria-label="Agent swimlane timeline"><defs><pattern id="inferredHatch" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#afcdb9"/><path d="M-1,1 L1,-1 M0,6 L6,0 M5,7 L7,5" stroke="#286750" stroke-width="1"/></pattern><marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#c97c4b"/></marker><clipPath id="plotClip"><rect x="${L}" y="30" width="${W-L-R}" height="${H-30}"/></clipPath></defs>`;
  for(let i=0;i<=5;i++){const xx=L+i*(W-L-R)/5,t=timelineScale.inverse(v0+i*(v1-v0)/5);s+=`<line x1="${xx}" x2="${xx}" y1="31" y2="${H-16}" stroke="#e5e9df" stroke-dasharray="2 4"/><text x="${xx}" y="18" text-anchor="${i===0?'start':i===5?'end':'middle'}" fill="#7a877d" font-size="10">${elapsed(v0+i*(v1-v0)/5-timelineScale.forward(trace.start))}</text>`;}
  trace.agents.forEach((a,i)=>{
    const y=top+i*row, rs=a.rounds.filter(inView), tools=a.spans.filter(e=>e.kind==='tool'&&inView(e));
    s+=`<rect x="0" y="${y}" width="${W}" height="${row}" fill="${i%2?'#f7f8f2':'transparent'}"/><text x="20" y="${y+24}" fill="#24382f" font-size="12" font-weight="600">${escapeHTML(agentName(a.id).slice(0,22))}</text><text x="20" y="${y+38}" fill="#7a877d" font-size="9">${a.nickname?escapeHTML(a.nickname.slice(-12))+' · ':''}${rs.length} responses in view</text><text x="20" y="${y+51}" fill="#7a877d" font-size="9">${tools.length} tool calls in view</text>`;
    s+='<g clip-path="url(#plotClip)">';
    for(const t of a.turns){if(t.start>view[1]||(t.end??t.start)<view[0])continue; s+=`<rect x="${clip(t.start)}" y="${y+13}" width="${Math.max(1,clip(t.end??t.start)-clip(t.start))}" height="46" fill="#eaf0e4" opacity=".65"><title>Turn envelope; gaps are not necessarily model compute</title></rect>`;}
    if($('showActivity').checked)for(const e of (a.activities||[]).filter(inView)){
      const fill=e.resource==='gpu'?'url(#inferredHatch)':e.resource==='cpu'?'#658a99':e.phase==='wait'?'#c97c4b':e.phase==='compaction'?'#8b77ac':'#d1d4cc';
      s+=`<rect ${eventAttrs(e)} x="${clip(e.start)}" y="${y+24}" width="${Math.max(1,clip(e.end)-clip(e.start))}" height="8" fill="${fill}"><title>${escapeHTML(e.label)} · ${e.confidence}</title></rect>`;
    }
    for(const e of a.spans.filter(inView)){
      if(e.kind==='execution'&&!$('showNested').checked)continue;
      const yy=y+(e.kind==='tool'?35:e.kind==='execution'?49:e.kind==='compaction'?15:52);
      const color=e.kind==='tool'?'#658a99':e.kind==='execution'?'#b8c9d0':e.kind==='compaction'?'#8b77ac':'#c97c4b';
      s+=`<rect ${eventAttrs(e)} x="${clip(e.start??e.time)}" y="${yy}" width="${Math.max(3,clip(e.end??e.start??e.time)-clip(e.start??e.time))}" height="${e.kind==='execution'?7:11}" rx="2" fill="${color}"><title>${escapeHTML(e.label)} · ${escapeHTML(e.model||'Model unavailable')} · ${time(e.time)}${e.end!=null?' · '+duration(e.end-e.start):' · end unavailable'}</title></rect>`;
    }
    for(const e of rs){const xx=clip(e.time);s+=`<path ${eventAttrs(e)} d="M${xx},${y+13} l4,5 -4,5 -4,-5 Z" fill="#286750"><title>${escapeHTML(e.label)} · ${escapeHTML(e.model||'Model unavailable')}: ${exact(e.usage.input_tokens)} input / ${exact(e.usage.output_tokens)} output</title></path>`;}
    s+='</g>';
    s+=`<line x1="0" x2="${W}" y1="${y+row}" y2="${y+row}" stroke="#e8ece1"/>`;
  });
  for(const e of trace.edges){if(e.time<view[0]||e.time>view[1])continue;const from=trace.agents.findIndex(a=>a.id===e.from),to=trace.agents.findIndex(a=>a.id===e.to);if(from<0||to<0||from===to)continue;const xx=x(e.time),y1=top+from*row+52,y2=top+to*row+22; s+=`<g ${e.event_id?`data-event="${escapeHTML(e.event_id)}" tabindex="0" role="button" class="svg-event"`:''}><path d="M${xx},${y1} C${xx+12},${y1} ${xx+12},${y2} ${xx},${y2}" fill="none" stroke="#c97c4b" stroke-width="1.5" ${e.kind==='spawn'?'stroke-dasharray="4 3"':''} marker-end="url(#arrow)"/><circle cx="${xx}" cy="${y1}" r="3" fill="#c97c4b"/><title>${e.kind}: ${escapeHTML(agentName(e.from))} → ${escapeHTML(agentName(e.to))} · ${e.confidence} · receipt/start timestamp</title></g>`;}
  for(const gap of timelineScale.gaps){if(gap[1]<view[0]||gap[0]>view[1])continue;const xx=x(gap[0]);s+=`<path d="M${xx-3},30 l6,6 -6,6" stroke="#9b7760" fill="none"><title>Removed observation gap (inferred out of scope): ${duration(gap[1]-gap[0])}</title></path>`;}
  s+='<line id="alignmentLine" x1="0" x2="0" y1="30" y2="'+H+'" stroke="#b35b32" stroke-dasharray="3 2" visibility="hidden" pointer-events="none"/><text id="alignmentLabel" y="28" fill="#b35b32" font-size="10"></text></svg>';$('timeline').innerHTML=s;
}
function renderTokens() {
  const a=trace.agents.find(a=>a.id===agentId), rs=a.rounds.filter(inView);
  if(!rs.length){$('tokenChart').innerHTML='<div class="empty-state">No responses for this agent in the selected time window. Choose another agent or Fit all.</div>';return;}
  const W=1000,H=205,L=55,R=58,T=16,B=160,iw=W-L-R;
  const maxIn=Math.max(1,...rs.map(r=>r.usage.input_tokens||0)),maxOut=Math.max(1,...rs.map(r=>r.usage.output_tokens||0));
  const bw=Math.min(28,iw/rs.length*.7),xx=i=>L+(i+.5)*iw/rs.length;
  let s=`<svg viewBox="0 0 ${W} ${H}" aria-label="Input and output tokens per recorded response">`;
  for(let i=0;i<=4;i++){const y=B-(B-T)*i/4;s+=`<line x1="${L}" x2="${W-R}" y1="${y}" y2="${y}" stroke="#e7ebe2"/><text x="${L-9}" y="${y+3}" text-anchor="end" font-size="9" fill="#7a877d">${fmt(maxIn*i/4)}</text><text x="${W-R+9}" y="${y+3}" font-size="9" fill="#c97c4b">${fmt(maxOut*i/4)}</text>`;}
  const pts=[];
  rs.forEach((r,i)=>{
    const input=r.usage.input_tokens||0, cached=Math.min(input,r.usage.cached_input_tokens||0),height=input/maxIn*(B-T),ch=cached/maxIn*(B-T),x=xx(i);
    s+=`<g ${eventAttrs(r)}><rect x="${x-bw/2}" y="${B-height}" width="${bw}" height="${height}" rx="1" fill="#286750"/><rect x="${x-bw/2}" y="${B-ch}" width="${bw}" height="${ch}" fill="#afcdb9"/><title>${r.label}: ${exact(input)} input (${exact(cached)} cached), ${exact(r.usage.output_tokens)} output</title></g>`;
    if(i===0||i===rs.length-1||i%Math.max(1,Math.floor(rs.length/8))===0)s+=`<text x="${x}" y="180" font-size="9" fill="#7a877d" text-anchor="middle">#${r.number}</text>`;
    pts.push([x,B-(r.usage.output_tokens||0)/maxOut*(B-T),r]);
  });
  s+=`<polyline points="${pts.map(p=>`${p[0]},${p[1]}`).join(' ')}" stroke="#c97c4b" stroke-width="1.5" fill="none" pointer-events="none"/>`;
  for(const [x,y,r] of pts)s+=`<circle ${eventAttrs(r)} cx="${x}" cy="${y}" r="3" fill="#c97c4b"><title>${r.label}: ${exact(r.usage.output_tokens)} output</title></circle>`;
  s+=`<text x="${L}" y="199" font-size="9" fill="#7a877d">Response order · ${rs.length} in current time window · input left axis / output right axis</text></svg>`;
  $('tokenChart').innerHTML=s;
}
function renderComposition() {
  const a=trace.agents.find(a=>a.id===agentId), entries=Object.entries(a.content_chars).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]), total=entries.reduce((s,[,v])=>s+v,0);
  $('composition').innerHTML=`<div class="composition-bar">${entries.map(([k,v],i)=>`<span style="width:${v/total*100}%;background:${palette[i%palette.length]}" title="${escapeHTML(k)}: ${exact(v)} visible characters"></span>`).join('')}</div><div class="composition-legend">${entries.map(([k,v],i)=>`<div class="composition-item"><i style="background:${palette[i%palette.length]}"></i><span>${escapeHTML(k)}</span><span>${(v/total*100).toFixed(1)}% · ${fmt(v)}</span></div>`).join('')}</div>`;
}
function selectEvent(id) {if(!eventMap.has(id))return;selected=id;renderInspector();renderTimeline();renderTokens();renderLedger();}
function renderInspector() {
  const e=eventMap.get(selected);
  if(!e){$('inspectTitle').textContent='Follow the evidence';$('inspectorBody').innerHTML=`<div class="empty-inspector"><div class="big-glyph">⌁</div><p>Select a response, tool span, or communication arrow to see its recorded details.</p><div class="agent-summary">${trace.agents.map(a=>`<div><strong>${escapeHTML(agentName(a.id))}</strong><span>${a.rounds.length} responses · ${a.spans.filter(s=>s.kind==='tool').length} tools</span></div>`).join('')}</div><p><b>${trace.agents.length-1} linked sub-agents</b><br>${trace.edges.filter(e=>e.kind==='report').length} report receipts · ${trace.edges.filter(e=>e.kind==='message').length} message receipts</p><div class="case-note">${trace.focus?'Opened at the first collaboration window. Choose “Fit all” to see the entire session, or select a main-agent turn.':'This case shows repeated model responses and tool calls in a single agent.'}</div><p>Diamonds mark when usage was recorded. They do not measure how long the model was thinking.</p><button class="text-button" data-method>Read measurement notes ↗</button></div>`;return;}
  $('inspectTitle').textContent=e.label;
  let s=`<span class="confidence ${e.confidence==='inferred'?'inferred':''}">${e.confidence==='inferred'?'Inferred boundary':'Recorded evidence'}</span><div class="inspector-value">${escapeHTML(agentName(e.agent_id))}<br>${new Date(e.time).toLocaleString()}</div>`;
  if(e.usage){const u=e.usage;s+=`<div class="inspector-label">RESPONSE USAGE</div><div class="inspect-grid">${[['Input',u.input_tokens],['Output',u.output_tokens],['Cached input ⊂ input',u.cached_input_tokens],['Reasoning ⊂ output',u.reasoning_output_tokens]].map(([l,v])=>`<div><strong>${exact(v)}</strong><small>${l}</small></div>`).join('')}</div>`;}
  const field=(label,value)=>value==null?'':`<div class="inspector-label">${label}</div><div class="inspector-value">${escapeHTML(value)}</div>`;
  s+=field('Model',e.model)+field('Timing',e.timing)+(e.start!=null?field('Observed span',e.end==null?'End not present':duration(e.end-e.start)):'');
  s+=field('Response ID',e.response_id)+field('Turn ID',e.turn_id);
  if(e.evidence_ids)s+=field('Classification',e.phase)+`<div class="inspector-label">SUPPORTING EVENTS</div>`+ (e.evidence_ids.length?e.evidence_ids.map(id=>`<button class="text-button" data-event="${escapeHTML(id)}">${escapeHTML(eventMap.get(id)?.label||id)} ↗</button>`).join('<br>'):'<div class="inspector-value">Turn envelope only; no activity-specific evidence.</div>');
  if(e.author)s+=field('Route',`${e.author} → ${e.recipient}`);
  if(e.encrypted)s+='<div class="case-note">Part of this message is encrypted in the source. Its plaintext length is unavailable.</div>';
  if(e.text)s+=`<div class="inspector-label">${e.kind==='tool'?'CALL ARGUMENTS':'RECORDED CONTENT'}${e.truncated?' · preview truncated':''}</div><pre>${escapeHTML(e.text)}</pre>`;
  if(e.output!=null)s+=`<div class="inspector-label">TOOL RETURN${e.output_truncated?' · preview truncated':''} · ${fmt(e.output_length)} chars</div><pre>${escapeHTML(e.output)}</pre>`;
  s+=field('Provenance',`${e.source.file}\nLine ${e.source.line}${e.source.ordinal!=null?' · ordinal '+e.source.ordinal:''}\n${e.source.type}`);
  $('inspectorBody').innerHTML=s+'<button class="text-button" data-overview>← Agent overview</button>'; 
}
function filteredEvents() {const q=$('eventSearch').value.toLowerCase(),kind=$('kindSelect').value,agent=$('ledgerAgent').value;return allEvents.filter(e=>inView(e)&&(kind==='all'||e.kind===kind)&&(agent==='all'||e.agent_id===agent)&&(!q||[e.label,e.model,e.text,e.output].join(' ').toLowerCase().includes(q)));}
function renderLedger() {
  const es=filteredEvents(),size=60,pages=Math.max(1,Math.ceil(es.length/size));page=Math.min(page,pages-1);
  $('events').innerHTML=es.slice(page*size,(page+1)*size).map(e=>`<tr data-event="${escapeHTML(e.id)}" tabindex="0" aria-label="Inspect ${escapeHTML(e.label)}" class="${selected===e.id?'selected':''}"><td>${date(e.time)} ${time(e.time)}</td><td>${escapeHTML(agentName(e.agent_id))}</td><td><span class="event-kind">${escapeHTML(e.kind)}</span></td><td title="${escapeHTML(e.label)}">${escapeHTML(e.label)}</td><td>${escapeHTML(e.model||'Unavailable')}</td><td>${e.usage?`${fmt(e.usage.input_tokens)} / ${fmt(e.usage.output_tokens)}`:e.end!=null?duration(e.end-e.start):'—'}</td></tr>`).join('') || '<tr><td colspan="6">No events match the current time window and filters.</td></tr>';
  $('eventCount').textContent=`${es.length} records in view`;$('pageLabel').textContent=`Page ${page+1} of ${pages}`;$('prevPage').disabled=page===0;$('nextPage').disabled=page>=pages-1;
}
function showMethod(){
  $('methodText').innerHTML=`<p>This is a read-only snapshot of local harness history files. No prompts are submitted and no model is invoked.</p><ul>${(trace?.limitations||[]).map(s=>`<li>${escapeHTML(s)}</li>`).join('')}<li>Solid communication arrows mark receipt at the destination. Dashed arrows mark agent starts; their timestamps do not imply measured transport latency.</li><li>Sub-agent links come from explicit parent-thread metadata. Unlinked internal agents are not assigned to a parent by guesswork.</li><li>Response IDs deduplicate usage records. Files without direct response records use distinct cumulative usage updates as an explicitly inferred fallback. Files with direct records ignore mirrored token-count updates.</li><li>Whole-session totals include all imported agents. The token chart and ledger follow the time window; content composition uses the entire selected agent.</li></ul><p>${escapeHTML(index.selection)}</p><p>Imported ${new Date(index.imported_at).toLocaleString()}. To refresh, run <code>python import_history.py</code> and reload this page.</p>`;
  $('methodDialog').showModal();
}
document.addEventListener('click',e=>{if(suppressClick){suppressClick=false;return;}const c=e.target.closest('[data-case]');if(c){$('summaryPage').hidden=true;$('sessionPage').hidden=false;$('tracesTab').setAttribute('aria-pressed','true');$('summaryTab').setAttribute('aria-pressed','false');loadCase(c.dataset.case);}const mark=e.target.closest('[data-event]');if(mark)selectEvent(mark.dataset.event);if(e.target.closest('[data-method]'))showMethod();if(e.target.closest('[data-overview]')){selected=null;renderInspector();renderTimeline();renderTokens();renderLedger();}});
document.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){const mark=e.target.closest('[data-event]');if(mark){e.preventDefault();selectEvent(mark.dataset.event);}}});
$('caseSearch').addEventListener('input',renderCases);$('multiOnly').addEventListener('change',renderCases);
$('agentSelect').addEventListener('change',()=>{agentId=$('agentSelect').value;renderTokens();renderComposition();});
$('turnSelect').addEventListener('change',()=>{if($('turnSelect').value==='all')setView(trace.start,trace.end);else{const t=trace.agents[0].turns[Number($('turnSelect').value)];const next=trace.agents[0].turns[Number($('turnSelect').value)+1];setView(t.start,(t.end??next?.start??trace.end)+1000);}});
$('collabButton').addEventListener('click',()=>{if(trace.focus){$('turnSelect').value='all';setView(...trace.focus);}});
$('fitButton').addEventListener('click',()=>{$('turnSelect').value='all';setView(trace.start,trace.end);});
$('zoomIn').addEventListener('click',()=>{const d=(view[1]-view[0])/4;setView(view[0]+d,view[1]-d);});
$('zoomOut').addEventListener('click',()=>{const d=(view[1]-view[0])/2;setView(view[0]-d,view[1]+d);});
$('panLeft').addEventListener('click',()=>{const d=(view[1]-view[0])*.5;setView(view[0]-d,view[1]-d);});
$('panRight').addEventListener('click',()=>{const d=(view[1]-view[0])*.5;setView(view[0]+d,view[1]+d);});
$('showNested').addEventListener('change',renderTimeline);
$('showActivity').addEventListener('change',renderTimeline);
for(const id of ['kindSelect','ledgerAgent','eventSearch'])$(id).addEventListener(id==='eventSearch'?'input':'change',()=>{page=0;renderLedger();});
$('prevPage').addEventListener('click',()=>{page--;renderLedger();});$('nextPage').addEventListener('click',()=>{page++;renderLedger();});
$('methodButton').addEventListener('click',showMethod);$('closeMethod').addEventListener('click',()=>$('methodDialog').close());
$('exportButton').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(trace,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`agent-trace-${trace.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
(async()=>{try{index=await fetchJSON('/data/index.json');$('inventory').textContent=`${index.scanned_files} source files scanned · ${index.unique_sessions} unique sessions · ${index.eligible_sessions} eligible · ${index.cases.length} curated cases${index.errors.length?' · '+index.errors.length+' import errors':''}`;renderCases();if(!index.cases.length)throw new Error('No eligible cases. Check selection rules in config.yaml and scan local history.');await loadCase(index.cases.some(c=>c.id===location.hash.slice(1))?location.hash.slice(1):index.cases[0].id);}catch(e){$('status').textContent=`Local history is not available. Run python import_history.py, then reload. ${e.message}`;}})();

$('netTime').addEventListener('change',renderView);
const canvas=$('timeline');
function pointerTime(e){const box=canvas.getBoundingClientRect(),f=Math.max(0,Math.min(1,(e.clientX-box.left-box.width*.16)/(box.width*.816)));const lo=timelineScale.forward(view[0]),hi=timelineScale.forward(view[1]);return {f,t:timelineScale.inverse(lo+f*(hi-lo))};}
canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;dragStart={x:e.clientX,t:pointerTime(e).t,view:[...view],shift:e.shiftKey,eventId:e.target.closest('[data-event]')?.dataset.event,moved:false};});
canvas.addEventListener('pointermove',e=>{
 if(!trace)return;
 if(dragStart && Math.abs(e.clientX-dragStart.x)>4 && !dragStart.moved){dragStart.moved=true;canvas.setPointerCapture(e.pointerId);}
 if(dragStart?.moved&&!dragStart.shift){const scale=new NetTimeline(trace,$('netTime').checked),box=canvas.getBoundingClientRect(),lo=scale.forward(dragStart.view[0]),hi=scale.forward(dragStart.view[1]),delta=(e.clientX-dragStart.x)/(box.width*.816)*(hi-lo);setView(scale.inverse(lo-delta),scale.inverse(hi-delta));}
 if($('showCursor').checked){const p=pointerTime(e),box=canvas.getBoundingClientRect(),x=160+p.f*816,line=document.getElementById('alignmentLine'),label=document.getElementById('alignmentLabel');if(line){line.setAttribute('x1',x);line.setAttribute('x2',x);line.setAttribute('visibility','visible');label.setAttribute('x',Math.min(x,800));label.textContent=elapsed(timelineScale.forward(p.t)-timelineScale.forward(trace.start));}}
});
canvas.addEventListener('pointerup',e=>{
 if(!dragStart)return;
 const d=dragStart;dragStart=null;
 if(d.moved){suppressClick=true;setTimeout(()=>{suppressClick=false;},0);if(d.shift){const t=pointerTime(e).t;setView(Math.min(t,d.t),Math.max(t,d.t));}}
 else if(d.eventId){selectEvent(d.eventId);}
});
canvas.addEventListener('pointercancel',()=>{dragStart=null;});
canvas.addEventListener('pointerleave',()=>{const line=document.getElementById('alignmentLine');if(line)line.setAttribute('visibility','hidden');});
$('showCursor').addEventListener('change',()=>{if(!$('showCursor').checked)renderTimeline();});
canvas.addEventListener('dblclick',()=>setView(trace.start,trace.end));
canvas.addEventListener('wheel',e=>{if(!trace)return;e.preventDefault();const p=pointerTime(e),scale=timelineScale,lo=scale.forward(view[0]),hi=scale.forward(view[1]),center=scale.forward(p.t),factor=e.deltaY>0?1.3:1/1.3;setView(scale.inverse(center-(center-lo)*factor),scale.inverse(center+(hi-center)*factor));},{passive:false});
