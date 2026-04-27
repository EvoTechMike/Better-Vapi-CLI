---
name: vapi
description: Manage Vapi voice AI configuration via the vapi CLI — read full assistant system prompts, edit assistants, create/update squads, list calls. Use whenever the user asks about Vapi assistants, squads, tools, calls, phone numbers, files, chats, or sessions. Prefer this CLI over the Vapi MCP server, which truncates large payloads (e.g. system prompts).
allowed-tools: Bash(vapi *), Bash(jq *), Bash(cat *), Bash(echo *)
---

# vapi — Vapi voice AI CLI

Thin wrapper over the Vapi REST API. Designed so you can dump JSON to disk and process it with `jq`. Responses are **unwrapped** — `list` returns the array directly, `get`/`create`/`update` return the entity directly, no `.QueryResponse` wrapper.

## Install

```bash
npm i -g vapi-cli            # global
npx vapi-cli ...             # one-off
```

## Getting an API Key

Vapi has two key types — the CLI needs the **private** one.

1. Open the Vapi dashboard → **Org Settings** → **API Keys**.
2. Copy the **Private Key** (starts with a UUID-shaped string). The Public Key only authorises browser SDKs and will fail with 401 here.
3. Store it via env var or `vapi auth login` (below).

## Setup

Three configuration paths, in resolution order:

```bash
# 1. Env var — preferred for CI / ephemeral shells. Overrides the file.
export VAPI_API_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# 2. Persisted file — preferred for desktop. Saved at
#    ~/.config/vapi-cli/credentials.json with mode 600.
vapi auth login                       # prompts on stdin
vapi auth login --key "$VAPI_API_KEY" # scripted

# 3. Pipe + non-interactive (e.g. inside a setup script).
echo "$VAPI_API_KEY" | vapi auth login --no-input
```

`vapi auth login` validates the key by hitting `GET /assistant?limit=1` before saving — if it fails with 401, nothing is written.

## Verify

```bash
vapi auth status                                 # shows source (env|file), redacted key, base URL
vapi assistant list --limit 1 --json | jq 'length'
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
vapi assistant list --out .vapi/assistants.json
jq '[.[] | {id, name}]' .vapi/assistants.json

# Pull one assistant — full untruncated system prompt
vapi assistant get $ID --out .vapi/assistants/$ID.json
jq -r '.model.messages[]? | select(.role=="system") | .content' \
   .vapi/assistants/$ID.json
# Older assistants put it on a different field — fall back if needed:
jq -r '.model.messages[0]?.content // .model.systemPrompt // ""' \
   .vapi/assistants/$ID.json

# Clone-and-edit: pull → mutate with jq → push back
vapi assistant get $ID --out /tmp/a.json
jq '.model.messages |= map(if .role=="system" then .content="NEW PROMPT" else . end)' \
   /tmp/a.json > /tmp/a.patch.json
vapi assistant update $ID -f /tmp/a.patch.json --dry-run    # preview
vapi assistant update $ID -f /tmp/a.patch.json              # apply
```

When `--out` is set, stdout gets `{"path":"<resolved>"}` (so you can chain) and the JSON goes to the file.

## Common Patterns

```bash
# List with field projection
vapi assistant list --select id,name,createdAt | jq .

# Get and pluck a single field
vapi assistant get $ID | jq -r '.voice.provider'

# Create from a heredoc
cat <<'JSON' | vapi assistant create -f -
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
echo '{"name":"Renamed"}' | vapi assistant update $ID -f -

# Filter listings by date
vapi assistant list --created-at-gt 2026-04-01T00:00:00Z

# Destructive ops require explicit confirmation
vapi assistant delete $ID --force      # or --yes

# Dry-run any mutation to see exactly what would be sent
echo '{"name":"x"}' | vapi assistant create -f - --dry-run
```

## Workflow: build a squad from scratch

```bash
# 1. Receptionist
RECEP=$(cat <<'JSON' | vapi assistant create -f - | jq -r '.id'
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
SPEC=$(cat <<'JSON' | vapi assistant create -f - | jq -r '.id'
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
}' | vapi squad create -f -

# 4. Confirm
vapi squad list --select id,name
```

## Workflow: edit a system prompt safely

```bash
# Pull current state
vapi assistant get $ID --out .vapi/assistants/$ID.json

# Inspect the prompt before changing it
jq -r '.model.messages[]? | select(.role=="system") | .content' .vapi/assistants/$ID.json

# Build the patch with jq (mutating only what we need)
jq '.model.messages |= map(
      if .role=="system" then .content=$new else . end
    )' --arg new "$(cat new-prompt.txt)" \
   .vapi/assistants/$ID.json > /tmp/patch.json

# Preview the request, then apply
vapi assistant update $ID -f /tmp/patch.json --dry-run
vapi assistant update $ID -f /tmp/patch.json
```

## Troubleshooting

| Symptom                            | Likely cause / fix                                                                 |
|------------------------------------|------------------------------------------------------------------------------------|
| 401 `Unauthorized`                 | Wrong key. The CLI needs the **private** key, not the public one.                   |
| 403 `Forbidden`                    | Key lacks scope for that resource (e.g. org-restricted). Use a key from the right org.|
| 404 on a known id                  | `id` belongs to another org, or was deleted. `vapi assistant list` to confirm.      |
| 429 `Too Many Requests`            | Rate limited — the CLI retries once; otherwise back off and retry.                  |
| `No Vapi API key configured`       | Set `VAPI_API_KEY` or run `vapi auth login`.                                        |
| `system prompt looks empty`        | Look at `.model.messages[]?.role=="system"`. Older assistants used `.model.systemPrompt`. |
| `Refusing to delete ... --force`   | Add `--force` (or `--yes`). Required outside of `--dry-run`.                        |
| Output missing in piped shell      | `--out path` writes to disk; without `--out` JSON goes to stdout (compact when piped).|

## Agent Introspection

```bash
vapi schema --json                       # full command tree
vapi schema assistant list --json        # one subcommand
vapi exit-codes --json                   # exit-code map
```

## Exit Codes

`0` success · `1` generic error · `2` usage · `3` empty result · `4` auth required · `5` not found · `6` forbidden · `7` rate limited · `8` retryable upstream · `9` not implemented in this phase · `10` config error.

## Reference

See [references/COMMANDS.md](references/COMMANDS.md) for the full per-command flag table, environment variables, and resource coverage matrix.
