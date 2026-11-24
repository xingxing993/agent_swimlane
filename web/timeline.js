/* Silence is missing evidence, not measured work. Preserve wall timestamps. */
function observationGaps(agent, threshold=120000) {
  const points=new Set();
  for(const e of [...(agent.rounds||[]),...(agent.spans||[]),...(agent.messages||[])])
    for(const t of [e.time,e.start,e.end])if(t!=null)points.add(t);
  // Legacy traces with turn boundaries only retain their original envelopes.
  if(!points.size)return [];
  for(const t of agent.turns)for(const p of [t.start,t.end])if(p!=null)points.add(p);
  const sorted=[...points].sort((a,b)=>a-b);
  return sorted.slice(1).flatMap((hi,i)=>hi-sorted[i]>threshold?[[sorted[i],hi]]:[]);
}
function classifyStalls(trace) {
  const threshold=(trace.timing_policy?.silence_seconds??120)*1000;
  for(const agent of trace.agents){
    const gaps=observationGaps(agent,threshold);
    const activities=[];
    for(const event of agent.activities||[]){
      const cuts=[event.start,event.end,...gaps.flat().filter(t=>t>event.start&&t<event.end)].sort((a,b)=>a-b);
      for(let i=0;i<cuts.length-1;i++){
        const start=cuts[i],end=cuts[i+1],stall=gaps.some(([lo,hi])=>lo<=start&&end<=hi);
        activities.push({...event,id:event.id+':part:'+i,time:start,start,end,...(stall?{
          resource:'other',phase:'stall',confidence:'inferred',label:'Other / inferred stall (out of scope)',
          text:'No observations inside this long gap. Possible suspension, approval, sleep, remote wait, or unobserved work; cause unknown. Recorded call/result boundaries are preserved.',
          evidence_ids:[]}: {})});
      }
    }
    agent.activities=activities;
  }
  return trace;
}
class NetTimeline {
  constructor(trace, enabled) {
    this.gaps=[];
    if(!enabled)return;
    const threshold=(trace.timing_policy?.silence_seconds??120)*1000;
    const intervals=trace.agents.flatMap(a=>{
      const gaps=observationGaps(a,threshold);
      return a.turns.flatMap(t=>{
        const observed=[...(a.rounds||[]),...(a.spans||[]),...(a.messages||[])].filter(e=>e.turn_id===t.id).map(e=>e.end??e.time);
        let parts=[[t.start,t.end??Math.max(t.start,...observed)]];
        for(const [lo,hi] of gaps)parts=parts.flatMap(([s,e])=>hi<=s||lo>=e?[[s,e]]:[[s,Math.max(s,lo)],[Math.min(e,hi),e]].filter(([s,e])=>e>s));
        return parts;
      });
    }).sort((a,b)=>a[0]-b[0]);
    let end=trace.start;
    for(const [lo,hi] of intervals){if(lo-end>threshold)this.gaps.push([end,lo]);end=Math.max(end,hi);}
    if(trace.end-end>threshold)this.gaps.push([end,trace.end]);
  }
  forward(t){let removed=0;for(const [lo,hi] of this.gaps){if(t<=lo)break;removed+=Math.min(t,hi)-lo;}return t-removed;}
  inverse(t){let removed=0;for(const [lo,hi] of this.gaps){if(t<lo-removed)break;removed+=hi-lo;}return t+removed;}
}
