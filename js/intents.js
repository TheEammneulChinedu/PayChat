// PayChat — NEAR Intents 1Click API helpers.
// Docs: https://docs.near-intents.org (there is no testnet; use small amounts).

export const ONECLICK = "https://1click.chaindefuser.com/v0";

// What the user can pay with, from their NEAR account.
export const PAY_WITH = {
  USDC: { label: "USDC (on NEAR)", assetId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", decimals: 6, native: false },
  NEAR: { label: "NEAR", assetId: "nep141:wrap.near", decimals: 24, native: true },
};

const TGAS = "30000000000000"; // 30 Tgas
const STORAGE_DEPOSIT = "1250000000000000000000"; // 0.00125 NEAR
const ONE_YOCTO = "1";

function headers(apiKey) {
  const h = { "Content-Type": "application/json" };
  // Optional partner key removes the 0.2% fee. JWTs (a.b.c) use Bearer; newer keys use X-API-Key.
  if (apiKey) {
    if (apiKey.split(".").length === 3) h["Authorization"] = `Bearer ${apiKey}`;
    else h["X-API-Key"] = apiKey;
  }
  return h;
}

async function call(fetchImpl, url, opts) {
  const res = await fetchImpl(url, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message || `NEAR Intents error ${res.status}`);
  return body;
}

export async function getTokens({ fetchImpl = fetch } = {}) {
  return call(fetchImpl, `${ONECLICK}/tokens`, {});
}

// Find the token the recipient should receive, e.g. USDC on "sol".
export function findDestinationToken(tokens, symbol, chain) {
  const s = symbol.toUpperCase();
  return tokens.find((t) => t.blockchain === chain && t.symbol?.toUpperCase() === s) || null;
}

// EXACT_OUTPUT: the recipient gets exactly the amount typed; the quote tells us what to send.
export function buildQuoteRequest({ payWith, destAssetId, amountOut, recipient, refundTo, dry }) {
  return {
    dry,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: 100,
    originAsset: payWith.assetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: destAssetId,
    amount: amountOut,
    refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
    referral: "paychat",
  };
}

export async function getQuote(req, { apiKey, fetchImpl = fetch } = {}) {
  return call(fetchImpl, `${ONECLICK}/quote`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify(req),
  });
}

export async function submitDeposit(depositAddress, txHash, { fetchImpl = fetch } = {}) {
  return call(fetchImpl, `${ONECLICK}/deposit/submit`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ depositAddress, txHash }),
  });
}

export async function getStatus(depositAddress, { fetchImpl = fetch } = {}) {
  return call(fetchImpl, `${ONECLICK}/status?depositAddress=${encodeURIComponent(depositAddress)}`, {});
}

export const FINAL_STATUSES = ["SUCCESS", "REFUNDED", "FAILED"];

// Build the NEAR transaction that sends the quoted amount to the deposit address.
// - registers the deposit address with the token contract (refunded if already registered)
// - for NEAR, wraps it into wNEAR first
// - ft_transfer of exactly amountIn
export function buildDepositTransaction({ payWith, depositAddress, amountIn, signerId }) {
  const contract = payWith.assetId.replace(/^nep141:/, "");
  const fc = (methodName, args, deposit) => ({
    type: "FunctionCall",
    params: { methodName, args, gas: TGAS, deposit },
  });
  const actions = [];
  if (payWith.native) {
    actions.push(fc("storage_deposit", { account_id: signerId, registration_only: true }, STORAGE_DEPOSIT));
    actions.push(fc("near_deposit", {}, amountIn));
  }
  actions.push(fc("storage_deposit", { account_id: depositAddress, registration_only: true }, STORAGE_DEPOSIT));
  actions.push(fc("ft_transfer", { receiver_id: depositAddress, amount: amountIn, memo: "PayChat" }, ONE_YOCTO));
  return { receiverId: contract, actions };
}

export function txHashFromOutcome(o) {
  return o?.transaction?.hash || o?.transaction_outcome?.id || null;
}

export function destinationTxLink(status) {
  const d = status?.swapDetails?.destinationChainTxHashes?.[0];
  return d ? d.explorerUrl || null : null;
}
