# Normalized trace schema v1

The rendering layer consumes `data/index.json`, then a selected case JSON. Times are UTC Unix milliseconds, displayed in the browser's local timezone. Unavailable values are `null` or absent, never fabricated zeros. Counts of genuinely observed zero events may be zero.

## Index

`schema_version`, `imported_at`, `scanned_files`, `unique_sessions`, `eligible_sessions`, `selection`, `errors`, and `cases`.

Each case summary has `id`, `file`, `title`, `started` (ISO timestamp), `agents`, `rounds`, `calls`, `turns`, `edges`, and cumulative `usage`. The file is a basename within `data/`.

## Case

- `schema_version: 1`, `id`, `title`, `harness`
- `start`, `end`: observed session extent
- `focus`: optional `[start, end]` for an interesting first view
- `agents`: explicitly related agent sessions
- `edges`: communication/lifecycle relationships
- `usage`: sum of imported per-response usage, once per response
- `source_files`, `limitations`

## Agent

`id`, `path` (logical agent path), `nickname`, `parent_id`, `harness`, `cli_version`, `start`, `end`, `turns`, `rounds`, `spans`, `messages`, `content_chars`, `notices`.

Optional additive field `activities` contains derived workflow intervals. Older v1 snapshots without it remain readable (empty processing bands). Each activity is an inspectable event with `kind: "activity"`, `start`, `end`, `resource` (`gpu`, `cpu`, `other`), `phase` (`model_candidate`, `tool`, `wait`, `compaction`, `unknown`), `evidence_ids`, and a textual derivation. Every GPU interval has `confidence: "inferred"`; CPU reported confidence applies to envelope timestamps, not utilization. Evidence IDs resolve to source events in the same case. Unknown intervals can reference only derived turn boundaries. Activities never carry usage and must not contribute to response, tool, or token counts.

Activity intervals partition each observed turn independently; tool wrappers/nested executions are not additive, and between-turn gaps are omitted. Different agents retain separate intervals so overlap is visible. See [architecture.md](architecture.md) for the precedence and inference rules.

Turns contain `id`, `agent_id`, `start`, nullable `end`, and a display `title`. An open turn must not imply that all following wall-clock time was active work.

All inspectable events have:

```json
{
  "id": "source-specific unique event ID",
  "agent_id": "thread ID",
  "kind": "round | tool | execution | lifecycle | compaction | message | text | tool_output",
  "label": "Display name",
  "time": 1790000000000,
  "turn_id": null,
  "model": null,
  "confidence": "reported | inferred",
  "text": "Available text preview",
  "text_length": 22,
  "truncated": false,
  "source": {"file": "original source path", "line": 123, "ordinal": 122, "type": "original record type"}
}
```

`round` adds `number`, nullable `response_id`, `usage`, `timing`. Preserve input/output/cache/reasoning field names after resolving the source's accounting semantics. Do not silently map additive cache counters into subset counters.

`tool` and `execution` add `start`, nullable `end`, `timing`; tools may have `call_id`, `namespace`, `routing`, `output`, `output_length`, `output_truncated`. A model-issued wrapper tool and its nested executions are deliberately different kinds.

`message` adds `author`, `recipient`, `encrypted`, `role`, and `origin`. This records visible message receipt; the current schema does not claim a transport send/receive pairing. `text` is ordinary transcript content. `content_chars` is a map of visible-character categories, explicitly separate from model input token composition.

Edges contain `id`, `kind` (`spawn`, `message`, `report`), `from`, `to`, `time`, nullable `event_id`, and `confidence`. Both endpoints must resolve to agents in the case. An inferred spawn from parent metadata uses the child's first recorded timestamp and is marked inferred. Do not infer edges from timestamp proximity alone.

## Adapter constraints

- Preserve raw source history unchanged; keep normalized snapshots regenerable.
- Prefer stable IDs for deduplication; retain source line numbers for auditing.
- Missing usage is not zero usage. Distinguish inferred round boundaries.
- Do not count mirrored event streams twice.
- Include internal agents only with explicit relationships or as separate roots; do not assign guardians by proximity.
- Keep request latency, context composition, send-time, and shutdown-time unavailable unless the source actually establishes them.


## Silence and model metadata

Cases may include `timing_policy: {silence_seconds: 120}`. Activity phase `stall` has resource `other` and confidence `inferred`: a gap between consecutive observations exceeding that threshold, clipped to the turn. It overrides tool, wait, compaction and model-candidate classifications; no observations establish its cause. Tool call/result envelopes are preserved in `spans`. Net time removes the union of gaps outside all agents' retained activity. Per-agent classified durations can overlap across agents and must not be interpreted as elapsed team time or hardware utilization.

`model` uses explicit event model metadata or the adapter's recorded model context. Missing names remain null and display as unavailable; they are never guessed from harness or tool names. The event ledger and inspector expose this field.

`/api/library` discovers normalized case JSON files in the configured data directory and deduplicates by harness/session ID. Index rows marked `local_import: true` are owned by the local importer; shared external files should remain unindexed or use `local_import: false` to survive import replacement.
