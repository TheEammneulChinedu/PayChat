import { NearConnector } from "../vendor/near-connect.js";
import { CHAINS, ruleParse, aiParse, resolveAndValidate, toBaseUnits, isValidAddress } from "./parser.js";
import {
  PAY_WITH, getTokens, findDestinationToken, buildQuoteRequest, getQuote,
  buildDepositTransaction, submitDeposit, getStatus, FINAL_STATUSES, txHashFromOutcome, destinationTxLink,
} from "./intents.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const short = (a) => (a && a.length > 18 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

// ---------- storage (per browser, best effort) ----------
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem("paychat:" + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("paychat:" + k, JSON.stringify(v)); } catch {} },
};

const state = {
  accountId: null,
  wallet: null,
  tokens: null,
  review: [],
  contacts: store.get("contacts", []),
  receipts: store.get("receipts", []),
  settings: { aiKey: "", aiModel: "deepseek-ai/DeepSeek-V4-Flash", intentsKey: "", ...store.get("settings", {}) },
};

// ---------- wallet ----------
const connector = new NearConnector({ network: "mainnet" });

function setAccount(id) {
  state.accountId = id;
  $("connectBtn").textContent = id ? short(id) + " · Disconnect" : "Connect wallet";
  $("connectBtn").classList.toggle("primary", !id);
  renderReview();
}

connector.on("wallet:signIn", async (t) => {
  state.wallet = await connector.wallet();
  setAccount(t.accounts?.[0]?.accountId ?? null);
});
connector.on("wallet:signOut", () => { state.wallet = null; setAccount(null); });

(async () => {
  try {
    const w = await connector.wallet();
    const accs = await w.getAccounts();
    if (accs?.length) { state.wallet = w; setAccount(accs[0].accountId); }
  } catch { /* not signed in yet */ }
})();

$("connectBtn").onclick = async () => {
  if (state.accountId) { await connector.disconnect(); return; }
  try { await connector.connect(); } catch (e) { alertBox(e.message || "Could not connect wallet."); }
};

// ---------- tokens ----------
async function tokens() {
  if (!state.tokens) state.tokens = await getTokens();
  return state.tokens;
}

// ---------- understand ----------
const EXAMPLES = [
  "Pay Tunde 2 USDC on Solana",
  "Send 1 USDC to Ada on Base and 1 USDT to Musa on Tron",
  "Pay alice.near 0.5 USDC",
];

async function understand() {
  const text = $("request").value.trim();
  if (!text) return;
  const btn = $("understandBtn");
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Reading…';
  $("reviewSection").classList.remove("hidden");
  $("reviewList").innerHTML = '<p class="note">Working out your payments…</p>';
  $("reviewTotal").innerHTML = "";
  let parsed, note;
  try {
    if (state.settings.aiKey) {
      try {
        parsed = await aiParse(text, { apiKey: state.settings.aiKey, model: state.settings.aiModel });
        note = `Understood by AI (${esc(state.settings.aiModel)} on NEAR AI Cloud, private inference).`;
      } catch (e) {
        parsed = ruleParse(text);
        note = `AI was unavailable (${esc(e.message)}), so the built-in reader was used.`;
      }
    } else {
      parsed = ruleParse(text);
      note = "Understood by the built-in reader. Add a NEAR AI Cloud key in Settings for smarter AI understanding.";
    }
    const items = resolveAndValidate(parsed, state.contacts);
    const payWith = PAY_WITH[$("payWith").value];
    const list = await tokens();
    await Promise.all(items.map((it) => previewQuote(it, list, payWith)));
    state.review = items;
    state.problems = parsed.problems || [];
    $("parsedBy").innerHTML = note;
  } catch (e) {
    state.review = [];
    state.problems = [e.message || "Something went wrong."];
  } finally {
    btn.disabled = false; btn.textContent = "Review payments";
    renderReview();
  }
}

async function previewQuote(it, list, payWith) {
  if (it.errors.length) return;
  const dest = findDestinationToken(list, it.token, it.chain);
  if (!dest) { it.errors.push(`${it.token} on ${CHAINS[it.chain]?.name} isn't supported by NEAR Intents.`); return; }
  it.dest = dest;
  try {
    it.amountOut = toBaseUnits(it.amount, dest.decimals);
    const q = await getQuote(
      buildQuoteRequest({ payWith, destAssetId: dest.assetId, amountOut: it.amountOut, recipient: it.address,
        refundTo: state.accountId || "intents.near", dry: true }),
      { apiKey: state.settings.intentsKey }
    );
    it.preview = q.quote;
  } catch (e) {
    it.errors.push(`Couldn't get a price: ${e.message}`);
  }
}

