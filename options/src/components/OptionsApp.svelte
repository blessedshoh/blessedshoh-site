<script lang="ts">
  // The options tool. It owns the position being edited, asks the pricing server
  // for a grid whenever the numbers could change, and reads everything on screen
  // from that grid. Nothing here does any option maths.
  import { onMount, untrack } from "svelte";
  import { fetchGrid } from "../lib/api.ts";
  import { dateLabel, daysText, decaySentence, headline, kicker } from "../lib/describe.ts";
  import { money, price as formatPrice, signedMoney, signedNumber } from "../lib/format.ts";
  import { sliceAt, tableAt, toCube, valueAt } from "../lib/grid.ts";
  import { cleanLeg, clonePosition, decodeState, encodeState, isValidPosition } from "../lib/state.ts";
  import { dragStep } from "../lib/templates.ts";
  import type { ExplainResponse, GridResponse, Position, RiskResponse, Settings } from "../lib/types.ts";
  import LegsEditor from "./LegsEditor.svelte";
  import PayoffChart from "./PayoffChart.svelte";
  import RiskPanel from "./RiskPanel.svelte";
  import ChainPanel from "./ChainPanel.svelte";
  import TreeExplorer from "./TreeExplorer.svelte";

  interface Props {
    settings: Settings;
    /** A two-date version of the default example, shipped inside the page for an instant first view. */
    first: GridResponse;
    /** The default example's risk numbers, also shipped inside the page. */
    firstRisk: { risk: RiskResponse; explain: ExplainResponse };
    apiBase: string;
  }

  let { settings, first, firstRisk, apiBase }: Props = $props();
  let distribution = $state.raw<RiskResponse["distribution"]>(null);

  /** Everything that changes the numbers. The label does not, so it is left out. */
  const pricingKey = (value: Position, range: number) =>
    JSON.stringify([value.spot, value.rate, value.div_yield, value.legs.map(cleanLeg), value.exercise ?? "european", range]);

  const startPosition = untrack(() => clonePosition(settings.default_position));
  const startRange = untrack(() => settings.default_range_pct);
  const startKey = pricingKey(startPosition, startRange);

  // What the visitor is editing.
  let position = $state<Position>(clonePosition(startPosition));
  let rangePct = $state(startRange);
  /** The range slider's value while it is being dragged, before it is committed. */
  let rangeDraft = $state<number | null>(null);

  // What is on screen: the last grid that came back, and the position it belongs to.
  let grid = $state.raw<GridResponse>(untrack(() => first));
  let priced = $state.raw<Position>(startPosition);
  let pricedKey = $state(startKey);
  /** False while only the two-date first view is loaded. The sliders need the full grid. */
  let full = $state(false);

  let status = $state<"ready" | "loading" | "slow" | "error">("ready");
  let problem = $state("");
  let elapsed = $state(0);
  let volScale = $state(1);
  let playing = $state(false);
  let copied = $state(false);
  /** Shown for copying by hand when the browser refuses clipboard access. */
  let shareUrl = $state("");

  const key = $derived(pricingKey(position, rangePct));
  const cube = $derived(toCube(grid));
  const summary = $derived(grid.summary);
  const lastDay = $derived(cube.days[cube.nD - 1]);
  const hasExpiry = $derived(lastDay > 0);
  const hasOptions = $derived(priced.legs.some((leg) => leg.kind !== "stock"));
  const day = $derived(Math.min(elapsed, lastDay));
  const atExpiry = $derived(hasExpiry && lastDay - day <= lastDay * 1e-6);

  const curve = $derived(sliceAt(cube, day, volScale));
  const todayCurve = $derived(sliceAt(cube, 0, volScale));
  const expiryCurve = $derived(sliceAt(cube, lastDay, 1));
  const unchanged = $derived(valueAt(cube.prices, curve, priced.spot));
  const greeks = $derived({
    delta: tableAt(cube, grid.greeks.delta, day, volScale),
    gamma: tableAt(cube, grid.greeks.gamma, day, volScale),
    theta: tableAt(cube, grid.greeks.theta_per_day, day, volScale),
    vega: tableAt(cube, grid.greeks.vega_per_point, day, volScale),
  });

  const label = $derived(dateLabel(day, lastDay));
  const curveName = $derived(atExpiry ? "expiry" : day <= lastDay * 1e-6 ? "today" : `in ${daysText(day)}`);
  const kickerText = $derived(kicker(priced, summary, position.label));
  const headlineText = $derived(
    headline(priced, summary, (at) => valueAt(cube.prices, expiryCurve, at), cube.prices[0], cube.prices[cube.nP - 1]),
  );
  const dekText = $derived(decaySentence(greeks.theta, lastDay - day, hasOptions));

  const vols = $derived([...new Set(priced.legs.filter((leg) => leg.kind !== "stock").map((leg) => leg.vol!))]);
  const volText = $derived(
    vols.length === 1 ? `${(vols[0] * volScale * 100).toFixed(1)}%` : `×${volScale.toFixed(2)}`,
  );
  const volLow = $derived(Math.log(cube.vols[0]));
  const volHigh = $derived(Math.log(cube.vols[cube.nV - 1]));
  const canSlide = $derived(full && hasExpiry);
  const canShiftVol = $derived(full && hasExpiry && cube.nV > 1);
  const shownRange = $derived(rangeDraft ?? Math.round(rangePct * 100));

  const upToDate = $derived(status === "ready" && key === pricedKey);
  const entryPrices = $derived(upToDate ? summary.legs.map((leg) => leg.entry_price) : null);
  const stale = $derived(status === "slow" || status === "error" || (!full && key !== pricedKey));
  const busy = $derived(
    status === "slow"
      ? position.exercise === "american"
        ? "Building American trees"
        : "Waking the pricing server"
      : status === "loading"
        ? "Pricing"
        : status === "error"
          ? "Not updated"
          : "",
  );
  const breakevenText = $derived(
    summary.breakevens.length === 0 ? "None" : summary.breakevens.map((point) => formatPrice(point)).join(" / "),
  );

  // --- talking to the pricing server -------------------------------------------

  let live = false;
  let requestedKey = startKey;
  let priceTimer = 0;
  let shareTimer = 0;
  let ticket = 0;
  let frame = 0;
  let autoplayed = false;
  let controller: AbortController | null = null;

  // Whenever the numbers could change, ask for fresh ones after a short pause.
  $effect(() => {
    const current = key;
    if (!live || current === requestedKey) return;
    requestedKey = current;
    untrack(() => {
      stopPlaying();
      window.clearTimeout(priceTimer);
      priceTimer = window.setTimeout(load, 220);
    });
  });

  // Keep the address bar in step with the screen, so it can be shared as it is.
  $effect(() => {
    const encoded = encodeState(position, rangePct);
    if (!live) return;
    untrack(() => {
      window.clearTimeout(shareTimer);
      shareTimer = window.setTimeout(() => history.replaceState(null, "", `#p=${encoded}`), 300);
    });
  });

  async function load() {
    const snapshot = clonePosition(position);
    const range = rangePct;
    if (!isValidPosition(snapshot)) return;

    controller?.abort();
    controller = new AbortController();
    const mine = ++ticket;
    status = "loading";
    const slow = window.setTimeout(() => {
      if (mine === ticket && status === "loading") status = "slow";
    }, 1200);

    try {
      const result = await fetchGrid(apiBase, snapshot, range, controller.signal);
      if (mine !== ticket) return;
      grid = result;
      priced = snapshot;
      pricedKey = pricingKey(snapshot, range);
      full = true;
      status = "ready";
      problem = "";
      elapsed = Math.min(elapsed, result.axes.days[result.axes.days.length - 1]);
    } catch (error) {
      if (mine !== ticket || (error as Error).name === "AbortError") return;
      status = "error";
      problem = error instanceof TypeError ? "The pricing server could not be reached." : (error as Error).message;
    } finally {
      window.clearTimeout(slow);
    }
  }

  /** The default example's full grid is a stored file, so the first view never needs the server. */
  async function loadStoredDefault() {
    try {
      const response = await fetch("/default-grid.json");
      if (!response.ok) throw new Error("missing");
      const stored = (await response.json()) as GridResponse;
      if (ticket === 0 && key === pricedKey) {
        grid = stored;
        full = true;
        autoplayOnce();
      }
    } catch {
      if (ticket === 0) load();
    }
  }

  /** On a first visit, run time decay once so the chart shows what it can do. */
  function autoplayOnce() {
    if (autoplayed || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    autoplayed = true;
    window.setTimeout(() => {
      if (!playing && elapsed === 0 && volScale === 1 && key === pricedKey) play();
    }, 800);
  }

  onMount(() => {
    const fromLink = location.hash.startsWith("#p=");
    const shared = fromLink ? decodeState(location.hash.slice(3)) : null;
    live = true;
    if (shared) {
      position = shared.position;
      rangePct = shared.rangePct;
      requestedKey = pricingKey(shared.position, shared.rangePct);
      load();
    } else {
      // A damaged link is dropped rather than left in the address bar.
      if (fromLink) history.replaceState(null, "", location.pathname);
      loadStoredDefault();
    }
    return () => {
      window.clearTimeout(priceTimer);
      window.clearTimeout(shareTimer);
      cancelAnimationFrame(frame);
      controller?.abort();
    };
  });

  // --- controls -----------------------------------------------------------------

  function stopPlaying() {
    cancelAnimationFrame(frame);
    playing = false;
  }

  /** Run the date from today to expiry and back, so time decay can be watched. */
  function play() {
    if (!canSlide) return;
    stopPlaying();
    playing = true;
    const started = performance.now();
    const run = 2600;
    const hold = 500;
    const total = lastDay;
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const step = (now: number) => {
      const t = now - started;
      if (t >= 2 * run + hold) {
        elapsed = 0;
        playing = false;
        return;
      }
      elapsed = t < run ? ease(t / run) * total : t < run + hold ? total : (1 - ease((t - run - hold) / run)) * total;
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  }

  function onDate(event: Event) {
    stopPlaying();
    elapsed = Number((event.currentTarget as HTMLInputElement).value);
  }

  function onVol(event: Event) {
    stopPlaying();
    const value = Number((event.currentTarget as HTMLInputElement).value);
    // A small dead zone makes "unchanged" easy to land on.
    volScale = Math.abs(value) < 0.02 ? 1 : Math.exp(value);
  }

  function commitRange(event: Event) {
    rangePct = Number((event.currentTarget as HTMLInputElement).value) / 100;
    rangeDraft = null;
  }

  function resetView() {
    stopPlaying();
    elapsed = 0;
    volScale = 1;
  }

  function resetPosition() {
    stopPlaying();
    position = clonePosition(settings.default_position);
    rangePct = settings.default_range_pct;
    elapsed = 0;
    volScale = 1;
  }

  function moveStrike(indices: number[], strike: number) {
    for (const index of indices) {
      position.legs[index].strike = strike;
      delete position.legs[index].entry_price;
    }
  }

  async function copyLink() {
    const url = `${location.origin}${location.pathname}#p=${encodeState(position, rangePct)}`;
    history.replaceState(null, "", url);
    try {
      await navigator.clipboard.writeText(url);
      shareUrl = "";
      copied = true;
      window.setTimeout(() => (copied = false), 1800);
    } catch {
      shareUrl = url;
    }
  }

  const fill = (value: number, low: number, high: number) =>
    `${high > low ? (((value - low) / (high - low)) * 100).toFixed(1) : 0}%`;
</script>

<div class="tool wrap">
  {#if settings.banner}
    <p class="banner">{settings.banner}</p>
  {/if}

  <header class="lede">
    <div class="kicker">{kickerText}</div>
    <h1>{headlineText}</h1>
    <p class="dek">{dekText}</p>
  </header>

  <section class="frame" aria-label="Profit and loss">
    <dl class="strip">
      <div class="cell">
        <dt class="k">{summary.entry_cost >= 0 ? "Net debit" : "Net credit"}</dt>
        <dd class="num">{money(summary.entry_cost)}</dd>
      </div>
      <div class="cell">
        <dt class="k">Max profit</dt>
        <dd class="num">{summary.max_profit == null ? "Unlimited" : signedMoney(summary.max_profit)}</dd>
      </div>
      <div class="cell">
        <dt class="k">{summary.max_loss != null && summary.max_loss >= 0 ? "Worst case" : "Max loss"}</dt>
        <dd class="num" class:neg={summary.max_loss == null || summary.max_loss < -0.5} class:pos={summary.max_loss != null && summary.max_loss > 0.5}>
          {summary.max_loss == null ? "Unlimited" : signedMoney(summary.max_loss)}
        </dd>
      </div>
      <div class="cell">
        <dt class="k">P/L if price unchanged</dt>
        <dd class="num" class:pos={unchanged > 0.5} class:neg={unchanged < -0.5}>{signedMoney(unchanged)}</dd>
      </div>
      <div class="cell">
        <dt class="k">Break-even at expiry</dt>
        <dd class="num">{breakevenText}</dd>
      </div>
    </dl>

    <div class="body">
      <PayoffChart
        prices={cube.prices}
        {curve}
        expiry={expiryCurve}
        today={todayCurve}
        spot={priced.spot}
        breakevens={summary.breakevens}
        legs={position.legs}
        {label}
        {curveName}
        {atExpiry}
        {busy}
        {stale}
        step={dragStep(position.spot)}
        onstrike={moveStrike}
        density={settings.flags.risk ? distribution : null}
      />
      <aside class="greeks" aria-label="Position Greeks">
        <div class="k">Position Greeks</div>
        <dl>
          <div><dt>Delta</dt><dd class="num">{signedNumber(greeks.delta, 0)}</dd></div>
          <div><dt>Gamma</dt><dd class="num">{signedNumber(greeks.gamma, 1)}</dd></div>
          <div><dt>Theta $/day</dt><dd class="num">{signedNumber(greeks.theta, 0)}</dd></div>
          <div><dt>Vega $/point</dt><dd class="num">{signedNumber(greeks.vega, 0)}</dd></div>
        </dl>
        <p class="hint">At the price now, on the selected date and volatility.</p>
      </aside>
    </div>

    <div class="controls">
      <label class="control">
        <span class="top"><span class="k">Date</span><span class="num value">{label}</span></span>
        <input
          type="range"
          min="0"
          max={lastDay}
          step={lastDay > 0 ? lastDay / 400 : 1}
          value={day}
          disabled={!canSlide}
          style="--fill: {fill(day, 0, lastDay)}"
          oninput={onDate}
        />
      </label>
      <label class="control">
        <span class="top"><span class="k">Volatility</span><span class="num value">{volText}</span></span>
        <input
          type="range"
          min={volLow}
          max={volHigh}
          step="0.005"
          value={Math.log(volScale)}
          disabled={!canShiftVol}
          style="--fill: {fill(Math.log(volScale), volLow, volHigh)}"
          oninput={onVol}
        />
      </label>
      <label class="control">
        <span class="top"><span class="k">Price range</span><span class="num value">&plusmn;{shownRange}%</span></span>
        <input
          type="range"
          min="5"
          max="60"
          step="1"
          value={shownRange}
          style="--fill: {fill(shownRange, 5, 60)}"
          oninput={(event) => (rangeDraft = Number(event.currentTarget.value))}
          onchange={commitRange}
        />
      </label>
    </div>

    <div class="actions">
      <button type="button" class="btn" onclick={playing ? stopPlaying : play} disabled={!canSlide}>
        {playing ? "Stop" : "Play time decay"}
      </button>
      <button type="button" class="btn" onclick={resetView} disabled={elapsed === 0 && volScale === 1}>Reset view</button>
      <button type="button" class="btn solid share" onclick={copyLink}>{copied ? "Link copied" : "Copy link"}</button>
    </div>
    {#if shareUrl}
      <div class="manual">
        <span class="k">Copy this link</span>
        <input class="field" readonly value={shareUrl} onfocus={(event) => event.currentTarget.select()} />
      </div>
    {/if}
  </section>

  {#if status === "error"}
    <p class="problem" role="alert">
      {problem} The chart shows the last position that was priced.
      <button type="button" class="btn" onclick={load}>Try again</button>
    </p>
  {/if}

  {#if settings.flags.risk}
    <RiskPanel
      {apiBase}
      position={priced}
      {rangePct}
      defaults={settings.risk_defaults}
      initial={pricedKey === startKey && rangePct === startRange ? firstRisk : null}
      bind:distribution
    />
  {/if}

  {#if settings.flags.chain}
    <ChainPanel
      {apiBase}
      {position}
      onload={(legs) => (position.legs = legs)}
      onadd={(leg) => {
        if (position.legs.length < 8) position.legs.push(leg);
      }}
    />
  {/if}

  {#if settings.flags.binomial}
    <TreeExplorer {apiBase} position={priced} />
  {/if}

  <h2 class="section">Position</h2>
  <LegsEditor bind:position {entryPrices} onreset={resetPosition} />

  <p class="caption">
    European options valued with the Black-Scholes model, using the volatility and interest rate entered above. The
    numbers are illustrative and are not investment advice.
  </p>
</div>

<style>
  .tool {
    padding-bottom: 64px;
  }
  .banner {
    margin: 16px 0 0;
    padding: 10px 14px;
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    color: var(--soft);
    font-size: 14.5px;
  }
  .lede {
    padding: 30px 0 22px;
  }
  .kicker {
    font: 600 11.5px/1.4 var(--mono);
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--accent);
  }
  h1 {
    font-size: clamp(25px, 3.4vw, 35px);
    margin: 9px 0 8px;
    max-width: 30ch;
  }
  .dek {
    margin: 0;
    color: var(--soft);
    max-width: 62ch;
  }
  .frame {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    overflow: hidden;
  }

  /* Key numbers. A 1px gap over a line-coloured background draws the dividers. */
  .strip {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 1px;
    margin: 0;
    background: var(--line);
    border-bottom: 1px solid var(--line);
  }
  .cell {
    background: var(--panel);
    padding: 11px 16px 12px;
    min-width: 0;
  }
  dt,
  dd {
    margin: 0;
  }
  .cell dd {
    font-size: 18px;
    line-height: 1.35;
    margin-top: 2px;
    overflow-wrap: anywhere;
  }

  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 218px;
  }
  .greeks {
    border-left: 1px solid var(--line);
    padding: 14px 16px;
  }
  .greeks dl {
    margin: 6px 0 0;
  }
  .greeks dl div {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px dotted var(--line);
    font: 400 13px/1.4 var(--mono);
  }
  .greeks dt {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--soft);
  }
  .hint {
    margin: 12px 0 0;
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--muted);
  }

  .controls {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1px;
    background: var(--line);
    border-top: 1px solid var(--line);
  }
  .control {
    display: grid;
    gap: 2px;
    background: var(--panel);
    padding: 10px 16px 8px;
    min-width: 0;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
  }
  .value {
    font-size: 13px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    padding: 12px 16px;
    border-top: 1px solid var(--line);
  }
  .share {
    margin-left: auto;
  }
  .manual {
    display: grid;
    gap: 6px;
    padding: 0 16px 14px;
  }

  .problem {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px 14px;
    margin: 14px 0 0;
    padding: 10px 14px;
    border: 1px solid var(--loss);
    border-radius: var(--radius);
    font-size: 14.5px;
  }
  .section {
    font: 500 11px/1.4 var(--mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    margin: 30px 0 10px;
  }
  .caption {
    margin: 18px 0 0;
    max-width: 78ch;
    font: italic 400 14px/1.5 var(--serif);
    color: var(--muted);
  }

  @media (max-width: 860px) {
    .strip {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .cell:last-child {
      grid-column: 1 / -1;
    }
    .body {
      grid-template-columns: minmax(0, 1fr);
    }
    .greeks {
      border-left: 0;
      border-top: 1px solid var(--line);
    }
    .greeks dl {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0 22px;
    }
    .controls {
      grid-template-columns: minmax(0, 1fr);
    }
    .share {
      margin-left: 0;
    }
  }
</style>
