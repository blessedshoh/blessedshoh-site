<script lang="ts">
  // Price a bond off today's curve: price, yield, spread, durations, convexity, DV01 and
  // key-rate durations, with the cashflow table behind the price. All from bondlab.
  import { untrack } from "svelte";
  import KeyRateChart from "./KeyRateChart.svelte";
  import { fetchBond } from "../lib/api.ts";
  import type { StoredCurve } from "../lib/curve-data.ts";
  import { bondRequest, isValidBond } from "../lib/state.ts";
  import { track } from "../lib/track.ts";
  import type { BondInput, BondResponse, Scheme } from "../lib/types.ts";

  interface Props {
    apiBase: string;
    stored: StoredCurve;
    scheme: Scheme;
    bond: BondInput;
  }

  let { apiBase, stored, scheme, bond = $bindable() }: Props = $props();

  let result = $state.raw<BondResponse | null>(null);
  let busy = $state(false);
  let problem = $state("");
  let timer = 0;
  let controller: AbortController | null = null;

  const valid = $derived(isValidBond($state.snapshot(bond) as BondInput));
  const key = $derived(JSON.stringify([stored.day, stored.yields, scheme, $state.snapshot(bond)]));

  $effect(() => {
    void key;
    untrack(() => {
      window.clearTimeout(timer);
      if (!valid) {
        problem = "Check the inputs: coupon 0–20%, a real maturity date, and a spread, yield or price in range.";
        return;
      }
      timer = window.setTimeout(load, 250);
    });
  });

  async function load() {
    controller?.abort();
    const mine = (controller = new AbortController());
    busy = true;
    try {
      const curve = { day: stored.day, yields: stored.yields, scheme };
      result = await fetchBond(apiBase, bondRequest(curve, $state.snapshot(bond) as BondInput), mine.signal);
      problem = "";
      track("priced");
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      problem = error instanceof TypeError ? "The pricing server could not be reached." : (error as Error).message;
    } finally {
      if (controller === mine) busy = false;
    }
  }

  const money = (v: number, digits = 4) => v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const longRates = $derived(
    (result?.keyRates ?? []).filter((k) => !/Mo|Month/.test(k.tenor)).map((k) => ({ tenor: k.tenor, values: [k.dv01] })),
  );
</script>

