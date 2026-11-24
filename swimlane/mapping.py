"""Harness naming/accounting maps into common concepts."""
HARNESS_LABELS = {"codex": "Codex", "claude": "Claude Code"}
CLAUDE_BLOCKS = {"tool_use": "tool", "tool_result": "tool_output", "text": "text", "thinking": "reasoning"}


def claude_usage(raw):
    cached = raw.get("cache_read_input_tokens", 0) or 0
    written = raw.get("cache_creation_input_tokens", 0) or 0
    total_input = (raw.get("input_tokens", 0) or 0) + cached + written
    output = raw.get("output_tokens", 0) or 0
    result = dict(input_tokens=total_input, cached_input_tokens=cached, cache_write_input_tokens=written,
                  output_tokens=output, total_tokens=total_input+output)
    thinking = (raw.get("output_tokens_details") or {}).get("thinking_tokens")
    if thinking is not None:
        result["reasoning_output_tokens"] = thinking
    return result
