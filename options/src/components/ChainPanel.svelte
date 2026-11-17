<script lang="ts">
  // The option chain and arbitrage checker. A model chain on an editable smile,
  // or prices typed in by hand, checked live by the Python API.
  import { onMount, untrack } from "svelte";
  import { fetchArbitrage, fetchChain } from "../lib/api.ts";
  import { money, price as formatPrice, strike as formatStrike } from "../lib/format.ts";
  import type { ArbitrageResponse, ChainRow, Leg, Position, Quote, TradeLeg } from "../lib/types.ts";

  interface Props {
    apiBase: string;
    /** The position being edited: its price, rate and dividend set the market. */
    position: Position;
    onload: (legs: Leg[]) => void;
    onadd: (leg: Leg) => void;
  }

  let { apiBase, position, onload, onadd }: Props = $props();

  const firstOption = untrack(() => position.legs.find((leg) => leg.kind !== "stock"));
  let days = $state(untrack(() => firstOption?.days ?? 30));
  let atmVol = $state(untrack(() => Math.round((firstOption?.vol ?? 0.45) * 100)));
  let skew = $state(0);
  let curvature = $state(0);
  let spreadPct = $state(2);
  let mode = $state<"model" | "edit">("model");

  let rows = $state.raw<ChainRow[]>([]);
  let edited = $state<{ strike: number; call_bid: string; call_ask: string; put_bid: string; put_ask: string }[]>([]);
  let report = $state.raw<ArbitrageResponse | null>(null);
  let busy = $state(false);
  let problem = $state("");
  let loadedNote = $state("");

  const american = $derived(position.exercise === "american");
  const market = $derived({ spot: position.spot, days, rate: position.rate, div_yield: position.div_yield });
  const smile = $derived({ atm_vol: atmVol / 100, skew, curvature });
  const chainKey = $derived(JSON.stringify([market, smile]));

  const cents = (value: number) => Math.round(value * 100) / 100;
  function modelQuote(row: ChainRow): Quote {
    const side = (mid: number) => {
      const half = Math.max((mid * spreadPct) / 200, 0.005);
      return [cents(Math.max(mid - half, 0)), cents(mid + half)];
    };
    const [call_bid, call_ask] = side(row.call);
    const [put_bid, put_ask] = side(row.put);
    return { strike: row.strike, call_bid, call_ask, put_bid, put_ask };
  }
  const parse = (text: string) => (text.trim() === "" || !Number.isFinite(Number(text)) || Number(text) < 0 ? null : Number(text));

  /** Quotes as checked. A typed pair with the bid above the ask is left out and flagged. */
  const quotes = $derived.by<Quote[]>(() => {
    if (mode === "model") return rows.map(modelQuote);
    return edited.map((row) => {
      const pair = (bid: string, ask: string) => {
        const b = parse(bid);
        const a = parse(ask);
        return b !== null && a !== null && b > a ? [null, null] : [b, a];
      };
      const [call_bid, call_ask] = pair(row.call_bid, row.call_ask);
      const [put_bid, put_ask] = pair(row.put_bid, row.put_ask);
      return { strike: row.strike, call_bid, call_ask, put_bid, put_ask };
    });
  });
  const quotesKey = $derived(JSON.stringify([quotes, market, american]));
  const badPair = (bid: string, ask: string) => {
    const b = parse(bid);
    const a = parse(ask);
    return b !== null && a !== null && b > a;
  };

  // --- fetching -------------------------------------------------------------------

  let live = false;
  let chainTimer = 0;
  let checkTimer = 0;
  let chainController: AbortController | null = null;
  let checkController: AbortController | null = null;
  let lastChain = "";
  let lastCheck = "";

  $effect(() => {
    const key = chainKey;
    if (!live || key === lastChain) return;
    untrack(() => {
      window.clearTimeout(chainTimer);
      chainTimer = window.setTimeout(() => loadChain(key), 200);
    });
  });

  $effect(() => {
    const key = quotesKey;
    if (!live || key === lastCheck || quotes.length === 0) return;
    untrack(() => {
      window.clearTimeout(checkTimer);
      checkTimer = window.setTimeout(() => runCheck(key), 250);
    });
  });

  async function loadChain(key: string) {
    if (!(days > 0) || !(atmVol > 0)) return;
    chainController?.abort();
    const mine = (chainController = new AbortController());
    busy = true;
    try {
      const result = await fetchChain(apiBase, market, smile, mine.signal);
      rows = result.rows;
      lastChain = key;
      problem = "";
    } catch (error) {
      if ((error as Error).name !== "AbortError") problem = "The chain could not be priced.";
    } finally {
      if (mine === chainController) busy = false;
    }
  }

  async function runCheck(key: string) {
    checkController?.abort();
    const mine = (checkController = new AbortController());
    busy = true;
    try {
      report = await fetchArbitrage(apiBase, { ...market, american }, quotes, mine.signal);
      lastCheck = key;
      problem = "";
    } catch (error) {
      if ((error as Error).name !== "AbortError") problem = (error as Error).message || "The check could not run.";
    } finally {
      if (mine === checkController) busy = false;
    }
  }

  onMount(() => {
    live = true;
    loadChain(chainKey);
    return () => {
      window.clearTimeout(chainTimer);
      window.clearTimeout(checkTimer);
      chainController?.abort();
      checkController?.abort();
    };
  });

  // --- actions --------------------------------------------------------------------

  function startEditing() {
    edited = rows.map((row) => {
      const q = modelQuote(row);
      const text = (value: number | null) => (value === null ? "" : value.toFixed(2));
      return { strike: row.strike, call_bid: text(q.call_bid), call_ask: text(q.call_ask), put_bid: text(q.put_bid), put_ask: text(q.put_ask) };
    });
    mode = "edit";
  }

  function breakSmile() {
    mode = "model";
    skew = -0.2;
    curvature = -25;
  }

  function resetSmile() {
    skew = 0;
    curvature = 0;
  }

  const volAt = (strike: number) => rows.find((row) => row.strike === strike)?.vol ?? atmVol / 100;

  function addLeg(kind: "call" | "put", strike: number, side: 1 | -1, price: number | null) {
    if (price === null) return;
    onadd({ kind, quantity: side, strike, days, vol: volAt(strike), entry_price: price });
  }

  const tradable = (trade: TradeLeg[]) => trade.filter((leg) => leg.kind !== "cash");
  const cashLent = (trade: TradeLeg[]) => trade.filter((leg) => leg.kind === "cash").reduce((sum, leg) => sum + leg.quantity, 0);

  function loadTrade(trade: TradeLeg[]) {
    const legs: Leg[] = tradable(trade).map((leg) =>
      leg.kind === "stock"
        ? { kind: "stock", quantity: Math.round(leg.quantity * 100 * 100) / 100, entry_price: position.spot }
        : {
            kind: leg.kind as "call" | "put",
            quantity: Math.round(leg.quantity * 100) / 100,
            strike: leg.strike!,
            days,
            vol: volAt(leg.strike!),
            entry_price: leg.price,
          },
    );
    if (legs.length === 0 || legs.length > 8) return;
    onload(legs);
    const cash = cashLent(trade) * 100;
    loadedNote =
      Math.abs(cash) > 0.005
        ? `Loaded, one contract per unit. The trade also ${cash > 0 ? "lends" : "borrows"} ${money(Math.abs(cash), 2)} today, which the chart leaves out, so its profit there can sit slightly off.`
        : "Loaded at the quoted prices, one contract per unit.";
  }

  // --- display --------------------------------------------------------------------

  const flagged = $derived(new Set(report?.violations.flatMap((v) => v.strikes) ?? []));
  const nearest = $derived(rows.length ? rows.reduce((a, b) => (Math.abs(b.strike - position.spot) < Math.abs(a.strike - position.spot) ? b : a)).strike : null);
  const describe = (leg: TradeLeg) => {
    const verb = leg.quantity > 0 ? "Buy" : "Sell";
    const amount = Math.abs(leg.quantity);
    const n = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
    if (leg.kind === "cash") return `${leg.quantity > 0 ? "Lend" : "Borrow"} ${money(Math.abs(leg.quantity), 2)}`;
    if (leg.kind === "stock") return `${verb} ${n} share${amount === 1 ? "" : "s"} at ${formatPrice(leg.price)}`;
    return `${verb} ${n} × ${formatStrike(leg.strike!)} ${leg.kind} at ${formatPrice(leg.price)}`;
  };

  // Smile chart
  const SW = 720;
  const SH = 130;
  const sm = { l: 44, r: 12, t: 12, b: 24 };
  const vRange = $derived.by(() => {
    if (!rows.length) return [0, 1];
    const vols = rows.map((row) => row.vol);
    const lo = Math.min(...vols);
    const hi = Math.max(...vols);
    const pad = Math.max((hi - lo) * 0.2, 0.02);
    return [Math.max(0, lo - pad), hi + pad];
  });
  const sx = (strike: number) => sm.l + ((strike - rows[0].strike) / Math.max(rows[rows.length - 1].strike - rows[0].strike, 1)) * (SW - sm.l - sm.r);
  const sy = (vol: number) => sm.t + ((vRange[1] - vol) / (vRange[1] - vRange[0])) * (SH - sm.t - sm.b);
  const smilePath = $derived(rows.length ? rows.map((row, i) => `${i ? "L" : "M"}${sx(row.strike).toFixed(1)} ${sy(row.vol).toFixed(1)}`).join("") : "");
