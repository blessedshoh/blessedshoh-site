<script lang="ts">
  // Curve factors: level, slope and curvature from the daily moves of the Treasury par
  // curve over a window ending on the curve day, and what they mean for the bond from
  // "Price a bond". The window's stored yields come from /history.json; every number on
  // this tab comes back from bondlab through the API.
  import { untrack } from "svelte";
  import LineChart from "./LineChart.svelte";
  import VarianceBars from "./VarianceBars.svelte";
  import { fetchPca } from "../lib/api.ts";
  import type { StoredCurve } from "../lib/curve-data.ts";
  import type { StoredHistory } from "../lib/history-data.ts";
  import { isValidBond, isValidFactors, pcaRequest } from "../lib/state.ts";
  import { track } from "../lib/track.ts";
  import {
    FACTOR_YEARS,
    HEDGE_TENORS,
    type BondInput,
    type ChartSeries,
    type FactorRow,
    type FactorsInput,
    type HedgeInput,
    type PcaResponse,
    type Scheme,
  } from "../lib/types.ts";

  interface Props {
    apiBase: string;
    stored: StoredCurve;
    scheme: Scheme;
    bond: BondInput;
    hedge: HedgeInput;
    factors: FactorsInput;
    onprice: () => void;
  }

  let { apiBase, stored, scheme, bond, hedge, factors = $bindable(), onprice }: Props = $props();

  const NAMES = ["Level", "Slope", "Curvature"] as const;
  const COLORS = ["var(--accent)", "var(--series-2)", "var(--series-3)"] as const;
  const ROW_NAMES: Record<FactorRow["name"], string> = {
    unhedged: "Unhedged",
    dv01: "DV01 hedge",
    "key-rate": "Key-rate (par)",
    "level-slope": "Level/slope",
  };

  let result = $state.raw<PcaResponse | null>(null);
  let busy = $state(false);
  let problem = $state("");
  let history: StoredHistory | null = null;
  let timer = 0;
  let controller: AbortController | null = null;

  const valid = $derived(isValidBond($state.snapshot(bond) as BondInput) && isValidFactors($state.snapshot(factors) as FactorsInput));
  const key = $derived(
    JSON.stringify([stored.day, scheme, bond.preset, bond.coupon, bond.maturity, hedge.faceAmount, factors.years, factors.hedgeTenors]),
  );

  $effect(() => {
    void key;
    untrack(() => {
      window.clearTimeout(timer);
      if (!valid) {
        problem = "Pick two different hedge maturities, and a valid bond on Price a bond.";
        return;
      }
      timer = window.setTimeout(load, 300);
    });
  });

  async function loadHistory(signal: AbortSignal): Promise<StoredHistory> {
    if (history && history.day === stored.day && history.years === factors.years) return history;
    const response = await fetch(`/history.json?day=${stored.day}&years=${factors.years}`, { signal });
    const body = (await response.json()) as StoredHistory & { error?: string };
    if (!response.ok) throw new Error(body.error ?? `The stored history answered with status ${response.status}.`);
    history = body;
    return body;
  }

  async function load() {
    controller?.abort();
    const mine = (controller = new AbortController());
    busy = true;
    try {
      const windowData = await loadHistory(mine.signal);
      const sent = $state.snapshot(factors) as FactorsInput;
      const request = pcaRequest(windowData, scheme, $state.snapshot(bond) as BondInput, hedge.faceAmount, sent);
      result = await fetchPca(apiBase, request, mine.signal);
      problem = "";
      track("factors");
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      result = null;
      problem = error instanceof TypeError ? "The pricing server could not be reached." : (error as Error).message;
    } finally {
      if (controller === mine) busy = false;
    }
  }

  function setTenor(index: 0 | 1, tenor: string) {
    const next: [string, string] = [...factors.hedgeTenors];
    next[index] = tenor;
    factors.hedgeTenors = next;
  }

  // Drawing only: a date as a decimal year for the x axis, and back for the labels.
  const decimalYear = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    const start = Date.UTC(y, 0, 1);
    return y + (Date.UTC(y, m - 1, d) - start) / (Date.UTC(y + 1, 0, 1) - start);
  };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dateLabel = (x: number) => {
    const year = Math.floor(x);
    const month = Math.min(11, Math.floor((x - year) * 12));
    return `${MONTHS[month]} ${year}`;
  };

  const loadingSeries = $derived<ChartSeries[]>(
    result
      ? NAMES.map((name, k) => ({
          key: name,
          label: name,
          points: result!.tenors.map((t, i) => ({ x: t.years, y: result!.loadings[k][i] })),
          style: k === 2 ? "dash" : "line",
          color: COLORS[k],
        }))
      : [],
  );
  const pathSeries = $derived<ChartSeries[]>(
    result
      ? (["level", "slope", "curvature"] as const).map((name, k) => ({
          key: name,
          label: NAMES[k],
          points: result!.moves.days.map((d, i) => ({ x: decimalYear(d), y: result!.moves[name][i] })),
          style: k === 2 ? "dash" : "line",
          color: COLORS[k],
        }))
      : [],
  );
  const bars = $derived(
    result
      ? [
          ...NAMES.map((name, k) => ({ label: name, share: result!.explained[k], color: COLORS[k] })),
          { label: "The rest", share: result.explainedRest, color: "var(--muted)" },
        ]
      : [],
  );
  const position = $derived(result?.position && "rows" in result.position ? result.position : null);
  const positionProblem = $derived(result?.position && "problem" in result.position ? result.position.problem : "");

  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  // Whole dollars; anything that rounds to zero is shown as $0, never −$0.
  const money = (v: number) => `${Math.round(v) < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const face = (v: number) => Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 });
  const num = (v: number, digits = 2) => v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const trades = (row: FactorRow) => row.hedges.filter((h) => Math.abs(h.face) >= 1e-4 * hedge.faceAmount);
</script>

<section class="area" aria-label="Curve factors">
  <header class="lede">
    <div class="kicker">Curve factors · {factors.years}-year window ending {stored.day}</div>
    <h1>{result ? `Level explains ${pct(result.explained[0])} of daily curve moves` : "Three shapes explain almost every curve move"}</h1>
    <p class="dek">
      {result
        ? `Over ${result.observations.toLocaleString("en-US")} daily changes from ${result.from} to ${result.day}, level, slope and curvature explain ${pct(result.explainedFirstThree)} of the variance of the Treasury par curve's moves.`
        : "Principal components of daily changes in Treasury par yields: what moves the curve, and what that does to your bond."}
    </p>
  </header>

  <div class="inputs">
    <div class="cell">
      <span class="k">Window</span>
      <span class="seg" role="group" aria-label="Window length">
        {#each FACTOR_YEARS as years (years)}
          <button type="button" aria-pressed={factors.years === years} onclick={() => (factors.years = years)}>{years}y</button>
        {/each}
      </span>
    </div>
    <label class="cell">
      <span class="k">Hedge with</span>
      <select class="field" value={factors.hedgeTenors[0]} onchange={(e) => setTenor(0, e.currentTarget.value)}>
        {#each HEDGE_TENORS as t (t)}<option value={t}>{t}</option>{/each}
      </select>
    </label>
    <label class="cell">
      <span class="k">and</span>
      <select class="field" value={factors.hedgeTenors[1]} onchange={(e) => setTenor(1, e.currentTarget.value)}>
        {#each HEDGE_TENORS as t (t)}<option value={t}>{t}</option>{/each}
      </select>
    </label>
  </div>

  {#if problem}<p class="note bad" role="alert">{problem}</p>{/if}

  {#if result}
    <p class="note">
      {result.tenors.length} maturities: {result.tenors.map((t) => t.tenor).join(", ")}.
      {#each result.dropped as d (d.tenor)}
        <span class="dropped">{d.tenor} left out: not published on {d.firstMissing}.</span>
      {/each}
    </p>

    <div class="grid" class:busy>
      <section class="card">
        <h2 class="section">The three shapes (loadings)</h2>
        <LineChart series={loadingSeries} xLabel="Maturity" xUnit="y" yLabel="loading" yDigits={3} label="Loadings of level, slope and curvature on each maturity" />
        <p class="note">
          A typical day moves level by {num(result.dailySd[0])} bp, slope by {num(result.dailySd[1])} bp and curvature by {num(result.dailySd[2])} bp,
          spread across maturities in these shapes.
        </p>
      </section>
      <section class="card">
        <h2 class="section">Share of daily variance</h2>
        <VarianceBars {bars} />
      </section>
    </div>

    <section class="card wide" class:busy>
      <h2 class="section">How the factors moved</h2>
      <LineChart series={pathSeries} xLabel="Date" xFormat={dateLabel} yLabel="cumulative bp" yDigits={1} label="Cumulative level, slope and curvature moves over the window" />
      <p class="note">
        Running sums of each day's move projected on the shape. Each line ends at the window's net curve move in that factor. The units are
        basis points along a shape, and each shape is a unit vector across the maturities, so a 1 bp rise in every yield adds about √m to level
        (3.2 for ten maturities), not 1.
      </p>
    </section>

    <section class="card wide" class:busy>
      <h2 class="section">Your bond</h2>
      <p class="bond">
        {face(hedge.faceAmount)} face of the {bond.coupon}% {bond.preset === "UST" ? "Treasury" : "corporate"} maturing {bond.maturity}
        <button type="button" class="link" onclick={onprice}>Change on Price a bond</button>
      </p>
      {#if positionProblem}
        <p class="note bad">{positionProblem}</p>
      {:else if position}
        <div class="scroll">
          <table class="num">
            <thead><tr><th>Factor</th><th>Typical day</th><th>Your P&amp;L</th></tr></thead>
            <tbody>
              {#each NAMES as name, k (name)}
                <tr><td>{name}</td><td>{num(result.dailySd[k])} bp</td><td class:neg={position.exposures[k] < 0} class:pos={position.exposures[k] > 0}>{money(position.exposures[k])}</td></tr>
              {/each}
            </tbody>
          </table>
        </div>

        <h2 class="section">Hedging with the {factors.hedgeTenors[0]} and {factors.hedgeTenors[1]}</h2>
        <div class="scroll">
          <table class="num compare">
            <thead><tr><th></th>{#each position.rows as row (row.name)}<th>{ROW_NAMES[row.name]}</th>{/each}</tr></thead>
            <tbody>
              <tr>
                <td>Trades</td>
                {#each position.rows as row (row.name)}
                  <td class="trades">
                    {#each trades(row) as h (h.tenor)}<div>{h.face < 0 ? "Sell" : "Buy"} {face(h.face)} {h.tenor}</div>{:else}<div class="none">None</div>{/each}
                  </td>
                {/each}
              </tr>
              {#each NAMES as name, k (name)}
                <tr><td>{name} left</td>{#each position.rows as row (row.name)}<td>{money(row.exposures[k])}</td>{/each}</tr>
              {/each}
              <tr class="total"><td>Daily risk left</td>{#each position.rows as row (row.name)}<td>{money(row.dailyRisk)}</td>{/each}</tr>
            </tbody>
          </table>
        </div>
        <p class="note">
          Daily risk is the standard deviation of the position's daily P&amp;L, replaying every day of the window through its DV01s. It is measured
          on the same window the factors were fitted on.
        </p>
      {/if}
    </section>

    <details class="work" ontoggle={(e) => e.currentTarget.open && track("work")}>
      <summary><span class="title">Show your work</span> <span class="hint">From daily yield changes to a hedge</span></summary>
      <div class="body">
        <p>
          <b>1. Changes.</b> ΔY holds the daily changes in basis points: {result.observations.toLocaleString("en-US")} daily changes by {result.tenors.length} maturities.
          {#if result.dropped.length > 0}{result.dropped.map((d) => d.tenor).join(", ")} left out because not published every day.{/if}
        </p>
        <p><b>2. Covariance.</b> Centre each column, then <code>S = XᵀX / (N − 1)</code> with N = {result.observations.toLocaleString("en-US")}.</p>
        <p>
          <b>3. Eigen-decomposition.</b> <code>S = V Λ Vᵀ</code>. The largest eigenvalues are
          <code>λ₁ = {num(result.eigenvalues[0])}</code>, <code>λ₂ = {num(result.eigenvalues[1])}</code>, <code>λ₃ = {num(result.eigenvalues[2])}</code> bp², so a
          typical day moves each factor by <code>√λ = {num(result.dailySd[0])}, {num(result.dailySd[1])}, {num(result.dailySd[2])}</code> bp.
          Signs are fixed so level raises every yield, slope steepens and curvature lifts the belly.
        </p>
        {#if position}
          <p>
            <b>4. Exposure.</b> The bond's par-yield DV01 at each maturity (dollars per bp, for the position) times that maturity's level
            loading, scaled by a typical move:
            <code>
              level = −{num(result.dailySd[0])} × ({position.dv01s
                .map((d, i) => `${d.dv01 < 0 ? `(${num(d.dv01, 1)})` : num(d.dv01, 1)}×${num(result!.loadings[0][i], 3)}`)
                .join(" + ")}) = {money(position.exposures[0])}
            </code>
          </p>
          <p>
            <b>5. Level/slope hedge.</b> With each hedge's exposure per 100 face in the columns, solve <code>E·n = −e</code>:
            <code>
              [{num(position.system.matrix[0][0], 4)}, {num(position.system.matrix[0][1], 4)}; {num(position.system.matrix[1][0], 4)}, {num(position.system.matrix[1][1], 4)}] · n =
              −[{num(position.system.target[0], 4)}, {num(position.system.target[1], 4)}]
            </code>
          </p>
        {/if}
        <p class="aside">
          Par-yield DV01s come from shifting each zero-rate pillar by a hundredth of a basis point and solving one small linear system
          (the chain rule through the bootstrap), not from rebuilding the curve once per maturity.
        </p>
      </div>
    </details>
  {/if}
</section>

<style>
  .lede {
    margin: 26px 0 18px;
  }
  .kicker {
    font: 500 11.5px/1.4 var(--mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent);
  }
  h1 {
    font-size: clamp(24px, 3.2vw, 38px);
    font-weight: 500;
    margin: 10px 0 8px;
  }
  .dek {
    color: var(--soft);
    margin: 0;
    max-width: 72ch;
  }
  .inputs {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 16px;
    align-items: flex-end;
  }
  .cell {
    display: grid;
    gap: 5px;
    min-width: 110px;
  }
  .note {
    font-size: 13px;
    color: var(--muted);
    margin: 10px 0;
  }
  .note.bad {
    color: var(--loss);
  }
  .dropped {
    display: inline-block;
    margin-left: 6px;
    color: var(--soft);
  }
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
    gap: 16px;
    margin-top: 12px;
  }
  @media (max-width: 760px) {
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .grid.busy,
  .card.busy {
    opacity: 0.6;
    transition: opacity 0.2s;
  }
  .card {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 14px 16px;
    background: var(--panel);
    min-width: 0;
  }
  .card.wide {
    margin-top: 16px;
  }
  .section {
    font: 500 11px/1.4 var(--mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    margin: 0 0 10px;
  }
  .card .section:not(:first-child) {
    margin-top: 18px;
  }
  .bond {
    margin: 0 0 8px;
    color: var(--soft);
    font-size: 14px;
  }
  .link {
    background: none;
    border: 0;
    padding: 0;
    margin-left: 8px;
    font: inherit;
    color: var(--accent);
    text-decoration: underline;
    cursor: pointer;
  }
  .scroll {
    overflow-x: auto;
    margin: 6px 0 12px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  th {
    text-align: right;
    font: 500 10.5px/1.4 var(--mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
    padding: 0 0 8px 12px;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }
  td {
    text-align: right;
    padding: 7px 0 7px 12px;
    border-bottom: 1px solid var(--grid);
    white-space: nowrap;
  }
  th:first-child,
  td:first-child {
    text-align: left;
    padding-left: 0;
  }
  td.trades {
    vertical-align: top;
  }
  .none {
    color: var(--muted);
  }
  tr.total td {
    font-weight: 600;
    color: var(--ink);
  }
  .work {
    margin-top: 20px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  .work summary {
    padding: 12px 16px;
    cursor: pointer;
    display: flex;
    gap: 12px;
    align-items: baseline;
  }
  .work .title {
    font: 500 11px/1.4 var(--mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .work .hint,
  .aside {
    font-size: 13px;
    color: var(--muted);
  }
  .work .body {
    padding: 0 16px 14px;
    font-size: 14px;
    color: var(--soft);
  }
  code {
    font: 400 12.5px var(--mono);
    color: var(--ink);
    overflow-wrap: anywhere;
  }
</style>
