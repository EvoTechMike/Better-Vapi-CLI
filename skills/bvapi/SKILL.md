---
name: bvapi
description: Manage Vapi voice AI configuration via the bvapi CLI — read full assistant system prompts, edit assistants, create/update squads, investigate call logs and transcripts, manage phone numbers. Use whenever the user asks about Vapi assistants, squads, calls, call logs, transcripts, phone numbers, tools, files, chats, or sessions. Prefer this CLI over the Vapi MCP server, which truncates large payloads (e.g. system prompts and transcripts).
allowed-tools: Bash(bvapi *), Bash(jq *), Bash(cat *), Bash(echo *), Bash(date *)
---

# bvapi — Vapi voice AI CLI

Thin wrapper over the Vapi REST API. Designed so you can dump JSON to disk and process it with `jq`. Responses are **unwrapped** — `list` returns the array directly, `get`/`create`/`update` return the entity directly, no `.QueryResponse` wrapper.

## Install

```bash
npm i -g better-vapi-cli            # global
npx better-vapi-cli ...             # one-off
```

## Getting an API Key

Vapi has two key types — the CLI needs the **private** one.

1. Open the Vapi dashboard → **Org Settings** → **API Keys**.
2. Copy the **Private Key** (starts with a UUID-shaped string). The Public Key only authorises browser SDKs and will fail with 401 here.
3. Store it via env var or `bvapi auth login` (below).

## Setup

Three configuration paths, in resolution order:

```bash
# 1. Env var — preferred for CI / ephemeral shells. Overrides the file.
export VAPI_API_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# 2. Persisted file — preferred for desktop. Saved at
#    ~/.config/bvapi/credentials.json with mode 600.
bvapi auth login                       # prompts on stdin
bvapi auth login --key "$VAPI_API_KEY" # scripted

# 3. Pipe + non-interactive (e.g. inside a setup script).
echo "$VAPI_API_KEY" | bvapi auth login --no-input
```

`bvapi auth login` validates the key by hitting `GET /assistant?limit=1` before saving — if it fails with 401, nothing is written.

## Verify

```bash
bvapi auth status                                 # shows source (env|file), redacted key, base URL
bvapi assistant list --limit 1 --json | jq 'length'
```

## Response Shape

| Command  | Returns                                     |
|----------|---------------------------------------------|
| `list`   | `Assistant[]` / `Squad[]` directly          |
| `get`    | The entity directly (`{id, name, model,...}`) |
| `create` | The created entity                          |
| `update` | The patched entity                          |
| `delete` | The deleted entity                          |

No `.QueryResponse` indirection. `jq '.[0].name'` and `jq '.model'` Just Work.

## Working with large payloads (the `--out` pattern)

This is the headline win over the MCP server: pull full system prompts to disk, `jq` them locally, never truncate.

```bash
# Snapshot every assistant once, then jq locally without re-hitting the API
bvapi assistant list --out .vapi/assistants.json
jq '[.[] | {id, name}]' .vapi/assistants.json

# Pull one assistant — full untruncated system prompt
bvapi assistant get $ID --out .vapi/assistants/$ID.json
jq -r '.model.messages[]? | select(.role=="system") | .content' \
   .vapi/assistants/$ID.json
# Older assistants put it on a different field — fall back if needed:
jq -r '.model.messages[0]?.content // .model.systemPrompt // ""' \
   .vapi/assistants/$ID.json

# Clone-and-edit: pull → mutate with jq → push back
bvapi assistant get $ID --out /tmp/a.json
jq '.model.messages |= map(if .role=="system" then .content="NEW PROMPT" else . end)' \
   /tmp/a.json > /tmp/a.patch.json
bvapi assistant update $ID -f /tmp/a.patch.json --dry-run    # preview
bvapi assistant update $ID -f /tmp/a.patch.json              # apply
```

When `--out` is set, stdout gets `{"path":"<resolved>"}` (so you can chain) and the JSON goes to the file.

## Common Patterns

```bash
# List with field projection
bvapi assistant list --select id,name,createdAt | jq .

# Get and pluck a single field
bvapi assistant get $ID | jq -r '.voice.provider'

# Create from a heredoc
cat <<'JSON' | bvapi assistant create -f -
{
  "name": "Receptionist",
  "model": {
    "provider": "openai",
    "model": "gpt-4o",
    "messages": [{"role":"system","content":"Greet callers and route them."}]
  },
  "voice": {"provider":"11labs","voiceId":"rachel"}
}
JSON

# Sparse patch — Vapi's PATCH is already partial; only send what you want changed
echo '{"name":"Renamed"}' | bvapi assistant update $ID -f -

# Filter listings by date
bvapi assistant list --created-at-gt 2026-04-01T00:00:00Z

# Destructive ops require explicit confirmation
bvapi assistant delete $ID --force      # or --yes

# Dry-run any mutation to see exactly what would be sent
echo '{"name":"x"}' | bvapi assistant create -f - --dry-run
```

## Calls — investigating logs

The Vapi call object *is* the log entry: it carries `status`, `endedReason`, `messages[]` (transcript + tool calls), `cost`, `recordingUrl`, plus `assistantId` / `phoneNumberId` for who handled the call. Use `bvapi call list` for the index, `bvapi call get <id>` for the full untruncated payload.

