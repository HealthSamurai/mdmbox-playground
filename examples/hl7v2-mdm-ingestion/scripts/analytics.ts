const patientLinkageProfile = "https://mdm.health-samurai.io/fhir/StructureDefinition/mdm-linkage";
const conditionLinkageProfile = "https://mdm.health-samurai.io/fhir/StructureDefinition/mdm-condition-linkage";

function latestSnapshot(name: string, key: string, fields: string[]): string {
  const columns = [...fields, "is_deleted"];
  return `CREATE OR REPLACE VIEW analytics.latest_${name} AS
    SELECT ${key}, ${columns.map((field, index) => `snapshot.${index + 1} AS ${field}`).join(", ")}
    FROM (
      SELECT ${key}, argMax(tuple(${columns.join(", ")}),
        tuple(toUInt64(version), is_deleted, received_at)) AS snapshot
      FROM analytics.${name}_events GROUP BY ${key}
    );`;
}

export const analyticsSchema = `

    CREATE DATABASE IF NOT EXISTS analytics;

    CREATE TABLE IF NOT EXISTS analytics.patient_events (
      id String,
      version String,
      kind Nullable(String),
      source Nullable(String),
      family Nullable(String),
      given Nullable(String),
      birth_date Nullable(String),
      is_deleted UInt8,
      received_at DateTime64(3) MATERIALIZED now64(3)
    ) ENGINE = MergeTree ORDER BY (id, received_at);

    CREATE TABLE IF NOT EXISTS analytics.linkage_events (
      cluster_id String,
      version String,
      profile Nullable(String),
      active Nullable(String),
      member_refs String,
      source_ref Nullable(String),
      item_refs String,
      golden_family Nullable(String),
      golden_given Nullable(String),
      golden_birth_date Nullable(String),
      golden_phone Nullable(String),
      is_deleted UInt8,
      received_at DateTime64(3) MATERIALIZED now64(3)
    ) ENGINE = MergeTree ORDER BY (cluster_id, received_at);

    ALTER TABLE analytics.linkage_events
      MODIFY COLUMN active Nullable(String);

    ALTER TABLE analytics.linkage_events
      ADD COLUMN IF NOT EXISTS profile Nullable(String) AFTER version;

    ALTER TABLE analytics.linkage_events
      ADD COLUMN IF NOT EXISTS item_refs String AFTER member_refs;

    ALTER TABLE analytics.linkage_events
      ADD COLUMN IF NOT EXISTS source_ref Nullable(String) AFTER member_refs;

    ALTER TABLE analytics.linkage_events
      ADD COLUMN IF NOT EXISTS golden_family Nullable(String) AFTER member_refs;

    ALTER TABLE analytics.linkage_events
      ADD COLUMN IF NOT EXISTS golden_given Nullable(String) AFTER golden_family;

    ALTER TABLE analytics.linkage_events
      ADD COLUMN IF NOT EXISTS golden_birth_date Nullable(String) AFTER golden_given;

    ALTER TABLE analytics.linkage_events
      ADD COLUMN IF NOT EXISTS golden_phone Nullable(String) AFTER golden_birth_date;

    CREATE TABLE IF NOT EXISTS analytics.condition_events (
      id String,
      version String,
      kind Nullable(String),
      source Nullable(String),
      subject_id String,
      code_system Nullable(String),
      code Nullable(String),
      display Nullable(String),
      onset Nullable(String),
      is_deleted UInt8,
      received_at DateTime64(3) MATERIALIZED now64(3)
    ) ENGINE = MergeTree ORDER BY (id, received_at);

    CREATE TABLE IF NOT EXISTS analytics.task_events (
      id String,
      version String,
      status Nullable(String),
      operation Nullable(String),
      request_key Nullable(String),
      focus_ref Nullable(String),
      source_event Nullable(String),
      cas_replans Nullable(Int64),
      is_deleted UInt8,
      received_at DateTime64(3) MATERIALIZED now64(3)
    ) ENGINE = MergeTree ORDER BY (id, received_at);

    ALTER TABLE analytics.task_events
      ADD COLUMN IF NOT EXISTS source_event Nullable(String) AFTER focus_ref;

    ALTER TABLE analytics.task_events
      ADD COLUMN IF NOT EXISTS cas_replans Nullable(Int64) AFTER source_event;


    ${latestSnapshot("patient", "id", ["version", "kind", "source", "family", "given", "birth_date"])}
    ${latestSnapshot("condition", "id", ["version", "kind", "source", "subject_id", "code_system", "code", "display", "onset"])}
    ${latestSnapshot("linkage", "cluster_id", ["version", "profile", "active", "member_refs", "source_ref", "item_refs", "golden_family", "golden_given", "golden_birth_date", "golden_phone"])}
    ${latestSnapshot("task", "id", ["version", "status", "operation", "request_key", "focus_ref", "source_event", "cas_replans"])}

    CREATE OR REPLACE VIEW analytics.current_patient AS
      SELECT id, version, kind, source, family, given, birth_date
      FROM analytics.latest_patient WHERE is_deleted = 0;

    CREATE OR REPLACE VIEW analytics.current_linkage AS
      SELECT cluster_id, version, active, golden_family, golden_given, golden_birth_date, golden_phone
      FROM analytics.latest_linkage
      WHERE is_deleted = 0 AND active = 'true' AND profile = '${patientLinkageProfile}';

    CREATE OR REPLACE VIEW analytics.current_linkage_membership AS
      SELECT cluster_id, concat('Patient/', member_id) AS member_ref, version, active
      FROM analytics.latest_linkage
      ARRAY JOIN splitByChar('|', member_refs) AS member_id
      WHERE is_deleted = 0 AND active = 'true' AND profile = '${patientLinkageProfile}' AND member_id != '';

    CREATE OR REPLACE VIEW analytics.current_condition AS
      SELECT id, version, kind, source, concat('Patient/', subject_id) AS subject_ref, code_system, code, display, onset
      FROM analytics.latest_condition WHERE is_deleted = 0;

    CREATE OR REPLACE VIEW analytics.current_condition_linkage AS
      SELECT cluster_id, version, active
      FROM analytics.latest_linkage
      WHERE is_deleted = 0 AND active = 'true' AND profile = '${conditionLinkageProfile}';

    CREATE OR REPLACE VIEW analytics.current_condition_linkage_membership AS
      SELECT cluster_id, concat('Condition/', member_id) AS member_ref, version, active
      FROM analytics.latest_linkage
      ARRAY JOIN arrayConcat(splitByChar('|', member_refs), [ifNull(source_ref, '')]) AS member_id
      WHERE is_deleted = 0 AND active = 'true' AND profile = '${conditionLinkageProfile}' AND member_id != '';

    CREATE OR REPLACE VIEW analytics.current_condition_fact AS
      SELECT condition.id AS condition_id,
        concat('Condition/', condition.id) AS condition_ref,
        condition.subject_ref AS subject_ref,
        if(patient_membership.cluster_id = '', condition.subject_ref,
          concat('Linkage/', patient_membership.cluster_id)) AS logical_patient_ref,
        if(condition_membership.cluster_id = '', concat('Condition/', condition.id),
          concat('Linkage/', condition_membership.cluster_id)) AS diagnosis_ref,
        condition.source AS source, condition.code_system AS code_system,
        condition.code AS code, condition.display AS display, condition.onset AS onset
      FROM analytics.current_condition AS condition
      LEFT JOIN analytics.current_linkage_membership AS patient_membership ON patient_membership.member_ref = condition.subject_ref
      LEFT JOIN analytics.current_condition_linkage_membership AS condition_membership ON condition_membership.member_ref = concat('Condition/', condition.id);

    CREATE OR REPLACE VIEW analytics.current_task AS
      SELECT id, version, status, operation, request_key, focus_ref, source_event, cas_replans
      FROM analytics.latest_task WHERE is_deleted = 0;
`;
