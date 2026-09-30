import { describe, expect, test } from "bun:test";
import type { Patient } from "../api/fhir";
import { defaultSelection, identifierRows, mergeResult, selectAll } from "./merge-fields";

const a: Patient = {
  resourceType: "Patient",
  id: "a",
  meta: { versionId: "3" },
  identifier: [{ system: "mrn", value: "1" }],
  name: [{ given: ["Robert"], family: "Alan" }],
  birthDate: "1971-06-24",
  telecom: [{ system: "email", value: "robert255@smith.net" }],
};

const b: Patient = {
  resourceType: "Patient",
  id: "b",
  identifier: [
    { system: "mrn", value: "1" },
    { system: "mrn", value: "2" },
  ],
  name: [{ given: ["Rob"], family: "Allen" }],
  birthDate: "1971-05-24",
  telecom: [{ system: "phone", value: "555-0100", use: "mobile" }],
  address: [{ city: "London" }],
};

describe("defaultSelection", () => {
  test("keeps the more complete record and fills its gaps from the other one", () => {
    const selection = defaultSelection([a, b]);
    expect(selection.survivor).toBe(1);
    expect(selection.choices.email).toBe(0);
    expect(selection.choices.given).toBe(1);
  });
});

describe("mergeResult", () => {
  test("takes the chosen attributes into the surviving record", () => {
    const result = mergeResult([a, b], { survivor: 0, choices: { ...selectAll(0).choices, birthDate: 1, city: 1, phone: 1 } });
    expect(result).toEqual({
      resourceType: "Patient",
      id: "a",
      identifier: [
        { system: "mrn", value: "1" },
        { system: "mrn", value: "2" },
      ],
      name: [{ given: ["Robert"], family: "Alan" }],
      birthDate: "1971-05-24",
      telecom: [
        { system: "email", value: "robert255@smith.net" },
        { system: "phone", value: "555-0100", use: "mobile" },
      ],
      address: [{ city: "London" }],
    });
  });

  test("removes an attribute taken from a record that lacks it", () => {
    const result = mergeResult([a, b], { survivor: 1, choices: { ...selectAll(1).choices, city: 0, phone: 0 } });
    expect(result.id).toBe("b");
    expect(result.address).toBeUndefined();
    expect(result.telecom).toBeUndefined();
  });

  test("leaves the source records unchanged", () => {
    const before = structuredClone([a, b]);
    mergeResult([a, b], { survivor: 0, choices: selectAll(1).choices });
    expect([a, b]).toEqual(before);
  });
});

test("identifierRows marks the records that have each identifier", () => {
  expect(identifierRows([a, b]).map((row) => [row.identifier.value, row.inRecords])).toEqual([
    ["1", [true, true]],
    ["2", [false, true]],
  ]);
});
