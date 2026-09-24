export type FhirResource = {
  resourceType: string;
  id?: string;
  meta?: {
    versionId?: string;
    lastUpdated?: string;
    profile?: string[];
    tag?: Array<{ system?: string; code?: string }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type MdmCommand = {
  messageId: string;
  event: "A01" | "A04" | "A08";
  source: string;
  casReplanCount?: number;
  patient: FhirResource & { resourceType: "Patient"; id: string };
  conditions?: Array<FhirResource & { resourceType: "Condition"; id: string }>;
};

const commandSystem = "https://mdm.health-samurai.io/fhir/CodeSystem/empi-command";
const commandCode = "apply-v1";
const payloadCode = "command-json-v1";
const fhirId = /^[A-Za-z0-9.-]{1,64}$/;

export type CommandTask = FhirResource & {
  resourceType: "Task";
  id: string;
  status: "requested";
  intent: "order";
  code: { coding: Array<{ system: string; code: string }> };
  input: Array<{
    type: { coding: Array<{ system: string; code: string }> };
    valueAttachment: { contentType: "application/json"; data: string };
  }>;
};

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateCommand(value: unknown): asserts value is MdmCommand {
  if (!object(value) || typeof value.messageId !== "string" || !fhirId.test(value.messageId)
      || !["A01", "A04", "A08"].includes(String(value.event))
      || typeof value.source !== "string" || value.source.length === 0
      || !object(value.patient) || value.patient.resourceType !== "Patient"
      || typeof value.patient.id !== "string" || !fhirId.test(value.patient.id)
      || value.casReplanCount !== undefined) {
    throw new Error("Invalid MDM command identity, event or Patient");
  }
  if (value.conditions !== undefined) {
    if (!Array.isArray(value.conditions)) throw new Error("conditions must be an array");
    const ids = new Set<string>();
    for (const condition of value.conditions) {
      if (!object(condition) || condition.resourceType !== "Condition"
          || typeof condition.id !== "string" || !fhirId.test(condition.id)
          || ids.has(condition.id) || !object(condition.subject)
          || condition.subject.reference !== `Patient/${value.patient.id}`) {
        throw new Error("Each Condition must have a distinct id and belong to the command Patient");
      }
      ids.add(condition.id);
    }
  }
}

export function encodeCommand(command: MdmCommand): CommandTask {
  validateCommand(command);
  return {
    resourceType: "Task", id: command.messageId, status: "requested", intent: "order",
    code: { coding: [{ system: commandSystem, code: commandCode }] },
    input: [{
      type: { coding: [{ system: commandSystem, code: payloadCode }] },
      valueAttachment: { contentType: "application/json", data: Buffer.from(JSON.stringify(command)).toString("base64") },
    }],
  };
}

function hasCode(value: unknown, code: string): boolean {
  return object(value) && Array.isArray(value.coding)
    && value.coding.some(coding => object(coding) && coding.system === commandSystem && coding.code === code);
}

export function decodeCommand(value: unknown): MdmCommand {
  if (!object(value) || value.resourceType !== "Task" || value.status !== "requested" || value.intent !== "order"
      || !hasCode(value.code, commandCode) || !Array.isArray(value.input) || value.input.length !== 1) {
    throw new Error("Expected an immutable MDM command Task (apply-v1)");
  }
  const input: unknown = value.input[0];
  if (!object(input) || !hasCode(input.type, payloadCode) || !object(input.valueAttachment)
      || input.valueAttachment.contentType !== "application/json" || typeof input.valueAttachment.data !== "string") {
    throw new Error("Expected one command-json-v1 application/json attachment");
  }
  const data = Buffer.from(input.valueAttachment.data, "base64");
  if (data.toString("base64") !== input.valueAttachment.data) throw new Error("Invalid base64 command payload");
  const command: unknown = JSON.parse(data.toString("utf8"));
  validateCommand(command);
  if (value.id !== command.messageId) throw new Error("Task id must equal the command messageId");
  return command;
}
