import { expect, test } from "bun:test";
import { parseHl7v2 } from "@health-samurai/interbox/hl7v2";
import { commandFromMessage, mapMessage } from "../src/mapper.ts";

const message = [
  "MSH|^~\\&|HOSPITAL|MOSCOW|AIDBOX|MDM|20260727120000||ADT^A01|hospital-001|P|2.5",
  "EVN|A01|20260727120000",
  "PID|1||H-100^^^HOSPITAL^MR||Smith^John||19800101|M|||10 Main St^^Moscow^^101000^RU||+74950000001",
  "PV1|1|I",
].join("\r");

test("HL7 message becomes one globally identified MDM command", async () => {
  const command = await commandFromMessage(parseHl7v2(message));
  expect(command).toMatchObject({
    messageId: "hospital-001",
    event: "A01",
    source: "hospital",
    patient: {
      resourceType: "Patient",
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
      gender: "male",
    },
  });
});

test("mapper queues only the command and performs no planning", async () => {
  const [envelope] = await mapMessage(parseHl7v2(message));

  expect(envelope).toMatchObject({
    resourceType: "Task",
    id: "hospital-001",
    status: "requested",
    intent: "order",
  });
  const task = envelope as unknown as { input: Array<{ valueAttachment: { contentType: string; data: string } }> };
  expect(task.input[0]!.valueAttachment.contentType).toBe("application/json");
  expect(JSON.parse(Buffer.from(task.input[0]!.valueAttachment.data, "base64").toString("utf8"))).toEqual(await commandFromMessage(parseHl7v2(message)));
});

test("DG1 segments become stable source Conditions owned by the source Patient", async () => {
  const withDiagnoses = [
    message,
    "DG1|1||I10^Essential hypertension^http://hl7.org/fhir/sid/icd-10|Essential hypertension|20260115120000|F",
    "DG1|2||J18.9^Pneumonia^http://hl7.org/fhir/sid/icd-10|Pneumonia|20260220120000|F",
  ].join("\r");
  const command = await commandFromMessage(parseHl7v2(withDiagnoses));

  expect(command.conditions).toHaveLength(2);
  expect(command.conditions?.[0]).toMatchObject({
    resourceType: "Condition",
    meta: {
      tag: [
        {
          system:
            "https://mdm.health-samurai.io/fhir/CodeSystem/condition-kind",
          code: "source",
        },
        {
          system:
            "https://mdm.health-samurai.io/fhir/CodeSystem/source-system",
          code: "hospital",
        },
      ],
    },
    code: {
      coding: [
        {
          system: "http://hl7.org/fhir/sid/icd-10",
          code: "I10",
          display: "Essential hypertension",
        },
      ],
    },
    subject: { reference: `Patient/${command.patient.id}` },
    onsetDateTime: "2026-01-15T12:00:00Z",
  });
  const retry = await commandFromMessage(parseHl7v2(withDiagnoses));
  expect(command.conditions?.[0]?.id).toBeDefined();
  expect(retry.conditions?.[0]?.id).toBe(command.conditions![0]!.id);
});

test("an exact delivery retry produces the same command", async () => {
  const first = await commandFromMessage(parseHl7v2(message));
  const retry = await commandFromMessage(parseHl7v2(message));
  expect(retry).toEqual(first);
});

test("A08 keeps the source Patient id but has a new global message id", async () => {
  const initial = await commandFromMessage(parseHl7v2(message));
  const updateMessage = message
    .replace("ADT^A01|hospital-001", "ADT^A08|hospital-a08-001")
    .replace("EVN|A01|", "EVN|A08|")
    .replace("+74950000001", "+74959999999");
  const update = await commandFromMessage(parseHl7v2(updateMessage));

  expect(update.patient.id).toBe(initial.patient.id);
  expect(update.messageId).toBe("hospital-a08-001");
  expect(update.event).toBe("A08");
});

test("the same local patient id from another source remains distinct", async () => {
  const hospital = await commandFromMessage(parseHl7v2(message));
  const labMessage = message
    .replaceAll("HOSPITAL", "LAB")
    .replace("hospital-001", "lab-001");
  const lab = await commandFromMessage(parseHl7v2(labMessage));

  expect(lab.patient.id).not.toBe(hospital.patient.id);
  expect(lab.source).toBe("lab");
});

test("MSH-10 must already be a global FHIR id", async () => {
  const invalid = message.replace("hospital-001", "hospital/001");
  await expect(
    commandFromMessage(parseHl7v2(invalid)),
  ).rejects.toThrow("globally unique FHIR id");
});
