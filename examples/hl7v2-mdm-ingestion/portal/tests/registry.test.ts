import assert from "node:assert/strict";
import test from "node:test";

import {
  paginateRegistry,
  parseRegistryQuery,
} from "../app/api/state/registry.ts";

type Card = {
  id: string;
  kind: "golden" | "singleton";
  duplicateConditionCount: number;
};

function card(
  id: string,
  kind: Card["kind"] = "singleton",
  duplicateConditionCount = 0,
): Card {
  return { id, kind, duplicateConditionCount };
}

test("registry filters before applying server-side pagination", () => {
  const cards = [
    card("singleton-clean"),
    card("cluster-repeated", "golden", 2),
    card("singleton-repeated", "singleton", 1),
    card("cluster-clean", "golden"),
  ];
  const query = parseRegistryQuery(
    "http://portal/api/state?conditionDuplicates=present&page=1&pageSize=1",
  );

  const firstPage = paginateRegistry(cards, query);
  const secondPage = paginateRegistry(cards, { ...query, page: 2 });

  assert.deepEqual(
    firstPage.patientCards.map(({ id }) => id),
    ["cluster-repeated"],
  );
  assert.deepEqual(
    secondPage.patientCards.map(({ id }) => id),
    ["singleton-repeated"],
  );
  assert.deepEqual(firstPage.registry, {
    page: 1,
    pageSize: 1,
    total: 2,
    totalPages: 2,
    patientKind: "all",
    conditionDuplicates: "present",
  });
});

test("registry combines patient kind and duplicate filters", () => {
  const cards = [
    card("cluster-repeated", "golden", 2),
    card("singleton-repeated", "singleton", 1),
    card("cluster-clean", "golden"),
  ];
  const query = parseRegistryQuery(
    "http://portal/api/state?patientKind=golden&conditionDuplicates=present",
  );

  assert.deepEqual(
    paginateRegistry(cards, query).patientCards.map(({ id }) => id),
    ["cluster-repeated"],
  );
});

test("registry query has bounded defaults and clamps an empty page", () => {
  const defaults = parseRegistryQuery("http://portal/api/state?page=0");
  const bounded = parseRegistryQuery(
    "http://portal/api/state?page=999&pageSize=999",
  );

  assert.equal(defaults.page, 1);
  assert.equal(defaults.pageSize, 20);
  assert.equal(bounded.pageSize, 100);
  assert.deepEqual(paginateRegistry([], bounded).registry, {
    page: 1,
    pageSize: 100,
    total: 0,
    totalPages: 1,
    patientKind: "all",
    conditionDuplicates: "all",
  });
});
