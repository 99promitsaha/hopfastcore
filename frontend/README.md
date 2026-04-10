# HopFast — Frontend

The React web app for HopFast. Handles wallet connection, swap quotes, yield vault browsing, transaction tracking, and the agent integration docs. Runs at [hopfast.xyz](https://hopfast.xyz).

---

## Tech stack

| | |
|---|---|
| Framework | React 18 + Vite |
| Language | TypeScript |
| Styling | Tailwind CSS + custom CSS design system |
| Animations | Framer Motion |
| Wallet auth | Privy (optional) |
| Icons | Lucide React |

---

## Running locally

```bash
npm install
cp .env.example .env
npm run dev
# http://localhost:5173
```

Make sure the backend is running on `http://localhost:8080` before starting the frontend.

---

## Environment variables

```env
VITE_PRIVY_APP_ID=        # optional, get this from dashboard.privy.io
```

If `VITE_PRIVY_APP_ID` is not set, the app falls back to a demo wallet so you can still develop and test without a Privy account.

---

## Views

The app is a single-page application. All views are React state — there is no URL routing.

| View | What it does |
|------|-------------|
| **Landing** | Entry point. User picks Human mode or Agent mode. |
| **Swap** | Cross-chain swap interface. Pick tokens, get quotes from multiple providers, see fees and estimated time. |
| **Earn** | Yield vault browser. Filter by chain, token, or protocol. Deposit into a vault and track your position. |
| **Agent** | MCP server docs for developers. Setup guides for Claude Desktop, Claude Code, and any HTTP agent. |
| **Stats** | Protocol-wide analytics. Swap volume, unique users, and earn deposits over 7, 15, or 30 days. |

---

## Project structure

```
src/
├── components/
│   ├── LandingView.tsx              Entry point, mode picker
│   ├── SwapView.tsx                 Main swap interface
│   ├── EarnView.tsx                 Yield vault browser and deposit flow
│   ├── AgentView.tsx                MCP docs and setup guides
│   ├── StatsView.tsx                Protocol analytics dashboard
│   ├── WalletConnector.tsx          Privy + demo wallet fallback
│   └── TransactionHistoryModal.tsx  Swap and bridge history modal
│
├── hooks/
│   ├── useSwapQuotes.ts             Fetches and compares quotes from all providers
│   ├── useSwapExecution.ts          Handles swap signing and submission
│   ├── useEarnVaults.ts             Fetches and filters yield vaults
│   ├── useEarnDeposit.ts            Handles the vault deposit flow
│   ├── useTokenBalances.ts          Reads on-chain token balances for a wallet
│   ├── useTransactionHistory.ts     Fetches swap and bridge history
│   └── usePrices.ts                 Token price feeds
│
├── services/
│   ├── quoteService.ts              Calls the backend quote API
│   ├── earnService.ts               Calls the earn API endpoints
│   ├── transactionStatusService.ts  Polls bridge status until resolved
│   ├── transactionHistoryService.ts Fetches transaction records
│   ├── priceService.ts              Token price lookups
│   └── balanceService.ts            On-chain balance fetching
│
├── lib/
│   ├── chains.ts                    Supported networks and their config
│   ├── tokens.generated.ts          2800+ ERC-20 tokens across all chains
│   ├── swap.ts                      Swap utility functions
│   ├── amount.ts                    Wei and human-readable conversions
│   └── erc20.ts                     ERC-20 contract helpers
│
├── types.ts                         Shared TypeScript interfaces
├── constants.ts                     App-wide constants and config
└── App.tsx                          Root component and view orchestration
```

---

## Supported chains

| Chain | Chain ID |
|-------|----------|
| Ethereum | 1 |
| Base | 8453 |
| BNB Chain | 56 |
| Polygon | 137 |
| Monad | 143 |

The token list covers 2800+ ERC-20 tokens across all five chains.

---

## Wallet connection

Wallet auth uses [Privy](https://privy.io). Set `VITE_PRIVY_APP_ID` in your `.env` to enable it. Without it, a demo wallet kicks in automatically — useful for local development and testing without needing a real wallet connected.

No email, password, or personal data is collected. Identity is purely wallet-address based.

---

## Static files

These live in `public/` and are served directly at the root of the domain.

| File | Purpose |
|------|---------|
| `robots.txt` | Crawler permissions and sitemap pointer |
| `sitemap.xml` | URL map for search engines |
| `llms.txt` | AI agent capability manifest, follows the llmstxt.org convention |

---

## Scripts

```bash
npm run dev      # start dev server with hot reload
npm run build    # production build to dist/
npm run preview  # preview the production build locally
```

---

## Design system

Styles live in `src/index.css`. The app uses CSS custom properties for colours, spacing, shadows, fonts, and transitions. All component styles use plain CSS classes prefixed with `hf-`.

Core tokens:

```css
--hf-primary: #F5A7CA        /* pink, primary actions */
--hf-secondary: #96D2F4      /* blue, secondary and agent-related UI */
--hf-tertiary: #3dbc5e       /* green, success and earn */
--hf-text-primary: #32435E
--hf-font-headline: 'Plus Jakarta Sans'
--hf-font-body: 'Be Vietnam Pro'
--hf-mono: 'JetBrains Mono'
```
