// The token radar's model, radar-3: one snapshot of the protocol universe in, one ranked board out.
//
// radar-3 keeps radar-2's implied-value arithmetic exactly — the same constants, the same four
// multipliers, the same board — and adds what radar-2 could not show: what the market already pays
// for the nearest tokens that trade, how much of the record the model can stand on, and what could
// go wrong with a row. Every board row now carries its comparables, its confidence and its risks,
// and the dashboard shows all three beside the implied value.
//
// The pipeline runs in stages, each a small function with one job:
//
//   readSnapshot  — the sealed file into typed records, or a refusal naming what is wrong
//   pickEligible  — the watchlist floor plus every other rankable pre-token protocol
//   scoreEach     — one protocol into its implied value, its confidence and its risks
//   rankScored    — strongest first, ranks 1..n, ties broken by slug so the order is stable
//   planEach      — the seven-step farm plan, from the protocol's own record
//   assemble      — rows, the live-token set-aside, and the dashboard's dataset
//
// Nothing here special-cases a name. The same functions score every row, and the same record that
// feeds the board feeds the page: the dashboard recomputes each row from the snapshot figures and
// checks the number board.json carries.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_step: number;
  breadth_cap: number;
}

/** How many nearest live-token comparables one board row carries. */
export const COMPARABLES_PER_ROW = 3;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The model's constants, radar-3: the same implied-value arithmetic as radar-2. */
export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.6,
  growth_floor: -60,
  growth_cap: 150,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 1460,
  unknown_age_days: 365,
  breadth_step: 0.02,
  breadth_cap: 5,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One live-token comparable: a token that already trades, near the protocol in kind and size. */
export interface Comparable {
  slug: string;
  name: string;
  category: string | null;
  mcap_usd: number;
  tvl_usd: number;
  /** What the market pays per dollar of TVL: market cap over TVL. */
  multiple: number;
  /** What this protocol would be worth at that multiple: its TVL times the multiple. */
  implied_usd: number;
}

