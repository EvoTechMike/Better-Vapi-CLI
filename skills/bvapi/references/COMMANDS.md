# bvapi Command Reference

## Global Flags

These are accepted on every leaf command. Place them anywhere after the command name.

| Flag | Short | Description |
|------|-------|-------------|
| `--json` | `-j` | Force JSON to stdout (default when stdout is piped). |
| `--plain` | `-p` | Tab-separated values; top-level scalars only. |
| `--select <fields>` | | Comma-separated list of top-level fields to keep. |
| `--out <path>` | | Write JSON to `<path>`; print `{"path":"..."}` to stdout. Creates parent dirs. |
| `--dry-run` | `-n` | Print the planned `{method,url,body}` and exit `0` without calling the API. |
| `--no-input` | | Never prompt; fail if input is needed. |
| `--force` | | Skip destructive-action confirmation. |
| `--verbose` | `-v` | Verbose progress to stderr. |

### Aliases

- `--fields` = `--select`
- `--yes` = `--force`

## Response Shapes

Vapi returns entities directly. There's no envelope to unwrap.

| Command  | Shape                      | Tip |
|----------|----------------------------|-----|
| `list`   | `Entity[]`                 | `jq '.[].id'`, exit `3` if empty. |
| `get`    | `Entity`                   | `jq '.model.messages'` |
| `create` | `Entity` (with `id`)       | `jq -r '.id'` to chain into next call. |
| `update` | `Entity` (patched)         | Same as `get`. |
| `delete` | `Entity` (deleted)         | Confirms what was removed. |

## auth

```bash
bvapi auth login [--key <key>] [--org-id <id>] [--no-input]
bvapi auth status
bvapi auth logout
```

`login` validates by calling `GET /assistant?limit=1`. Saves to `~/.config/bvapi/credentials.json` (mode 600).
`status` prints `{authenticated, source, keyPreview, orgId, path, baseUrl}`.
`logout` removes the credentials file. Does not affect `VAPI_API_KEY` env.

```bash
echo $VAPI_API_KEY | bvapi auth login --no-input
bvapi auth status --json | jq .source       # "env" or "file"
```

## assistant

| Command | Endpoint | Notes |
|---------|----------|-------|
| `bvapi assistant list [--limit N] [--created-at-{gt,lt,ge,le} ISO] [--updated-at-{gt,lt,ge,le} ISO]` | `GET /assistant` | Returns array. Empty → exit `3`. `gt`/`lt` are exclusive, `ge`/`le` inclusive. |
| `bvapi assistant get <id>` | `GET /assistant/{id}` | |
| `bvapi assistant create -f <file\|->` | `POST /assistant` | Body required. `-` reads stdin. |
| `bvapi assistant update <id> -f <file\|->` | `PATCH /assistant/{id}` | Vapi PATCH is partial; only include changed fields. |
| `bvapi assistant delete <id> [--force]` | `DELETE /assistant/{id}` | `--force` required outside dry-run. |

```bash
bvapi assistant list --limit 50 --select id,name --out .vapi/assistants.json
bvapi assistant get $ID | jq .model.messages
echo '{"name":"x"}' | bvapi assistant create -f - --dry-run
```

## squad

| Command | Endpoint | Notes |
|---------|----------|-------|
| `bvapi squad list [--limit N] [--created-at-{gt,lt,ge,le} ISO] [--updated-at-{gt,lt,ge,le} ISO]` | `GET /squad` | Same filter flags as `assistant list`. |
| `bvapi squad get <id>` | `GET /squad/{id}` | |
| `bvapi squad create -f <file\|->` | `POST /squad` | First `members[]` entry is the entry-point assistant. |
| `bvapi squad update <id> -f <file\|->` | `PATCH /squad/{id}` | |
| `bvapi squad delete <id> [--force]` | `DELETE /squad/{id}` | |

```bash
bvapi squad list --select id,name
jq -n --arg id "$ASSISTANT_ID" '{name:"S", members:[{assistantId:$id}]}' \
  | bvapi squad create -f -
```

## call

The Vapi call object *is* the log entry. `list` indexes them, `get` returns the full payload (status, endedReason, transcript via `messages[]`, cost, recordingUrl).

