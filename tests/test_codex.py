import json
import pathlib
import uuid
import unittest

from swimlane.codex import normalize, build_case, read_events, prompt_title


def event(typ, payload, second=0):
    return {"type": typ, "timestamp": f"2026-10-01T10:00:{second:02d}Z", "payload": payload}


def usage(n):
    return {"input_tokens": n, "cached_input_tokens": n//2, "output_tokens": 10, "reasoning_output_tokens": 2, "total_tokens": n+10}


class AdapterTests(unittest.TestCase):
    def test_explicit_event_model_overrides_context(self):
        path=self.write('model.jsonl',[
            event('session_meta',dict(id='model-session')),
            event('turn_context',dict(turn_id='t',model='context-model'),1),
            event('token_usage_record',dict(response_id='r',model='called-model',usage=usage(10)),2),
            event('response_item',dict(type='function_call',name='exec',call_id='c',arguments='{}'),3)])
        result=normalize(path)
        self.assertEqual(result['rounds'][0]['model'],'called-model')
        self.assertEqual(result['spans'][0]['model'],'context-model')

    def setUp(self):
        self.scratch = pathlib.Path(__file__).resolve().parents[1]/".runtime"/"tests"
        self.scratch.mkdir(parents=True, exist_ok=True)
        # Python 3.13's Windows TemporaryDirectory mode=0700 drops the
        # sandbox token's inherited access. Ordinary workspace dirs retain it.
        self.root = self.scratch/str(uuid.uuid4())
        self.root.mkdir()

    def tearDown(self):
        assert self.root.resolve().is_relative_to(self.scratch.resolve())
        for file in self.root.iterdir():
            file.unlink()
        self.root.rmdir()

    def write(self, name, events):
        p = self.root/name
        p.write_text("\n".join(json.dumps(e) for e in events), encoding="utf-8")
        return p

    def test_direct_usage_overrides_mirrored_and_stale_counts(self):
        events = [event("session_meta", {"id": "root"}), event("event_msg", {"type": "task_started", "turn_id": "t"}),
                  event("token_usage_record", {"turn_id": "t", "response_id": "r", "usage": usage(100)}, 1),
                  event("event_msg", {"type": "token_count", "info": {"last_token_usage": usage(100), "total_token_usage": usage(100)}}, 2),
                  event("token_usage_record", {"turn_id": "t", "response_id": "r", "usage": usage(100)}, 3),
                  event("event_msg", {"type": "task_started", "turn_id": "next"}, 4),
                  event("event_msg", {"type": "token_count", "info": {"last_token_usage": usage(100), "total_token_usage": usage(100)}}, 5)]
        a = normalize(self.write("root.jsonl", events))
        self.assertEqual(len(a["rounds"]), 1)
        self.assertEqual(a["rounds"][0]["usage"]["input_tokens"], 100)
        self.assertEqual(a["rounds"][0]["confidence"], "reported")

    def test_legacy_fallback_deduplicates_cumulative_updates_across_turns(self):
        events = [event("session_meta", {"id": "root"})]
        for n, turn in [(100,"a"),(100,"b"),(200,"b")]:
            events += [event("turn_context", {"turn_id": turn}), event("event_msg", {"type": "token_count", "info": {"last_token_usage": usage(100), "total_token_usage": usage(n)}})]
        a = normalize(self.write("root.jsonl", events))
        self.assertEqual(len(a["rounds"]), 2)
        self.assertTrue(all(r["confidence"] == "inferred" for r in a["rounds"]))

    def test_parallel_calls_match_outputs_by_id_and_keep_open_ends(self):
        events = [event("session_meta", {"id": "root"})]
        for i in range(3):
            events.append(event("response_item", {"type": "function_call", "name": "tool", "call_id": str(i), "arguments": "{}"}, i))
        events += [event("response_item", {"type": "function_call_output", "call_id": "1", "output": "second"}, 4), event("response_item", {"type": "function_call_output", "call_id": "0", "output": "first"}, 5)]
        a = normalize(self.write("root.jsonl", events))
        self.assertEqual(a["spans"][0]["output"], "first")
        self.assertEqual(a["spans"][1]["output"], "second")
        self.assertIsNone(a["spans"][2]["end"])

    def test_encryption_and_truncation_are_explicit(self):
        secret = "gAAAAA"+"z"*200
        p = self.write("root.jsonl", [event("session_meta", {"id": "root"}), event("response_item", {"type": "agent_message", "author": "/root/child", "recipient": "/root", "content": [{"type": "encrypted_content", "encrypted_content": secret}]}), event("response_item", {"type": "message", "role": "assistant", "content": [{"text": "x"*20000}]})])
        a = normalize(p)
        self.assertTrue(a["messages"][0]["encrypted"])
        self.assertNotIn(secret, json.dumps(a))
        self.assertEqual(a["content_chars"]["Agent communication"], 0)
        self.assertTrue(a["messages"][1]["truncated"])
        self.assertEqual(a["messages"][1]["text_length"], 20000)

    def test_parent_and_receipt_edges_are_explicit(self):
        root = self.write("root.jsonl", [event("session_meta", {"id": "root"}), event("response_item", {"type": "agent_message", "author": "/root/child", "recipient": "/root", "content": [{"text": "Message Type: FINAL_ANSWER\nDone"}]}, 10)])
        child = self.write("child.jsonl", [event("session_meta", {"id": "child", "source": {"subagent": {"thread_spawn": {"parent_thread_id": "root", "agent_path": "/root/child"}}}}, 2)])
        case = build_case({"id":"root", "title":"test"}, [{"path":str(root)}, {"path":str(child)}])
        report = next(e for e in case["edges"] if e["kind"] == "report")
        self.assertEqual((report["from"], report["to"]), ("child", "root"))
        self.assertEqual(report["confidence"], "reported")
        self.assertEqual(next(e for e in case["edges"] if e["kind"] == "spawn")["confidence"], "inferred")

    def test_compressed_input_and_malformed_tail(self):
        import zstandard
        raw = json.dumps(event("session_meta", {"id": "z"})).encode()+b'\n{"partial":'
        p = self.root/"test.jsonl.zst"
        p.write_bytes(zstandard.ZstdCompressor().compress(raw))
        self.assertEqual(list(read_events(p))[1]["type"], "parse_error")
        self.assertEqual(len(normalize(p)["notices"]), 1)

    def test_title_strips_attachment_wrapper(self):
        self.assertEqual(prompt_title("# Files mentioned\nfile.pdf\n## My request:\nhttps://example.com\nExplain the paper"), "Explain the paper")


class ImportedDataTests(unittest.TestCase):
    def test_imported_usage_reconciles_and_all_edges_resolve(self):
        data = pathlib.Path(__file__).resolve().parents[1]/"data"
        if not (data/"index.json").exists():
            self.skipTest("No local imported data")
        index = json.loads((data/"index.json").read_text(encoding="utf-8"))
        self.assertGreater(len(index["cases"]), 0)
        for row in index["cases"]:
            case = json.loads((data/row["file"]).read_text(encoding="utf-8"))
            ids = {a["id"] for a in case["agents"]}
            for edge in case["edges"]:
                self.assertIn(edge["from"], ids)
                self.assertIn(edge["to"], ids)
            for a, source in zip(case["agents"],case["source_files"]):
                event_ids = {e["id"] for e in a["rounds"]+a["spans"]+a["messages"]}
                turns = {t["id"]:t for t in a["turns"]}
                for activity in a.get("activities", []):
                    self.assertGreater(activity["end"], activity["start"])
                    self.assertTrue(set(activity["evidence_ids"]).issubset(event_ids))
                    turn = turns[activity["turn_id"]]
                    self.assertGreaterEqual(activity["start"], turn["start"])
                    if turn["end"] is not None:
                        self.assertLessEqual(activity["end"], turn["end"])
                    if activity["resource"] == "gpu":
                        self.assertEqual(activity["confidence"], "inferred")
                if case.get("anonymization") or a.get("harness") != "codex" or not pathlib.Path(source).exists():
                    continue
                records = [e["payload"] for e in read_events(pathlib.Path(source)) if e["type"] == "token_usage_record"]
                if records:
                    self.assertEqual(len(a["rounds"]), len({r["response_id"] for r in records}))
                    totals = records[-1].get("thread_token_usage", {})
                    for key in ("input_tokens", "output_tokens", "cached_input_tokens"):
                        self.assertEqual(sum(r["usage"].get(key,0) for r in a["rounds"]), totals[key], (a["id"], key))
                for s in a["spans"]:
                    if s.get("end") is not None:
                        self.assertGreaterEqual(s["end"],s["start"])


if __name__ == "__main__":
    unittest.main()