/** How much of the record the model can stand on, 0 to 100, and what is missing. */
export interface ConfidenceReport {
  score: number;
  note: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  /** The nearest tokens that already trade, and what they pay per dollar of TVL. */
  comparables: Comparable[];
  /** The middle multiple of the comparables, or null where none is near enough to name. */
  comparable_median_multiple: number | null;
  /** How much of the record the model can stand on, 0 to 100. */
  confidence: number;
  /** The largest gap in the record, in one sentence. */
  confidence_note: string;
  /** What could go wrong with this row, each a short warning from the record itself. */
  risks: string[];
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  comparables: Comparable[];
  comparable_median_multiple: number | null;
  confidence: number;
  confidence_note: string;
  risks: string[];
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** `value` kept inside [low, high]. */
function clampNumber(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** A number rounded to four decimals, for the model's breakdown the dashboard shows. */
function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

/** Whole days from `from` to `to`, never below zero; null when either date is absent or bad. */
function daysBetween(from: string, to: string | null): number | null {
  if (to === null) return null;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The protocol's age in days on the snapshot's date, or null where the record has no listing day. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  return daysBetween(asOf, listedAt);
}

// ---------------------------------------------------------------------------
// Eligibility: the watchlist's own rule, as a list of reasons instead of a boolean.
// ---------------------------------------------------------------------------

/** A name ending in a release marker is a pool of another protocol, not a launch. */
const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking anywhere in a name, in any case. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** The categories of products whose token already trades, or of a token that is not a launch. */
const BARRED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchanges whose name at the start of a protocol's name marks its own product. */
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Every reason a protocol is not one the board may rank, empty where it is rankable: it must
 * record no token, and it must not be a wrapped, staked or bridged product of a token that
 * already trades. This is the watchlist's own rule, applied to every row, not just the floor.
 */
export function exclusionReasons(p: SnapshotProtocol): string[] {
  const reasons: string[] = [];
  if (!isPreToken(p)) reasons.push('records a token');
  if (p.category !== null && BARRED_CATEGORIES.has(p.category)) reasons.push(`category ${p.category} is a product of a token that trades`);
  if (VERSION_MARKER.test(p.name)) reasons.push('name ends in a version marker');
  if (WRAPPED_WORD.test(p.name)) reasons.push('name carries wrapped, staked or staking');
  for (const exchange of EXCHANGE_NAMES) {
    if (p.name.startsWith(exchange)) {
      reasons.push(`name begins with the exchange ${exchange}`);
      break;
    }
  }
  return reasons;
}

/** Whether a protocol is one the board may rank: pre-token, and nothing bars it. */
export function isRankable(p: SnapshotProtocol): boolean {
  return exclusionReasons(p).length === 0;
}

// ---------------------------------------------------------------------------
// Scoring: one protocol into its implied value, its confidence and its risks.
// ---------------------------------------------------------------------------

/** The four multipliers and the implied value one protocol gets under `model`. */
export interface ScoreBreakdown {
  age: number | null;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  implied: number;
}

/** The multipliers and the implied value, from the snapshot's own figures and nothing else. */
export function scoreProtocol(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): ScoreBreakdown {
  const age = daysBetween(asOf, protocol.listed_at);
  const growthPct = clampNumber(finiteNumber(protocol.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (clampNumber(ageForModel, 0, model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult =
    1 + model.breadth_step * clampNumber(protocol.chains.length - 1, 0, model.breadth_cap);
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * breadthMult));
  return { age, growthPct, growthMult, maturityMult, breadthMult, implied };
}

/** The four multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const s = scoreProtocol(protocol, asOf, model);
  return { implied: s.implied, growthPct: s.growthPct, growthMult: s.growthMult, maturityMult: s.maturityMult, breadthMult: s.breadthMult, age: s.age };
}

// ---------------------------------------------------------------------------
// Comparables: what the market already pays for the nearest tokens that trade.
// ---------------------------------------------------------------------------

/** The live-token protocols with a market cap and a TVL, the pool comparables are drawn from. */
function livePool(protocols: SnapshotProtocol[]): SnapshotProtocol[] {
  const pool: SnapshotProtocol[] = [];
  for (const p of protocols) {
    if (!isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0) pool.push(p);
  }
  return pool;
}

/** How near two protocols sit by size: the log distance of their TVLs, zero for twins. */
function sizeDistance(aTvl: number, bTvl: number): number {
  return Math.abs(Math.log(aTvl) - Math.log(bTvl));
}

/**
 * The nearest live-token comparables for one pre-token protocol: same category first, then any
 * live token near it in size. Each carries what the market pays per dollar of its TVL and what
 * this protocol would be worth at that multiple — a second opinion on the model's implied value,
 * drawn from the snapshot alone.
 */
export function comparablesFor(
  protocol: SnapshotProtocol,
  pool: SnapshotProtocol[],
  count: number = COMPARABLES_PER_ROW,
): Comparable[] {
  const sameKind = pool.filter((p) => p.category !== null && p.category === protocol.category);
  const others = pool.filter((p) => p.category === null || p.category !== protocol.category);
  const bySize = (a: SnapshotProtocol, b: SnapshotProtocol) =>
    sizeDistance(protocol.tvl_usd, a.tvl_usd) - sizeDistance(protocol.tvl_usd, b.tvl_usd);
  const ordered = [...sameKind.sort(bySize), ...others.sort(bySize)];
  const picked = ordered.slice(0, count);
  return picked.map((p) => {
    const multiple = p.mcap_usd! / p.tvl_usd;
    return {
      slug: p.slug,
      name: p.name,
      category: p.category,
      mcap_usd: p.mcap_usd!,
      tvl_usd: p.tvl_usd,
      multiple: round4(multiple),
      implied_usd: Math.max(1, Math.round(protocol.tvl_usd * multiple)),
    };
  });
}

/** The middle multiple of the comparables, or null where none is near enough to name. */
export function medianMultiple(comparables: Comparable[]): number | null {
  if (comparables.length === 0) return null;
  const sorted = comparables.map((c) => c.multiple).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return round4((sorted[middle - 1]! + sorted[middle]!) / 2);
}

// ---------------------------------------------------------------------------
// Confidence and risks: how much of the record the model can stand on.
// ---------------------------------------------------------------------------

/** How much of the record the model can stand on, 0 to 100, and what is missing. */
export function confidenceFor(protocol: SnapshotProtocol, age: number | null): ConfidenceReport {
  let score = 0;
  const missing: string[] = [];
  if (protocol.change_7d !== null) score += 30;
  else missing.push('no seven-day change reported');
  if (protocol.listed_at !== null) score += 25;
  else missing.push('no listing day recorded');
  if (protocol.category !== null) score += 15;
  else missing.push('no category recorded');
  if (protocol.chains.length >= 2) score += 15;
  else missing.push('TVL on a single chain only');
  if (age !== null && age >= 365) score += 15;
  else missing.push('under a year of history, or none recorded');
  const note =
    missing.length === 0
      ? 'Full record: growth, listing day, category, chains and age are all reported.'
      : `Missing ${missing[0]}${missing.length > 1 ? `, and ${missing.length - 1} more` : ''}.`;
  return { score, note };
}

/** What could go wrong with this row, each a short warning from the record itself. */
export function risksFor(protocol: SnapshotProtocol, age: number | null): string[] {
  const risks: string[] = [];
  if (protocol.chains.length <= 1) risks.push('Single chain carries all of its TVL.');
  if (age !== null && age < 90) risks.push('Listed under 90 days ago, so the record is thin.');
  if (age === null) risks.push('No listing day recorded, so its age is a guess.');
  if (protocol.change_7d !== null && protocol.change_7d < 0) risks.push('TVL fell over the last seven days.');
  if (protocol.change_7d === null) risks.push('No seven-day change reported, so momentum is unknown.');
  if (protocol.category === null) risks.push('No category recorded, so its kind is unknown.');
  if (protocol.tvl_usd < 50_000_000) risks.push('Below the watchlist floor, so fewer eyes have checked it.');
  return risks;
}

// ---------------------------------------------------------------------------
// Farm plan: seven steps, each an action with a cost and a time.
// ---------------------------------------------------------------------------

/** The first chain a protocol names, or a neutral phrase. */
function firstChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The second chain a protocol names, or null. */
function secondChainOf(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function mainActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A second, smaller action on the protocol's second chain, or a second feature where it has one chain. */
function followUpActionFor(p: SnapshotProtocol, capital: number, chain2: string | null): FarmStep {
  const name = p.name;
  const half = Math.max(25, Math.round(capital / 2));
  if (chain2 !== null) {
    return {
      text: `Repeat the same position on ${chain2} with $${half}, so the wallet shows activity on two chains.`,
      cost: `$${half} of capital and about $3 of gas`,
      time: '10 minutes',
    };
  }
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return { text: `Borrow $25 against the supply and repay it within the week, so the wallet shows both sides of ${name}.`, cost: 'about $3 of gas, no new capital', time: '10 minutes' };
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) {
    return { text: `Swap $25 through ${name}'s pool and leave the route in the wallet's history.`, cost: '$25 of capital and about $3 of gas', time: '5 minutes' };
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return { text: `Close the first hedge and open one small position the other way, so the wallet shows two trades.`, cost: 'about $3 of gas, no new capital', time: '10 minutes' };
  }
  if (c.includes('prediction')) {
    return { text: `Place a second market position of $10 on a different outcome, so the wallet shows two markets.`, cost: '$10 of capital and about $2 of gas', time: '5 minutes' };
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return { text: `Deposit $25 into a second ${name} vault, so the wallet holds shares in two vaults.`, cost: '$25 of capital and about $3 of gas', time: '10 minutes' };
  }
  return { text: `Use ${name}'s second feature once, such as a swap, a vote or a stake, and leave it in the wallet's history.`, cost: 'about $3 of gas', time: '10 minutes' };
}

/** One step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = firstChain(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  const steps: FarmStep[] = [];
  steps.push({
    text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
    cost: 'under $3 of gas for the first transaction',
    time: '5 minutes',
  });
  steps.push({
    text: mainActionFor(p, capital, chain),
    cost: `$${capital} of capital and about $${gas} of gas`,
    time: '15 minutes to set up',
  });
  steps.push(followUpActionFor(p, capital, secondChainOf(p)));
  steps.push({
    text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
    cost: 'about $2 of gas a week',
    time: '10 minutes a week',
  });
  steps.push({
    text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
    cost: `the $${capital} stays in the position`,
    time: `${hold} days`,
  });
  steps.push({
    text: `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes.`,
    cost: 'no fee to check, and never pay to claim',
    time: '10 minutes',
  });
  steps.push({
    text: `Write the wallet, the dates and every transaction in a farm log, then unwind in reverse: claim first, withdraw the second chain, then the main position.`,
    cost: 'nothing but the log, plus gas to unwind',
    time: '5 minutes to log, 15 to unwind',
  });
  return steps;
}

// ---------------------------------------------------------------------------
// Board: pick, score, rank, plan.
// ---------------------------------------------------------------------------

/** One scored protocol, before its rank is assigned. */
interface ScoredProtocol {
  protocol: SnapshotProtocol;
  score: ScoreBreakdown;
  confidence: ConfidenceReport;
  risks: string[];
  comparables: Comparable[];
  medianMultiple: number | null;
}

/** The snapshot's protocol by slug. */
function indexBySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  const index = new Map<string, SnapshotProtocol>();
  for (const p of protocols) index.set(p.slug, p);
  return index;
}

/** The protocols the board ranks: the watchlist floor, then every other rankable pre-token one. */
function pickEligible(snapshot: Snapshot): SnapshotProtocol[] {
  const index = indexBySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, at any TVL. The floor is never the
  // whole board: a protocol below it, or one the watchlist leaves out, is no worse a subject.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  return [...chosen.values()];
}

/** Score every candidate: implied value, confidence, risks and comparables, all from the record. */
function scoreEach(candidates: SnapshotProtocol[], snapshot: Snapshot, model: ModelConstants): ScoredProtocol[] {
  const pool = livePool(snapshot.protocols);
  const scored: ScoredProtocol[] = [];
  for (const protocol of candidates) {
    const score = scoreProtocol(protocol, snapshot.as_of, model);
    const confidence = confidenceFor(protocol, score.age);
    const risks = risksFor(protocol, score.age);
    const comparables = comparablesFor(protocol, pool);
    scored.push({
      protocol,
      score,
      confidence,
      risks,
      comparables,
      medianMultiple: medianMultiple(comparables),
    });
  }
  return scored;
}

/** Strongest implied value first; a tie falls to the slug, so the order is stable run to run. */
function rankScored(scored: ScoredProtocol[]): ScoredProtocol[] {
  const ordered = [...scored];
  ordered.sort((a, b) => {
    if (b.score.implied !== a.score.implied) return b.score.implied - a.score.implied;
    return a.protocol.slug < b.protocol.slug ? -1 : a.protocol.slug > b.protocol.slug ? 1 : 0;
  });
  return ordered;
}

/** A scored protocol into its board row, with its rank and its seven-step plan. */
function toBoardRow(s: ScoredProtocol, rank: number): BoardRow {
  const p = s.protocol;
  const sc = s.score;
  return {
    rank,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token',
    age_days: sc.age,
    implied_value_usd: sc.implied,
    model: {
      base_multiple: MODEL.base_multiple,
      growth_pct: sc.growthPct,
      growth_multiplier: round4(sc.growthMult),
      maturity_multiplier: round4(sc.maturityMult),
      breadth_multiplier: round4(sc.breadthMult),
      age_days: sc.age,
    },
    comparables: s.comparables,
    comparable_median_multiple: s.medianMultiple,
    confidence: s.confidence.score,
    confidence_note: s.confidence.note,
    risks: s.risks,
    farm_steps: farmSteps(p, sc.age).map(stepText),
  };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const candidates = pickEligible(snapshot);
  const scored = scoreEach(candidates, snapshot, model);
  const ranked = rankScored(scored);
  return ranked.map((s, i) => toBoardRow(s, i + 1));
}

// ---------------------------------------------------------------------------
// Live set-aside, dashboard dataset, snapshot reading, board checks.
// ---------------------------------------------------------------------------

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  const live: SnapshotProtocol[] = [];
  for (const p of snapshot.protocols) {
    if (!isPreToken(p) && p.category !== 'CEX') live.push(p);
  }
  live.sort((a, b) => {
    const mcapA = a.mcap_usd ?? 0;
    const mcapB = b.mcap_usd ?? 0;
    if (mcapB !== mcapA) return mcapB - mcapA;
    return b.tvl_usd - a.tvl_usd;
  });
  const top: LiveRow[] = [];
  for (const p of live.slice(0, LIVE_ROWS)) {
    top.push({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    });
  }
  return top;
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    comparables: row.comparables,
    comparable_median_multiple: row.comparable_median_multiple,
    confidence: row.confidence,
    confidence_note: row.confidence_note,
    risks: row.risks,
    watchlist: watchlist.has(row.slug),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  let early = 0;
  for (const r of board) if (!snapshot.watchlist.includes(r.slug)) early++;
  const watchSet = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, watchSet)),
    live,
  };
  return { board, radar };
}