<section class="area" aria-label="Price a bond">
  <header class="lede">
    <div class="kicker">Price a bond · curve of {stored.day}</div>
    <h1>{result ? `${money(result.cleanPrice, 3)} clean, yielding ${result.yield.toFixed(3)}%` : "Price a bond off today's curve"}</h1>
    <p class="dek">
      {result
        ? `Settles ${result.settlement}. Modified duration ${result.modified.toFixed(2)}: a 1 bp rise in yield costs about ${money(result.dv01, 4)} per 100 face.`
        : "Choose a bond and how to price it: off the Treasury curve plus a spread, from a yield, or from a price."}
    </p>
  </header>

  <div class="inputs">
    <label class="cell">
      <span class="k">Bond</span>
      <select class="field" bind:value={bond.preset}>
        <option value="UST">US Treasury (ACT/ACT, T+1)</option>
        <option value="USD_CORP">USD corporate (30/360, T+2)</option>
      </select>
    </label>
    <label class="cell"><span class="k">Coupon %</span><input class="field" type="number" step="0.125" min="0" max="20" bind:value={bond.coupon} /></label>
    <label class="cell"><span class="k">Maturity</span><input class="field" type="date" bind:value={bond.maturity} /></label>
    <div class="cell">
      <span class="k">Price it</span>
      <span class="seg" role="group" aria-label="Pricing mode">
        <button type="button" aria-pressed={bond.mode === "curve"} onclick={() => (bond.mode = "curve")}>Off the curve</button>
        <button type="button" aria-pressed={bond.mode === "yield"} onclick={() => (bond.mode = "yield")}>From a yield</button>
        <button type="button" aria-pressed={bond.mode === "price"} onclick={() => (bond.mode = "price")}>From a price</button>
      </span>
    </div>
    {#if bond.mode === "curve"}
      <label class="cell"><span class="k">Spread, bp</span><input class="field" type="number" step="5" bind:value={bond.spreadBp} /></label>
    {:else if bond.mode === "yield"}
      <label class="cell"><span class="k">Yield %</span><input class="field" type="number" step="0.01" bind:value={bond.yield} /></label>
    {:else}
      <label class="cell"><span class="k">Clean price</span><input class="field" type="number" step="0.01" bind:value={bond.cleanPrice} /></label>
    {/if}
  </div>

  {#if problem}<p class="note bad" role="alert">{problem}</p>{/if}

  {#if result}
    <dl class="strip" class:busy>
      <div><dt class="k">Clean price</dt><dd class="num">{money(result.cleanPrice)}</dd></div>
      <div><dt class="k">Accrued</dt><dd class="num">{money(result.accrued)}</dd></div>
      <div><dt class="k">Dirty price</dt><dd class="num">{money(result.dirtyPrice)}</dd></div>
      <div><dt class="k">Yield</dt><dd class="num">{result.yield.toFixed(4)}%</dd></div>
      <div><dt class="k">Z-spread</dt><dd class="num">{result.zSpreadBp.toFixed(1)} bp</dd></div>
      <div><dt class="k">Macaulay</dt><dd class="num">{result.macaulay.toFixed(3)}</dd></div>
      <div><dt class="k">Modified</dt><dd class="num">{result.modified.toFixed(3)}</dd></div>
      <div><dt class="k">Convexity</dt><dd class="num">{result.convexity.toFixed(2)}</dd></div>
      <div><dt class="k">DV01 / 100</dt><dd class="num">{money(result.dv01)}</dd></div>
    </dl>

    <section class="card">
      <h2 class="section">Key-rate durations</h2>
      <p class="note">
        How much the price moves for a 1 bp shift at each point of the curve, the rest held still. They add up to roughly the
        parallel DV01; where they sit shows which part of the curve the bond is exposed to.
      </p>
      <KeyRateChart rows={longRates} labels={["DV01 per 100 face"]} unit="price change per 1 bp" />
    </section>

    <details class="work" ontoggle={(e) => e.currentTarget.open && track("work")}>
      <summary><span class="title">Show your work</span> <span class="hint">The cashflows behind the price</span></summary>
      <div class="body">
        <p>
          Each remaining payment is discounted on the curve{bond.mode !== "price" && (bond.spreadBp ?? 0) !== 0 && bond.mode === "curve" ? ` plus ${bond.spreadBp} bp on every semiannual zero rate` : ""},
          back to settlement on {result.settlement}. The present values add up to the dirty price, {money(result.dirtyPrice)};
          less accrued interest of {money(result.accrued)} (coupon earned since {result.issueDate}), that is the clean price.
        </p>
        <div class="scroll">
          <table class="num">
            <thead><tr><th>Pays on</th><th>Years</th><th>Amount</th><th>Discount factor</th><th>Present value</th></tr></thead>
            <tbody>
              {#each result.cashflows as row (row.date)}
                <tr><td>{row.date}</td><td>{row.yearFraction.toFixed(4)}</td><td>{money(row.amount)}</td><td>{row.discountFactor.toFixed(6)}</td><td>{money(row.presentValue)}</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
        <p class="aside">
          Macaulay duration is the present-value-weighted average time of those payments ({result.macaulay.toFixed(3)} years); modified
          duration is the price's percentage sensitivity to its yield ({result.modified.toFixed(3)}); convexity is the curvature of the price
          against yield ({result.convexity.toFixed(2)}), the reason a duration-only estimate misses for large moves.
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
    font-size: clamp(26px, 3.4vw, 40px);
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
    min-width: 140px;
  }
  .note {
    font-size: 13px;
    color: var(--muted);
    margin: 10px 0;
  }
  .note.bad {
    color: var(--loss);
  }
  .strip {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    margin: 20px 0;
    border-top: 1px solid var(--line);
    border-left: 1px solid var(--line);
    transition: opacity 0.2s;
  }
  .strip.busy {
    opacity: 0.6;
  }
  .strip div {
    padding: 10px 12px;
    border-right: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
  }
  .strip dd {
    margin: 4px 0 0;
    font-size: 17px;
  }
  .card {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 14px 16px;
    background: var(--panel);
  }
  .section {
    font: 500 11px/1.4 var(--mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    margin: 0;
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
  .scroll {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }
  th {
    text-align: right;
    font: 500 10.5px/1.4 var(--mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
    padding: 0 0 8px 12px;
    border-bottom: 1px solid var(--line);
  }
  td {
    text-align: right;
    padding: 5px 0 5px 12px;
    border-bottom: 1px solid var(--grid);
  }
  th:first-child,
  td:first-child {
    text-align: left;
    padding-left: 0;
  }
</style>
