<script lang="ts">
  // The coursework models: each opens on my workbook's inputs, so its first numbers are the
  // workbook's. Change any input and the model reruns in bondlab through the API.
  import { untrack, type Component } from "svelte";
  import DEFAULTS from "../data/basics-defaults.json";
  import { fetchBasics } from "../lib/api.ts";
  import { basicsProblem, basicsRequest, MODELS, readPath, type Inputs } from "../lib/basics.ts";
  import { track } from "../lib/track.ts";
  import type { BasicsInput, BasicsModel } from "../lib/types.ts";
  import BootstrapModel from "./basics/BootstrapModel.svelte";
  import ConvertibleModel from "./basics/ConvertibleModel.svelte";
  import CouponModel from "./basics/CouponModel.svelte";
  import DurationModel from "./basics/DurationModel.svelte";
  import MaturityModel from "./basics/MaturityModel.svelte";
  import PriceModel from "./basics/PriceModel.svelte";
  import RateTreeModel from "./basics/RateTreeModel.svelte";
  import TangentModel from "./basics/TangentModel.svelte";
  import TimePathModel from "./basics/TimePathModel.svelte";
  import YieldChangeModel from "./basics/YieldChangeModel.svelte";

  interface Props {
    apiBase: string;
    basics: BasicsInput | null;
  }
  let { apiBase, basics = $bindable() }: Props = $props();

  interface Candidate {
    label: string;
    inputs: Inputs;
    workbook: { field: string; value: number; cell: string; note?: string; tolerance?: number }[];
  }
  type Entry = Candidate & { presets?: Candidate[] };
  const DATA = DEFAULTS as unknown as Record<BasicsModel, Entry>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const VIEWS: Record<BasicsModel, Component<any>> = {
    price: PriceModel,
    coupon: CouponModel,
    maturity: MaturityModel,
    "time-path": TimePathModel,
    "yield-change": YieldChangeModel,
    duration: DurationModel,
    tangent: TangentModel,
    bootstrap: BootstrapModel,
    "rate-tree": RateTreeModel,
    convertible: ConvertibleModel,
  };
  const GROUPS: [string, BasicsModel[]][] = [
    ["Price and yield", ["price", "coupon", "maturity", "time-path", "yield-change"]],
    ["Rate risk", ["duration", "tangent"]],
    ["Curves", ["bootstrap"]],
    ["Trees", ["rate-tree", "convertible"]],
  ];
  const BLURBS: Record<BasicsModel, string> = {
    price: "A fixed-coupon bond's price is the present value of its coupons and face at its yield.",
    coupon: "Two bonds that differ only in coupon: how each price responds to the yield.",
    maturity: "Two bonds that differ only in maturity: the longer one swings more.",
    "time-path": "With the yield held still, premium and discount bonds both pull to par as they age.",
    "yield-change": "What happens to the price path when the yield moves partway through the bond's life.",
    duration: "Macaulay and modified duration, convexity and DV01, and how they change with the yield.",
    tangent: "Duration is the tangent to the price curve; convexity is the bend it misses. How wrong each estimate is for a large move.",
    bootstrap: "Spot rates stripped out of par yields, one maturity at a time.",
    "rate-tree": "A callable or putable bond valued on a Kalotay-Williams-Fabozzi binomial rate tree.",
    convertible: "A convertible bond valued on a Cox-Ross-Rubinstein stock tree: hold or convert at every node.",
  };

  const clone = (inputs: Inputs): Inputs => JSON.parse(JSON.stringify(inputs));
  const fresh = (model: BasicsModel): BasicsInput => ({ model, inputs: clone(DATA[model].inputs) });
  if (!basics) basics = fresh("price");
  const current = $derived(basics ?? fresh("price"));

  const candidates = $derived<Candidate[]>([{ ...DATA[current.model], label: "Coursework workbook" }, ...(DATA[current.model].presets ?? [])]);
  const snapshot = $derived(JSON.stringify($state.snapshot(current.inputs)));
  const matched = $derived(candidates.find((c) => JSON.stringify(c.inputs) === snapshot) ?? null);
  const problem = $derived(basicsProblem(current.model, $state.snapshot(current.inputs) as Inputs));

  let result = $state.raw<{ model: BasicsModel; data: Record<string, unknown> } | null>(null);
  let busy = $state(false);
  let failure = $state("");
  let timer = 0;
  let controller: AbortController | null = null;

  $effect(() => {
    const key = JSON.stringify([current.model, snapshot]);
    untrack(() => {
      window.clearTimeout(timer);
      if (problem) {
        result = null;
        return;
      }
      timer = window.setTimeout(() => load(key), 250);
    });
  });

  async function load(_key: string) {
    controller?.abort();
    const mine = (controller = new AbortController());
    const model = current.model;
    const { route, body } = basicsRequest(model, $state.snapshot(current.inputs) as Inputs);
    busy = true;
    try {
      const data = await fetchBasics<Record<string, unknown>>(apiBase, route, body, mine.signal);
      result = { model, data };
      failure = "";
      track("basics");
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      result = null;
      failure = error instanceof TypeError ? "The pricing server could not be reached." : (error as Error).message;
    } finally {
      if (controller === mine) busy = false;
    }
  }

  function choose(model: BasicsModel) {
    if (model === current.model) return;
    result = null;
    basics = fresh(model);
  }
  function usePreset(c: Candidate) {
    basics = { model: current.model, inputs: clone(c.inputs) };
  }
  function addEntry(key: string) {
    const list = current.inputs[key] as number[];
    current.inputs[key] = [...list, list[list.length - 1] ?? 5];
  }
  function dropEntry(key: string) {
    const list = current.inputs[key] as number[];
    if (list.length > 1) current.inputs[key] = list.slice(0, -1);
  }

  const shown = $derived(result && result.model === current.model ? result.data : null);
  const View = $derived(VIEWS[current.model]);
  const close = (a: number, b: number, tolerance?: number) => Math.abs(a - b) <= (tolerance ?? 1e-6 * Math.max(1, Math.abs(a)));
  const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 10 });
