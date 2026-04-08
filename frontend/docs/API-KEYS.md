# HopFast API Keys

## Must Have (for production)

1. Privy App ID
- Used client-side for wallet/auth UX.

2. OpenAI API key (server-side)
- Used by `/api/intent` to parse natural-language prompts into structured swap parameters.

## Optional (recommended at scale)

1. LI.FI API key
- Used server-side for higher rate limits and controlled backend usage.
- Header: `x-lifi-api-key`

## Recommended Placement

- Frontend (`VITE_*`): only non-sensitive values (Privy app id, backend URL)
- Backend secret env:
  - `OPENAI_API_KEY`
  - `LIFI_API_KEY`

## Why Not Put Secrets in Frontend?

Browser apps expose bundled env vars. Keep API keys server-side and call provider APIs via your backend.
