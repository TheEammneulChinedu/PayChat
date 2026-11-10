import assert from "node:assert";
import * as P from "../js/parser.js";
import * as I from "../js/intents.js";
const show = (t) => console.log(JSON.stringify(P.ruleParse(t)));
for (const t of [
 "Pay Tunde 2 USDC on Solana and Ada 1.5 USDC on Base",
 "Send 1 USDC to Ada on Base and 1 USDT to Musa on Tron",
 "Pay alice.near 0.5 USDC",
 "pay 0x2527D02599Ba641c19FEa793cD0F167589a0f10D 3 usdc on arbitrum, Ada Obi 2,5 usdt on bnb chain",
 "please send $5 usdc to Tunde on solana.",
 "buy me a pizza",
]) show(t);
const contacts=[{name:"Tunde",chain:"sol",address:"13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK"}];
const r = P.resolveAndValidate(P.ruleParse("Pay Tunde 2 USDC and Ada 1 USDC on Base and alice.near 0.5 USDC"), contacts);
console.log(JSON.stringify(r,null,1));
assert.equal(r[0].chain,"sol"); assert.equal(r[0].errors.length,0);
assert.ok(r[1].errors.length); assert.equal(r[2].chain,"near"); assert.equal(r[2].errors.length,0);
assert.equal(P.toBaseUnits("12.5",6),"12500000"); assert.equal(P.toBaseUnits("0.1",24),"100000000000000000000000");
assert.throws(()=>P.toBaseUnits("1.1234567",6));
const tx = I.buildDepositTransaction({payWith:I.PAY_WITH.NEAR, depositAddress:"ab".repeat(32), amountIn:"5", signerId:"me.near"});
console.log(JSON.stringify(tx));
assert.equal(tx.receiverId,"wrap.near"); assert.equal(tx.actions.length,4);
const tx2 = I.buildDepositTransaction({payWith:I.PAY_WITH.USDC, depositAddress:"x", amountIn:"5", signerId:"me.near"});
assert.equal(tx2.actions.length,2); assert.equal(tx2.actions[1].params.deposit,"1");
// AI parse with mock fetch
const mock = async (url, opts) => ({ ok:true, json: async()=>({choices:[{message:{content:'```json\n{"payments":[{"to":"Tunde","amount":"2","token":"usdc","chain":"Solana"}],"problems":[]}\n```'}}]}) });
const a = await P.aiParse("x",{apiKey:"k",model:"m",fetchImpl:mock}); console.log(JSON.stringify(a)); assert.equal(a.payments[0].chain,"sol");
// quote request + headers
let seen; const qm = async (u,o)=>{seen=o; return {ok:true,json:async()=>({quote:{amountIn:"1"}})}};
await I.getQuote(I.buildQuoteRequest({payWith:I.PAY_WITH.USDC,destAssetId:"d",amountOut:"1",recipient:"r",refundTo:"me.near",dry:true}),{apiKey:"abc",fetchImpl:qm});
assert.equal(seen.headers["X-API-Key"],"abc");
console.log("ALL OK");
