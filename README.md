# vapi-cli

Command-line interface for [Vapi](https://vapi.ai) voice AI — for humans and AI agents.

The Vapi MCP server can't return large payloads (full system prompts, full assistant configs). This CLI hits the REST API directly, dumps JSON to stdout (or to disk via `--out`), and ships with a Claude Code skill that teaches Claude how to use it with `jq`.

## Status — phased rollout

| Resource     | Status     | Commands                              |
|--------------|------------|---------------------------------------|
| auth         | Phase 1 ✅ | `login`, `status`, `logout`           |
| assistant    | Phase 1 ✅ | `list`, `get`, `create`, `update`, `delete` |
| squad        | Phase 1 ✅ | `list`, `get`, `create`, `update`, `delete` |
| tool         | Phase 2 ⏳ | —                                     |
| call         | Phase 3 ⏳ | —                                     |
| phone-number | Phase 3 ⏳ | —                                     |
| file         | Phase 4 ⏳ | —                                     |
| chat         | Phase 5 ⏳ | —                                     |
| session      | Phase 5 ⏳ | —                                     |
| campaign     | Phase 5 ⏳ | —                                     |
| analytics    | Phase 5 ⏳ | —                                     |

`vapi schema --json` is always the authoritative source for what's actually shipped in the binary you have.

## Install

```bash
npm i -g vapi-cli
# or run ad-hoc
npx vapi-cli ...
```

Requires Node 18+.

## Configure your API key

Get the **private** key from the Vapi dashboard → Org Settings → API Keys. (The public key is for browser SDKs only — it returns 401 here.)

Pick one:

```bash
# 1. Env var — overrides everything
export VAPI_API_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# 2. Persisted file — stored at ~/.config/vapi-cli/credentials.json (mode 600)
vapi auth login                        # interactive
vapi auth login --key "$VAPI_API_KEY"  # scripted
echo $VAPI_API_KEY | vapi auth login --no-input
```

Verify:

```bash
vapi auth status                       # source, redacted key, base URL
vapi assistant list --limit 1
```

## Use with Claude Code

The skill at [`skills/vapi/SKILL.md`](skills/vapi/SKILL.md) tells Claude exactly how to drive this CLI — pulling system prompts, editing assistants with `jq`, building squads.

```bash
# 1. Install the CLI globally so Claude can run it
npm i -g vapi-cli

# 2. Install the skill (uses the SKILL.md in this repo)
npx skills add -g <owner>/vapi-cli

# 3. Set your key once, in your shell rc or via:
vapi auth login
```

After that, ask Claude things like *"show me the full system prompt for assistant abc-123"* or *"add a sentence to every assistant's system prompt"* — it will use the skill and `jq` instead of the truncating MCP server.

## Quick examples

```bash
# Pull every assistant to disk, then jq locally
vapi assistant list --out .vapi/assistants.json
jq '[.[] | {id, name}]' .vapi/assistants.json

# Full untruncated system prompt
vapi assistant get $ID | jq -r '.model.messages[]? | select(.role=="system") | .content'

# Edit an assistant
vapi assistant get $ID --out /tmp/a.json
jq '.model.messages |= map(if .role=="system" then .content="NEW" else . end)' /tmp/a.json \
  | vapi assistant update $ID -f -

# Always preview destructive changes
echo '{"name":"x"}' | vapi assistant create -f - --dry-run
vapi assistant delete $ID --force
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
| `VAPI_CONFIG_DIR` | Override config dir (default `~/.config/vapi-cli`). |

## Development

```bash
npm install
npm run build         # tsup → dist/cli.js
npm run typecheck
npm test              # vitest
node dist/cli.js --help
```

## License

MIT
