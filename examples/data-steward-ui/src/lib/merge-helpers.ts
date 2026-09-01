/**
 * Patient-specific merge helpers.
 *
 * These use generated FHIR R4 types and SDK generic utilities
 * to implement patient merge logic.
 */

import type { Identifier } from "@/fhir-types/hl7-fhir-r4-core/Identifier";
import type { HumanName } from "@/fhir-types/hl7-fhir-r4-core/HumanName";
import type { ContactPoint } from "@/fhir-types/hl7-fhir-r4-core/ContactPoint";
import type { Resource } from "mdmbox-sdk";
import { getField, unionUnique } from "mdmbox-sdk";

// ==================== Identifiers ====================

/** Stable identity key for an Identifier (`value|system`). */
export function identifierKey(id: Identifier): string {
  return `${id.value ?? ""}|${id.system ?? ""}`;
}

/** Merge identifiers from two resources, deduplicating by `value+system`. Target wins. */
export function mergeIdentifiers(
  source: Resource,
  target: Resource
): Identifier[] {
  const sourceIds: Identifier[] = getField(source, "identifier") || [];
  const targetIds: Identifier[] = getField(target, "identifier") || [];
  return unionUnique(targetIds, sourceIds, identifierKey);
}

// ==================== Names ====================

/** Stable identity key for a HumanName (`family|given|use`). */
export function nameKey(name: HumanName): string {
  return `${name.family ?? ""}|${(name.given ?? []).join(",")}|${name.use ?? ""}`;
}

/** Merge names from two resources, deduplicating by `family+given+use`. Target wins. */
export function mergeNames(source: Resource, target: Resource): HumanName[] {
  const sourceNames: HumanName[] = getField(source, "name") || [];
  const targetNames: HumanName[] = getField(target, "name") || [];
  return unionUnique(targetNames, sourceNames, nameKey);
}

// ==================== Telecom ====================

/** Stable identity key for a ContactPoint (`system|value`). */
export function telecomKey(t: ContactPoint): string {
  return `${t.system ?? ""}|${t.value ?? ""}`;
}

/** Merge telecom entries from two resources, deduplicating by `system+value`. Target wins. */
export function mergeTelecom(
  source: Resource,
  target: Resource
): ContactPoint[] {
  const sourceTel: ContactPoint[] = getField(source, "telecom") || [];
  const targetTel: ContactPoint[] = getField(target, "telecom") || [];
  return unionUnique(targetTel, sourceTel, telecomKey);
}
