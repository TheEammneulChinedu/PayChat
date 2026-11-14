# PayChat

**Pay anyone, on any chain, by typing a sentence.** Built during NEAR HACKATHON 2026 (Real-world payments track), 10–14 November 2026.

> "Pay Tunde 2 USDC on Solana and Ada 1.5 USDC on Base"

PayChat reads the request, shows each payment for you to check, then sends them all from your NEAR wallet with **one approval**. **NEAR Intents** delivers the money to each recipient on their own network: Solana, Base, Ethereum, Arbitrum, Polygon, BNB Chain, Tron, NEAR and more. A receipt tracks every payment until it's delivered.

- **Live app:** https://paychat-ruby.vercel.app/ (homepage). The app itself is at https://paychat-ruby.vercel.app/app.html
- **Demo video:** https://x.com/onchainmaverick/status/2121711924396322944
- **Tested on NEAR mainnet:** NEAR-to-NEAR payments ✅ and cross-chain payments from NEAR to another chain ✅

## Why

Sending stablecoins to friends, freelancers or family on different chains means bridges, swaps and copying addresses, and one mistake loses the money. PayChat makes it a sentence plus a confirmation screen. Nothing moves until you approve it in your own wallet.

## Try it in 2 minutes

**Without a wallet (free, nothing is sent):**
1. Open https://paychat-ruby.vercel.app/app.html
2. Type `Pay alice.near 0.5 USDC` and click **Review payments**.
3. **Expected:** one line, "alice.near · 0.5 USDC · USDC on NEAR", with a live "you send ≈ …" price from NEAR Intents and a total in USD. **Confirm & pay** stays disabled with "Connect your wallet to pay."
4. Type `Pay Ada 1 USDC on Base` and click **Review payments**.
5. **Expected:** a red error saying "Ada" isn't a saved contact, because names only resolve to contacts you saved.

**With a NEAR mainnet wallet (real payment, about $0.50 plus fees):**
1. Click **Connect wallet** and sign in with Meteor, HOT, MyNearWallet or another NEAR wallet.
2. Choose **USDC (on NEAR)** or **NEAR** under "Pay with". You need a little of it in your wallet.
3. Type `Pay <your-account>.near 0.5 USDC`, then click **Review payments**, then **Confirm & pay**, and approve in your wallet.
4. **Expected:** a receipt appears and moves through "Sending" and "Delivering" to **Delivered**, with a link to the NEAR transaction.
5. **Cross-chain:** open **Contacts**, save your own Solana or Base address, then type `Pay Me 1 USDC on Solana`. The USDC arrives in that wallet within a few minutes.

NEAR Intents has no testnet, so use small amounts. If a payment fails, NEAR Intents refunds your NEAR account automatically.

## How it works

1. **Understand.** If you add a NEAR AI Cloud key in **Settings**, the request goes to an AI model on **NEAR AI Cloud** (private, TEE-based inference). It comes back as structured JSON: recipient, amount, token and network. Without a key, a built-in rule-based reader handles common phrasings, so the app works with no keys at all.
2. **Check.** Names are matched against your saved contacts, addresses are checked against each network's format, and anything unclear is shown in red. Pay stays disabled until every line is valid.
3. **Price.** For each payment PayChat asks the **NEAR Intents 1Click API** for an `EXACT_OUTPUT` quote, so the recipient gets exactly the amount you typed. You see what you'll send.
4. **Pay.** On confirm, PayChat gets a real quote with a one-time deposit address for each payment. It builds one NEAR transaction per payment: `storage_deposit`, plus `near_deposit` when paying in NEAR, then `ft_transfer` to the deposit address. All of them go to your wallet in a single `signAndSendTransactions` request.
5. **Track.** Each transaction hash is sent to `/v0/deposit/submit`, and the receipt polls `/v0/status` until the payment is `SUCCESS`, `REFUNDED` or `FAILED`.

```
sentence ─▶ NEAR AI Cloud / rule reader ─▶ validate + contacts ─▶ 1Click quotes
        ─▶ wallet approves N transactions ─▶ NEAR Intents delivers on the destination chains ─▶ receipts
```

## NEAR tech used

- **NEAR Intents (1Click API):** cross-chain delivery and quotes
- **NEAR AI Cloud:** optional private AI understanding of requests (OpenAI-compatible API, default model `deepseek-ai/DeepSeek-V4-Flash`)
- **NEAR Connect** (`@hot-labs/near-connect`): wallet connection for Meteor, HOT, MyNearWallet and others

## Run it yourself

It's a static site with no build step and no server.

```bash
git clone https://github.com/TheEammneulChinedu/paychat
cd paychat
python3 -m http.server 8000      # or any static file server
# homepage: http://localhost:8000
# app:      http://localhost:8000/app.html
```

Optional settings live under **Settings** in the app: a NEAR AI Cloud key turns on AI understanding, and a NEAR Intents partner key removes the 0.2% fee. Keys and contacts are stored only in your browser.

### Tests

```bash
node tests/test.mjs
```

This prints `ALL OK` when everything passes. The tests cover the sentence reader (several phrasings, decimal commas, unknown input), contact resolution, address validation, exact base-unit conversion, deposit transaction building for both USDC and NEAR, AI response parsing and API-key headers.

## Files

| Path | What it does |
|---|---|
| `index.html` | Homepage |
| `app.html` | The PayChat app |
| `js/app.js` | UI, wallet, pay flow, receipts, contacts, settings |
| `js/parser.js` | AI + rule-based request reader, validation, unit conversion |
| `js/intents.js` | NEAR Intents 1Click API calls and the deposit transaction builder |
| `vendor/near-connect.js` | `@hot-labs/near-connect@0.12.0` bundled for the browser with esbuild |
| `tests/test.mjs` | Offline tests |

## Limits and next steps

- Built in under a week for the hackathon and not audited, so use small amounts.
- Pays from USDC or NEAR on NEAR. Payment names like ENS or SNS aren't supported yet; use the address or a saved contact.
- Next: pay from other chains, split-the-bill mode, local-currency (₦) display and recurring payments.

## License

MIT
