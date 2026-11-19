<script lang="ts">
  // Today's curve: the published par yields draw at once from stored data; zero,
  // forward and par curves arrive from the Python API (bondlab) when it answers.
  import { untrack } from "svelte";
  import CurveChart from "./CurveChart.svelte";
  import { fetchCurve } from "../lib/api.ts";
  import type { StoredCurve } from "../lib/curve-data.ts";
  import { SCHEMES, TENORS, type ChartSeries, type CurveResponse, type Scheme } from "../lib/types.ts";

  interface Props {
    apiBase: string;
    stored: StoredCurve;
    scheme: Scheme;
    today: string;
    loadingDay: boolean;
    onday: (day: string | null) => void;
    onscheme: (scheme: Scheme) => void;
    oncurve?: (curve: CurveResponse) => void;
  }

  let { apiBase, stored, scheme, today, loadingDay, onday, onscheme, oncurve }: Props = $props();

  // Years for placing each published yield on the chart (display only).
  const YEARS: Record<string, number> = {
    "1 Mo": 1 / 12, "1.5 Month": 6 / 52, "2 Mo": 2 / 12, "3 Mo": 0.25, "4 Mo": 4 / 12, "6 Mo": 0.5,
    "1 Yr": 1, "2 Yr": 2, "3 Yr": 3, "5 Yr": 5, "7 Yr": 7, "10 Yr": 10, "20 Yr": 20, "30 Yr": 30,
  };
  const SCHEME_LABELS: Record<Scheme, string> = {
    MonotoneConvex: "Monotone convex",
    LinearOnZeroRate: "Linear in zero rates",
    NaturalCubicSpline: "Natural cubic spline",
  };

  let curve = $state.raw<CurveResponse | null>(null);
  let busy = $state(false);
  let problem = $state("");
  let showZero = $state(true);
  let showForward = $state(true);
  let showNelson = $state(false);
  let controller: AbortController | null = null;

  const published = $derived(
    TENORS.filter((t) => t in stored.yields).map((t) => ({ tenor: t, x: YEARS[t], y: stored.yields[t] })),
  );
  const key = $derived(JSON.stringify([stored.day, stored.yields, scheme]));

  $effect(() => {
    void key;
    untrack(load);
  });

  async function load() {
    controller?.abort();
    const mine = (controller = new AbortController());
    busy = true;
    problem = "";
    try {
      const answer = await fetchCurve(apiBase, { day: stored.day, yields: stored.yields, scheme }, mine.signal);
      if (controller !== mine) return;
      curve = answer;
      oncurve?.(answer);
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      curve = null;
      problem = error instanceof TypeError ? "The pricing server could not be reached; the published yields are shown." : (error as Error).message;
    } finally {
      if (controller === mine) busy = false;
    }
  }

  const series = $derived.by((): ChartSeries[] => {
    const out: ChartSeries[] = [{ key: "published", label: "Published par yields", points: published, style: "points", color: "var(--ink)" }];
    if (curve) {
      out.push({ key: "par", label: "Par curve", points: curve.grid.filter((g) => g.par !== null).map((g) => ({ x: g.years, y: g.par! })), style: "line", color: "var(--accent)" });
      if (showZero) out.push({ key: "zero", label: "Zero (spot)", points: curve.grid.map((g) => ({ x: g.years, y: g.zero })), style: "line", color: "var(--series-2)" });
      if (showForward)
        out.push({ key: "forward", label: "3-month forward", points: curve.grid.filter((g) => g.forward !== null).map((g) => ({ x: g.years, y: g.forward! })), style: "dash", color: "var(--series-3)" });
      if (showNelson)
        out.push({ key: "ns", label: "Nelson-Siegel (continuous zero)", points: curve.nelsonSiegel.grid.map((g) => ({ x: g.years, y: g.zeroContinuous })), style: "dot", color: "var(--muted)" });
    }
    return out;
  });

  const ten = $derived(stored.yields["10 Yr"]);
  const two = $derived(stored.yields["2 Yr"]);
  const slope = $derived(ten !== undefined && two !== undefined ? Math.round((ten - two) * 100) : null);
  const dayText = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const headline = $derived(
    ten !== undefined
      ? `The 10-year Treasury yields ${ten.toFixed(2)}%.`
      : `Treasury par yields for ${dayText(stored.day)}.`,
  );
  const shape = $derived(
    slope === null ? "" : slope > 0 ? `${slope} bp above the 2-year: an upward-sloping curve.` : slope < 0 ? `${-slope} bp below the 2-year: an inverted curve.` : "level with the 2-year: a flat curve.",
  );
</script>