function renderReview() {
  const items = state.review || [];
  const payWith = PAY_WITH[$("payWith").value];
  const rows = items.map((it) => `
    <div class="pay">
      <div>
        <div class="who">${esc(it.name || short(it.address))}</div>
        <div class="meta">${esc(it.token)} on ${esc(CHAINS[it.chain]?.name ?? "unknown network")}${it.name ? " · " + esc(short(it.address)) : ""}</div>
      </div>
      <div class="amt">${esc(it.amount)} ${esc(it.token)}${it.preview ? `<div class="meta">you send ≈ ${esc(trim(it.preview.amountInFormatted))} ${esc(payWith.label.split(" ")[0])}</div>` : ""}</div>
      ${it.errors.map((e) => `<div class="msg err">${esc(e)}</div>`).join("")}
    </div>`).join("");
  const probs = (state.problems || []).map((p) => `<div class="msg warn">${esc(p)}</div>`).join("");
  $("reviewList").innerHTML = rows + probs || '<p class="note">No payments found.</p>';
  const ok = items.filter((i) => !i.errors.length && i.preview);
  const usd = ok.reduce((s, i) => s + Number(i.preview.amountInUsd || 0), 0);
  const tokenSum = ok.reduce((s, i) => s + Number(i.preview.amountInFormatted || 0), 0);
  $("reviewTotal").innerHTML = ok.length
    ? `<span>Total (${ok.length} payment${ok.length > 1 ? "s" : ""})</span><span>≈ ${trim(String(tokenSum))} ${esc(payWith.label.split(" ")[0])} · $${usd.toFixed(2)}</span>`
    : "";
  const blocked = items.length && ok.length !== items.length;
  $("payBtn").disabled = !ok.length || blocked || !state.accountId;
  $("payNote").textContent = !state.accountId ? "Connect your wallet to pay."
    : blocked ? "Fix the items in red first." : ok.length ? "Your wallet will ask you to approve." : "";
}

const trim = (s) => { const n = Number(s); return Number.isFinite(n) ? String(+n.toFixed(6)) : s; };

// ---------- pay ----------
async function payAll() {
  const items = state.review.filter((i) => !i.errors.length && i.preview);
  if (!items.length || !state.wallet) return;
  const payWith = PAY_WITH[$("payWith").value];
  const btn = $("payBtn");
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Getting final prices…';
  try {
    // 1. Real quotes: each gives a one-time deposit address.
    const quotes = await Promise.all(items.map((it) => getQuote(
      buildQuoteRequest({ payWith, destAssetId: it.dest.assetId, amountOut: it.amountOut, recipient: it.address,
        refundTo: state.accountId, dry: false }),
      { apiKey: state.settings.intentsKey }
    )));
    // 2. One NEAR transaction per payment, approved together.
    const transactions = quotes.map((q) => buildDepositTransaction({
      payWith, depositAddress: q.quote.depositAddress, amountIn: q.quote.amountIn, signerId: state.accountId,
    }));
    const newReceipts = items.map((it, i) => ({
      id: quotes[i].quote.depositAddress,
      depositAddress: quotes[i].quote.depositAddress,
      who: it.name || it.address, address: it.address, chain: it.chain, token: it.token, amount: it.amount,
      sent: `${trim(quotes[i].quote.amountInFormatted)} ${payWith.label.split(" ")[0]}`,
      status: "AWAITING_APPROVAL", createdAt: Date.now(),
    }));
    addReceipts(newReceipts);
    btn.innerHTML = '<span class="spinner"></span> Approve in your wallet…';
    let outcomes;
    try {
      outcomes = await state.wallet.signAndSendTransactions({ signerId: state.accountId, transactions });
    } catch (e) {
      if (/not supported|not implemented/i.test(e?.message || "") && transactions.length) {
        outcomes = [];
        for (const tx of transactions) outcomes.push(await state.wallet.signAndSendTransaction({ signerId: state.accountId, ...tx }));
      } else throw e;
    }
    // 3. Tell NEAR Intents about each deposit, then track it.
    newReceipts.forEach((r, i) => {
      r.txHash = txHashFromOutcome(outcomes?.[i]);
      r.status = "PENDING_DEPOSIT";
      if (r.txHash) submitDeposit(r.depositAddress, r.txHash).catch(() => {});
      track(r);
    });
    saveReceipts();
    state.review = []; $("reviewSection").classList.add("hidden"); $("request").value = "";
  } catch (e) {
    markCancelled();
    alertBox(e?.message?.includes("reject") || e?.message?.includes("cancel")
      ? "Payment cancelled in your wallet. Nothing was sent." : `Payment failed: ${e?.message || e}`);
  } finally {
    btn.innerHTML = "Confirm &amp; pay"; renderReview();
  }
}

function markCancelled() {
  state.receipts.forEach((r) => { if (r.status === "AWAITING_APPROVAL") r.status = "CANCELLED"; });
  saveReceipts();
}

// ---------- receipts ----------
function addReceipts(rs) { state.receipts = [...rs, ...state.receipts].slice(0, 50); saveReceipts(); }
function saveReceipts() { store.set("receipts", state.receipts); renderReceipts(); }

const LABEL = {
  AWAITING_APPROVAL: "Waiting for wallet", PENDING_DEPOSIT: "Sending", KNOWN_DEPOSIT_TX: "Received by NEAR Intents",
  PROCESSING: "Delivering", SUCCESS: "Delivered", INCOMPLETE_DEPOSIT: "Amount too low", REFUNDED: "Refunded",
  FAILED: "Failed", CANCELLED: "Cancelled",
};

