<script lang="ts">
  // The risk view: chance of profit, the scenario grid and the P/L explain.
  // Every number comes from the Python API. This component only asks and draws.
  import { onMount, untrack } from "svelte";
  import { fetchExplain, fetchRisk } from "../lib/api.ts";
  import { axisMoney, money, percent, price as formatPrice, signedMoney } from "../lib/format.ts";
  import { clonePosition } from "../lib/state.ts";
  import type { ExplainResponse, Position, RiskDefaults, RiskResponse } from "../lib/types.ts";

  interface Props {
    apiBase: string;
    /** The position the chart currently shows. */
    position: Position;
    rangePct: number;
    defaults: RiskDefaults;
    /** Stored answers for the default example, so its first view needs no server. */
    initial: { risk: RiskResponse; explain: ExplainResponse } | null;
    /** Shared with the chart, which draws it as the "likely range" overlay. */
    distribution?: RiskResponse["distribution"];
  }

  let { apiBase, position, rangePct, defaults, initial, distribution = $bindable(null) }: Props = $props();

  const startDefaults = untrack(() => defaults);
  let risk = $state.raw<RiskResponse | null>(untrack(() => initial?.risk ?? null));
  let explained = $state.raw<ExplainResponse | null>(untrack(() => initial?.explain ?? null));
  let riskBusy = $state(false);
  let explainBusy = $state(false);
  let problem = $state("");

  /** Expected annual return in percent, as typed. A number box gives a number, or null when empty. */
  let driftInput = $state<number | null>(null);
  let horizon = $state(0);
  let movePct = $state(startDefaults.move_pct * 100);
  let moveDays = $state(startDefaults.days);
  let volPoints = $state(startDefaults.vol_points);

  const expiry = $derived(
    Math.min(...position.legs.filter((leg) => leg.kind !== "stock").map((leg) => leg.days!), Infinity),
  );
  const hasOptions = $derived(Number.isFinite(expiry));
  const horizons = $derived([0, 7, 14].filter((days) => days === 0 || days < expiry));
  const drift = $derived(
    typeof driftInput === "number" && Number.isFinite(driftInput) && Math.abs(driftInput) <= 100 ? driftInput / 100 : null,
  );

  const positionKey = $derived(JSON.stringify([clonePosition(position), rangePct]));
  const riskKey = $derived(JSON.stringify([positionKey, drift, horizon]));
  const explainKey = $derived(JSON.stringify([positionKey, movePct, moveDays, volPoints]));

  // The stored answers fit only the untouched default example.
  let lastRiskKey = untrack(() => (initial ? riskKey : ""));
  let lastExplainKey = untrack(() => (initial ? explainKey : ""));
  let riskTimer = 0;
  let explainTimer = 0;
  let riskController: AbortController | null = null;
  let explainController: AbortController | null = null;
  let live = false;

  $effect(() => {
    distribution = risk?.distribution ?? null;
  });

  $effect(() => {
    const key = riskKey;
    if (!live || key === lastRiskKey) return;
    lastRiskKey = key;
    untrack(() => {
      window.clearTimeout(riskTimer);
      riskTimer = window.setTimeout(loadRisk, 250);
    });
  });

  $effect(() => {
    const key = explainKey;
    if (!live || key === lastExplainKey) return;
    lastExplainKey = key;
    untrack(() => {
      window.clearTimeout(explainTimer);
      explainTimer = window.setTimeout(loadExplain, 200);
    });
  });

  async function loadRisk() {
    riskController?.abort();
    const controller = (riskController = new AbortController());
    riskBusy = true;
    try {
      risk = await fetchRisk(apiBase, clonePosition(position), rangePct, { drift, horizonDays: horizon }, controller.signal);
      problem = "";
    } catch (error) {
      if ((error as Error).name !== "AbortError") problem = "The risk numbers could not be updated.";
    } finally {
      if (controller === riskController) riskBusy = false;
    }
  }

  async function loadExplain() {
    explainController?.abort();
    const controller = (explainController = new AbortController());
    explainBusy = true;
    try {
      explained = await fetchExplain(
        apiBase,
        clonePosition(position),
        { pct: movePct / 100, days: Math.min(moveDays, hasOptions ? expiry : moveDays), volPoints },
        controller.signal,
      );
      problem = "";
    } catch (error) {
      if ((error as Error).name !== "AbortError") problem = "The explain could not be updated.";
    } finally {
      if (controller === explainController) explainBusy = false;
    }
  }

  onMount(() => {
    live = true;
    if (riskKey !== lastRiskKey) {
      lastRiskKey = riskKey;
      loadRisk();
    }
    if (explainKey !== lastExplainKey) {
      lastExplainKey = explainKey;
      loadExplain();
    }
    return () => {
      window.clearTimeout(riskTimer);
      window.clearTimeout(explainTimer);
      riskController?.abort();
      explainController?.abort();
    };
  });

  // --- scenario heat map --------------------------------------------------------

  const table = $derived(risk?.scenarios ?? null);
  const largest = $derived(table ? Math.max(1, ...table.profit.flat().map(Math.abs)) : 1);
  const rows = $derived(table ? table.vol_shifts.map((shift, index) => ({ shift, index })).reverse() : []);
  const tint = (value: number) =>
    `color-mix(in srgb, var(${value >= 0 ? "--profit" : "--loss"}) ${Math.round(6 + (54 * Math.abs(value)) / largest)}%, transparent)`;
  const shockLabel = (shock: number) => (shock === 0 ? "0%" : `${shock > 0 ? "+" : "−"}${Math.round(Math.abs(shock) * 100)}%`);
  const shiftLabel = (shift: number) =>
    shift === 0 ? "0 pts" : `${shift > 0 ? "+" : "−"}${Math.round(Math.abs(shift) * 100)} pts`;

  // --- explain bars ---------------------------------------------------------------

  const parts = $derived(
    explained
      ? [
          { name: "Delta", hint: "direction", value: explained.delta },
          { name: "Gamma", hint: "curvature", value: explained.gamma },
          { name: "Theta", hint: "time", value: explained.theta },
          { name: "Vega", hint: "volatility", value: explained.vega },
          { name: "Unexplained", hint: "higher-order", value: explained.unexplained },
        ]
      : [],
  );
  const barScale = $derived(explained ? Math.max(1, Math.abs(explained.actual), ...parts.map((part) => Math.abs(part.value))) : 1);
  const bar = (value: number) => `${((Math.abs(value) / barScale) * 50).toFixed(2)}%`;

  const fill = (value: number, low: number, high: number) => `${(((value - low) / (high - low)) * 100).toFixed(1)}%`;
  const signedPct = (value: number) => (value === 0 ? "0%" : `${value > 0 ? "+" : "−"}${Math.abs(value)}%`);
