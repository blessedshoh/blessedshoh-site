<script lang="ts">
  // The fixed income lab: tabs for each area, the day being viewed, and the shareable
  // link. Each area asks the Python API for its numbers; nothing here does bond maths.
  import { onMount, untrack } from "svelte";
  import CurvePanel from "./CurvePanel.svelte";
  import PricePanel from "./PricePanel.svelte";
  import HedgePanel from "./HedgePanel.svelte";
  import BasicsPanel from "./BasicsPanel.svelte";
  import FactorsPanel from "./FactorsPanel.svelte";
  import type { StoredCurve } from "../lib/curve-data.ts";
  import { decodeLab, encodeLab } from "../lib/state.ts";
  import { track } from "../lib/track.ts";
  import type { Area, BasicsInput, BondInput, CurveResponse, FactorsInput, HedgeInput, Scheme } from "../lib/types.ts";

  interface Props {
    initial: StoredCurve | null;
    problem: string;
    flags: Record<string, boolean>;
    banner: string | null;
    apiBase: string;
    today: string;
  }

  let { initial, problem, flags, banner, apiBase, today }: Props = $props();

  const LABELS: Record<Area, string> = { curve: "Today's curve", price: "Price a bond", hedge: "Hedge", factors: "Factors", basics: "Basics" };
  const FLAG: Record<Area, string> = { curve: "curve", price: "price", hedge: "hedge", factors: "factors", basics: "basics" };
  const areas = $derived((Object.keys(LABELS) as Area[]).filter((a) => flags[FLAG[a]] !== false));

  let area = $state<Area>("curve");
  let stored = $state.raw<StoredCurve | null>(untrack(() => initial));
  let scheme = $state<Scheme>("MonotoneConvex");
  let loadingDay = $state(false);
  let dayProblem = $state("");
  let curve = $state.raw<CurveResponse | null>(null);

  const defaultBond: BondInput = { preset: "UST", coupon: 4, maturity: "2036-11-15", mode: "curve", spreadBp: 0 };
  let bond = $state<BondInput>({ ...defaultBond });
  let hedge = $state<HedgeInput>({ faceAmount: 1_000_000, mode: "key-rate", tenors: ["2 Yr", "5 Yr", "10 Yr", "30 Yr"] });
  let basics = $state<BasicsInput | null>(null);
  let factors = $state<FactorsInput>({ years: 5, hedgeTenors: ["2 Yr", "10 Yr"] });
  let live = false;

  async function loadDay(day: string | null) {
    loadingDay = true;
    dayProblem = "";
    try {
      const response = await fetch(day ? `/curve.json?day=${day}` : "/curve.json");
      const body = (await response.json()) as StoredCurve & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `status ${response.status}`);
      stored = body;
      if (day) track("curve_date");
    } catch (error) {
      dayProblem = (error as Error).message;
    } finally {
      loadingDay = false;
    }
  }

  onMount(() => {
    if (location.hash.startsWith("#l=")) {
      const shared = decodeLab(location.hash.slice(3));
      if (shared) {
        track("link_opened");
        area = areas.includes(shared.area) ? shared.area : "curve";
        if (shared.bond) bond = shared.bond;
        if (shared.hedge) hedge = shared.hedge;
        if (shared.basics) basics = shared.basics;
        if (shared.factors) factors = shared.factors;
        if (shared.day && shared.day !== stored?.day) loadDay(shared.day);
      } else history.replaceState(null, "", location.pathname);
    }
    live = true;
  });

  // Keep the address bar in step with what is on screen.
  let linkTimer = 0;
  $effect(() => {
    const encoded = encodeLab({
      area,
      day: stored && stored.day !== initial?.day ? stored.day : null,
      ...(area === "price" || area === "hedge" || area === "factors" ? { bond: $state.snapshot(bond) } : {}),
      ...(area === "hedge" || area === "factors" ? { hedge: $state.snapshot(hedge) } : {}),
      ...(area === "factors" ? { factors: $state.snapshot(factors) as FactorsInput } : {}),
      ...(area === "basics" && basics ? { basics: $state.snapshot(basics) } : {}),
    });
    if (!live) return;
    window.clearTimeout(linkTimer);
    linkTimer = window.setTimeout(() => history.replaceState(null, "", `#l=${encoded}`), 300);
  });

  let copied = $state(false);
  async function copyLink() {
    track("shared");
    try {
      await navigator.clipboard.writeText(location.href);
      copied = true;
      window.setTimeout(() => (copied = false), 1800);
    } catch {
      // The address bar already holds the link.
    }
  }
</script>

<div class="lab wrap">
  {#if banner}<p class="banner">{banner}</p>{/if}

  <nav class="tabs" aria-label="Areas">
    {#each areas as a (a)}
      <button type="button" aria-pressed={area === a} onclick={() => (area = a)}>{LABELS[a]}</button>
    {/each}
    <button type="button" class="btn share" onclick={copyLink}>{copied ? "Link copied" : "Copy link"}</button>
  </nav>

  {#if !stored}
    <p class="problem" role="alert">{problem || "No Treasury data is available yet."}</p>
  {:else}
    {#if dayProblem}<p class="problem" role="alert">{dayProblem}</p>{/if}
    <div hidden={area !== "curve"}>
      <CurvePanel
        {apiBase}
        {stored}
        {scheme}
        {today}
        {loadingDay}
        onday={loadDay}
        onscheme={(s) => (scheme = s)}
        oncurve={(c) => (curve = c)}
      />
    </div>
    {#if area === "price"}
      <PricePanel {apiBase} {stored} {scheme} bind:bond />
    {:else if area === "hedge"}
      <HedgePanel {apiBase} {stored} {scheme} bind:bond bind:hedge />
    {:else if area === "factors"}
      <FactorsPanel {apiBase} {stored} {scheme} {bond} {hedge} bind:factors onprice={() => (area = "price")} />
    {:else if area === "basics"}
      <BasicsPanel {apiBase} bind:basics />
    {/if}
  {/if}

  <p class="caption">
    Prices, yields and risk are computed by <a href="https://github.com/blessedshoh/bondlab">bondlab</a>, a Python fixed income
    library, through the same API as the options tool. Illustrative only, not investment advice.
    <a href="/methodology">How it works</a> · <a href="/limits">Where the model is wrong</a>
  </p>
</div>

<style>
  .lab {
    padding-bottom: 64px;
  }
  .banner {
    margin: 16px 0 0;
    padding: 10px 14px;
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    font-size: 14px;
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 18px;
    border-bottom: 1px solid var(--line);
  }
  .tabs button:not(.btn) {
    font: 500 12px/1 var(--mono);
    letter-spacing: 0.07em;
    text-transform: uppercase;
    padding: 12px 14px;
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }
  .tabs button[aria-pressed="true"] {
    color: var(--ink);
    border-bottom-color: var(--accent);
  }
  .share {
    margin-left: auto;
    align-self: center;
  }
  .problem {
    margin: 18px 0;
    padding: 12px 14px;
    border: 1px solid var(--loss);
    border-radius: var(--radius);
    font-size: 14px;
  }
  .caption {
    margin-top: 30px;
    font: italic 400 14px/1.5 var(--serif);
    color: var(--muted);
    max-width: 78ch;
  }
  .caption a {
    font-style: normal;
    font-family: var(--sans);
    font-size: 13px;
    color: var(--soft);
  }
</style>