/** One field read as a string, or null where it is absent or not a string. */
function stringField(record: Record<string, unknown>, name: string): string | null {
  return typeof record[name] === 'string' ? (record[name] as string) : null;
}

/** One field read as a finite number, or null where it is absent or not a number. */
function numberField(record: Record<string, unknown>, name: string): number | null {
  const v = record[name];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** One protocol record out of a raw object, refused unless it carries a slug, a name and a TVL. */
function toProtocol(value: unknown, index: number): SnapshotProtocol {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SnapshotError(`snapshot.json's protocol ${index} is not an object`);
  }
  const p = value as Record<string, unknown>;
  if (typeof p.slug !== 'string' || typeof p.name !== 'string') {
    throw new SnapshotError(`snapshot.json's protocol ${index} lacks a slug or a name`);
  }
  const tvl = numberField(p, 'tvl_usd');
  if (tvl === null) throw new SnapshotError(`snapshot.json's protocol ${index} lacks a TVL`);
  const chains: string[] = [];
  if (Array.isArray(p.chains)) {
    for (const c of p.chains) if (typeof c === 'string') chains.push(c);
  }
  return {
    slug: p.slug,
    name: p.name,
    category: stringField(p, 'category'),
    chains,
    tvl_usd: tvl,
    change_7d: numberField(p, 'change_7d'),
    mcap_usd: numberField(p, 'mcap_usd'),
    listed_at: stringField(p, 'listed_at'),
    gecko_id: stringField(p, 'gecko_id'),
    symbol: stringField(p, 'symbol'),
  };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date');
  }
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i) => toProtocol(v, i));
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** One board check: a message naming what is wrong, or null where the board passes it. */
type BoardCheck = (board: BoardRow[], snapshot: Snapshot) => string | null;

const BOARD_CHECKS: BoardCheck[] = [
  (board, snapshot) => {
    const slugs = new Set(board.map((r) => r.slug));
    const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
    return missing.length > 0
      ? `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`
      : null;
  },
  (board) => {
    const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
    for (let i = 0; i < ranks.length; i++) {
      if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
    }
    return null;
  },
  (board) => {
    for (let i = 1; i < board.length; i++) {
      if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
        return `row ${i + 1} outranks row ${i} on implied value`;
      }
    }
    return null;
  },
  (board) => {
    if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
      return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
    }
    return null;
  },
  (board) => {
    for (const r of board) {
      const steps = r.farm_steps;
      if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
      for (const s of steps) {
        if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
      }
      if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
        return `${r.slug} has implied value ${r.implied_value_usd}`;
      }
    }
    return null;
  },
];

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  for (const check of BOARD_CHECKS) {
    const issue = check(board, snapshot);
    if (issue !== null) return issue;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