</script>

<section class="risk" aria-label="Risk">
  <div class="head">
    <h2 class="section">Risk</h2>
    <span class="status" aria-live="polite">{riskBusy || explainBusy ? "Updating" : problem}</span>
  </div>

  <div class="top">
    <div class="card chance">
      <div class="k">Chance of profit at expiry</div>
      {#if hasOptions && risk?.chance_of_profit != null}
        <div class="big num">{percent(risk.chance_of_profit)}</div>
        <p class="note">
          Risk-neutral: assumes the stock grows at the {percent(position.rate, 1)} interest rate, which is what option
          prices imply. It is not a forecast.
        </p>
        <label class="view">
          <span>Your expected return</span>
          <span class="field-wrap"
            ><input class="field" type="number" step="1" min="-100" max="100" placeholder="10" bind:value={driftInput} /><span
              class="unit">% a year</span
            ></span
          >
        </label>
        {#if drift != null && risk.chance_of_profit_with_drift != null}
          <p class="with-view">With your view: <b class="num">{percent(risk.chance_of_profit_with_drift)}</b></p>
        {/if}
      {:else}
        <div class="big num">&mdash;</div>
        <p class="note">This position has no options, so there is no expiry to measure.</p>
      {/if}
    </div>

    <div class="card facts">
      <div class="fact">
        <span class="k">Average profit at expiry</span>
        <span class="num value">{risk?.expected_profit != null ? signedMoney(risk.expected_profit) : "—"}</span>
        <span class="note">Risk-neutral. Fairly priced options earn only the interest rate on average.</span>
      </div>
      <div class="fact">
        <span class="k">Volatility used</span>
        <span class="num value">{risk?.representative_vol != null ? percent(risk.representative_vol) : "—"}</span>
        <span class="note">Each leg weighted by how much the position depends on it.</span>
      </div>
      {#if risk?.distribution}
        <div class="fact">
          <span class="k">Outside the chart</span>
          <span class="num value"
            >{percent(risk.distribution.below_range)} below &middot; {percent(risk.distribution.above_range)} above</span
          >
          <span class="note">Chance the price finishes beyond the price range shown.</span>
        </div>
      {/if}
    </div>
  </div>

  {#if table}
    <div class="card scen">
      <div class="scen-head">
        <div>
          <div class="k">Scenario grid</div>
          <p class="note">Profit if the price and every leg's volatility jump at once.</p>
        </div>
        <span class="seg" role="group" aria-label="When the shock happens">
          {#each horizons as days (days)}
            <button type="button" aria-pressed={horizon === days} onclick={() => (horizon = days)}>
              {days === 0 ? "Now" : `In ${days}d`}
            </button>
          {/each}
        </span>
      </div>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th class="corner"><span class="k">Vol \ price</span></th>
              {#each table.price_shocks as shock (shock)}
                <th>
                  <span class="num">{shockLabel(shock)}</span>
                  <span class="px num">{formatPrice(position.spot * (1 + shock))}</span>
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each rows as row (row.shift)}
              <tr>
                <th class="num">{shiftLabel(row.shift)}</th>
                {#each table.profit[row.index] as value, column (column)}
                  <td
                    class="num"
                    class:centre={row.shift === 0 && table.price_shocks[column] === 0}
                    style="background: {tint(value)}"
                    title="{shiftLabel(row.shift)}, price {shockLabel(table.price_shocks[column])}: {signedMoney(value)}"
                    >{Math.abs(value) < 0.5 ? "$0" : axisMoney(value)}</td
                  >
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  <div class="card explain">
    <div class="k">P/L explain</div>
    <p class="note">How much of a move each Greek accounts for, measured before the move as a risk report would.</p>

    <div class="sliders">
      <label class="control">
        <span class="ctop"><span class="k">Price move</span><span class="num">{signedPct(movePct)}</span></span>
        <input type="range" min="-20" max="20" step="1" bind:value={movePct} style="--fill: {fill(movePct, -20, 20)}" />
      </label>
      <label class="control">
        <span class="ctop"><span class="k">Days pass</span><span class="num">{moveDays}</span></span>
        <input
          type="range"
          min="0"
          max={hasOptions ? Math.max(1, Math.floor(expiry)) : 30}
          step="1"
          bind:value={moveDays}
          style="--fill: {fill(moveDays, 0, hasOptions ? Math.max(1, Math.floor(expiry)) : 30)}"
        />
      </label>
      <label class="control">
        <span class="ctop"><span class="k">Volatility change</span><span class="num">{volPoints > 0 ? "+" : ""}{volPoints} pts</span></span>
        <input type="range" min="-20" max="20" step="1" bind:value={volPoints} style="--fill: {fill(volPoints, -20, 20)}" />
      </label>
    </div>

    {#if explained}
      <div class="bars" class:busy={explainBusy}>
        {#each parts as part (part.name)}
          <div class="row">
            <span class="name">{part.name} <i>{part.hint}</i></span>
            <span class="track">
              <span
                class="fillbar"
                class:neg={part.value < 0}
                style="width: {bar(part.value)}; {part.value < 0 ? 'right: 50%' : 'left: 50%'}"
              ></span>
            </span>
            <span class="num amount" class:pos={part.value > 0.5} class:neg={part.value < -0.5}>{signedMoney(part.value)}</span>
          </div>
        {/each}
        <div class="row total">
          <span class="name">Actual change</span>
          <span class="track">
            <span
              class="fillbar total-bar"
              style="width: {bar(explained.actual)}; {explained.actual < 0 ? 'right: 50%' : 'left: 50%'}"
            ></span>
          </span>
          <span class="num amount">{signedMoney(explained.actual)}</span>
        </div>
      </div>
      <p class="formula">
        delta &times; move + &frac12; gamma &times; move&sup2; + theta &times; days + vega &times; vol change. A move of
        {money(Math.abs(explained.price_move), 2)}; what the Greeks miss shows up as unexplained.
      </p>
    {/if}
  </div>
</section>

<style>
  .risk {
    margin-top: 30px;
  }
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  .section {
    font: 500 11px/1.4 var(--mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    margin: 0 0 10px;
  }
  .status {
    font: 400 12px var(--mono);
    color: var(--accent);
  }
  .card {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 16px 18px;
    background: var(--bg);
    min-width: 0;
  }
  .top {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
    gap: 14px;
  }
  .note {
    margin: 4px 0 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--muted);
  }
  .big {
    font-size: 44px;
    line-height: 1.1;
    margin: 6px 0 2px;
  }
  .view {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 14px;
    font-size: 13.5px;
    color: var(--soft);
  }
  .field-wrap {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .field-wrap .field {
    width: 76px;
  }
  .unit {
    font-size: 12.5px;
    color: var(--muted);
    white-space: nowrap;
  }
  .with-view {
    margin: 10px 0 0;
    font-size: 14px;
    color: var(--soft);
  }
  .with-view b {
    font-size: 17px;
    color: var(--ink);
    font-weight: 500;
  }
  .facts {
    display: grid;
    gap: 14px;
    align-content: start;
  }
  .fact {
    display: grid;
    gap: 2px;
  }
  .fact .value {
    font-size: 17px;
  }

  .scen,
  .explain {
    margin-top: 14px;
  }
  .scen-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }
  .scroll {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 3px;
    font-size: 12.5px;
  }
  th {
    font-weight: 400;
    color: var(--muted);
    padding: 4px 6px;
    text-align: center;
    white-space: nowrap;
  }
  thead th {
    vertical-align: bottom;
  }
  thead th .px {
    display: block;
    font-size: 11px;
    opacity: 0.8;
  }
  tbody th {
    text-align: right;
  }
  .corner {
    text-align: left;
  }
  td {
    text-align: center;
    padding: 9px 4px;
    border-radius: 3px;
    color: var(--ink);
    white-space: nowrap;
  }
  td.centre {
    outline: 1.5px solid var(--accent);
    outline-offset: -1.5px;
  }

  .sliders {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 18px;
    margin: 14px 0 10px;
  }
  .control {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .ctop {
    display: flex;
    justify-content: space-between;
    font-size: 13px;
  }
  .bars {
    display: grid;
    gap: 6px;
    margin-top: 8px;
    transition: opacity 0.2s;
  }
  .bars.busy {
    opacity: 0.55;
  }
  .row {
    display: grid;
    grid-template-columns: 170px minmax(0, 1fr) 96px;
    gap: 12px;
    align-items: center;
    font-size: 13.5px;
  }
  .name i {
    font-style: normal;
    font-size: 12px;
    color: var(--muted);
  }
  .track {
    position: relative;
    height: 14px;
    background: linear-gradient(var(--line), var(--line)) center / 1px 100% no-repeat;
  }
  .fillbar {
    position: absolute;
    top: 2px;
    bottom: 2px;
    background: var(--profit);
    opacity: 0.75;
    border-radius: 2px;
  }
  .fillbar.neg {
    background: var(--loss);
  }
  .total-bar {
    background: var(--ink);
    opacity: 0.85;
  }
  .amount {
    text-align: right;
  }
  .total {
    border-top: 1px solid var(--line);
    padding-top: 8px;
    margin-top: 2px;
    font-weight: 500;
  }
  .formula {
    margin: 12px 0 0;
    font: italic 400 13.5px/1.5 var(--serif);
    color: var(--muted);
  }

  @media (max-width: 860px) {
    .top {
      grid-template-columns: minmax(0, 1fr);
    }
    .sliders {
      grid-template-columns: minmax(0, 1fr);
      gap: 8px;
    }
    .row {
      grid-template-columns: 112px minmax(0, 1fr) 82px;
      gap: 8px;
      font-size: 12.5px;
    }
    .name i {
      display: none;
    }
  }
</style>
