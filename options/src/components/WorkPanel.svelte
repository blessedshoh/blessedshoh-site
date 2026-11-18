<script lang="ts">
  // "Show your work": every headline number broken into the steps that make it,
  // with the real values substituted into each formula. The numbers come from the
  // Python API's /options/work route; this component only lays them out.
  import { untrack } from "svelte";
  import { fetchWork } from "../lib/api.ts";
  import { money, percent, strike as formatStrike } from "../lib/format.ts";
  import { clonePosition } from "../lib/state.ts";
  import type { LegWork, Position, WorkResponse } from "../lib/types.ts";

  interface Props {
    apiBase: string;
    /** The position the chart currently shows. */
    position: Position;
    onopen?: () => void;
  }

  let { apiBase, position, onopen }: Props = $props();

  let open = $state(false);
  let work = $state.raw<WorkResponse | null>(null);
  let busy = $state(false);
  let problem = $state("");
  let loadedKey = "";
  let timer = 0;
  let controller: AbortController | null = null;

  const key = $derived(JSON.stringify(clonePosition(position)));

  // Ask only while the panel is open, and again whenever the position changes.
  $effect(() => {
    const current = key;
    if (!open || current === loadedKey) return;
    untrack(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => load(current), work ? 250 : 0);
    });
  });

  async function load(current: string) {
    controller?.abort();
    const mine = (controller = new AbortController());
    busy = true;
    try {
      work = await fetchWork(apiBase, clonePosition(position), mine.signal);
      loadedKey = current;
      problem = "";
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      problem = error instanceof TypeError ? "The pricing server could not be reached." : (error as Error).message;
    } finally {
      if (controller === mine) busy = false;
    }
  }

  function toggled(event: Event) {
    open = (event.currentTarget as HTMLDetailsElement).open;
    if (open) onopen?.();
  }

  // --- formatting ---------------------------------------------------------------

  /** Fixed decimals with a true minus sign, for numbers inside formulas. */
  const n = (x: number, digits = 4) => {
    const text = x.toFixed(digits);
    return Number(text) === 0 ? (0).toFixed(digits) : text.replace("-", "−");
  };
  const grouped = (x: number, digits = 2) =>
    (x < 0 ? "−" : "") + Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const sharesText = (size: number) => `${Math.abs(size).toLocaleString("en-US")} ${Math.abs(size) === 1 ? "share" : "shares"}`;

  function legTitle(leg: LegWork, index: number) {
    const side = leg.quantity > 0 ? "Long" : "Short";
    const count = Math.abs(leg.quantity);
    if (leg.kind === "stock") return `Leg ${index + 1} · ${side} ${count.toLocaleString("en-US")} shares`;
    const noun = count === 1 ? leg.kind : `${leg.kind}s`;
    return `Leg ${index + 1} · ${side} ${count} ${noun}, strike ${formatStrike(leg.strike!)}, ${leg.days} days, vol ${percent(leg.vol!)}`;
  }

  const S = $derived(position.spot);
  const r = $derived(position.rate);
  const q = $derived(position.div_yield);

  const totals = $derived(
    work
      ? {
          cost: work.legs.reduce((sum, leg) => sum + leg.cost, 0),
          delta: work.greeks.delta,
          gamma: work.greeks.gamma,
          theta: work.greeks.theta_per_day,
          vega: work.greeks.vega_per_point,
        }
      : null,
  );
  const weightSum = $derived(work?.chance ? work.chance.vol_weights.reduce((sum, [, , w]) => sum + w, 0) : 0);

  function rangeText(low: number, high: number | null) {
    if (low === 0 && high === null) return "Any price";
    if (low === 0) return `Below ${formatStrike(high!)}`;
    if (high === null) return `Above ${formatStrike(low)}`;
    return `${formatStrike(low)} to ${formatStrike(high)}`;
  }
  const lnOrInf = (x: number | null, low: boolean) => (x === null ? "+∞" : x === 0 && low ? "−∞" : `ln ${formatStrike(x)}`);
</script>

