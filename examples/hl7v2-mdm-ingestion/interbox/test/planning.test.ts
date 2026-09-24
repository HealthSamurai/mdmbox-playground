import { expect, test } from "bun:test";
import {
  calculateGolden,
  type MdmCommand,
} from "../src/mdm/planning.ts";

const command: MdmCommand = {
  messageId: "message-1",
  event: "A01",
  source: "hospital",
  patient: {
    resourceType: "Patient",
    id: "source-b",
    meta: {
      tag: [
        {
          system:
            "https://mdm.health-samurai.io/fhir/CodeSystem/patient-kind",
          code: "source",
        },
        {
          system:
            "https://mdm.health-samurai.io/fhir/CodeSystem/source-system",
          code: "hospital",
        },
      ],
    },
    name: [{ family: "Smith", given: ["John"] }],
    birthDate: "1980-01-01",
  },
};

test("golden view applies explicit source priority", () => {
  const hospital = structuredClone(command.patient);
  hospital.telecom = [{ system: "phone", value: "hospital" }];
  const registry = structuredClone(command.patient);
  registry.meta!.tag![1]!.code = "registry";
  registry.telecom = [{ system: "phone", value: "registry" }];

  expect(calculateGolden([hospital, registry])).toMatchObject({
    resourceType: "Patient",
    id: "golden",
    telecom: [{ system: "phone", value: "registry" }],
  });
});
