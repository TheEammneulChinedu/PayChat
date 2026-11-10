# PayChat

**Pay anyone, on any chain, by typing a sentence.** Built for NEAR HACKATHON 2026 (Real-world payments track).

> "Pay Tunde 2 USDC on Solana and Ada 1.5 USDC on Base"

PayChat reads the request, shows each payment for you to check, then sends them all from your NEAR wallet with **one approval**. **NEAR Intents** delivers the money to each recipient on their own network: Solana, Base, Ethereum, Arbitrum, Polygon, BNB Chain, Tron, NEAR and more. A receipt tracks every payment until it's delivered.

**Live app:** `https://<your-github-username>.github.io/paychat/`
**Demo video:** `<link to X post>`

## Why

Sending stablecoins to friends, freelancers or family on different chains means bridges, swaps and copying addresses, and one mistake loses the money. PayChat makes it a sentence plus a confirmation screen. Nothing moves until you approve it in your own wallet.

## How it works

1. **Understand.** The request goes to an AI model on **NEAR AI Cloud** (private, TEE-based inference) and comes back as structured JSON: recipient, amount, token and network. Without an AI key, a built-in rule-based reader handles common phrasings, so the app also works with no keys.
2. **Check.** Names are matched against your saved contacts, addresses are checked against each network's format, and anything unclear is shown in red. Pay stays disabled until every line is valid.
3. **Price.** For each payment PayChat asks the **NEAR Intents 1Click API** for an `EXACT_OUTPUT` quote, so the recipient gets exactly the amount you typed. You see what you'll send.
4. **Pay.** On confirm, PayChat gets a real quote with a one-time deposit address for each payment. It then builds one NEAR transaction per payment: `storage_deposit`, plus `near_deposit` when paying in NEAR, then `ft_transfer` to the deposit address. All of them go to your wallet in a single `signAndSendTransactions` request.
5. **Track.** Each transaction hash is sent to `/v0/deposit/submit` and the receipt polls `/v0/status` until the payment is `SUCCESS`, `REFUNDED` or `FAILED`. If anything fails, NEAR Intents refunds to your NEAR account.

```
sentence ─▶ NEAR AI Cloud / rule reader ─▶ validate + contacts ─▶ 1Click quotes
        ─▶ wallet approves N transactions ─▶ NEAR Intents delivers on the destination chains ─▶ receipts
```

## NEAR tech used

- **NEAR Intents (1Click API):** cross-chain delivery and quotes
- **NEAR AI Cloud:** private AI understanding of requests (OpenAI-compatible API, default model `deepseek-ai/DeepSeek-V4-Flash`)
- **NEAR Connect** (`@hot-labs/near-connect`): wallet connection for Meteor, HOT, MyNearWallet and others

## Run it yourself

It's a static site with no build step and no server.

```bash
git clone https://github.com/<your-github-username>/paychat
cd paychat
python3 -m http.server 8000      # or any static file server
# open http://localhost:8000
```

1. Click **Connect wallet** and sign in with a NEAR mainnet wallet. NEAR Intents has no testnet, so use small amounts. Each payment costs about $0.01 in NEAR for storage and gas.
2. Have some **USDC on NEAR** or **NEAR** in the wallet, and pick it under "Pay with".
3. Optional: open **Contacts** to save names. Open **Settings** to add a NEAR AI Cloud key for AI understanding, or a NEAR Intents partner key to remove the 0.2% fee. Keys and contacts stay in your browser's local storage.
4. Type a request, for example `Pay alice.near 0.5 USDC` or `Send 1 USDC to 0x… on Base`, then **Review payments**, then **Confirm & pay**.

### Tests

```bash
node tests/test.mjs
```

The tests cover the sentence reader (several phrasings, decimal commas, unknown input), contact resolution, address validation, exact base-unit conversion, deposit transaction building for both USDC and NEAR, AI response parsing and API-key headers.

## Files

| Path | What it does |
|---|---|
| `index.html` | Page and styles |
| `js/app.js` | UI, wallet, pay flow, receipts, contacts, settings |
| `js/parser.js` | AI + rule-based request reader, validation, unit conversion |
| `js/intents.js` | NEAR Intents 1Click API calls and the deposit transaction builder |
| `vendor/near-connect.js` | `@hot-labs/near-connect@0.12.0` bundled for the browser with esbuild |
| `tests/test.mjs` | Offline tests |

## Limits and next steps

- Built in under a week for the hackathon and not audited, so use small amounts.
- Pays from USDC or NEAR on NEAR. Next: pay from other chains, split-the-bill mode, local-currency (₦) display and recurring payments.

## License

MIT
