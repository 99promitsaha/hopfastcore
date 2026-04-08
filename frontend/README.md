# HopFast MVP (React + Vite + Tailwind)

HopFast MVP for fast cross-chain swap UX between **Base** and **BNB Smart Chain**, with two user modes:

- `I am a human` -> prompt or manual swap setup
- `I am an agent` -> coming soon placeholder

The app currently supports:

- Cozy, mobile-friendly pink/blue UI
- Prompt-to-form prefill flow
- Manual Uniswap-style swap form
- LI.FI quote wiring via backend routes
- Mock quote fallback when API keys are missing
- Privy wallet connect integration point
- Express + MongoDB backend scaffold with modular API routes

## Tech Stack

- React + TypeScript + Vite
- Tailwind CSS
- Framer Motion
- Privy React SDK

## Quick Start (Frontend)

```bash
npm install
cp .env.example .env
npm run dev
```

## Quick Start (Backend)

```bash
cd ../backend
npm install
cp .env.example .env
npm run dev
```

Backend default URL: `http://localhost:8080`

## Frontend Env

Copy `.env.example` and fill:

- `VITE_PRIVY_APP_ID`
  - From Privy dashboard, enables wallet login UI.
- `VITE_HOPFAST_API_BASE_URL`
  - Recommended. Example: `http://localhost:8080/api` for local development.
- `VITE_HOPFAST_QUOTE_PROXY_URL`
  - Optional override for quote endpoint.
- `VITE_HOPFAST_INTENT_PROXY_URL`
  - Optional override for intent endpoint.

If backend/LI.FI config is missing, HopFast automatically uses a mock quote engine so UI still works.

## Backend Env

In `../backend/.env`:

- `MONGODB_URI`
- `LIFI_API_KEY` (optional, for higher rate limits)
- `OPENAI_API_KEY`
- `CORS_ORIGIN`
- `PORT`

## Backend Routes

- `GET /api/health` -> service and DB health
- `POST /api/intent` -> parse natural-language swap intent (OpenAI + heuristic fallback)
- `POST /api/quotes` -> LI.FI quote proxy and quote logging
- `POST /api/swaps` -> persist swap record in MongoDB
- `GET /api/swaps` -> list recent swap records

## Current Network Scope

- Base: chainId `8453`
- BNB Smart Chain: chainId `56`

## Docs

- [API keys and deployment notes](./docs/API-KEYS.md)
