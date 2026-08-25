import assert from "node:assert/strict";
import test from "node:test";
import {
  assessBotPressure,
  buildFighterPlan,
  defaultFighterPolicy,
  FIGHTER_SAFETY_ENVELOPE,
  type FighterHolding,
  type FighterPolicy,
} from "./compas-market-fighter";
import type { OpenSeaActivityEvent } from "./opensea-events-activity";

const NOW = new Date("2026-08-25T12:00:00.000Z");
const nowSeconds = Math.floor(NOW.getTime() / 1000);

function listEvent(minutesAgo: number, priceEth?: number, tokenId?: string): OpenSeaActivityEvent {
  return { action: "list", timestamp: nowSeconds - minutesAgo * 60, ...(priceEth !== undefined ? { priceEth } : {}), ...(tokenId !== undefined ? { tokenId } : {}) };
}

function saleEvent(minutesAgo: number, priceEth = 0.1): OpenSeaActivityEvent {
  return { action: "sale", timestamp: nowSeconds - minutesAgo * 60, priceEth };
}

function policyWith(overrides: Partial<FighterPolicy> = {}): FighterPolicy {
  return { ...defaultFighterPolicy(), ...overrides };
}

function calmPressure(floorEth = 0.1) {
  return assessBotPressure([listEvent(600, floorEth)], floorEth, NOW);
}

// ---------- assessBotPressure heuristics ----------

test("pressure is calm with sparse listings and no floor drop", () => {
  const pressure = assessBotPressure([listEvent(300, 0.1), listEvent(700, 0.11), saleEvent(60)], 0.1, NOW);
  assert.equal(pressure.pressureLevel, "calm");
  assert.equal(pressure.listingsLast1h, 0);
  assert.equal(pressure.listingsLast24h, 2);
  assert.equal(pressure.salesLast24h, 1);
});

test("10 listings in the last hour is a bot-storm; 9 is not", () => {
  const nine = Array.from({ length: 9 }, (_, i) => listEvent(i + 1, 0.1, String(i)));
  assert.notEqual(assessBotPressure(nine, 0.1, NOW).pressureLevel, "bot-storm");
  const ten = Array.from({ length: 10 }, (_, i) => listEvent(i + 1, 0.1, String(i)));
  const pressure = assessBotPressure(ten, 0.1, NOW);
  assert.equal(pressure.pressureLevel, "bot-storm");
  assert.equal(pressure.listingsLast1h, 10);
  assert.ok(pressure.reasons.length > 0);
});

test("floor drop >= 500 bps with low sales is a bot-storm", () => {
  // Older-half floor 0.2, newer floor 0.18 → 10% drop, 1 sale in 24h.
  const events = [listEvent(20 * 60, 0.2, "1"), listEvent(30, 0.18, "2"), saleEvent(120)];
  const pressure = assessBotPressure(events, 0.18, NOW);
  assert.ok(pressure.floorDropBps24h >= 500);
  assert.equal(pressure.pressureLevel, "bot-storm");
});

test("floor drop with healthy sales is active, not a storm", () => {
  const sales = Array.from({ length: 5 }, (_, i) => saleEvent((i + 1) * 60));
  const events = [listEvent(20 * 60, 0.2, "1"), listEvent(30, 0.18, "2"), ...sales];
  const pressure = assessBotPressure(events, 0.18, NOW);
  assert.ok(pressure.floorDropBps24h >= 500);
  assert.equal(pressure.pressureLevel, "active");
});

test("moderate listing burst (4 in 1h) is active", () => {
  const events = Array.from({ length: 4 }, (_, i) => listEvent(i + 1, 0.1, String(i)));
  assert.equal(assessBotPressure(events, 0.1, NOW).pressureLevel, "active");
});

test("unique listers estimate uses distinct tokenIds and floor is passed through", () => {
  const events = [listEvent(10, 0.1, "1"), listEvent(20, 0.1, "1"), listEvent(30, 0.1, "2")];
  const pressure = assessBotPressure(events, 0.1, NOW);
  assert.equal(pressure.uniqueListers24hEstimate, 2);
  assert.equal(pressure.floorEth, 0.1);
});

test("no floor and no priced listings yields floorEth null and zero drop, never fabricated", () => {
  const pressure = assessBotPressure([listEvent(10)], null, NOW);
  assert.equal(pressure.floorEth, null);
  assert.equal(pressure.floorDropBps24h, 0);
});

// ---------- buildFighterPlan pricing ----------

