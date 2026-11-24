# Agent Swimlane

## Portable local import and anonymization

Copy the application folder to another computer with Python installed, install `requirements.txt`, then launch `python serve.py`. Click **Scan new sessions** in the sidebar for an incremental scan, or **Refresh all sessions** to rebuild from source. Settings and selection filters live in `config.yaml`. The server detects available Codex and Claude Code history under the current user's home directory and scans all eligible cases, with progress for scanning, extraction, and anonymization. This detects saved history, not whether a CLI executable is installed. No account login or model call is required. The web UI must be served by `serve.py`, not a generic static server, for the import button to work.

One import runs at a time. Output is staged under `.runtime/`, optionally scrambled, then published to `data/` with the index replaced last. A failed extraction leaves the previous database usable. Successful import replaces the local-import snapshot and removes obsolete files owned by the previous import index. Unindexed shared datasets are preserved. Incremental scans reuse unchanged source metadata and normalized records using file size and modification time; changed and new files are reread. Full refresh ignores that cache and rereads all configured sources. Restarting the server interrupts its import worker; retry the import if needed. Failed staging folders and the incremental history cache remain under `.runtime/` and contain private source-derived content, even when published output is scrambled. Treat that directory as private scratch data.

Content masking is optional and disabled by default for local imports. Enable **Scramble imported content** for button imports or set `import.anonymize: true` in `config.yaml`. The one-shot `--anonymize` flag is also available. Prose, titles, tool output, and string argument values are replaced with length-preserving letter/digit masks; whitespace and punctuation are preserved. JSON tool argument keys and numeric values, tool names, types, lengths, timing and token counters remain. Session/event IDs and source paths become consistent pseudonyms within the export; the random pseudonym key is not saved. A fresh import generates new pseudonyms. Inspector evidence links continue to resolve. `text_length` and `output_length` describe the original extracted content, including text omitted by the existing preview cap.

This preserves profiling structure rather than semantic command content. For example, `{"cmd":"read private.txt","timeout":30}` retains the keys, timeout, and string length but masks the command string. Absolute timestamps, numeric values, punctuation, tool names and usage patterns remain potentially identifying; the export is masked profiling data, not a guarantee of irreversible statistical anonymization. Existing raw histories are never changed.

A local, read-only explorer of real agent history. The first adapter reads Codex `.jsonl` and `.jsonl.zst` rollouts; the viewer consumes a harness-independent JSON format.

The importer now also reads local Claude Code CLI transcripts from `~/.claude/projects` (configure `import.sources.claude.home`). It selects eligible Claude cases using the configured thresholds and limit. `swimlane/mapping.py` handles provider naming and inclusive token accounting; adapters emit common events and `swimlane/cases.py` assembles cases. Claude response blocks are deduplicated by message ID with maximum reported counters; cached reads and writes are added to its uncached input to match the common input-total convention. Child transcripts without verified linkage are not attached.

The timeline is compact: GPU/model-wait hatching, CPU/tool blue, and other activity colors appear inside each agent lane. Toggle the alignment cursor to follow a vertical line. Drag to pan, Shift-drag across a time range to zoom, use the wheel to zoom around the pointer, and double-click to reset. Keyboard/button zoom controls remain available.

Axis ticks and the alignment cursor show `T`, `T + 30 s`, or `T + 2 m`, anchored to the case start. With Net time enabled, offsets exclude removed idle gaps; with it disabled they show wall elapsed time. The inspector and ledger retain original calendar timestamps. A click with small mouse movement selects the bar; movement beyond four pixels starts a drag.

**First collaboration** selects the first child-agent task window. **All turns** resets to the complete case. **Net time** (on by default) excludes long gaps between observations, including silence inside a tool call or an open turn. The threshold is `timing.silence_seconds` in `config.yaml` (120 seconds by default; applied to new imports). A gap is removed only when no other agent retains observed activity across it. Inferred stalls remain **Other / inferred stall (out of scope)** with Net time off. Silence can mean machine sleep, approval, remote waiting, or unobserved computation; its cause is unknown. Original tool boundaries and timestamps are preserved. This is workflow accounting, never measured CPU/GPU utilization.

