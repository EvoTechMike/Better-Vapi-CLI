# better-vapi-cli (`bvapi`)

Command-line interface for [Vapi](https://vapi.ai) voice AI — for humans and AI agents.

The Vapi MCP server can't return large payloads (full system prompts, full assistant configs). This CLI hits the REST API directly, dumps JSON to stdout (or to disk via `--out`), and ships with a Claude Code skill that teaches Claude how to use it with `jq`.

## Status — phased rollout

| Resource     | Status     | Commands                              |
|--------------|------------|---------------------------------------|
| auth         | Phase 1 ✅ | `login`, `status`, `logout`           |
| assistant    | Phase 1 ✅ | `list`, `get`, `create`, `update`, `delete` |
| squad        | Phase 1 ✅ | `list`, `get`, `create`, `update`, `delete` |
| tool         | Phase 2 ✅ | `list`, `get`, `create`, `update`, `delete` |
| call         | Phase 3 ✅ | `list`, `get`, `create`, `update`, `delete` |
| phone-number | Phase 3 ✅ | `list`, `get`, `create`, `update`, `delete` |
| file         | Phase 4 ✅ | `list`, `get`, `create`, `update`, `delete` |
| chat         | Phase 5 ⏳ | —                                     |
| session      | Phase 5 ⏳ | —                                     |
| campaign     | Phase 5 ⏳ | —                                     |
| analytics    | Phase 5 ⏳ | —                                     |

`bvapi schema --json` is always the authoritative source for what's actually shipped in the binary you have.

## Install

```bash
npm i -g better-vapi-cli
# or run ad-hoc
npx better-vapi-cli ...
```

Requires Node 18+.

## Configure your API key

Get the **private** key from the Vapi dashboard → Org Settings → API Keys. (The public key is for browser SDKs only — it returns 401 here.)

Pick one:

```bash
# 1. Env var — overrides everything
export VAPI_API_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# 2. Persisted file — stored at ~/.config/bvapi/credentials.json (mode 600)
bvapi auth login                        # interactive
bvapi auth login --key "$VAPI_API_KEY"  # scripted
echo $VAPI_API_KEY | bvapi auth login --no-input
```

Verify:

```bash
bvapi auth status                       # source, redacted key, base URL
bvapi assistant list --limit 1
```

## Use with Claude Code

The skill at [`skills/bvapi/SKILL.md`](skills/bvapi/SKILL.md) tells Claude exactly how to drive this CLI — pulling system prompts, editing assistants with `jq`, building squads.

```bash
# 1. Install the CLI globally so Claude can run it
npm i -g better-vapi-cli

# 2. Install the skill (uses the SKILL.md in this repo)
npx skills add -g EvoTechMike/Better-Vapi-CLI

# 3. Set your key once, in your shell rc or via:
bvapi auth login
```

After that, ask Claude things like *"show me the full system prompt for assistant abc-123"*, *"find all failed calls in the last day and tell me which assistants handled them"*, or *"add a sentence to every assistant's system prompt"* — it will use the skill and `jq` instead of the truncating MCP server.

## Quick examples

```bash
# Pull every assistant to disk, then jq locally
bvapi assistant list --out .vapi/assistants.json
jq '[.[] | {id, name}]' .vapi/assistants.json

# Full untruncated system prompt
bvapi assistant get $ID | jq -r '.model.messages[]? | select(.role=="system") | .content'

# Edit an assistant
bvapi assistant get $ID --out /tmp/a.json
jq '.model.messages |= map(if .role=="system" then .content="NEW" else . end)' /tmp/a.json \
  | bvapi assistant update $ID -f -

# Always preview destructive changes
echo '{"name":"x"}' | bvapi assistant create -f - --dry-run
bvapi assistant delete $ID --force

# Investigate call logs — full untruncated transcripts
bvapi call list --limit 20 --select id,status,endedReason,cost,assistantId,phoneNumberId --plain
bvapi call get $CALL_ID --out /tmp/c.json
jq -r '.messages[] | "\(.role): \(.message // "")"' /tmp/c.json

# Filter calls by assistant + window, find failures
bvapi call list --assistant-id $A --created-at-gt 2026-04-20T00:00:00Z
bvapi call list --created-at-gt $(date -u -d '1 day ago' +%FT%TZ) --out /tmp/c.json
jq '[.[] | select((.endedReason // "") | test("error|failed";"i"))]' /tmp/c.json

# Resolve a call's phoneNumberId back to the owning assistant/squad
PHONE=$(bvapi call get $CALL_ID | jq -r '.phoneNumberId')
bvapi phone-number get $PHONE | jq '{number, name, assistantId, squadId}'

# List every tool, then pull one's full function schema
bvapi tool list --select id,type,function.name --plain
bvapi tool get $TOOL_ID | jq '.function'

# Build a knowledge base: upload → query tool → wire to assistant
F1=$(bvapi file create -f ./pricing.pdf | jq -r '.id')
F2=$(bvapi file create -f ./faq.md      | jq -r '.id')
TOOL_ID=$(jq -n --arg a "$F1" --arg b "$F2" '{
  type:"query",
  function:{name:"product-knowledge", description:"Search product docs and pricing."},
  knowledgeBases:[{provider:"google", name:"product-kb",
    description:"Pricing, plans, FAQ.", fileIds:[$a,$b]}]
}' | bvapi tool create -f - | jq -r '.id')
# Then `bvapi assistant update $A` with model.toolIds += [$TOOL_ID] and a
# system prompt that names "product-knowledge" — see SKILL.md for the patch.
```

## Output modes

By default, JSON to stdout (pretty in a TTY, compact when piped). Other modes:

- `--json` / `-j` — force JSON
- `--out <path>` — write JSON to file; stdout gets `{"path":"..."}`
- `--select id,name` — project to top-level fields
- `--plain` / `-p` — TSV of top-level scalars
- `--dry-run` / `-n` — print the planned `{method,url,body}` and exit `0`

## Exit codes

`0` success · `1` error · `2` usage · `3` empty result · `4` auth required · `5` not found · `6` forbidden · `7` rate limited · `8` retryable upstream · `9` not implemented · `10` config

## Environment variables

| Variable | Purpose |
|----------|---------|
| `VAPI_API_KEY` | Private API key (overrides credentials file). |
| `VAPI_ORG_ID` | Optional org id, threaded through env-based config. |
| `VAPI_BASE_URL` | Override base URL (default `https://api.vapi.ai`). |
| `VAPI_CONFIG_DIR` | Override config dir (default `~/.config/bvapi`). |

## Development

```bash
npm install
npm run build         # tsup → dist/cli.js
npm run typecheck
npm test              # vitest (mocked fetch — never hits the real API)
node dist/cli.js --help

# Live dev loop: auto-rebuild on save + globally linked binary
npm link              # makes `bvapi` on PATH point at this dist
npm run dev           # tsup --watch
```

## License

MIT
