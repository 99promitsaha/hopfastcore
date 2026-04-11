<div align="center">

# HopFast

**Swap tokens across chains. Earn yield in DeFi vaults. Works for humans and AI agents.**

[![Live](https://img.shields.io/badge/live-hopfast.xyz-F5A7CA?style=flat-square)](https://hopfast.xyz)
[![MCP Server](https://img.shields.io/badge/MCP-mcp.hopfast.xyz-96D2F4?style=flat-square)](https://mcp.hopfast.xyz/health)
[![API](https://img.shields.io/badge/API-api.hopfast.xyz-B4EADB?style=flat-square)](https://api.hopfast.xyz/api/health)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

</div>

---

HopFast lets you swap tokens across five blockchains and deposit into DeFi yield vaults, all from one place. No account, no sign-up. Connect a wallet and start using it.

It also ships with a full MCP server so AI agents like Claude, Codex, or Gemini can do the same things programmatically. One URL, and the agent figures the rest out on its own.

---

## What you can do

### Swapping

Pick a token on one chain, pick where you want it to land, and HopFast finds you the best route. It pulls quotes from three different routing providers (LI.FI, Squid Router, and deBridge) and gives you the one with the best output and lowest fee. You sign one transaction and the rest is handled automatically.

Cross-chain swaps can take anywhere from 30 seconds to a few minutes depending on the chains involved. HopFast polls the bridge status and shows you when funds arrive.

### Earning

Browse yield vaults from protocols like Aave, Morpho, and Yo Protocol across all supported chains. Each vault shows the current APY, total value locked, and which token it accepts. Once you pick one, HopFast generates the deposit transaction and you sign it. Your position gets saved and tracked so you can always see what you have in where.

### Preferences

Set your risk appetite (aggressive or conservative) and experience level once. HopFast uses that to sort and filter vault recommendations the next time you look for yield.

### Transaction history

Every swap and vault deposit you make through HopFast is saved to your wallet's history. You can see the status of each one, which chains were involved, and link out to the block explorer.

---

## Supported chains

| Chain | Chain ID |
|-------|----------|
| Ethereum | 1 |
| Base | 8453 |
| BNB Chain | 56 |
| Polygon | 137 |
| Monad | 143 |

---

## For AI agents

HopFast has a live MCP server that lets any AI agent interact with the app the same way a human would. The agent can get swap quotes, browse yield vaults, check transaction status, and read a wallet's history. All through one endpoint, no API key required.

**MCP endpoint:** `https://mcp.hopfast.xyz/mcp`

### Connecting your agent

**Claude Desktop**

Open `~/Library/Application Support/Claude/claude_desktop_config.json` on Mac (or `%APPDATA%\Claude\claude_desktop_config.json` on Windows) and add this:

```json
{
  "mcpServers": {
    "hopfast": {
      "type": "http",
      "url": "https://mcp.hopfast.xyz/mcp"
    }
  }
}
```

Restart Claude Desktop and you will see the HopFast tools available in the chat.

**Claude Code**

```bash
claude mcp add --transport http hopfast https://mcp.hopfast.xyz/mcp
```

That registers HopFast globally across all your Claude Code sessions. Run `claude mcp list` to confirm it connected.

**Any other HTTP agent**

Every request needs these two headers or you will get a 406:

```
Content-Type: application/json
Accept: application/json, text/event-stream
```

To list all available tools:

```bash
curl -X POST https://mcp.hopfast.xyz/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

### Tools

| Tool | What it does |
|------|-------------|
| `check_health` | Check the backend and database are online |
| `register_wallet` | Register a wallet at the start of a session |
| `get_swap_quote` | Get a cross-chain quote from LI.FI, Squid, or deBridge |
| `get_transaction_status` | Poll a bridge or swap until it completes or fails |
| `get_transaction_history` | Fetch a wallet's past swaps |
| `record_transaction` | Save a swap after the user signs it |
| `get_earn_vaults` | Browse yield vaults by chain, token, or protocol |
| `get_earn_quote` | Get a vault deposit transaction payload |
| `get_earn_positions` | See all vaults a wallet has deposited into |
| `record_earn_deposit` | Save a vault deposit after it confirms on-chain |
| `get_user_preferences` | Read a user's saved risk and experience preferences |
| `save_user_preferences` | Store preferences for personalised vault recommendations |
| `get_protocol_stats` | Get swap volume, unique users, and earn stats |

### Workflow prompts

These are pre-written instructions you can inject into an agent's conversation to handle complete DeFi workflows. Instead of figuring out which tools to call and in what order, you invoke a prompt and the agent already knows the full sequence.

| Prompt | What it covers |
|--------|---------------|
| `cross_chain_swap` | Quote, user confirmation, signing, and status tracking |
| `find_yield` | Preference setup, vault search, deposit quote, and position recording |
| `portfolio_review` | Swap history and active earn positions for a wallet |
| `check_swap_status` | Monitors a bridge until it resolves, with updates along the way |

### Resources

| URI | What is it |
|-----|------------|
| `hopfast://guide` | Full agent workflow guide written in Markdown, read this first |
| `hopfast://chains` | All five supported chains with token contract addresses and decimals |

### How wallet signing works

An agent cannot sign a blockchain transaction. Only the user's private key can do that. Here is how the flow works in practice:

1. Agent calls `get_swap_quote` and gets back a `transactionRequest` payload
2. Agent shows the user what they are about to do: destination amount, fees, estimated time
3. User signs the transaction in their wallet (Privy or MetaMask). The agent never sees the private key
4. Wallet returns a `txHash`. Agent calls `record_transaction` and starts polling `get_transaction_status` until the bridge finishes

Agents plan and track. Users sign and approve. Nothing moves without an explicit wallet confirmation.

---

## Tech stack

**Frontend** React 18, Vite, TypeScript, Tailwind CSS, Framer Motion, Privy

**Backend** Express, MongoDB, Mongoose, TypeScript, Zod

**MCP server** @modelcontextprotocol/sdk, TypeScript, Node 18+

**Routing providers** LI.FI, Squid Router, deBridge

---

## Project structure

```
hopfast.xyz/
├── frontend/          Web app (hopfast.xyz)
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── services/
│   │   └── lib/
│   └── public/
│       ├── llms.txt       Agent-readable capability manifest
│       ├── sitemap.xml
│       └── robots.txt
│
├── backend/           REST API (api.hopfast.xyz)
│   └── src/
│       ├── routes/
│       ├── models/
│       └── lib/
│
└── mcp/               MCP server (mcp.hopfast.xyz)
    └── src/
        ├── tools/
        ├── resources/
        └── prompts/
```

---

## Running locally

You need Node 18+ and a MongoDB instance (local or Atlas).

**Backend**

```bash
cd backend
npm install
cp .env.example .env
npm run dev
# runs on http://localhost:8080
```

**Frontend**

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
# runs on http://localhost:5173
```

**MCP server**

```bash
cd mcp
npm install
npm run build

# stdio mode, for Claude Desktop or Claude Code
npm start

# HTTP mode, for remote agents
npm run start:http
# runs on http://localhost:3100/mcp
```

---

## Environment variables

**Backend**

```env
PORT=8080
MONGODB_URI=mongodb://localhost:27017/hopfast

LIFI_API_KEY=
LIFI_INTEGRATOR=
SQUID_INTEGRATOR_ID=
DEBRIDGE_ACCESS_TOKEN=
```

**Frontend**

```env
VITE_PRIVY_APP_ID=    # optional, enables Privy wallet auth
```

**MCP server**

```env
HOPFAST_API_URL=http://localhost:8080
PORT=3100
```

---

## API

Base URL: `https://api.hopfast.xyz/api`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Service and database status |
| `POST` | `/wallets` | Register or update a wallet |
| `POST` | `/quotes` | Get a swap quote |
| `GET` | `/transactions` | Get a wallet's transaction history |
| `POST` | `/transactions` | Record a transaction |
| `GET` | `/status` | Poll a transaction's bridge status |
| `GET` | `/earn/vaults` | List yield vaults |
| `POST` | `/earn/quote` | Get a vault deposit quote |
| `GET` | `/earn/positions/:address` | Get a wallet's earn positions |
| `POST` | `/earn/positions` | Record a vault deposit |
| `GET` | `/earn/preferences/:address` | Get yield preferences |
| `POST` | `/earn/preferences` | Save yield preferences |
| `GET` | `/stats` | Protocol analytics |

---

## Privacy

No email, phone number, or personal data is collected. The only thing stored is your wallet address (which is already public on the blockchain), your swap records, and your earn positions. You can remove your earn positions at any time. Blockchain transactions themselves are permanent and visible to anyone.

---

<div align="center">

[hopfast.xyz](https://hopfast.xyz) · [mcp.hopfast.xyz](https://mcp.hopfast.xyz/health) · [llms.txt](https://hopfast.xyz/llms.txt)

</div>
