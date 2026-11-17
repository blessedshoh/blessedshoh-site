<script lang="ts">
  // The position editor: market inputs, one row per leg, and ready-made strategies.
  // Numbers are committed when a field loses focus or Enter is pressed, so
  // half-typed values such as "1." never reach the pricing server.
  import { price as formatPrice } from "../lib/format.ts";
  import { LIMITS } from "../lib/state.ts";
  import { snap, strikeStep, TEMPLATES } from "../lib/templates.ts";
  import type { Leg, LegKind, Position } from "../lib/types.ts";

  interface Props {
    position: Position;
    /** Model price per share of each leg, or null while the numbers are being refreshed. */
    entryPrices: number[] | null;
    onreset: () => void;
  }

  let { position = $bindable(), entryPrices, onreset }: Props = $props();

  const firstOption = $derived(position.legs.find((leg) => leg.kind !== "stock"));
  const usualVol = $derived(firstOption?.vol ?? 0.5);
  const usualDays = $derived(firstOption?.days ?? 30);

  /** Read a number field. Out-of-range or empty input is refused and the old value is shown again. */
  function commit(event: Event, low: number, high: number, shown: number, apply: (value: number) => void) {
    const input = event.currentTarget as HTMLInputElement;
    const value = Number(input.value);
    if (input.value.trim() === "" || !Number.isFinite(value) || value < low || value > high) {
      input.value = String(shown);
      return;
    }
    apply(value);
  }

  const round = (value: number, digits: number) => Number(value.toFixed(digits));

  function setSide(leg: Leg, long: boolean) {
    leg.quantity = Math.abs(leg.quantity) * (long ? 1 : -1);
  }

  function setKind(leg: Leg, kind: LegKind) {
    const sign = leg.quantity < 0 ? -1 : 1;
    if (kind === "stock") {
      if (leg.kind !== "stock") leg.quantity = sign * 100;
      delete leg.strike;
      delete leg.days;
      delete leg.vol;
    } else if (leg.kind === "stock") {
      leg.quantity = sign;
      leg.strike = snap(position.spot, strikeStep(position.spot));
      leg.days = usualDays;
      leg.vol = usualVol;
    }
    leg.kind = kind;
  }

  function addLeg() {
    if (position.legs.length >= LIMITS.legs) return;
    position.legs.push({
      kind: "call",
      quantity: 1,
      strike: snap(position.spot * 1.05, strikeStep(position.spot)),
      days: usualDays,
      vol: usualVol,
    });
  }

  function removeLeg(index: number) {
    if (position.legs.length > 1) position.legs.splice(index, 1);
  }

  function useTemplate(event: Event) {
    const select = event.currentTarget as HTMLSelectElement;
    const template = TEMPLATES.find((item) => item.id === select.value);
    if (template) position.legs = template.build(position.spot, usualVol, usualDays);
    select.value = "";
  }
</script>

