import {
  defineMapper,
  domainError,
} from "@health-samurai/interbox";
import {
  hl7v2Parser,
} from "@health-samurai/interbox/builtins";
import {
  fromMSH,
  fromDG1,
  fromPID,
  type DG1,
  type HL7v2Segment,
  type PID,
  type XAD,
  type XPN,
  type XTN,
} from "@health-samurai/interbox/hl7v2";
import {
  encodeCommand,
  type MdmCommand,
} from "./mdm/command.ts";

const patientKindSystem =
  "https://mdm.health-samurai.io/fhir/CodeSystem/patient-kind";
const sourceSystemTag =
  "https://mdm.health-samurai.io/fhir/CodeSystem/source-system";
const conditionKindSystem =
  "https://mdm.health-samurai.io/fhir/CodeSystem/condition-kind";

export type MapperAuthoringConfig = Record<string, never>;

function segment(
  message: HL7v2Segment[],
  name: string,
): HL7v2Segment | undefined {
  return message.find((candidate) => candidate.segment === name);
}

function segments(
  message: HL7v2Segment[],
  name: string,
): HL7v2Segment[] {
  return message.filter((candidate) => candidate.segment === name);
}

function requiredSegment(
  message: HL7v2Segment[],
  name: string,
): HL7v2Segment {
  const found = segment(message, name);
  if (!found) {
    throw domainError("structure", `missing_${name.toLowerCase()}`, `${name} segment is required`);
  }
  return found;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function gender(code: string | undefined): string | undefined {
  return {
    M: "male",
    F: "female",
    O: "other",
    U: "unknown",
  }[code ?? ""];
}

function fhirDate(value: string | undefined): string | undefined {
  if (!value || value.length < 8) return undefined;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function fhirDateTime(value: string | undefined): string | undefined {
  const date = fhirDate(value);
  if (!date) return undefined;
  const hour = value?.slice(8, 10) || "00";
  const minute = value?.slice(10, 12) || "00";
  const second = value?.slice(12, 14) || "00";
  return `${date}T${hour}:${minute}:${second}Z`;
}

function name(value: XPN | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const family = value.$1_family?.$1_family;
  const given = [value.$2_given, value.$3_additionalGiven].filter(Boolean);
  if (!family && given.length === 0) return undefined;
  return {
    ...(family ? { family } : {}),
    ...(given.length > 0 ? { given } : {}),
  };
}

function address(value: XAD | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const line = [value.$1_line1?.$1_line, value.$2_line2].filter(Boolean);
  const result = {
    ...(line.length > 0 ? { line } : {}),
    ...(value.$3_city ? { city: value.$3_city } : {}),
    ...(value.$4_state ? { state: value.$4_state } : {}),
    ...(value.$5_postalCode ? { postalCode: value.$5_postalCode } : {}),
    ...(value.$6_country ? { country: value.$6_country } : {}),
  };
  return Object.keys(result).length > 0 ? result : undefined;
}

function telecom(value: XTN | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (value.$4_email) return { system: "email", value: value.$4_email };
  const phone =
    value.$12_unformatted ??
    value.$1_value ??
    [value.$5_countryCode, value.$6_areaCode, value.$7_localNumber]
      .filter(Boolean)
      .join("");
  return phone ? { system: "phone", value: phone } : undefined;
}

function messageContext(message: HL7v2Segment[]) {
  const msh = fromMSH(requiredSegment(message, "MSH"));
  const sendingApplication = msh.$3_sendingApplication?.$1_namespace;
  const sendingFacility = msh.$4_sendingFacility?.$1_namespace;
  const messageId = msh.$10_messageControlId;
  const event = msh.$9_messageType?.$2_event;
  if (!sendingApplication || !sendingFacility || !messageId || !event) {
    throw domainError(
      "field",
      "missing_message_identity",
      "MSH-3, MSH-4, MSH-9.2 and MSH-10 are required",
    );
  }
  if (!["A01", "A04", "A08"].includes(event)) {
    throw domainError("unsupported", "message_type", `ADT^${event} is not supported by this showcase`);
  }
  if (!/^[A-Za-z0-9.-]{1,64}$/.test(messageId)) {
    throw domainError(
      "field",
      "invalid_message_id",
      "MSH-10 must be a globally unique FHIR id (1..64 letters, digits, '-' or '.')",
    );
  }
  return {
    source: slug(sendingApplication),
    sendingFacility,
    messageId,
    event: event as MdmCommand["event"],
  };
}

async function patientResource(
  pid: PID,
  source: string,
): Promise<Record<string, unknown>> {
  const identifier = pid.$3_identifier[0] ?? pid.$2_patientId;
  const sourcePatientId = identifier?.$1_value;
  if (!sourcePatientId) {
    throw domainError("field", "missing_patient_id", "PID-3.1 is required");
  }
  const id = `source-${(await sha256(`${source}|${sourcePatientId}`)).slice(0, 32)}`;
  const patientName = name(pid.$5_name[0]);
  const patientAddress = address(pid.$11_address?.[0]);
  const patientTelecom = telecom(pid.$13_homePhone?.[0]);
  const identifierSystem =
    identifier?.$4_system?.$2_system ??
    identifier?.$4_system?.$1_namespace ??
    `urn:source:${source}`;
  return {
    resourceType: "Patient",
    id,
    meta: {
      tag: [
        { system: patientKindSystem, code: "source" },
        { system: sourceSystemTag, code: source },
      ],
    },
    active: true,
    identifier: [{ system: identifierSystem, value: sourcePatientId }],
    ...(patientName ? { name: [patientName] } : {}),
    ...(gender(pid.$8_gender) ? { gender: gender(pid.$8_gender) } : {}),
    ...(fhirDate(pid.$7_birthDate) ? { birthDate: fhirDate(pid.$7_birthDate) } : {}),
    ...(patientAddress ? { address: [patientAddress] } : {}),
    ...(patientTelecom ? { telecom: [patientTelecom] } : {}),
  };
}

async function conditionResource(
  dg1: DG1,
  position: number,
  source: string,
  sourcePatientId: string,
  patientId: string,
): Promise<NonNullable<MdmCommand["conditions"]>[number]> {
  const coding = dg1.$3_diagnosisCodeDg1;
  const code = coding?.$1_code;
  if (!code) {
    throw domainError(
      "field",
      "missing_diagnosis_code",
      `DG1-${position + 1}.3.1 is required`,
    );
  }
  const sourceDiagnosisId = dg1.$1_setIdDg1 || String(position + 1);
  const id = `source-condition-${(
    await sha256(`${source}|${sourcePatientId}|${sourceDiagnosisId}`)
  ).slice(0, 32)}`;
  const onsetDateTime = fhirDateTime(dg1.$5_diagnosisDateTime);
  const display = coding?.$2_text ?? dg1.$4_diagnosisDescription;
  return {
    resourceType: "Condition",
    id,
    meta: {
      tag: [
        { system: conditionKindSystem, code: "source" },
        { system: sourceSystemTag, code: source },
      ],
    },
    identifier: [
      {
        system: `urn:source:${source}:condition`,
        value: `${sourcePatientId}|${sourceDiagnosisId}`,
      },
    ],
    clinicalStatus: {
      coding: [
        {
          system:
            "http://terminology.hl7.org/CodeSystem/condition-clinical",
          code: "active",
        },
      ],
    },
    verificationStatus: {
      coding: [
        {
          system:
            "http://terminology.hl7.org/CodeSystem/condition-ver-status",
          code: "confirmed",
        },
      ],
    },
    category: [
      {
        coding: [
          {
            system:
              "http://terminology.hl7.org/CodeSystem/condition-category",
            code: "encounter-diagnosis",
          },
        ],
      },
    ],
    code: {
      coding: [
        {
          system:
            coding?.$3_system || "http://hl7.org/fhir/sid/icd-10",
          code,
          ...(display ? { display } : {}),
        },
      ],
      ...(display ? { text: display } : {}),
    },
    subject: { reference: `Patient/${patientId}` },
    ...(onsetDateTime ? { onsetDateTime } : {}),
    ...(onsetDateTime ? { recordedDate: onsetDateTime } : {}),
  };
}

export async function commandFromMessage(
  message: HL7v2Segment[],
): Promise<MdmCommand> {
  const context = messageContext(message);
  const pid = fromPID(requiredSegment(message, "PID"));
  const sourceIdentifier = pid.$3_identifier[0] ?? pid.$2_patientId;
  const sourcePatientId = sourceIdentifier?.$1_value;
  if (!sourcePatientId) {
    throw domainError("field", "missing_patient_id", "PID-3.1 is required");
  }
  const patient = await patientResource(pid, context.source) as MdmCommand["patient"];
  const conditions = await Promise.all(
    segments(message, "DG1").map((dg1, position) =>
      conditionResource(
        fromDG1(dg1),
        position,
        context.source,
        sourcePatientId,
        patient.id,
      ),
    ),
  );
  return {
    messageId: context.messageId,
    event: context.event,
    source: context.source,
    patient,
    ...(conditions.length > 0 ? { conditions } : {}),
  };
}

export async function mapMessage(
  message: HL7v2Segment[],
) {
  const command = await commandFromMessage(message);
  return [encodeCommand(command)];
}

export const mdmMapper = defineMapper({
  type: "hl7v2-to-mdm-command",
  parser: hl7v2Parser,
  async map(_config: MapperAuthoringConfig, input) {
    return await mapMessage(input);
  },
});