</script>

<section class="chain-panel" aria-label="Option chain and arbitrage checker">
  <div class="head">
    <h2 class="section">Option chain and arbitrage</h2>
    <span class="status" aria-live="polite">{busy ? "Checking" : problem}</span>
  </div>

  <div class="card">
    <div class="controls">
      <label class="ctl">
        <span class="k">Expiry (days)</span>
        <input class="field" type="number" min="1" max="1825" step="1" bind:value={days} />
      </label>
      <label class="ctl">
        <span class="ctop"><span class="k">Volatility at the money</span><span class="num">{atmVol}%</span></span>
        <input type="range" min="5" max="150" step="1" bind:value={atmVol} disabled={mode === "edit"} style="--fill: {((atmVol - 5) / 145) * 100}%" />
      </label>
      <label class="ctl">
        <span class="ctop"><span class="k">Skew</span><span class="num">{skew.toFixed(2)}</span></span>
        <input type="range" min="-2" max="1" step="0.05" bind:value={skew} disabled={mode === "edit"} style="--fill: {((skew + 2) / 3) * 100}%" />
      </label>
      <label class="ctl">
        <span class="ctop"><span class="k">Curvature</span><span class="num">{curvature.toFixed(1)}</span></span>
        <input type="range" min="-30" max="10" step="0.5" bind:value={curvature} disabled={mode === "edit"} style="--fill: {((curvature + 30) / 40) * 100}%" />
      </label>
      <label class="ctl">
        <span class="ctop"><span class="k">Bid-ask spread</span><span class="num">{spreadPct}%</span></span>
        <input type="range" min="0.5" max="10" step="0.5" bind:value={spreadPct} disabled={mode === "edit"} style="--fill: {((spreadPct - 0.5) / 9.5) * 100}%" />
      </label>
    </div>
    <div class="actions">
      <span class="seg" role="group" aria-label="Where prices come from">
        <button type="button" aria-pressed={mode === "model"} onclick={() => (mode = "model")}>Model prices</button>
        <button type="button" aria-pressed={mode === "edit"} onclick={startEditing}>Edit prices</button>
      </span>
      <button type="button" class="btn" onclick={breakSmile}>Break the smile</button>
      <button type="button" class="btn" onclick={resetSmile} disabled={skew === 0 && curvature === 0}>Flatten</button>
    </div>

    {#if rows.length}
      <svg class="smile" viewBox="0 0 {SW} {SH}" role="img" aria-label="Volatility smile by strike">
        {#each [vRange[0], (vRange[0] + vRange[1]) / 2, vRange[1]] as v, i (i)}
          <line class="grid" x1={sm.l} x2={SW - sm.r} y1={sy(v)} y2={sy(v)} />
          <text class="axis" x={sm.l - 6} y={sy(v) + 4} text-anchor="end">{Math.round(v * 100)}%</text>
        {/each}
        {#if nearest !== null}
          <line class="spot" x1={sx(position.spot)} x2={sx(position.spot)} y1={sm.t} y2={SH - sm.b} />
        {/if}
        <path class="curve" d={smilePath} />
        {#each rows as row (row.strike)}
          <circle class="dot" class:flag={flagged.has(row.strike)} cx={sx(row.strike)} cy={sy(row.vol)} r={flagged.has(row.strike) ? 4 : 2.5} />
        {/each}
        {#each [rows[0], rows[Math.floor(rows.length / 2)], rows[rows.length - 1]] as row (row.strike)}
          <text class="axis" x={sx(row.strike)} y={SH - 6} text-anchor="middle">{formatStrike(row.strike)}</text>
        {/each}
      </svg>
    {/if}

    <div class="split">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th colspan="2" class="side">Calls</th>
              <th rowspan="2" class="mid">Strike</th>
              <th colspan="2" class="side">Puts</th>
            </tr>
            <tr>
              <th>Bid</th>
              <th>Ask</th>
              <th>Bid</th>
              <th>Ask</th>
            </tr>
          </thead>
          <tbody>
            {#if mode === "model"}
              {#each quotes as q, i (q.strike)}
                <tr class:flag={flagged.has(q.strike)} class:atm={q.strike === nearest}>
                  <td><button type="button" class="px" title="Sell the {formatStrike(q.strike)} call at the bid" onclick={() => addLeg("call", q.strike, -1, q.call_bid)}>{q.call_bid?.toFixed(2)}</button></td>
                  <td><button type="button" class="px" title="Buy the {formatStrike(q.strike)} call at the ask" onclick={() => addLeg("call", q.strike, 1, q.call_ask)}>{q.call_ask?.toFixed(2)}</button></td>
                  <th class="mid num">{formatStrike(q.strike)}<span class="vol">{rows[i] ? `${(rows[i].vol * 100).toFixed(1)}%` : ""}</span></th>
                  <td><button type="button" class="px" title="Sell the {formatStrike(q.strike)} put at the bid" onclick={() => addLeg("put", q.strike, -1, q.put_bid)}>{q.put_bid?.toFixed(2)}</button></td>
                  <td><button type="button" class="px" title="Buy the {formatStrike(q.strike)} put at the ask" onclick={() => addLeg("put", q.strike, 1, q.put_ask)}>{q.put_ask?.toFixed(2)}</button></td>
                </tr>
              {/each}
            {:else}
              {#each edited as row (row.strike)}
                <tr class:flag={flagged.has(row.strike)} class:atm={row.strike === nearest}>
                  <td><input class="cell" class:bad={badPair(row.call_bid, row.call_ask)} inputmode="decimal" aria-label="{row.strike} call bid" bind:value={row.call_bid} /></td>
                  <td><input class="cell" class:bad={badPair(row.call_bid, row.call_ask)} inputmode="decimal" aria-label="{row.strike} call ask" bind:value={row.call_ask} /></td>
                  <th class="mid num">{formatStrike(row.strike)}</th>
                  <td><input class="cell" class:bad={badPair(row.put_bid, row.put_ask)} inputmode="decimal" aria-label="{row.strike} put bid" bind:value={row.put_bid} /></td>
                  <td><input class="cell" class:bad={badPair(row.put_bid, row.put_ask)} inputmode="decimal" aria-label="{row.strike} put ask" bind:value={row.put_ask} /></td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
        <p class="hint">
          {mode === "model"
            ? "Click a bid to sell or an ask to buy: the leg joins your position at that price."
            : "Type real quotes. A bid above its ask is shown in red and left out of the check."}
        </p>
      </div>

      <div class="results">
        {#if report}
          {#if report.violations.length === 0 && !report.solver?.arbitrage}
            <div class="clean">
              <div class="k">No arbitrage</div>
              <p>
                Every rule holds at these bids and asks{report.solver ? ", and the solver's best never-losing portfolio pays nothing today" : ""}.
                Try <b>Break the smile</b>, or edit a price.
              </p>
            </div>
          {:else}
            <div class="k found">{report.violations.length} rule {report.violations.length === 1 ? "violation" : "violations"}</div>
            <ol class="list">
              {#each report.violations as v, i (i)}
                <li>
                  <div class="title">{v.title}</div>
                  <p class="detail">{v.detail}</p>
                  <div class="row">
                    <span class="num gain">+{money(v.profit, 2)} a share · +{money(v.profit * 100, 0)} a contract</span>
                    <button type="button" class="btn" onclick={() => loadTrade(v.trade)} disabled={tradable(v.trade).length > 8}>Load this trade</button>
                  </div>
                  <ul class="legs">
                    {#each v.trade as leg, j (j)}<li>{describe(leg)}</li>{/each}
                  </ul>
                </li>
              {/each}
            </ol>
          {/if}

          {#if report.solver?.arbitrage}
            <div class="solver">
              <div class="k">The solver</div>
              <p>
                The best never-losing portfolio from these quotes pays you <b class="num">{money(report.solver.credit, 2)}</b> a share today.
                {report.violations.length === 0 ? "None of the separate rules caught it." : ""}
              </p>
              <ul class="legs">
                {#each report.solver.trade as leg, j (j)}<li>{describe(leg)}</li>{/each}
              </ul>
              <button type="button" class="btn" onclick={() => loadTrade(report!.solver!.trade)} disabled={tradable(report.solver.trade).length > 8}>
                Load this trade
              </button>
            </div>
          {/if}

          {#if loadedNote}<p class="loaded">{loadedNote}</p>{/if}

          <details class="assumptions">
            <summary>Assumptions</summary>
            <ul>{#each report.assumptions as line, i (i)}<li>{line}</li>{/each}</ul>
          </details>
        {:else}
          <p class="hint">Checking the chain…</p>
        {/if}
      </div>
    </div>
  </div>
</section>

<style>
  .chain-panel {
    margin-top: 30px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
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
    min-width: 0;
  }
  .controls {
    display: grid;
    grid-template-columns: 120px repeat(4, minmax(0, 1fr));
    gap: 16px;
    align-items: end;
  }
  .ctl {
    display: grid;
    gap: 5px;
    min-width: 0;
  }
  .ctop {
    display: flex;
    justify-content: space-between;
    font-size: 13px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin: 14px 0 6px;
  }
  .smile {
    display: block;
    width: 100%;
    height: auto;
    margin: 8px 0 4px;
  }
  .smile .grid {
    stroke: var(--grid);
  }
  .smile .axis {
    fill: var(--muted);
    font: 400 11px var(--mono);
  }
  .smile .spot {
    stroke: var(--muted);
    stroke-dasharray: 2 3;
  }
  .smile .curve {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
  }
  .smile .dot {
    fill: var(--bg);
    stroke: var(--accent);
    stroke-width: 1.5;
  }
  .smile .dot.flag {
    fill: var(--loss);
    stroke: var(--loss);
  }
  .split {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
    gap: 20px;
    margin-top: 10px;
  }
  .table-wrap {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font: 400 12.5px var(--mono);
    font-variant-numeric: tabular-nums;
  }
  th {
    font-weight: 400;
    color: var(--muted);
    padding: 4px 6px;
    text-align: center;
  }
  thead th.side {
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-size: 11px;
  }
  td {
    padding: 1px 2px;
    text-align: center;
    border-top: 1px dotted var(--line);
  }
  th.mid {
    color: var(--ink);
    border-top: 1px dotted var(--line);
    background: var(--panel);
    white-space: nowrap;
  }
  thead th.mid {
    background: transparent;
    border-top: 0;
    color: var(--muted);
  }
  .vol {
    display: block;
    font-size: 10.5px;
    color: var(--muted);
  }
  tr.atm th.mid {
    color: var(--accent);
  }
  tr.flag td,
  tr.flag th.mid {
    background: color-mix(in srgb, var(--loss) 12%, transparent);
  }
  .px {
    font: inherit;
    color: var(--ink);
    background: none;
    border: 1px solid transparent;
    border-radius: 3px;
    padding: 5px 6px;
    width: 100%;
    cursor: pointer;
  }
  .px:hover {
    border-color: var(--accent);
  }
  .cell {
    font: inherit;
    width: 100%;
    min-width: 56px;
    text-align: center;
    color: var(--ink);
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 3px;
    padding: 5px 4px;
  }
  .cell.bad {
    border-color: var(--loss);
    color: var(--loss);
  }
  .hint {
    margin: 8px 0 0;
    font-size: 12.5px;
    color: var(--muted);
  }
  .results {
    min-width: 0;
  }
  .clean p,
  .solver p {
    margin: 4px 0 8px;
    font-size: 14px;
    color: var(--soft);
  }
  .clean b,
  .solver b {
    color: var(--ink);
    font-weight: 500;
  }
  .found {
    color: var(--loss);
  }
  .list {
    margin: 6px 0 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 12px;
    max-height: 460px;
    overflow-y: auto;
  }
  .list > li {
    border: 1px solid var(--line);
    border-left: 3px solid var(--loss);
    border-radius: 0;
    padding: 10px 12px;
  }
  .title {
    font-weight: 500;
    font-size: 14px;
  }
  .detail {
    margin: 4px 0 8px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--soft);
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .gain {
    color: var(--profit);
    font-size: 13px;
  }
  .legs {
    margin: 8px 0 0;
    padding-left: 18px;
    font: 400 12px/1.6 var(--mono);
    color: var(--soft);
  }
  .solver {
    margin-top: 14px;
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    padding: 12px 14px;
  }
  .solver .btn {
    margin-top: 10px;
  }
  .loaded {
    margin: 12px 0 0;
    font-size: 13px;
    color: var(--accent);
  }
  .assumptions {
    margin-top: 14px;
    font-size: 12.5px;
    color: var(--muted);
  }
  .assumptions summary {
    cursor: pointer;
    font: 500 11px var(--mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .assumptions ul {
    margin: 6px 0 0;
    padding-left: 18px;
    line-height: 1.5;
  }

  @media (max-width: 860px) {
    .controls {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .split {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