<section class="editor" aria-label="Position">
  <div class="market">
    <label class="cell">
      <span class="k">Label</span>
      <input class="field" type="text" maxlength={LIMITS.label} bind:value={position.label} />
    </label>
    <label class="cell">
      <span class="k">Price now</span>
      <input
        class="field"
        type="number"
        step="any"
        value={position.spot}
        onchange={(event) => commit(event, LIMITS.spot[0], LIMITS.spot[1], position.spot, (value) => (position.spot = value))}
      />
    </label>
    <label class="cell">
      <span class="k">Interest rate %</span>
      <input
        class="field"
        type="number"
        step="0.25"
        value={round(position.rate * 100, 2)}
        onchange={(event) =>
          commit(event, LIMITS.rate[0] * 100, LIMITS.rate[1] * 100, round(position.rate * 100, 2), (value) => (position.rate = value / 100))}
      />
    </label>
    <label class="cell">
      <span class="k">Dividend yield %</span>
      <input
        class="field"
        type="number"
        step="0.25"
        min="0"
        value={round(position.div_yield * 100, 2)}
        onchange={(event) =>
          commit(event, LIMITS.divYield[0] * 100, LIMITS.divYield[1] * 100, round(position.div_yield * 100, 2), (value) => (position.div_yield = value / 100))}
      />
    </label>
    <div class="cell">
      <span class="k">Exercise</span>
      <span class="seg exercise" role="group" aria-label="Exercise style">
        <button type="button" aria-pressed={position.exercise !== "american"} onclick={() => (position.exercise = "european")}>European</button>
        <button type="button" aria-pressed={position.exercise === "american"} onclick={() => (position.exercise = "american")}>American</button>
      </span>
    </div>
    <label class="cell">
      <span class="k">Start from</span>
      <select class="field" onchange={useTemplate}>
        <option value="">Choose a strategy</option>
        {#each TEMPLATES as template (template.id)}
          <option value={template.id}>{template.name}</option>
        {/each}
      </select>
    </label>
  </div>

  <div class="legs">
    <div class="row head" aria-hidden="true">
      <span class="k">Side</span>
      <span class="k">Quantity</span>
      <span class="k">Type</span>
      <span class="k">Strike</span>
      <span class="k">Days</span>
      <span class="k">Volatility %</span>
      <span class="k right">Model price</span>
      <span></span>
    </div>

    {#each position.legs as leg, index (index)}
      {@const shownQuantity = Math.abs(leg.quantity)}
      {@const n = index + 1}
      <div class="row">
        <span class="seg side" role="group" aria-label="Side of leg {n}">
          <button type="button" aria-pressed={leg.quantity > 0} onclick={() => setSide(leg, true)}>Long</button>
          <button type="button" aria-pressed={leg.quantity < 0} onclick={() => setSide(leg, false)}>Short</button>
        </span>

        <label class="cell qty">
          <span class="k cap">Quantity</span>
          <input
            class="field"
            type="number"
            min="1"
            step="1"
            aria-label="Quantity of leg {n}"
            value={shownQuantity}
            onchange={(event) =>
              commit(event, 0.01, LIMITS.quantity, shownQuantity, (value) => (leg.quantity = value * (leg.quantity < 0 ? -1 : 1)))}
          />
        </label>

        <label class="cell type">
          <span class="k cap">Type</span>
          <select
            class="field"
            aria-label="Type of leg {n}"
            value={leg.kind}
            onchange={(event) => setKind(leg, (event.currentTarget as HTMLSelectElement).value as LegKind)}
          >
            <option value="call">Call</option>
            <option value="put">Put</option>
            <option value="stock">Stock</option>
          </select>
        </label>

        {#if leg.kind === "stock"}
          <span class="none">Shares, traded at the price now</span>
        {:else}
          <label class="cell strike">
            <span class="k cap">Strike</span>
            <input
              class="field"
              type="number"
              step="any"
              aria-label="Strike of leg {n}"
              value={leg.strike}
              onchange={(event) => commit(event, LIMITS.strike[0], LIMITS.strike[1], leg.strike!, (value) => (leg.strike = value))}
            />
          </label>
          <label class="cell days">
            <span class="k cap">Days</span>
            <input
              class="field"
              type="number"
              min="0"
              step="1"
              aria-label="Days to expiry of leg {n}"
              value={leg.days}
              onchange={(event) => commit(event, LIMITS.days[0], LIMITS.days[1], leg.days!, (value) => (leg.days = value))}
            />
          </label>
          <label class="cell vol">
            <span class="k cap">Volatility %</span>
            <input
              class="field"
              type="number"
              min="1"
              step="1"
              aria-label="Implied volatility of leg {n}, in percent"
              value={round(leg.vol! * 100, 2)}
              onchange={(event) =>
                commit(event, LIMITS.vol[0] * 100, LIMITS.vol[1] * 100, round(leg.vol! * 100, 2), (value) => (leg.vol = value / 100))}
            />
          </label>
        {/if}

        <span class="price">
          <span class="k cap">Model price</span>
          <span class="num">{entryPrices?.[index] != null ? formatPrice(entryPrices[index]) : "…"}</span>
        </span>

        <button
          type="button"
          class="remove"
          aria-label="Remove leg {n}"
          disabled={position.legs.length === 1}
          onclick={() => removeLeg(index)}
        >
          &times;
        </button>
      </div>
    {/each}
  </div>

  <div class="actions">
    <button type="button" class="btn" onclick={addLeg} disabled={position.legs.length >= LIMITS.legs}>Add leg</button>
    <button type="button" class="btn" onclick={onreset}>Back to the example</button>
  </div>
</section>

<style>
  .editor {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .market {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
    padding: 14px 16px;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
  }
  .cell {
    display: grid;
    gap: 5px;
    min-width: 0;
  }
  .exercise {
    justify-self: start;
  }
  .exercise button {
    padding: 10px 12px;
  }
  .legs {
    padding: 6px 16px 4px;
  }
  .row {
    display: grid;
    grid-template-columns: 132px repeat(5, minmax(0, 1fr)) 96px 30px;
    gap: 10px;
    align-items: center;
    padding: 7px 0;
    border-bottom: 1px dotted var(--line);
  }
  .row.head {
    padding: 6px 0 4px;
  }
  .row:last-child {
    border-bottom: 0;
  }
  .side {
    justify-self: start;
  }
  /* Field captions inside a row. Hidden on wide screens, where the header row labels the columns. */
  .cap {
    display: none;
  }
  .none {
    grid-column: span 3;
    color: var(--muted);
    font-size: 13.5px;
  }
  .right {
    text-align: right;
  }
  .price {
    display: grid;
    justify-items: end;
    font-size: 14px;
  }
  .remove {
    font: 400 20px/1 var(--sans);
    color: var(--muted);
    background: transparent;
    border: 0;
    border-radius: var(--radius);
    width: 30px;
    height: 30px;
    cursor: pointer;
  }
  .remove:hover:not(:disabled) {
    color: var(--loss);
  }
  .remove:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    padding: 12px 16px 14px;
    border-top: 1px solid var(--line);
  }

  @media (max-width: 860px) {
    .market {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .market .cell:last-child {
      grid-column: 1 / -1;
    }
    .row.head {
      display: none;
    }
    .cap {
      display: block;
    }
    .row {
      grid-template-columns: repeat(6, minmax(0, 1fr));
      grid-template-areas:
        "side side side qty qty remove"
        "type type strike strike days days"
        "vol vol price price price price";
      align-items: end;
      row-gap: 10px;
      padding: 14px 0;
    }
    .side {
      grid-area: side;
    }
    .qty {
      grid-area: qty;
    }
    .type {
      grid-area: type;
    }
    .strike {
      grid-area: strike;
    }
    .days {
      grid-area: days;
    }
    .vol {
      grid-area: vol;
    }
    .none {
      grid-row: 2;
      grid-column: 3 / 7;
      align-self: center;
    }
    .price {
      grid-area: price;
    }
    .remove {
      grid-area: remove;
      justify-self: end;
    }
  }
</style>