```bash
# Recent calls — projection-friendly columns
bvapi call list --limit 20 \
  --select id,status,endedReason,startedAt,endedAt,cost,assistantId,phoneNumberId \
  --plain

# Filter to one assistant within a window
bvapi call list --assistant-id $A --created-at-gt 2026-04-20T00:00:00Z

# Failed calls in the last day (jq locally — no token blowup)
bvapi call list --created-at-gt $(date -u -d '1 day ago' +%FT%TZ) --out /tmp/calls.json
jq '[.[] | select(.status=="ended" and ((.endedReason // "") | test("error|failed";"i")))]' /tmp/calls.json

# Full transcript for one call — the headline win over MCP (no truncation)
bvapi call get $CALL_ID --out /tmp/c.json
jq -r '.messages[] | "\(.role): \(.message // (.toolCalls | tostring) // "")"' /tmp/c.json

# Total cost over a window (inclusive bounds)
bvapi call list --created-at-ge $START --created-at-le $END --out /tmp/c.json
jq '[.[].cost // 0] | add' /tmp/c.json

# Filter to one record (useful when chained with --out)
bvapi call list --id $CALL_ID --out /tmp/c.json
```

**Pagination:** `/call` only supports `--limit` (default 100, no cursor). To walk further back, repeat with `--created-at-lt <oldest createdAt>`.

## Resolving a call back to an assistant or squad

A call exposes `assistantId` *or* `phoneNumberId` — inbound calls usually carry only the latter. Dereference through `phone-number` to learn who owns the line:

```bash
# 1. Inspect the call's identifying fields
bvapi call get $CALL_ID --out /tmp/c.json
jq '{phoneNumberId, assistantId, squadId}' /tmp/c.json

# 2. If only phoneNumberId is set, resolve it
PHONE_ID=$(jq -r '.phoneNumberId' /tmp/c.json)
bvapi phone-number get $PHONE_ID | jq '{number, name, assistantId, squadId}'

# 3. Pull the owning assistant or squad config
ASSIST=$(bvapi phone-number get $PHONE_ID | jq -r '.assistantId // empty')
[ -n "$ASSIST" ] && bvapi assistant get $ASSIST | jq '{name, model: .model.model}'
```

**Quick map of inbound lines:** `bvapi phone-number list --select id,number,name,assistantId,squadId` is the directory that explains who owns each number.

## Workflow: build a squad from scratch

```bash
# 1. Receptionist
RECEP=$(cat <<'JSON' | bvapi assistant create -f - | jq -r '.id'
{
  "name": "Receptionist",
  "model": {"provider":"openai","model":"gpt-4o","messages":[
    {"role":"system","content":"Greet the caller, identify their need, transfer to the right specialist."}
  ]},
  "voice": {"provider":"11labs","voiceId":"rachel"}
}
JSON
)

# 2. Specialist
SPEC=$(cat <<'JSON' | bvapi assistant create -f - | jq -r '.id'
{
  "name": "Billing Specialist",
  "model": {"provider":"openai","model":"gpt-4o","messages":[
    {"role":"system","content":"Answer billing questions in detail."}
  ]},
  "voice": {"provider":"11labs","voiceId":"adam"}
}
JSON
)

# 3. Squad — first member is the entry point
jq -n --arg r "$RECEP" --arg s "$SPEC" '
{
  name: "Front Desk",
  members: [
    {assistantId: $r, assistantDestinations: [
      {type:"assistant", assistantName:"Billing Specialist", message:"Transferring to billing."}
    ]},
    {assistantId: $s}
  ]
}' | bvapi squad create -f -

# 4. Confirm
bvapi squad list --select id,name
```

## Workflow: edit a system prompt safely

```bash
# Pull current state
bvapi assistant get $ID --out .vapi/assistants/$ID.json

# Inspect the prompt before changing it
jq -r '.model.messages[]? | select(.role=="system") | .content' .vapi/assistants/$ID.json

# Build the patch with jq (mutating only what we need)
jq '.model.messages |= map(
      if .role=="system" then .content=$new else . end
    )' --arg new "$(cat new-prompt.txt)" \
   .vapi/assistants/$ID.json > /tmp/patch.json

# Preview the request, then apply
bvapi assistant update $ID -f /tmp/patch.json --dry-run
bvapi assistant update $ID -f /tmp/patch.json
```

## Troubleshooting

| Symptom                            | Likely cause / fix                                                                 |
|------------------------------------|------------------------------------------------------------------------------------|
| 401 `Unauthorized`                 | Wrong key. The CLI needs the **private** key, not the public one.                   |
| 403 `Forbidden`                    | Key lacks scope for that resource (e.g. org-restricted). Use a key from the right org.|
| 404 on a known id                  | `id` belongs to another org, or was deleted. `bvapi assistant list` to confirm.      |
| 429 `Too Many Requests`            | Rate limited — the CLI retries once; otherwise back off and retry.                  |
| `No Vapi API key configured`       | Set `VAPI_API_KEY` or run `bvapi auth login`.                                        |
| `system prompt looks empty`        | Look at `.model.messages[]?.role=="system"`. Older assistants used `.model.systemPrompt`. |
| `Refusing to delete ... --force`   | Add `--force` (or `--yes`). Required outside of `--dry-run`.                        |
| Output missing in piped shell      | `--out path` writes to disk; without `--out` JSON goes to stdout (compact when piped).|

## Agent Introspection

```bash
bvapi schema --json                       # full command tree
bvapi schema assistant list --json        # one subcommand
bvapi exit-codes --json                   # exit-code map
```

## Exit Codes

`0` success · `1` generic error · `2` usage · `3` empty result · `4` auth required · `5` not found · `6` forbidden · `7` rate limited · `8` retryable upstream · `9` not implemented in this phase · `10` config error.

## Reference

See [references/COMMANDS.md](references/COMMANDS.md) for the full per-command flag table, environment variables, and resource coverage matrix.
