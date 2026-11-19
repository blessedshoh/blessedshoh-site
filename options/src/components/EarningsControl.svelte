<script lang="ts">
  // The earnings control: when the announcement is and how big a move it brings,
  // plus a calculator for the move the market is pricing. All maths is in the
  // Python engine; this only edits the position and asks.
  import { fetchImpliedMove } from "../lib/api.ts";
  import { percent } from "../lib/format.ts";
  import { LIMITS } from "../lib/state.ts";
  import type { EarningsEvent, ImpliedMoveResponse } from "../lib/types.ts";

  interface Props {
    event?: EarningsEvent;
    apiBase: string;
    /** Days to the first expiry: the latest date the chart can show the crush. */
    maxDays: number;
    onenable?: () => void;
  }

  let { event = $bindable(), apiBase, maxDays, onenable }: Props = $props();

  const DEFAULT_MOVE = 0.08;
  const on = $derived(event !== undefined);

  function toggle() {
    if (event) {
      event = undefined;
      return;
    }
    const days = Math.max(LIMITS.eventDays[0], Math.min(5, Math.floor(maxDays) - 1));
    event = { days, move: DEFAULT_MOVE };
    onenable?.();
  }

  function setDays(input: HTMLInputElement) {
    const value = Number(input.value);
    if (event && Number.isFinite(value) && value >= LIMITS.eventDays[0] && value <= LIMITS.eventDays[1]) {
      event = { ...event, days: Math.round(value * 100) / 100 };
    } else if (event) input.value = String(event.days);
  }

  function setMove(input: HTMLInputElement) {
    const value = Number(input.value) / 100;
    if (event && Number.isFinite(value) && value >= LIMITS.eventMove[0] && value <= LIMITS.eventMove[1]) {
      event = { ...event, move: Math.round(value * 10000) / 10000 };
    } else if (event) input.value = (event.move * 100).toString();
  }

  // --- what move is priced in? ---------------------------------------------------

  let nearDays = $state(7);
  let nearVol = $state(80);
  let farDays = $state(35);
  let farVol = $state(55);
  let implied = $state.raw<ImpliedMoveResponse | null>(null);
  let problem = $state("");
  let busy = $state(false);

  async function work() {
    busy = true;
    problem = "";
    try {
      implied = await fetchImpliedMove(apiBase, {
        near_days: Number(nearDays),
        near_vol: Number(nearVol) / 100,
        far_days: Number(farDays),
        far_vol: Number(farVol) / 100,
      });
    } catch (error) {
      implied = null;
      problem = error instanceof TypeError ? "The pricing server could not be reached." : (error as Error).message;
    } finally {
      busy = false;
    }
  }

  const usable = $derived(implied !== null && implied.move >= LIMITS.eventMove[0] && implied.move <= LIMITS.eventMove[1]);

  function useMove() {
    if (!implied || !usable) return;
    const move = Math.round(implied.move * 10000) / 10000;
    if (event) event = { ...event, move };
    else {
      event = { days: Math.max(1, Math.min(5, Math.floor(maxDays) - 1)), move };
      onenable?.();
    }
  }
</script>

<section class="earnings" aria-label="Earnings">
  <div class="row">
    <label class="toggle">
      <input type="checkbox" checked={on} onchange={toggle} />
      <span><b>Earnings before expiry</b> <span class="hint">Split each option's volatility into an everyday part and a one-day jump</span></span>
    </label>
    {#if event}
      <label class="cell">
        <span class="k">Days until earnings</span>
        <input class="field" type="number" min="1" max="1825" step="1" value={event.days} onchange={(e) => setDays(e.currentTarget)} />
      </label>
      <label class="cell">
        <span class="k">Expected move ±%</span>
        <input class="field" type="number" min="0.5" max="50" step="0.5" value={event.move * 100} onchange={(e) => setMove(e.currentTarget)} />
      </label>
    {/if}
  </div>

  <details class="calc">
    <summary>What move is the market pricing?</summary>
    <p class="note">
      Two expiries that both come after the announcement share the same jump, but the nearer one spreads it over less time,
      so its volatility is higher. The difference reveals the move.
    </p>
    <div class="inputs">
      <label class="cell"><span class="k">Near expiry, days</span><input class="field" type="number" min="1" bind:value={nearDays} /></label>
      <label class="cell"><span class="k">Near volatility %</span><input class="field" type="number" min="1" step="0.5" bind:value={nearVol} /></label>
      <label class="cell"><span class="k">Far expiry, days</span><input class="field" type="number" min="2" bind:value={farDays} /></label>
      <label class="cell"><span class="k">Far volatility %</span><input class="field" type="number" min="1" step="0.5" bind:value={farVol} /></label>
      <button type="button" class="btn" onclick={work} disabled={busy}>{busy ? "Working" : "Work it out"}</button>
    </div>
    {#if implied}
      <dl class="result num">
        <div><dt class="k">Jump, one standard deviation</dt><dd>±{percent(implied.move)}</dd></div>
        <div><dt class="k">Average move, up or down</dt><dd>±{percent(implied.expected_abs_move)}</dd></div>
        <div><dt class="k">Everyday volatility</dt><dd>{percent(implied.base_vol)}</dd></div>
        <div><dt class="k">Near expiry's variance from the jump</dt><dd>{percent(implied.event_variance_share, 0)}</dd></div>
      </dl>
      <button type="button" class="btn solid" onclick={useMove} disabled={!usable}>Use this move</button>
      {#if !usable}<span class="note">That move is outside the 0.5% to 50% the tool accepts.</span>{/if}
    {/if}
    {#if problem}<p class="note bad">{problem}</p>{/if}
  </details>
</section>

<style>
  .earnings {
    margin-top: 18px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 14px 16px;
    background: var(--bg);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 12px 20px;
  }
  .toggle {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    flex: 1 1 320px;
    font-size: 14px;
    cursor: pointer;
  }
  .toggle input {
    accent-color: var(--accent);
    margin-top: 4px;
  }
  .toggle b {
    font-weight: 500;
  }
  .hint {
    display: block;
    font-size: 12.5px;
    color: var(--muted);
  }
  .cell {
    display: grid;
    gap: 5px;
    width: 150px;
  }
  .calc {
    margin-top: 12px;
    border-top: 1px dashed var(--line);
    padding-top: 10px;
  }
  .calc summary {
    cursor: pointer;
    font: 500 11px/1.4 var(--mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .note {
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--muted);
    margin: 8px 0;
  }
  .note.bad {
    color: var(--loss);
  }
  .inputs {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 10px 14px;
  }
  .inputs .cell {
    width: 130px;
  }
  .result {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 10px 18px;
    margin: 14px 0 10px;
  }
  .result dd {
    margin: 3px 0 0;
    font-size: 17px;
  }
  @media (max-width: 560px) {
    .cell,
    .inputs .cell {
      width: calc(50% - 10px);
    }
  }
</style>