Use **Summary** to explore KPI cards, daily/weekly/monthly activity, cached/uncached input and output composition, tool rankings, workflow time, collaboration, recorded models, and a sortable session leaderboard. Harness and snapshot-relative time filters narrow the whole dashboard; activity can be switched between responses, tools, tokens, and sessions. Cached input and reasoning output remain subsets of their respective totals. **Refresh data** scans normalized case JSON files directly in the configured data directory, including files copied there without index entries. Duplicate harness/session IDs count once; independent exports need unique session IDs. File/import errors are counted; malformed datasets are skipped. Summary refresh does not import local history. Offline packages refresh their embedded snapshot only. Toggle **Dark mode** in the header; the preference is saved locally when browser storage is available.

Read the [architecture explanation](docs/architecture.md) for the principles, data flow, record reconstruction, and processing-indicator algorithm.

## Open the viewer

From this folder:

```powershell
python serve.py
```

Open **http://127.0.0.1:8765**. You can also double-click `start-viewer.cmd`. The server binds only to loopback. Stop it with Ctrl+C. For another port, edit `server.port` in `config.yaml` and restart the server.

The imported cases are already in `data/`. To regenerate them:

```powershell
python -m pip install -r requirements.txt
python import_history.py
```

The importer reads the configured source homes and directories without modifying histories or invoking models. `config.yaml` contains source enable flags, discovery patterns, excluded directory components, minimum tool-call/response counts, per-harness limits, explicit session IDs, excluded working directories, sub-agent prioritization, output path, masking preference, silence threshold, and server port. Paths are relative to the configuration file and `~` expands to the user home. The default excludes this viewer project and requires 10 tool calls / 3 responses for Codex or 3 tool calls / 3 responses for Claude. Explicit IDs in `import.sessions` bypass automatic eligibility thresholds.

```powershell
# Rebuild using config.yaml
python import_history.py
# Reuse unchanged source records
python import_history.py --incremental
# Use a separate import configuration
python import_history.py --config other-config.yaml
```

The server uses the application `config.yaml`. Restart it after changing the port; subsequent import jobs read updated import settings.
Refresh the page after importing. `data/inventory.json` lists scanned sessions and selection metadata. `data/index.json` records import errors and case summaries. A snapshot is not a live tail of running sessions.

## Start with these cases

| Case | Agents | Recorded responses | Model-issued tool calls |
| --- | ---: | ---: | ---: |
| SuperMimic / humanoid-control research and video, Oct 23 | 3 | 207 | 193 |
| SVD explainer video, Oct 7 | 2 | 78 | 73 |
| Anatomy skill task, Oct 19 | 1 | 84 | 81 |
| Network-access investigation, Oct 14 | 1 | 39 | 27 |
| Quota / checkpoint discussion, Oct 14 | 1 | 14 | 10 |

Counts include all imported agents across the full session, including later resumed turns. They are not counts of user prompts. The first two cases open at the first collaboration window rather than showing long idle gaps. Choose **Fit all** or a main-agent turn to change the range; use zoom and pan for detail.

- Green diamonds: a model response's usage was recorded.
- Blue bars: model-issued tool call to matching returned output. Gray optional bars: nested command/tool executions with their own timestamps. These are separate layers, not additive tool counts.
- Orange arrows: explicit spawn/start relationships and messages received by another agent. Dashed arrows mark starts; solid arrows mark message/report receipt.
- Purple bars: recorded compaction.
- The extra **GPU / model wait**, **CPU / tools**, and **Other / annotations** bands share the timeline. Each has one subtrack per agent, so concurrent activity remains visible. Green hatching means inferred model-wait windows; blue means recorded tool envelopes excluding inferred stalls in activity bands; orange/purple/gray mark waits, compaction, and unclassified time. These are workflow indicators, not measured hardware utilization. Pre/post-processing cannot be isolated from these logs. Click a segment for the derivation and supporting events, or hide the bands with **Show processing indicators**.
- Pale lane envelopes: recorded turn boundaries, not continuous model compute.
- Select any mark or ledger row for usage, tool arguments/results, available message content, and file/line provenance.
- Token charts and the ledger follow the time window. The token-chart agent selector also controls stored-content composition. Top summary totals cover the whole session.
- The inspector intentionally escapes transcript content as text. It does not execute HTML or commands from history.

