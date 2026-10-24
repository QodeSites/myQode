# MCP server — One Battalion Ventures Private Limited

Lets One Battalion's AI assistant (Claude, or any tool that speaks the Model Context Protocol) read their own
investors' data with Qode. It is a thin layer over the partner API in `distributor-api-one-battalion.md`: same key,
same scope (only accounts whose intermediary is One Battalion), read-only.

| | |
|---|---|
| URL | `https://myqode.qodeinvest.com/api/distributor-api/v1/mcp` |
| Transport | MCP Streamable HTTP (POST, JSON responses, no sessions) |
| Authentication | `Authorization: Bearer <API key>` on every request (the partner API key; `x-api-key` also works) |
| Limits | 120 tool calls a minute |

## Tools

| Tool | What it returns | Inputs |
|---|---|---|
| `list_investors` | Families → owners → accounts: code, name, email, strategy, start date, latest value, amount invested, relationship manager (name, phone, email), totals | none |
| `get_portfolio` | Latest value, invested amount, P&L, NAV, drawdown and returns per account | `account_codes` (optional) |
| `get_transactions` | Contributions and withdrawals | `account_codes`, `from`, `to` (all optional) |
| `get_portfolio_history` | Value, NAV, drawdown and returns over time | `account_codes` (1 to 5, required), `from`, `to`, `interval` = `daily` / `weekly` (default) / `monthly`; default range the last 90 days; at most 2,000 rows |
| `list_documents` | Which document types are on file per account, and how many files | `account_codes` (optional) |

Account codes that are not One Battalion's are ignored, exactly as in the API. Document download links
(`/documents/files`) are not available through MCP; use the API for those.

## Connecting

Claude Code:

```
claude mcp add --transport http qode-one-battalion https://myqode.qodeinvest.com/api/distributor-api/v1/mcp \
  --header "Authorization: Bearer <API key>"
```

Claude Desktop and other clients that only run local servers (`claude_desktop_config.json`):

```json
{ "mcpServers": { "qode-one-battalion": { "command": "npx", "args": ["-y", "mcp-remote",
  "https://myqode.qodeinvest.com/api/distributor-api/v1/mcp", "--header", "Authorization: Bearer <API key>"] } } }
```

Connectors that cannot send a custom header (they expect OAuth or no login) cannot use this server yet.

## What to keep in mind

- Whatever the assistant reads (names, emails, values, transactions) is sent to the AI provider of the tool it is
  connected to. Connect it only to tools One Battalion is allowed to share client data with.
- The key gives the whole book. Keep it out of shared prompts and screenshots; ask Qode to rotate it if it leaks.
- Data is as of the last portfolio update (`as_of` / `report_date`), not live.
- Every tool call is recorded on Qode's side (admin audit log, action `partner.mcp`, with the tool and its inputs).

## Implementation

`app/api/distributor-api/v1/mcp/route.ts`. Each tool calls the matching partner API handler in-process with the
caller's key, so there is no second copy of the scoping rules.