<details class="work" ontoggle={toggled}>
  <summary>
    <span class="title">Show your work</span>
    <span class="hint">How every number above is calculated, with today's values put into each formula</span>
    <span class="status" aria-live="polite">{busy ? "Working" : problem}</span>
  </summary>

  {#if work}
    <div class="body" class:busy>
      <p class="inputs num">
        S = {n(S, 2)} &nbsp;·&nbsp; r = {n(r)} &nbsp;·&nbsp; q = {n(q)} &nbsp;·&nbsp;
        {work.exercise === "american" ? "American exercise" : "European exercise"}
      </p>

      {#each work.legs as leg, i (i)}
        <article class="leg">
          <h3>{legTitle(leg, i)}</h3>
          {#if leg.kind === "stock"}
            <ol class="steps">
              <li>
                <span class="what">Cost</span>
                <code>{leg.size.toLocaleString("en-US")} × {n(leg.entry_price, 2)} = {money(leg.cost, 2)}{leg.cost < 0 ? " received" : ""}</code>
              </li>
              <li><span class="what">Delta</span><code>one per share: {leg.size.toLocaleString("en-US")}. No gamma, theta or vega.</code></li>
            </ol>
          {:else}
            {@const call = leg.kind === "call"}
            {@const sqrtT = Math.sqrt(leg.years!)}
            <ol class="steps">
              <li>
                <span class="what">Time to expiry</span>
                <code>T = {leg.days} / 365 = {n(leg.years!)} years</code>
              </li>
              <li>
                <span class="what">d₁</span>
                <code>[ln(S/K) + (r − q + σ²/2)·T] / (σ√T)</code>
                <code
                  >= [ln({n(S, 2)}/{n(leg.strike!, 2)}) + ({n(r)} − {n(q)} + {n(leg.vol!)}²/2) × {n(leg.years!)}] / ({n(leg.vol!)} × √{n(
                    leg.years!,
                  )}) = <b>{n(leg.d1!)}</b></code
                >
              </li>
              <li>
                <span class="what">d₂</span>
                <code>d₁ − σ√T = {n(leg.d1!)} − {n(leg.vol! * sqrtT)} = <b>{n(leg.d2!)}</b></code>
              </li>
              <li>
                <span class="what">Normal probabilities</span>
                <code
                  >{call ? "N(d₁)" : "N(−d₁)"} = {n(leg.n_d1!)} &nbsp;·&nbsp; {call ? "N(d₂)" : "N(−d₂)"} = {n(leg.n_d2!)}</code
                >
                <span class="aside"
                  >{call ? "N(d₂)" : "N(−d₂)"} is the risk-neutral chance this {leg.kind} finishes in the money.</span
                >
              </li>
              <li>
                <span class="what">Black-Scholes price</span>
                {#if call}
                  <code>S·e<sup>−qT</sup>·N(d₁) − K·e<sup>−rT</sup>·N(d₂)</code>
                  <code
                    >= {n(S, 2)} × {n(leg.spot_discount!)} × {n(leg.n_d1!)} − {n(leg.strike!, 2)} × {n(leg.strike_discount!)} × {n(
                      leg.n_d2!,
                    )} = <b>{n(leg.european_price!)}</b> per share</code
                  >
                {:else}
                  <code>K·e<sup>−rT</sup>·N(−d₂) − S·e<sup>−qT</sup>·N(−d₁)</code>
                  <code
                    >= {n(leg.strike!, 2)} × {n(leg.strike_discount!)} × {n(leg.n_d2!)} − {n(S, 2)} × {n(leg.spot_discount!)} × {n(
                      leg.n_d1!,
                    )} = <b>{n(leg.european_price!)}</b> per share</code
                  >
                {/if}
              </li>
              {#if leg.american_price != null}
                <li>
                  <span class="what">American value</span>
                  <code
                    >binomial tree with early exercise = <b>{n(leg.american_price)}</b>; early-exercise premium = {n(leg.american_price)} − {n(
                      leg.european_price!,
                    )} = {n(leg.american_price - leg.european_price!)}</code
                  >
                  <span class="aside">The tree, not the formula above, sets this leg's value and Greeks.</span>
                </li>
              {/if}
              <li>
                <span class="what">Cost</span>
                <code
                  >{leg.quantity} × 100 = {leg.size.toLocaleString("en-US")} shares × {n(leg.entry_price)} = {grouped(leg.cost)}</code
                >
                <span class="aside"
                  >{leg.entry_price_stated ? "Uses the price you entered." : "Uses the model price today."}
                  {leg.cost < 0 ? "Negative: money received." : ""}</span
                >
              </li>
              <li>
                <span class="what">Greeks per share</span>
                <code
                  >Δ {n(leg.greeks.delta)} &nbsp;·&nbsp; Γ {n(leg.greeks.gamma, 5)} &nbsp;·&nbsp; Θ {n(leg.greeks.theta_per_day)}/day &nbsp;·&nbsp;
                  vega {n(leg.greeks.vega_per_point)}/pt</code
                >
                <span class="aside"
                  >{leg.american_price != null
                    ? "Measured by nudging each input and repricing the tree."
                    : "Δ = ±e^(−qT)·N(±d₁), Γ = e^(−qT)·φ(d₁)/(Sσ√T), vega = S·e^(−qT)·φ(d₁)·√T / 100, Θ per year / 365."}
                  Times {sharesText(leg.size)} gives the leg's share of the position below.</span
                >
              </li>
            </ol>
          {/if}
        </article>
      {/each}

      {#if totals}
        <div class="scroll">
          <table class="num">
            <thead>
              <tr><th>Leg</th><th>Cost</th><th>Delta</th><th>Gamma</th><th>Theta / day</th><th>Vega / pt</th></tr>
            </thead>
            <tbody>
              {#each work.legs as leg, i (i)}
                <tr>
                  <td>{i + 1} · {leg.quantity > 0 ? "long" : "short"} {leg.kind}</td>
                  <td>{grouped(leg.cost)}</td>
                  <td>{grouped(leg.contribution.delta)}</td>
                  <td>{grouped(leg.contribution.gamma, 3)}</td>
                  <td>{grouped(leg.contribution.theta_per_day)}</td>
                  <td>{grouped(leg.contribution.vega_per_point)}</td>
                </tr>
              {/each}
            </tbody>
            <tfoot>
              <tr>
                <td>Position</td>
                <td>{grouped(totals.cost)}</td>
                <td>{grouped(totals.delta)}</td>
                <td>{grouped(totals.gamma, 3)}</td>
                <td>{grouped(totals.theta)}</td>
                <td>{grouped(totals.vega)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p class="aside">
          Each column is a plain sum: a position's Greeks are its legs' Greeks times their sizes, added up. The total cost
          is the net {totals.cost >= 0 ? "debit" : "credit"} at the top of the page; the totals are today's Greeks.
        </p>
      {/if}

      {#if work.chance}
        {@const c = work.chance}
        <article class="leg">
          <h3>Chance of profit at expiry · {percent(c.chance)}</h3>
          <ol class="steps">
            <li>
              <span class="what">One volatility</span>
              <code>σ = Σ wᵢσᵢ / Σ wᵢ, with wᵢ = |size| × vega</code>
              {#if c.vol_weights.length > 1}
                <code
                  >= ({c.vol_weights.map(([, v, w]) => `${grouped(w, 0)} × ${n(v)}`).join(" + ")}) / {grouped(weightSum, 0)} = <b
                    >{n(c.vol)}</b
                  ></code
                >
              {:else}
                <code>one option leg, so σ = <b>{n(c.vol)}</b></code>
              {/if}
            </li>
            <li>
              <span class="what">Price at expiry</span>
              <code>ln S<sub>T</sub> ~ Normal(m, s²), m = ln S + (r − q − σ²/2)·T, s = σ√T</code>
              <code
                >m = ln {n(S, 2)} + ({n(r)} − {n(q)} − {n(c.vol)}²/2) × {n(c.days / 365)} = <b>{n(c.mean_log)}</b> &nbsp;·&nbsp; s =
                {n(c.vol)} × √{n(c.days / 365)} = <b>{n(c.sd_log)}</b></code
              >
              <span class="aside">Risk-neutral: the stock is assumed to grow at the interest rate, as option prices imply.</span>
            </li>
            <li>
              <span class="what">Cut at the break-evens</span>
              <code>P(a &lt; S<sub>T</sub> &lt; b) = N((ln b − m)/s) − N((ln a − m)/s)</code>
            </li>
          </ol>
          <div class="scroll">
            <table class="num">
              <thead><tr><th>Price at expiry</th><th>Result</th><th>Calculation</th><th>Chance</th></tr></thead>
              <tbody>
                {#each c.intervals as piece, i (i)}
                  <tr class:win={piece.profitable}>
                    <td>{rangeText(piece.low, piece.high)}</td>
                    <td>{piece.profitable ? "Profit" : "Loss"}</td>
                    <td class="calc">N(({lnOrInf(piece.high, false)} − m)/s) − N(({lnOrInf(piece.low, true)} − m)/s)</td>
                    <td>{percent(piece.probability)}</td>
                  </tr>
                {/each}
              </tbody>
              <tfoot>
                <tr><td colspan="3">Chance of profit: the profitable rows added up</td><td>{percent(c.chance)}</td></tr>
              </tfoot>
            </table>
          </div>
          <p class="aside">
            The break-evens themselves are found by scanning the expiry payoff over a wide range of prices and refining each
            change of sign with Brent's root-finding method. The same scan gives the maximum profit and loss.
            <a href="/methodology">Methodology</a> · <a href="/limits">Where this model is wrong</a>
          </p>
        </article>
      {/if}
    </div>
  {:else if problem}
    <p class="aside pad">{problem}</p>
  {:else}
    <p class="aside pad">Working it out…</p>
  {/if}
</details>

<style>
  .work {
    margin-top: 30px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
  }
  summary {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 14px;
    padding: 14px 18px;
    cursor: pointer;
    list-style: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary::before {
    content: "+";
    font: 500 15px/1 var(--mono);
    color: var(--accent);
    width: 12px;
  }
  .work[open] summary::before {
    content: "−";
  }
  .title {
    font: 500 11px/1.4 var(--mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink);
  }
  .hint {
    font-size: 13px;
    color: var(--muted);
  }
  .status {
    margin-left: auto;
    font: 400 12px var(--mono);
    color: var(--accent);
  }
  .body {
    padding: 4px 18px 18px;
    border-top: 1px solid var(--line);
    transition: opacity 0.2s;
  }
  .body.busy {
    opacity: 0.6;
  }
  .inputs {
    margin: 14px 0 4px;
    font-size: 12.5px;
    color: var(--muted);
  }
  .leg {
    margin-top: 18px;
  }
  h3 {
    font: 500 13px/1.4 var(--mono);
    color: var(--accent);
    letter-spacing: 0;
    margin-bottom: 8px;
  }
  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .steps li {
    display: grid;
    grid-template-columns: 170px minmax(0, 1fr);
    column-gap: 16px;
    padding: 7px 0;
    border-bottom: 1px dashed var(--grid);
  }
  .steps li > :not(.what) {
    grid-column: 2;
  }
  .what {
    font-size: 13px;
    color: var(--soft);
    grid-row: span 3;
  }
  code {
    font: 400 12.5px/1.6 var(--mono);
    font-variant-numeric: tabular-nums;
    color: var(--ink);
    overflow-wrap: anywhere;
  }
  code b {
    font-weight: 600;
    color: var(--accent);
  }
  .aside {
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--muted);
    margin: 2px 0 0;
  }
  .aside a {
    color: var(--soft);
  }
  .pad {
    padding: 0 18px 16px;
  }
  .scroll {
    overflow-x: auto;
    margin-top: 16px;
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
    padding: 0 0 8px 14px;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }
  td {
    text-align: right;
    padding: 7px 0 7px 14px;
    border-bottom: 1px solid var(--grid);
    white-space: nowrap;
  }
  th:first-child,
  td:first-child,
  td.calc {
    text-align: left;
    padding-left: 0;
  }
  td.calc {
    padding-left: 14px;
    color: var(--muted);
  }
  tfoot td {
    border-bottom: 0;
    border-top: 1px solid var(--line);
    color: var(--ink);
    font-weight: 600;
  }
  tr.win td:nth-child(2) {
    color: var(--profit);
  }
  @media (max-width: 700px) {
    .steps li {
      grid-template-columns: minmax(0, 1fr);
    }
    .steps li > :not(.what) {
      grid-column: 1;
    }
    .what {
      grid-row: auto;
      font-weight: 500;
    }
    .hint {
      display: none;
    }
  }
</style>
