import unittest
from swimlane.activity import derive_activity


def record(id, kind, start, end=None, label="exec", **extra):
    return dict(id=id, kind=kind, start=start, end=end, time=start, label=label,
                turn_id="t", model="test", source={"file":"fixture", "line":1, "type":"fixture"}, **extra)


def agent():
    return dict(id="a", turns=[dict(id="t", start=0, end=100)], rounds=[record("r1","round",30),record("r2","round",80)],
                spans=[record("tool","tool",25,50)], messages=[])


class ActivityTests(unittest.TestCase):
    def test_overnight_tool_is_inferred_stall_preserving_raw_envelope(self):
        a=agent(); a['turns'][0]['end']=1000000
        a['spans']=[record('long','tool',25,999900)]
        a['rounds']=[record('r','round',1000000)]
        spans=derive_activity(a)
        stalls=[s for s in spans if s['phase']=='stall']
        self.assertEqual(sum(s['end']-s['start'] for s in stalls),999875)
        self.assertTrue(all(s['resource']=='other' and s['confidence']=='inferred' for s in stalls))
        self.assertEqual(a['spans'][0]['end'],999900)
        # Frequent nested evidence prevents classifying a long wrapper as silence.
        a['messages']=[record(str(i),'text',i*100000) for i in range(1,10)]
        self.assertFalse(any(s['phase']=='stall' for s in derive_activity(a)))

    def test_tool_subtracted_from_model_window_without_double_counting(self):
        a=agent()
        a["spans"].append(record("nested","execution",28,45))
        spans=derive_activity(a)
        totals={resource:sum(e["end"]-e["start"] for e in spans if e["resource"]==resource) for resource in ("gpu","cpu","other")}
        self.assertEqual(totals,{"gpu":55,"cpu":25,"other":20})
        self.assertEqual(sum(totals.values()),100)
        self.assertTrue(all(e["confidence"]=="inferred" for e in spans if e["resource"]=="gpu"))
        self.assertTrue(all(x["end"]<=y["start"] for x,y in zip(spans,spans[1:])))

    def test_wait_overrides_nested_execution_and_compaction_is_other(self):
        a=agent();a["spans"]=[record("wait","tool",25,50,label="wait_agent"),record("nested","execution",28,45),record("compact","compaction",60,70)]
        spans=derive_activity(a)
        self.assertFalse(any(e["resource"]=="cpu" for e in spans))
        self.assertEqual(sum(e["end"]-e["start"] for e in spans if e["phase"]=="wait"),25)
        self.assertEqual(sum(e["end"]-e["start"] for e in spans if e["phase"]=="compaction"),10)

    def test_no_model_before_human_input_and_no_cross_turn_idle(self):
        a=agent();a["messages"]=[record("input","text",12,origin="Human input")]
        a["turns"].append(dict(id="later",start=1000,end=1020))
        spans=derive_activity(a)
        self.assertTrue(all(e["start"]>=12 for e in spans if e["resource"]=="gpu"))
        self.assertFalse(any(e["start"]<1000 and e["end"]>100 for e in spans))

    def test_open_tool_is_unknown_not_inference_or_completed_cpu(self):
        a=agent();a["spans"]=[record("open","tool",25)]
        spans=derive_activity(a)
        self.assertTrue(all(e["resource"]=="other" for e in spans if e["start"]>=25))

    def test_unfinished_turn_stops_at_last_observation(self):
        a=agent();a["turns"][0]["end"]=None
        spans=derive_activity(a)
        self.assertEqual(max(e["end"] for e in spans),80)

    def test_parallel_agents_keep_cpu_and_model_overlap(self):
        a=agent();b=agent();b["id"]="b";b["spans"]=[]
        cpu=[e for e in derive_activity(a) if e["resource"]=="cpu"]
        gpu=[e for e in derive_activity(b) if e["resource"]=="gpu"]
        self.assertTrue(any(max(x["start"],y["start"])<min(x["end"],y["end"]) for x in cpu for y in gpu))


if __name__ == "__main__":
    unittest.main()