## Measurement contract

1. **Response count:** prefer `token_usage_record`, deduplicated by `response_id`. When a file has these records, mirrored `token_count` events are ignored entirely. This avoids repeated old usage snapshots at turn boundaries. In older files without direct records, distinct cumulative usage updates are a proxy, explicitly tagged `inferred`; missing calls cannot be recovered with certainty.
2. **Tokens:** retain Codex's reported usage fields. Cached input is a subset of input; reasoning output is a subset of output. Never sum those subsets into the totals again. Full-session input is accumulated across responses, not the size of one context window. No cost estimate is made.
3. **Timing:** usage timestamps are observation points, not model request start/end boundaries. Tool timestamps are recorded call/output boundaries or explicit item execution timestamps. The GPU/model-wait band is an inferred workflow window before a response with known tool/wait/compaction intervals removed. It is not model latency or GPU utilization; network, queueing, and unmeasured harness work can remain inside it. Very short marks have a minimum visual width for selection.
4. **Communication:** arrows use explicit source/destination agent paths and parent-thread metadata. Message receipt is not identical to message send time. Agent turn completion/report delivery is not proof that the agent process terminated. No latency is invented by matching unrelated timestamps.
5. **Content proportions:** counts of visible characters stored once, by origin/role. They are not per-request token proportions. Full prompt reconstruction, hidden server instructions, encrypted bodies, and hidden reasoning are unavailable. Encrypted strings are replaced with an explicit placeholder and excluded from their plaintext content counts.
6. **Previews:** inspector text is limited to 18,000 characters per body; original visible text length and truncation flags are retained. Binary content is not rendered. Basic recognizable credential patterns are redacted; this is not a comprehensive anonymization tool.

Imported traces may contain private prompts, paths, and tool outputs. They stay in `data/`, which is ignored by Git. This workspace is under OneDrive, so existing filesystem synchronization settings still apply. No hosting or external telemetry is configured. Export downloads the currently selected normalized trace to your browser; review its contents before sharing.

## Structure and adding harnesses

```text
swimlane/codex.py   Read-only Codex adapter and normalization
swimlane/activity.py Derived workflow indicators and inferred stalls
swimlane/history.py Harness registry, cached discovery and configurable selection
config.yaml         Shared server, import, filter and timing settings
import_history.py  Thin configuration-driven import entry point
serve.py           Loopback server; only web/ and data/ are served
web/               Buildless HTML, CSS, JavaScript, SVG visualization
tests/             Adapter regression, real-data reconciliation, UI logic smoke tests
docs/schema.md     Normalized format for future adapters
data/              Generated private snapshots (Git ignored)
```

Another adapter should produce the same case contract, preserving its own provenance and capability limits. The UI has no dependency on Codex rollout shapes. Add a discovery/selection entry point for the new harness rather than teaching the renderer to parse its logs.

## Verification

```powershell
python -m unittest discover -s tests -v
node tests/ui-smoke.cjs
node --check web/app.js
```

The real-data test checks each imported agent's response count and token totals against its original usage records and final thread usage snapshot. Regression tests cover duplicated snapshots, compressed input, parallel tool returns, encrypted content, explicit parent links, and partial JSON writes. The Node smoke test exercises rendering and interactions against a small DOM stub; it does **not** replace browser layout/accessibility testing.

## Self-contained packages

Use **Create package** to download a single offline HTML file containing the viewer and all currently imported cases. Choose **Scramble package content** to mask that package independently of the local database; leave it unchecked for readable content. Open the resulting HTML directly in a browser. It needs no Python/server or internet to explore the snapshot. Local history importing requires the full application and Python server.

The same operation is available as `python -m swimlane.package --output agent-swimlane.html`, optionally adding `--scramble`. Package creation never modifies local data. Scrambling cannot recover text from an already scrambled database: use the default readable local import first. Sidebar labels use short session identifiers in both modes; hover reveals the original title only when available, while the main heading and inspector show readable local text.