function renderReceipts() {
  const rs = state.receipts;
  $("receiptsSection").classList.toggle("hidden", !rs.length);
  $("receiptList").innerHTML = rs.map((r) => `
    <div class="pay">
      <div>
        <div class="who">${esc(short(r.who))} · ${esc(r.amount)} ${esc(r.token)} on ${esc(CHAINS[r.chain]?.name ?? r.chain)}</div>
        <div class="meta">You sent ${esc(r.sent)} · ${new Date(r.createdAt).toLocaleString()}
          ${r.txHash ? ` · <a href="https://nearblocks.io/txns/${esc(r.txHash)}" target="_blank" rel="noopener">NEAR tx</a>` : ""}
          ${r.destLink ? ` · <a href="${esc(r.destLink)}" target="_blank" rel="noopener">Delivery tx</a>` : ""}        </div>
      </div>
      <div><span class="badge ${esc(r.status)}">${!FINAL_STATUSES.includes(r.status) && r.status !== "CANCELLED" && r.status !== "AWAITING_APPROVAL" ? '<span class="spinner"></span> ' : ""}${esc(LABEL[r.status] || r.status)}</span></div>
    </div>`).join("");
}

const tracking = new Set();
async function track(r) {
  if (tracking.has(r.id)) return;
  tracking.add(r.id);
  const started = Date.now();
  while (!FINAL_STATUSES.includes(r.status) && Date.now() - started < 30 * 60_000) {
    await new Promise((res) => setTimeout(res, 5000));
    try {
      const s = await getStatus(r.depositAddress);
      if (s?.status) r.status = s.status;
      r.destLink = destinationTxLink(s) || r.destLink;
      saveReceipts();
    } catch { /* keep trying */ }
  }
  tracking.delete(r.id);
}

$("clearReceipts").onclick = () => { state.receipts = state.receipts.filter((r) => !FINAL_STATUSES.includes(r.status) && r.status !== "CANCELLED" && r.status !== "AWAITING_APPROVAL"); saveReceipts(); };

// ---------- contacts ----------
function renderContacts() {
  $("contactList").innerHTML = state.contacts.length
    ? state.contacts.map((c, i) => `<div class="contact"><span><strong>${esc(c.name)}</strong> · ${esc(CHAINS[c.chain]?.name)}<br><code>${esc(c.address)}</code></span><button class="link" data-del="${i}">Remove</button></div>`).join("")
    : '<p class="note">No contacts yet.</p>';
}
$("contactList").onclick = (e) => {
  const i = e.target.dataset?.del; if (i === undefined) return;
  state.contacts.splice(Number(i), 1); store.set("contacts", state.contacts); renderContacts();
};
$("contactForm").onsubmit = (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const c = { name: f.get("name").trim(), chain: f.get("chain"), address: f.get("address").trim() };
  if (!isValidAddress(c.chain, c.address)) {
    $("contactErr").textContent = `That doesn't look like a valid ${CHAINS[c.chain].name} address.`;
    $("contactErr").classList.remove("hidden"); return;
  }
  $("contactErr").classList.add("hidden");
  state.contacts = state.contacts.filter((x) => !(x.name.toLowerCase() === c.name.toLowerCase() && x.chain === c.chain));
  state.contacts.push(c); store.set("contacts", state.contacts); e.target.reset(); renderContacts();
};

// ---------- settings ----------
$("saveSettings").onclick = () => {
  state.settings.aiKey = $("aiKey").value.trim();
  state.settings.aiModel = $("aiModel").value.trim() || "deepseek-ai/DeepSeek-V4-Flash";
  state.settings.intentsKey = $("intentsKey").value.trim();
  store.set("settings", state.settings);
  $("settingsDlg").close();
};

// ---------- misc UI ----------
function alertBox(text) {
  $("reviewSection").classList.remove("hidden");
  state.problems = [text]; renderReview();
}

for (const [k, v] of Object.entries(PAY_WITH)) $("payWith").add(new Option(v.label, k));
$("payWith").value = store.get("payWith", "USDC");
$("payWith").onchange = () => { store.set("payWith", $("payWith").value); if (state.review.length) understand(); };
for (const c of Object.values(CHAINS)) $("contactChain").add(new Option(c.name, c.code));
$("examples").innerHTML = EXAMPLES.map((x) => `<button class="chip">${esc(x)}</button>`).join("");
$("examples").onclick = (e) => { if (e.target.classList.contains("chip")) { $("request").value = e.target.textContent; } };
$("understandBtn").onclick = understand;
$("request").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) understand(); });
$("payBtn").onclick = payAll;
$("contactsBtn").onclick = () => { renderContacts(); $("contactsDlg").showModal(); };
$("settingsBtn").onclick = () => {
  $("aiKey").value = state.settings.aiKey; $("aiModel").value = state.settings.aiModel; $("intentsKey").value = state.settings.intentsKey;
  $("settingsDlg").showModal();
};
document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => b.closest("dialog").close()));

renderReceipts();
// Resume tracking anything still in flight (e.g. after a page reload).
state.receipts.filter((r) => r.txHash && !FINAL_STATUSES.includes(r.status)).forEach(track);
