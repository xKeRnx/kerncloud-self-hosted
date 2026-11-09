import test from "node:test";
import assert from "node:assert/strict";
import {
  boundWindow,
  zoomWindow,
  panWindow,
  clipInterval,
  assignLanes,
} from "../src/core/timeline.ts";
const domain = { start: 0, end: 86400000 };
test("zoom keeps the centre, respects one minute and never expands beyond available data", () => {
  const range = { start: 3600000, end: 7200000 };
  assert.deepEqual(zoomWindow(range, 0.5, domain), {
    start: 4500000,
    end: 6300000,
  });
  assert.equal(
    zoomWindow(range, 0.00001, domain).end -
      zoomWindow(range, 0.00001, domain).start,
    60000,
  );
  assert.deepEqual(zoomWindow(range, 10000, domain), domain);
});
test("pan clamps at both boundaries without changing visible duration", () => {
  const range = { start: 3600000, end: 7200000 };
  assert.deepEqual(panWindow(range, -86400000, domain), {
    start: 0,
    end: 3600000,
  });
  assert.deepEqual(panWindow(range, 86400000, domain), {
    start: 82800000,
    end: 86400000,
  });
  assert.deepEqual(boundWindow(5, 1000, { start: 0, end: 1000 }), {
    start: 0,
    end: 1000,
  });
});
test("clipping includes tasks that started before the window and excludes non-overlapping work", () => {
  const w = { start: 100, end: 200 };
  assert.deepEqual(clipInterval(50, 150, w), { left: 0, width: 50 });
  assert.deepEqual(clipInterval(150, 250, w), { left: 50, width: 50 });
  assert.deepEqual(clipInterval(50, 250, w), { left: 0, width: 100 });
  assert.equal(clipInterval(1, 100, w), null);
  assert.equal(clipInterval(200, 220, w), null);
  assert.equal(clipInterval(NaN, 250, w), null);
  assert.equal(clipInterval(180, 120, w), null);
});
test("concurrent work gets separate lanes and completed lanes can be reused without changing input", () => {
  const items = [
    { id: "b", start: 3, end: 6 },
    { id: "a", start: 1, end: 5 },
    { id: "c", start: 6, end: 8 },
  ];
  const lanes = assignLanes(items);
  assert.deepEqual(
    lanes.map((i) => [i.id, i.lane]),
    [
      ["a", 0],
      ["b", 1],
      ["c", 0],
    ],
  );
  assert.deepEqual(
    items.map((i) => i.id),
    ["b", "a", "c"],
  );
  assert.deepEqual(
    assignLanes(
      [
        { start: 0, end: 0 },
        { start: 1, end: 1 },
      ],
      5,
    ).map((i) => i.lane),
    [0, 1],
  );
});