<section class="area" aria-label="Today's curve">
  <header class="lede">
    <div class="kicker">U.S. Treasury par curve · {dayText(stored.day)}{stored.requested && stored.requested !== stored.day ? ` (nearest day with data to ${stored.requested})` : ""}</div>
    <h1>{headline}</h1>
    <p class="dek">{ten !== undefined && slope !== null ? `It sits ${shape}` : ""} Zero and forward rates are bootstrapped from the published yields in Python.</p>
  </header>

  <div class="controls">
    <label class="cell">
      <span class="k">Date</span>
      <input class="field" type="date" min="1990-01-02" max={today} value={stored.day} onchange={(e) => onday(e.currentTarget.value || null)} />
    </label>
    <button type="button" class="btn" onclick={() => onday(null)} disabled={loadingDay}>Latest</button>
    <label class="cell">
      <span class="k">Interpolation</span>
      <select class="field" value={scheme} onchange={(e) => onscheme(e.currentTarget.value as Scheme)}>
        {#each SCHEMES as s (s)}<option value={s}>{SCHEME_LABELS[s]}</option>{/each}
      </select>
    </label>
    <div class="toggles">
      <label><input type="checkbox" bind:checked={showZero} /> Zero</label>
      <label><input type="checkbox" bind:checked={showForward} /> Forward</label>
      <label><input type="checkbox" bind:checked={showNelson} /> Nelson-Siegel</label>
    </div>
  </div>

  <div class="frame">
    <CurveChart {series} busy={loadingDay ? "Loading that day" : busy ? "Bootstrapping in Python" : ""} />
    {#if problem}<p class="note bad" role="alert">{problem}</p>{/if}
    {#if curve && curve.missing.length > 0}
      <p class="note">Not published on this day: {curve.missing.join(", ")}. The curve is built from the maturities that were.</p>
    {/if}
  </div>

  <div class="scroll">
    <table class="num">
      <thead><tr><th>Maturity</th><th>Published par yield</th><th>Zero (semiannual)</th><th>Discount factor</th></tr></thead>
      <tbody>
        {#each published as p (p.tenor)}
          {@const pillar = curve?.pillars.find((q) => q.tenor === p.tenor)}
          <tr>
            <td>{p.tenor}</td>
            <td>{p.y.toFixed(2)}%</td>
            <td>{pillar ? `${pillar.zero.toFixed(4)}%` : "—"}</td>
            <td>{pillar ? pillar.discountFactor.toFixed(6) : "—"}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <details class="work">
    <summary><span class="title">Show your work</span> <span class="hint">How the zero curve comes out of the published yields</span></summary>
    <div class="body">
      <p>
        Maturities of six months or less are bills: one payment, so each published yield (a simple ACT/365 rate) gives its
        discount factor directly, <code>DF = 1 / (1 + y·t)</code>. Every longer maturity is a par note: a semiannual coupon equal
        to its yield, priced at exactly 100. Taking the maturities in order, each note has one unknown, its last discount factor:
      </p>
      <p><code>100 = Σ (c/2)·DF(tᵢ)·100 + 100·DF(T)</code></p>
      <p>
        The discount factors between pillars come from the chosen interpolation ({SCHEME_LABELS[scheme]}), and the solve is
        repeated until every note reprices at 100 to the floating-point floor. Zero rates are read from the discount factors,
        <code>z = 2·(DF^(−1/(2t)) − 1)</code> on a semiannual basis; forwards are ratios of discount factors.
      </p>
      {#if curve}
        <p class="aside">
          Nelson-Siegel fitted to the continuous zero rates: β₀ {curve.nelsonSiegel.beta0.toFixed(3)}%, β₁ {curve.nelsonSiegel.beta1.toFixed(3)}%,
          β₂ {curve.nelsonSiegel.beta2.toFixed(3)}%, decay {curve.nelsonSiegel.decay.toFixed(3)}. It is smooth everywhere but does not pass through
          every published yield; the bootstrapped curve does.
        </p>
      {/if}
    </div>
  </details>

  <p class="attribution">Source: U.S. Department of the Treasury, Daily Treasury Par Yield Curve Rates. Stored daily; the page never waits on treasury.gov.</p>
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
    font-size: clamp(28px, 3.6vw, 42px);
    font-weight: 500;
    margin: 10px 0 8px;
  }
  .dek {
    color: var(--soft);
    margin: 0;
    max-width: 70ch;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 10px 16px;
    margin-bottom: 14px;
  }
  .cell {
    display: grid;
    gap: 5px;
    min-width: 160px;
  }
  .toggles {
    display: flex;
    gap: 14px;
    font-size: 13px;
    color: var(--soft);
    padding-bottom: 8px;
  }
  .toggles input {
    accent-color: var(--accent);
  }
  .frame {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 14px 16px;
    background: var(--panel);
  }
  .note {
    font-size: 13px;
    color: var(--muted);
    margin: 8px 0 0;
  }
  .note.bad {
    color: var(--loss);
  }
  .scroll {
    overflow-x: auto;
    margin-top: 18px;
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
    padding: 0 0 8px 14px;
    border-bottom: 1px solid var(--line);
  }
  td {
    text-align: right;
    padding: 6px 0 6px 14px;
    border-bottom: 1px solid var(--grid);
  }
  th:first-child,
  td:first-child {
    text-align: left;
    padding-left: 0;
  }
  .work {
    margin-top: 22px;
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
  .work .hint {
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
  .aside {
    font-size: 13px;
    color: var(--muted);
  }
  .attribution {
    font-size: 12px;
    color: var(--muted);
    margin-top: 18px;
  }
</style>
