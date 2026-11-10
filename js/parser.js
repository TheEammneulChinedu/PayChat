// PayChat — turns a plain-English request into a list of payments.
// Two ways: an AI model on NEAR AI Cloud (if the user added a key),
// or a built-in rule-based parser that works with no key at all.

export const CHAINS = {
  near: { code: "near", name: "NEAR", aliases: ["near"] },
  sol: { code: "sol", name: "Solana", aliases: ["solana", "sol"] },
  eth: { code: "eth", name: "Ethereum", aliases: ["ethereum", "eth", "mainnet"] },
  base: { code: "base", name: "Base", aliases: ["base"] },
  arb: { code: "arb", name: "Arbitrum", aliases: ["arbitrum", "arb"] },
  pol: { code: "pol", name: "Polygon", aliases: ["polygon", "pol", "matic"] },
  bsc: { code: "bsc", name: "BNB Chain", aliases: ["bnb chain", "bnb", "bsc", "binance"] },
  op: { code: "op", name: "Optimism", aliases: ["optimism", "op"] },
  avax: { code: "avax", name: "Avalanche", aliases: ["avalanche", "avax"] },
  tron: { code: "tron", name: "Tron", aliases: ["tron", "trx"] },
  ton: { code: "ton", name: "TON", aliases: ["ton"] },
  btc: { code: "btc", name: "Bitcoin", aliases: ["bitcoin", "btc"] },
};

export function chainFromWord(word) {
  if (!word) return null;
  const w = word.toLowerCase().trim();
  for (const c of Object.values(CHAINS)) {
    if (c.code === w || c.aliases.includes(w)) return c.code;
  }
  return null;
}

const EVM = ["eth", "base", "arb", "pol", "bsc", "op", "avax"];

export function isValidAddress(chain, addr) {
  if (!addr || typeof addr !== "string") return false;
  const a = addr.trim();
  if (EVM.includes(chain)) return /^0x[0-9a-fA-F]{40}$/.test(a);
  if (chain === "sol") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
  if (chain === "near")
    return /^[0-9a-f]{64}$/.test(a) || /^(([a-z\d]+[-_])*[a-z\d]+\.)+[a-z\d]+$/.test(a);
  if (chain === "tron") return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a);
  if (chain === "btc") return /^(bc1[0-9a-z]{25,62}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(a);
  if (chain === "ton") return /^[A-Za-z0-9_-]{48}$/.test(a) || /^-?\d:[0-9a-fA-F]{64}$/.test(a);
  return a.length > 0;
}

// Guess a chain from what an address looks like (used when the user omits "on <chain>").
export function guessChainFromAddress(addr) {
  if (!addr) return null;
  if (/^[a-z\d_-]+(\.[a-z\d_-]+)*\.(near|tg)$/.test(addr)) return "near";
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr)) return "tron";
  if (/^bc1/.test(addr)) return "btc";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) return "sol";
  return null; // 0x addresses could be any EVM chain, so we don't guess
}

// ---------- Rule-based parser ----------

const CHAIN_WORDS = Object.values(CHAINS)
  .flatMap((c) => c.aliases)
  .sort((a, b) => b.length - a.length)
  .map((w) => w.replace(/ /g, "\\s+"))
  .join("|");

const AMT = "(\\d+(?:[.,]\\d+)?)";
const TOKEN = "([A-Za-z][A-Za-z0-9.]{1,9})";
const WHO = "([^\\s,]+(?:\\s+[A-Z][a-z]+)?)";
const ON = `(?:\\s+(?:on|via|over|using)\\s+(${CHAIN_WORDS}))?`;

// "pay Tunde 20 USDC on Solana"  /  "Tunde 20 usdc solana"
const P1 = new RegExp(`^(?:pay|send|give)?\\s*${WHO}\\s+\\$?${AMT}\\s*${TOKEN}${ON}\\s*$`, "i");
// "send 20 USDC to Tunde on Solana"
const P2 = new RegExp(`^(?:pay|send|give|transfer)?\\s*\\$?${AMT}\\s*${TOKEN}\\s+to\\s+${WHO}${ON}\\s*$`, "i");

function splitParts(text) {
  return text
    .replace(/\s+/g, " ")
    .split(/\s*(?:,(?!\d)|;|\n|\band then\b|\band\b|\balso\b|&)\s*/i)
    .map((s) => s.trim().replace(/[.!]+$/, ""))
    .filter(Boolean);
}