| Command | Endpoint | Notes |
|---------|----------|-------|
| `bvapi call list [--limit N] [--id <id>] [--assistant-id <id>] [--phone-number-id <id>] [--created-at-{gt,lt,ge,le} ISO] [--updated-at-{gt,lt,ge,le} ISO]` | `GET /call` | Returns array. No cursor pagination — walk back with `--created-at-lt <oldest>`. |
| `bvapi call get <id>` | `GET /call/{id}` | Full untruncated payload, including `messages[]` transcript. |
| `bvapi call create -f <file\|->` | `POST /call` | Triggers an outbound call. |
| `bvapi call update <id> -f <file\|->` | `PATCH /call/{id}` | Partial. |
| `bvapi call delete <id> [--force]` | `DELETE /call/{id}` | `--force` required outside dry-run. |

```bash
# Recent calls — projection-friendly columns
bvapi call list --limit 20 \
  --select id,status,endedReason,startedAt,cost,assistantId,phoneNumberId --plain

# Filter by assistant within a window
bvapi call list --assistant-id $A --created-at-gt 2026-04-20T00:00:00Z

# Failed calls in last day
bvapi call list --created-at-gt $(date -u -d '1 day ago' +%FT%TZ) --out /tmp/c.json
jq '[.[] | select((.endedReason // "") | test("error|failed";"i"))]' /tmp/c.json

# Full transcript
bvapi call get $ID --out /tmp/c.json
jq -r '.messages[] | "\(.role): \(.message // (.toolCalls | tostring) // "")"' /tmp/c.json
```

## phone-number

The bridge between assistants/squads and inbound calls. `phone-number get <id>` exposes `assistantId`, `squadId`, `number`, `name` so you can resolve `call.phoneNumberId → owner`.

| Command | Endpoint | Notes |
|---------|----------|-------|
| `bvapi phone-number list [--limit N] [--created-at-{gt,lt,ge,le} ISO] [--updated-at-{gt,lt,ge,le} ISO]` | `GET /phone-number` | Returns array. |
| `bvapi phone-number get <id>` | `GET /phone-number/{id}` | |
| `bvapi phone-number create -f <file\|->` | `POST /phone-number` | |
| `bvapi phone-number update <id> -f <file\|->` | `PATCH /phone-number/{id}` | |
| `bvapi phone-number delete <id> [--force]` | `DELETE /phone-number/{id}` | |

```bash
# Directory of inbound lines — who owns what
bvapi phone-number list --select id,number,name,assistantId,squadId

# Resolve a call's phoneNumberId to its owner
PHONE_ID=$(bvapi call get $CALL_ID | jq -r '.phoneNumberId')
bvapi phone-number get $PHONE_ID | jq '{number, name, assistantId, squadId}'
```

## schema

```bash
bvapi schema                           # whole CLI
bvapi schema assistant                 # one subcommand subtree
bvapi schema assistant get             # leaf only
```

Output: `{name, description, usage, aliases, arguments, options, subcommands}` recursively.

## exit-codes

```bash
bvapi exit-codes
```

Returns a map of `NAME → {code, description}`.

## Resource Coverage

| Resource     | Status        | Commands |
|--------------|---------------|----------|
| auth         | Phase 1 ✅    | login, status, logout |
| assistant    | Phase 1 ✅    | list, get, create, update, delete |
| squad        | Phase 1 ✅    | list, get, create, update, delete |
| tool         | Phase 2 ⏳    | — |
| call         | Phase 3 ✅    | list, get, create, update, delete |
| phone-number | Phase 3 ✅    | list, get, create, update, delete |
| file         | Phase 4 ⏳    | — |
| chat         | Phase 5 ⏳    | — |
| session      | Phase 5 ⏳    | — |
| campaign     | Phase 5 ⏳    | — |
| analytics    | Phase 5 ⏳    | — |

Use `bvapi schema --json` for the live, authoritative list of what's currently shipped.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VAPI_API_KEY` | Private API key. Highest precedence. |
| `VAPI_ORG_ID` | Optional Vapi organization ID, sent through env-based config. |
| `VAPI_BASE_URL` | Override base URL (default `https://api.vapi.ai`). Useful for proxies/tests. |
| `VAPI_CONFIG_DIR` | Override config dir (default `$XDG_CONFIG_HOME/bvapi` or `~/.config/bvapi`). |
