<script lang="ts">
  // Hedge the bond from "Price a bond" with on-the-run Treasuries off the same curve:
  // one bond against its DV01, or up to four against its key-rate DV01s. All from bondlab.
  import { untrack } from "svelte";
  import KeyRateChart from "./KeyRateChart.svelte";
  import { fetchHedge } from "../lib/api.ts";
  import type { StoredCurve } from "../lib/curve-data.ts";
  import { fitHedgeToDay, hedgeRequest, isValidBond, isValidHedge } from "../lib/state.ts";
  import { track } from "../lib/track.ts";
  import { HEDGE_TENORS, type BondInput, type HedgeInput, type HedgeResponse, type Scheme } from "../lib/types.ts";

  interface Props {
    apiBase: string;
    stored: StoredCurve;
    scheme: Scheme;
    bond: BondInput;
    hedge: HedgeInput;
  }

  let { apiBase, stored, scheme, bond = $bindable(), hedge = $bindable() }: Props = $props();

  let result = $state.raw<HedgeResponse | null>(null);
  /** The position face the shown result was computed for, so the headline never mixes inputs. */
  let resultFace = $state(0);
  let busy = $state(false);
  let problem = $state("");
  let timer = 0;
  let controller: AbortController | null = null;

  const available = $derived(HEDGE_TENORS.filter((t) => t in stored.yields));
  const valid = $derived(isValidBond($state.snapshot(bond) as BondInput) && isValidHedge($state.snapshot(hedge) as HedgeInput));
  const key = $derived(JSON.stringify([stored.day, stored.yields, scheme, bond.preset, bond.coupon, bond.maturity, $state.snapshot(hedge)]));

  function toggle(tenor: string) {
    if (hedge.mode === "dv01") {
      hedge.tenors = [tenor];
      return;
    }
    const has = hedge.tenors.includes(tenor);
    if (has && hedge.tenors.length > 1) hedge.tenors = hedge.tenors.filter((t) => t !== tenor);
    else if (!has && hedge.tenors.length < 4) hedge.tenors = [...hedge.tenors, tenor].sort((a, b) => HEDGE_TENORS.indexOf(a as never) - HEDGE_TENORS.indexOf(b as never));
  }

  function setMode(mode: HedgeInput["mode"]) {
    hedge.mode = mode;
    if (mode === "dv01") hedge.tenors = [hedge.tenors.includes("10 Yr") ? "10 Yr" : (hedge.tenors[0] ?? "10 Yr")];
  }

  // A day without some maturity (no 30-year from 2002 to 2006) drops it from the hedge.
  $effect(() => {
    const fitted = fitHedgeToDay($state.snapshot(hedge) as HedgeInput, available);
    if (fitted.tenors.length !== hedge.tenors.length) untrack(() => (hedge.tenors = fitted.tenors));
  });

  $effect(() => {
    void key;
    untrack(() => {
      window.clearTimeout(timer);
      if (!valid) {
        result = null;
        problem =
          hedge.mode === "dv01" ? "A DV01 hedge uses one Treasury; pick one maturity." : "A key-rate hedge uses one to four distinct maturities.";
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
      const curveInput = { day: stored.day, yields: stored.yields, scheme };
      const sent = $state.snapshot(hedge) as HedgeInput;
      result = await fetchHedge(apiBase, hedgeRequest(curveInput, $state.snapshot(bond) as BondInput, sent), mine.signal);
      resultFace = sent.faceAmount;
      problem = "";
      track("hedged");
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      result = null;
      problem = error instanceof TypeError ? "The pricing server could not be reached." : (error as Error).message;
    } finally {
      if (controller === mine) busy = false;
    }
  }

  const amount = (v: number) => Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 });
  // A hedge under a hundredth of a percent of the position is no trade at all (e.g. a 30-year
  // hedge against a 10-year bond, which has no 30-year exposure).
  const trades = (h: HedgeResponse["hedges"][number]) => Math.abs(h.face) >= 1e-4 * resultFace;
  const material = $derived((result?.hedges ?? []).filter(trades));
  const rows = $derived(
    (result?.keyRates ?? []).filter((k) => !/Mo|Month/.test(k.tenor)).map((k) => ({ tenor: k.tenor, values: [k.before, k.after] })),
  );
  const leftover = $derived.by(() => {
    if (!result) return "";
    const remaining = result.keyRates.filter((k) => !hedge.tenors.includes(k.tenor) && Math.abs(k.after) > 0.005 * Math.abs(result!.positionDv01));
    if (hedge.mode === "dv01") return "A DV01 hedge zeroes the total but not the shape: risk moves between maturities, as the after bars show.";
    return remaining.length === 0
      ? "Every pillar is now close to flat."
      : `Still exposed at ${remaining.map((k) => k.tenor).join(", ")}: those pillars were not hedged.`;
  });
</script>

<section class="area" aria-label="Hedge">
  <header class="lede">
    <div class="kicker">Hedge · {bond.coupon}% {bond.preset === "UST" ? "Treasury" : "corporate"} maturing {bond.maturity}</div>
    <h1>
      {result && material.length > 0
        ? `Hedge ${amount(resultFace)} face with ${material.map((h) => `${h.face < 0 ? "a short" : "a long"} ${h.tenor}`).join(", ")}`
        : "Hedge the bond's rate risk"}
    </h1>
    <p class="dek">
      {result
        ? `Position DV01 ${result.positionDv01.toLocaleString("en-US", { maximumFractionDigits: 2 })} per bp; after the hedge, ${result.netDv01.toLocaleString("en-US", { maximumFractionDigits: 2 })}.`
        : "The position is the bond from Price a bond. Hedges are on-the-run Treasuries at par, priced off the same curve."}
    </p>
  </header>

  <div class="inputs">
    <label class="cell"><span class="k">Position face</span><input class="field" type="number" step="100000" min="1" bind:value={hedge.faceAmount} /></label>
    <div class="cell">
      <span class="k">Hedge</span>
      <span class="seg" role="group" aria-label="Hedge type">
        <button type="button" aria-pressed={hedge.mode === "dv01"} onclick={() => setMode("dv01")}>DV01, one bond</button>
        <button type="button" aria-pressed={hedge.mode === "key-rate"} onclick={() => setMode("key-rate")}>Key rates, up to four</button>
      </span>
    </div>
  </div>
  <div class="chips" role="group" aria-label="Hedge maturities">
    {#each available as tenor (tenor)}
      <button type="button" class="chip" aria-pressed={hedge.tenors.includes(tenor)} onclick={() => toggle(tenor)}>{tenor}</button>
    {/each}
  </div>

  {#if problem}<p class="note bad" role="alert">{problem}</p>{/if}

  {#if result}
    <div class="scroll" class:busy>
      <table class="num">
        <thead><tr><th>Hedge</th><th>Coupon</th><th>Matures</th><th>Trade (face)</th></tr></thead>
        <tbody>
          {#each result.hedges as h (h.tenor)}
            <tr><td>{h.tenor} Treasury</td><td>{h.coupon.toFixed(3)}%</td><td>{h.maturity}</td>{#if trades(h)}<td class:neg={h.face < 0} class:pos={h.face > 0}>{h.face < 0 ? "Sell" : "Buy"} {amount(h.face)}</td>{:else}<td class="none">No trade: no exposure there</td>{/if}</tr>
          {/each}
        </tbody>
      </table>
    </div>
    <section class="card">
      <h2 class="section">Key-rate DV01, before and after</h2>
      <KeyRateChart {rows} labels={["Position", "Hedged"]} unit="value change per 1 bp" />
      <p class="note">{leftover}</p>
    </section>
    <details class="work" ontoggle={(e) => e.currentTarget.open && track("work")}>
      <summary><span class="title">Show your work</span> <span class="hint">How the hedge amounts are found</span></summary>
      <div class="body">
        {#if hedge.mode === "dv01"}
          <p>One bond: hold <code>n = −DV01(position) / DV01(hedge)</code> of the hedge, so a parallel 1 bp move leaves the total unchanged.</p>
        {:else}
          <p>
            One hedge per chosen pillar. With <code>A[t][h]</code> the DV01 of hedge <code>h</code> when only pillar <code>t</code> moves 1 bp, and
            <code>b[t]</code> the position's, solve <code>A·n = −b</code>: the hedged position then has zero DV01 at every chosen pillar.
            Pillars not chosen keep whatever risk is left, shown by the hedged bars.
          </p>
        {/if}
        <p class="aside">Key-rate DV01s come from bumping one pillar of the bootstrapped curve at a time and repricing, the rest of the curve held still.</p>
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
    min-width: 160px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 12px;
  }
  .chip {
    font: 500 12px/1 var(--mono);
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }
  .chip[aria-pressed="true"] {
    border-color: var(--accent);
    color: var(--ink);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .note {
    font-size: 13px;
    color: var(--muted);
    margin: 10px 0;
  }
  .note.bad {
    color: var(--loss);
  }
  .scroll {
    overflow-x: auto;
    margin: 18px 0;
    transition: opacity 0.2s;
  }
  .scroll.busy {
    opacity: 0.6;
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
  }
  td {
    text-align: right;
    padding: 7px 0 7px 12px;
    border-bottom: 1px solid var(--grid);
  }
  th:first-child,
  td:first-child {
    text-align: left;
    padding-left: 0;
  }
  td:not(:first-child) {
    white-space: nowrap;
  }
  td.none {
    color: var(--muted);
    white-space: normal;
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
    margin: 0 0 10px;
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
  }
</style>