test("undercut price wins when above min margin", () => {
  // floor 0.2, undercut 100 bps → 0.198; cost 0.05 + 15% margin → 0.0575.
  const policy = policyWith({ undercutBps: 100, minMarginBps: 1500 });
  const plan = buildFighterPlan(policy, calmPressure(0.2), [{ tokenId: "7", mintCostEth: 0.05 }], NOW);
  assert.equal(plan.suggestions.length, 1);
  const suggestion = plan.suggestions[0];
  assert.equal(suggestion.suggestedPriceEth, 0.198);
  assert.equal(suggestion.blocked, false);
  assert.equal(suggestion.requiresManualSign, true);
  assert.match(suggestion.rationale, /Undercut/);
});

test("blocked when undercut price would fall below min margin over cost", () => {
  // floor 0.05, undercut 100 bps → 0.0495; cost 0.05 + 15% → 0.0575 → blocked.
  const policy = policyWith({ undercutBps: 100, minMarginBps: 1500 });
  const plan = buildFighterPlan(policy, calmPressure(0.05), [{ tokenId: "7", mintCostEth: 0.05 }], NOW);
  const suggestion = plan.suggestions[0];
  assert.equal(suggestion.blocked, true);
  assert.ok(suggestion.blockReasons.includes("undercut-price-below-min-margin"));
  // Suggested price is still the min-margin price, never below it.
  assert.equal(suggestion.suggestedPriceEth, 0.0575);
});

// ---------- blocking ----------

test("maxActiveListings caps new suggestions, counting already-listed holdings", () => {
  const policy = policyWith({ maxActiveListings: 2, undercutBps: 100, minMarginBps: 1000 });
  const holdings: FighterHolding[] = [
    { tokenId: "1", mintCostEth: 0.01, activeListing: true },
    { tokenId: "2", mintCostEth: 0.01 },
    { tokenId: "3", mintCostEth: 0.01 },
  ];
  const plan = buildFighterPlan(policy, calmPressure(0.2), holdings, NOW);
  // token 1 already listed → not suggested again; token 2 fills slot 2; token 3 blocked.
  assert.equal(plan.suggestions.length, 2);
  assert.equal(plan.suggestions[0].blocked, false);
  assert.equal(plan.suggestions[1].blocked, true);
  assert.ok(plan.suggestions[1].blockReasons.includes("max-active-listings-reached"));
});

test("bot-storm with stormBehavior hold blocks; undercut lets suggestions through", () => {
  const stormEvents = Array.from({ length: 12 }, (_, i) => listEvent(i + 1, 0.2, String(i)));
  const storm = assessBotPressure(stormEvents, 0.2, NOW);
  assert.equal(storm.pressureLevel, "bot-storm");
  const holdings: FighterHolding[] = [{ tokenId: "7", mintCostEth: 0.05 }];

  const holdPlan = buildFighterPlan(policyWith({ stormBehavior: "hold" }), storm, holdings, NOW);
  assert.equal(holdPlan.suggestions[0].blocked, true);
  assert.ok(holdPlan.suggestions[0].blockReasons.includes("bot-storm-hold"));

  const undercutPlan = buildFighterPlan(policyWith({ stormBehavior: "undercut" }), storm, holdings, NOW);
  assert.equal(undercutPlan.suggestions[0].blocked, false);
});

test("cooldown blocks a recently relisted token", () => {
  const policy = policyWith({ cooldownMinutes: 30 });
  const holdings: FighterHolding[] = [{ tokenId: "7", mintCostEth: 0.05, lastListedAt: new Date(NOW.getTime() - 10 * 60_000).toISOString() }];
  const plan = buildFighterPlan(policy, calmPressure(0.2), holdings, NOW);
  assert.ok(plan.suggestions[0].blockReasons.includes("cooldown-active"));
});

test("unknown floor blocks with floor-unknown, no invented price anchor", () => {
  const pressure = assessBotPressure([], null, NOW);
  const plan = buildFighterPlan(policyWith(), pressure, [{ tokenId: "7", mintCostEth: 0.05 }], NOW);
  assert.ok(plan.suggestions[0].blockReasons.includes("floor-unknown"));
});

// ---------- safety envelope ----------

test("safety envelope is always present with autoListing false, regardless of policy", () => {
  const plans = [
    buildFighterPlan(policyWith(), calmPressure(0.2), [{ tokenId: "7", mintCostEth: 0.05 }], NOW),
    buildFighterPlan(policyWith({ stormBehavior: "undercut", maxActiveListings: 0 }), calmPressure(0.05), [], NOW),
  ];
  for (const plan of plans) {
    assert.deepEqual(plan.safety, { previewOnly: true, execution: "none", broadcast: false, custody: false, autoListing: false, listingSignature: false });
    assert.equal(plan.mode, "preview-only");
    assert.equal(plan.safety.autoListing, false);
    for (const suggestion of plan.suggestions) assert.equal(suggestion.requiresManualSign, true);
  }
  assert.equal(FIGHTER_SAFETY_ENVELOPE.autoListing, false);
});