export function ruleParse(text) {
  const payments = [];
  const problems = [];
  // A leading verb applies to the whole sentence ("Pay A 5 USDC and B 3 USDT")
  for (const raw of splitParts(text)) {
    const part = raw.replace(/^(please|kindly)\s+/i, "");
    let m = part.match(P1);
    let to, amount, token, chainWord;
    if (m) [, to, amount, token, chainWord] = m;
    else if ((m = part.match(P2))) [, amount, token, to, chainWord] = m;
    if (!m) {
      problems.push(`I couldn't understand "${raw}". Try: "Pay Tunde 5 USDC on Solana".`);
      continue;
    }
    payments.push({
      to: to.trim(),
      amount: amount.replace(",", "."),
      token: token.toUpperCase(),
      chain: chainWord ? chainFromWord(chainWord.replace(/\s+/g, " ")) : null,
    });
  }
  return { payments, problems, source: "rules" };
}

// ---------- AI parser (NEAR AI Cloud, OpenAI-compatible) ----------

export const AI_SYSTEM_PROMPT = `You convert a payment request into JSON. Output ONLY JSON, no prose.
Schema: {"payments":[{"to":string,"amount":string,"token":string,"chain":string|null}],"problems":[string]}
- "to": the recipient name or address exactly as written.
- "amount": a plain decimal number as a string, no currency symbols.
- "token": uppercase symbol, e.g. USDC, USDT, NEAR, ETH, SOL. Treat "$" or "dollars" as USDC.
- "chain": one of ${Object.keys(CHAINS).join(", ")} or null if not stated.
- Put anything unclear or not a payment into "problems" and do not invent values.`;

export async function aiParse(text, { apiKey, model, fetchImpl = fetch, baseUrl = "https://cloud-api.near.ai/v1" }) {
  const res = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: AI_SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
    }),
  });
  if (!res.ok) throw new Error(`NEAR AI Cloud returned ${res.status}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  const json = content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1);
  const parsed = JSON.parse(json);
  return {
    payments: (parsed.payments || []).map((p) => ({
      to: String(p.to ?? "").trim(),
      amount: String(p.amount ?? "").trim(),
      token: String(p.token ?? "").toUpperCase().trim(),
      chain: chainFromWord(p.chain) ?? null,
    })),
    problems: parsed.problems || [],
    source: "ai",
  };
}

// ---------- Resolve contacts + validate ----------

// contacts: [{name, chain, address}]
export function resolveAndValidate(parsed, contacts = []) {
  const out = [];
  for (const p of parsed.payments) {
    const item = { ...p, errors: [] };
    const contact = contacts.find(
      (c) => c.name.toLowerCase() === p.to.toLowerCase() && (!p.chain || c.chain === p.chain)
    );
    if (contact) {
      item.name = contact.name;
      item.address = contact.address;
      item.chain = item.chain || contact.chain;
    } else {
      item.address = p.to;
      item.chain = item.chain || guessChainFromAddress(p.to);
    }
    const amt = Number(item.amount);
    if (!/^\d+(\.\d+)?$/.test(item.amount) || !(amt > 0)) item.errors.push("Amount must be a number above 0.");
    if (!item.chain) item.errors.push(`Which network? Add "on Solana", "on Base", etc.`);
    else if (!isValidAddress(item.chain, item.address))
      item.errors.push(
        contact || /^[A-Z]?[a-z]+$/.test(p.to)
          ? `"${p.to}" isn't a saved contact on ${CHAINS[item.chain]?.name ?? item.chain}. Add them in Contacts or use their address.`
          : `That doesn't look like a valid ${CHAINS[item.chain]?.name ?? item.chain} address.`
      );
    out.push(item);
  }
  return out;
}

// Convert "12.5" with 6 decimals -> "12500000" without floating-point errors.
export function toBaseUnits(amount, decimals) {
  const [whole, frac = ""] = String(amount).split(".");
  if (frac.length > decimals) throw new Error(`Too many decimal places (max ${decimals}).`);
  const s = (whole.replace(/^0+/, "") || "0") + frac.padEnd(decimals, "0");
  return BigInt(s).toString();
}
