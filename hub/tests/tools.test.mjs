// The dashboard's switches and usage labels must cover exactly what each tool has.
import assert from "node:assert/strict";
import { test } from "node:test";

import bondsBuiltIn from "../../bonds/src/data/settings.json" with { type: "json" };
import { EVENTS as BOND_EVENTS } from "../../bonds/src/lib/track.ts";
import optionsBuiltIn from "../../options/src/data/settings.json" with { type: "json" };
import { EVENTS as OPTION_EVENTS } from "../../options/src/lib/track.ts";
import { eventLabel, toolName } from "../src/lib/labels.ts";
import { BOND_FLAGS, OPTION_FLAGS, flagsFromForm } from "../src/lib/validate.ts";

test("each tool's switches are exactly the flags that tool reads", () => {
  assert.deepEqual(BOND_FLAGS.map((f) => f.key).sort(), Object.keys(bondsBuiltIn.flags).sort());
  for (const f of OPTION_FLAGS) assert.ok(f.key in optionsBuiltIn.flags, f.key);
});

test("a switch form reads only that tool's flags", () => {
  const form = new FormData();
  form.set("flag_curve", "on");
  form.set("flag_basics", "on");
  form.set("flag_risk", "on");
  assert.deepEqual(flagsFromForm(form, BOND_FLAGS), { curve: true, price: false, hedge: false, basics: true });
  assert.equal(flagsFromForm(form, OPTION_FLAGS).risk, true);
  assert.equal("curve" in flagsFromForm(form, OPTION_FLAGS), false);
});

test("every event either tool counts has a label, read per tool", () => {
  for (const e of BOND_EVENTS) assert.notEqual(eventLabel("bonds", e), e, `bonds ${e}`);
  for (const e of OPTION_EVENTS) assert.notEqual(eventLabel("options", e), e, `options ${e}`);
  assert.equal(eventLabel("options", "view"), "Page views");
  assert.equal(eventLabel("bonds", "priced"), "Bonds priced");
  assert.equal(eventLabel("options", "priced"), "Positions priced");
  assert.equal(toolName("bonds"), "Fixed income lab");
  assert.equal(toolName("mystery"), "mystery");
});
