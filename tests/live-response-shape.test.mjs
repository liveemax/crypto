import assert from "node:assert/strict";
import test from "node:test";

import { compareResponseShape } from "../scripts/compare-response-shape.mjs";

test("live response shape comparison checks nulls and every array item", () => {
  assert.doesNotThrow(() => compareResponseShape({ value: null, rows: [{ score: 1 }, { score: 2 }] }, {
    value: null,
    rows: [{ score: 10 }, { score: 20 }],
  }));

  assert.throws(
    () => compareResponseShape({ value: null, rows: [{ score: 1 }, { score: 2 }] }, {
      value: 0,
      rows: [{ score: 10 }, { score: "20" }],
    }),
    (error) => {
      assert.match(error.message, /\$\.value: expected null, received number/);
      assert.match(error.message, /\$\.rows\[1\]\.score: expected number, received string/);
      return true;
    },
  );
});
