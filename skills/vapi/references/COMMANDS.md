# vapi Command Reference

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
vapi auth login [--key <key>] [--org-id <id>] [--no-input]
vapi auth status
vapi auth logout
```

`login` validates by calling `GET /assistant?limit=1`. Saves to `~/.config/vapi-cli/credentials.json` (mode 600).
`status` prints `{authenticated, source, keyPreview, orgId, path, baseUrl}`.
`logout` removes the credentials file. Does not affect `VAPI_API_KEY` env.

```bash
echo $VAPI_API_KEY | vapi auth login --no-input
vapi auth status --json | jq .source       # "env" or "file"
```

## assistant

| Command | Endpoint | Notes |
|---------|----------|-------|
| `vapi assistant list [--limit N] [--created-at-gt ISO] [--created-at-lt ISO] [--updated-at-gt ISO] [--updated-at-lt ISO]` | `GET /assistant` | Returns array. Empty → exit `3`. |
| `vapi assistant get <id>` | `GET /assistant/{id}` | |
| `vapi assistant create -f <file\|->` | `POST /assistant` | Body required. `-` reads stdin. |
| `vapi assistant update <id> -f <file\|->` | `PATCH /assistant/{id}` | Vapi PATCH is partial; only include changed fields. |
| `vapi assistant delete <id> [--force]` | `DELETE /assistant/{id}` | `--force` required outside dry-run. |

```bash
vapi assistant list --limit 50 --select id,name --out .vapi/assistants.json
vapi assistant get $ID | jq .model.messages
echo '{"name":"x"}' | vapi assistant create -f - --dry-run
```

## squad

| Command | Endpoint | Notes |
|---------|----------|-------|
| `vapi squad list [filters]` | `GET /squad` | Same filter flags as `assistant list`. |
| `vapi squad get <id>` | `GET /squad/{id}` | |
| `vapi squad create -f <file\|->` | `POST /squad` | First `members[]` entry is the entry-point assistant. |
| `vapi squad update <id> -f <file\|->` | `PATCH /squad/{id}` | |
| `vapi squad delete <id> [--force]` | `DELETE /squad/{id}` | |

```bash
vapi squad list --select id,name
jq -n --arg id "$ASSISTANT_ID" '{name:"S", members:[{assistantId:$id}]}' \
  | vapi squad create -f -
```

## schema

```bash
vapi schema                           # whole CLI
vapi schema assistant                 # one subcommand subtree
vapi schema assistant get             # leaf only
```

Output: `{name, description, usage, aliases, arguments, options, subcommands}` recursively.

## exit-codes

```bash
vapi exit-codes
```

Returns a map of `NAME → {code, description}`.

## Resource Coverage

| Resource     | Status        | Commands |
|--------------|---------------|----------|
| auth         | Phase 1 ✅    | login, status, logout |
| assistant    | Phase 1 ✅    | list, get, create, update, delete |
| squad        | Phase 1 ✅    | list, get, create, update, delete |
| tool         | Phase 2 ⏳    | — |
| call         | Phase 3 ⏳    | — |
| phone-number | Phase 3 ⏳    | — |
| file         | Phase 4 ⏳    | — |
| chat         | Phase 5 ⏳    | — |
| session      | Phase 5 ⏳    | — |
| campaign     | Phase 5 ⏳    | — |
| analytics    | Phase 5 ⏳    | — |

Use `vapi schema --json` for the live, authoritative list of what's currently shipped.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VAPI_API_KEY` | Private API key. Highest precedence. |
| `VAPI_ORG_ID` | Optional Vapi organization ID, sent through env-based config. |
| `VAPI_BASE_URL` | Override base URL (default `https://api.vapi.ai`). Useful for proxies/tests. |
| `VAPI_CONFIG_DIR` | Override config dir (default `$XDG_CONFIG_HOME/vapi-cli` or `~/.config/vapi-cli`). |
