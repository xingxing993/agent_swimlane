/* Shared wall-clock ↔ net-time mapping. Only gaps outside every observed turn
   longer than two minutes are removed; activity within turns is retained. */
class NetTimeline {
  constructor(trace, enabled) {
    this.gaps=[];
    if(!enabled)return;
    const intervals=trace.agents.flatMap(a=>a.turns.map(t=>[t.start,t.end??t.start])).sort((a,b)=>a[0]-b[0]);
    let end=trace.start;
    for(const [lo,hi] of intervals){if(lo-end>120000)this.gaps.push([end,lo]);end=Math.max(end,hi);}
    if(trace.end-end>120000)this.gaps.push([end,trace.end]);
  }
  forward(t){let removed=0;for(const [lo,hi] of this.gaps){if(t<=lo)break;removed+=Math.min(t,hi)-lo;}return t-removed;}
  inverse(t){let removed=0;for(const [lo,hi] of this.gaps){if(t<lo-removed)break;removed+=hi-lo;}return t+removed;}
}