</script>

<section class="area" aria-label="Basics">
  <header class="lede">
    <div class="kicker">Basics · models from my fixed income derivatives course</div>
    <h1>{MODELS[current.model].title}</h1>
    <p class="dek">{BLURBS[current.model]}</p>
  </header>

  <nav class="models" aria-label="Models">
    {#each GROUPS as [group, models] (group)}
      <div class="group">
        <span class="k">{group}</span>
        <div class="chips">
          {#each models as model (model)}
            <button type="button" class="chip" aria-pressed={current.model === model} onclick={() => choose(model)}>{MODELS[model].title}</button>
          {/each}
        </div>
      </div>
    {/each}
  </nav>

  {#if candidates.length > 1}
    <div class="presets">
      <span class="k">Start from</span>
      <span class="seg" role="group" aria-label="Preset inputs">
        {#each candidates as c (c.label)}
          <button type="button" aria-pressed={matched?.label === c.label} onclick={() => usePreset(c)}>{c.label}</button>
        {/each}
      </span>
    </div>
  {/if}

  {#if basics}
    <div class="inputs">
      {#each MODELS[current.model].fields as field (field.key)}
        {#if !field.when || field.when(current.inputs)}
          {#if field.kind === "list"}
            <div class="cell wide">
              <span class="k">{field.label}</span>
              <div class="list">
                {#each current.inputs[field.key] as number[] as _, i (i)}
                  <input class="field small" type="number" step={field.step} aria-label="{field.label} {i + 1}" bind:value={(basics.inputs[field.key] as number[])[i]} />
                {/each}
                <button type="button" class="mini" onclick={() => addEntry(field.key)} aria-label="Add a value">+</button>
                <button type="button" class="mini" onclick={() => dropEntry(field.key)} aria-label="Remove the last value">−</button>
              </div>
            </div>
          {:else if field.kind === "choice"}
            <label class="cell">
              <span class="k">{field.label}</span>
              <select class="field" bind:value={basics.inputs[field.key]}>
                {#each field.choices ?? [] as [value, text] (value)}<option {value}>{text}</option>{/each}
              </select>
            </label>
          {:else if field.kind === "bool"}
            <label class="cell check"><input type="checkbox" bind:checked={basics.inputs[field.key] as boolean} /> <span>{field.label}</span></label>
          {:else}
            <label class="cell">
              <span class="k">{field.label}</span>
              <input class="field" type="number" step={field.step} min={field.min} max={field.max} bind:value={basics.inputs[field.key]} />
            </label>
          {/if}
        {/if}
      {/each}
    </div>
  {/if}

  {#if problem}<p class="note bad" role="alert">{problem}</p>{:else if failure}<p class="note bad" role="alert">{failure}</p>{/if}

  {#if matched && shown}
    <div class="match">
      <p>
        These are the inputs from {matched.label === "Coursework workbook" ? "my coursework workbook" : `my ${matched.label.toLowerCase()}`}, so the numbers below
        should equal the spreadsheet's. Change any input to rerun the model.
      </p>
      <ul>
        {#each matched.workbook as w (w.field)}
          {@const mine = readPath(shown, w.field)}
          <li>
            <span class="cellref">{w.cell}</span>
            <span class="num">{fmt(w.value)}</span>
            <span class="num" class:ok={mine !== undefined && close(w.value, mine, w.tolerance)}>{mine === undefined ? "–" : fmt(mine)}</span>
            {#if w.note}<span class="why">{w.note}</span>{/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if shown && !problem}
    <div class:busy>
      <View inputs={current.inputs} result={shown} />
    </div>
  {:else if busy}
    <p class="note">Running the model…</p>
  {/if}

  <p class="note foot">
    The workbook's Black-Scholes sheet lives in the <a href="https://options.blessedshoh.dev">options tool</a>, which prices options the same way with
    live chains.
  </p>
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
  .models {
    display: grid;
    gap: 10px;
    margin-bottom: 16px;
  }
  .group {
    display: grid;
    grid-template-columns: 120px minmax(0, 1fr);
    gap: 10px;
    align-items: center;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
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
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    align-items: center;
    margin-bottom: 14px;
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
    min-width: 130px;
  }
  .cell.wide {
    flex-basis: 100%;
  }
  .cell.check {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 13px;
    color: var(--soft);
    min-height: 38px;
  }
  .list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .field.small {
    width: 92px;
  }
  .mini {
    width: 34px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: transparent;
    color: var(--soft);
    cursor: pointer;
  }
  .note {
    font-size: 13px;
    color: var(--muted);
    margin: 10px 0;
  }
  .note.bad {
    color: var(--loss);
  }
  .match {
    margin: 18px 0 0;
    padding: 12px 14px;
    border-left: 2px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 6%, transparent);
    font-size: 13px;
    color: var(--soft);
  }
  .match p {
    margin: 0 0 8px;
  }
  .match ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 4px;
  }
  .match li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 4px 16px;
  }
  .cellref {
    color: var(--muted);
  }
  .ok::after {
    content: " ✓";
    color: var(--accent);
  }
  .why {
    grid-column: 1 / -1;
    color: var(--muted);
    font-size: 12.5px;
  }
  .busy {
    opacity: 0.6;
    transition: opacity 0.2s;
  }
  .foot {
    margin-top: 28px;
  }
  @media (max-width: 560px) {
    .group {
      grid-template-columns: 1fr;
      gap: 4px;
    }
    .match li {
      grid-template-columns: 1fr 1fr;
    }
    .cellref {
      grid-column: 1 / -1;
    }
  }
</style>
