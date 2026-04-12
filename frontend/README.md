# HopFast / Frontend

The web app. Handles wallet connection, swap quotes, yield vault browsing, transaction tracking, and the agent docs page. Runs at [hopfast.xyz](https://hopfast.xyz).

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

Single-page app. All views are React state, no URL routing.

| View | What it does |
|------|-------------|
| **Landing** | Entry point. Pick Human or Agent mode. |
| **Swap** | Cross-chain swap interface. Pick tokens, compare quotes, see fees and ETA. |
| **Earn** | Yield vault browser. Filter by chain, token, or protocol. Deposit and track positions. |
| **Agent** | MCP server docs. Setup guides for Claude Desktop, Claude Code, and HTTP agents. |
| **Stats** | Protocol analytics. Swap volume, unique users, earn deposits over 7/15/30 days. |

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
│   ├── chains.ts                    Supported networks, tokens, and their config
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

Tokens are defined in `src/lib/chains.ts`. To add a new token, just add an entry there and a price mapping in `priceService.ts`.

---

## Wallet connection

Wallet auth uses [Privy](https://privy.io). Set `VITE_PRIVY_APP_ID` in your `.env` to enable it. Without it, a demo wallet kicks in so you can still dev and test without a real wallet.

No email, password, or personal data collected. Identity is wallet-address only.

---

## Static files

These live in `public/` and get served at the root of the domain.

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

Styles live in `src/index.css`. CSS custom properties for colours, spacing, shadows, fonts, and transitions. All classes are prefixed with `hf-`.

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
