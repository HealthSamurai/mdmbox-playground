"use client";

import { useEffect, useState } from "react";

export type PatientView = {
  id: string;
  version: string;
  source: string | null;
  name: string;
  birthDate: string | null;
  gender: string | null;
  phone: string | null;
  address: string | null;
  identifiers: Array<{ system: string; value: string }>;
};

export type ConditionView = {
  id: string;
  kind: "linked" | "singleton";
  reference: string;
  system: string | null;
  code: string | null;
  display: string;
  onset: string | null;
  evidence: Array<{
    id: string;
    reference: string;
    version: string;
    source: string | null;
    subject: string | null;
    system: string | null;
    code: string | null;
    display: string;
    onset: string | null;
    recordedDate: string | null;
  }>;
};

export type PatientCard = {
  id: string;
  kind: "golden" | "singleton";
  reference: string;
  version: string;
  patient: PatientView;
  sources: PatientView[];
  patientCount: number;
  totalConditionCount: number;
  uniqueConditionCount: number;
  duplicateConditionCount: number;
  conditions: ConditionView[];
};

type State = {
  generatedAt: string;
  aidbox: {
    sources: number;
    goldens: number;
    clusters: number;
    memberships: number;
    pending: number;
    receipts: number;
    creates: number;
    updates: number;
    conditions: number;
    uniqueConditions: number;
    conditionLinkages: number;
  };
  analytics: {
    sources?: number;
    goldens?: number;
    clusters?: number;
    memberships?: number;
    receipts?: number;
    creates?: number;
    updates?: number;
    error?: string;
  };
  destinations: Array<{ id: string; ok: boolean }>;
  registry: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    patientKind: "all" | "golden" | "singleton";
    conditionDuplicates: "all" | "present";
  };
  patientCards: PatientCard[];
};

function StatusMark({ ok }: { ok: boolean }) {
  return <span className={ok ? "status status-ok" : "status status-warn"} />;
}

function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: number | string;
  note: string;
}) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function Fact({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string | null | undefined;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "patient-fact patient-fact-wide" : "patient-fact"}>
      <span>{label}</span>
      <strong>{value || "—"}</strong>
    </div>
  );
}

export function PatientFacts({ patient }: { patient: PatientView }) {
  return (
    <div className="patient-facts">
      <Fact label="Name" value={patient.name} />
      <Fact label="Birth date" value={patient.birthDate} />
      <Fact label="Gender" value={patient.gender} />
      <Fact label="Phone" value={patient.phone} />
      <Fact label="Address" value={patient.address} wide />
      <div className="patient-fact patient-fact-wide">
        <span>Identifiers</span>
        {patient.identifiers.length > 0 ? (
          <ul className="patient-identifiers">
            {patient.identifiers.map((identifier) => (
              <li key={`${identifier.system}|${identifier.value}`}>
                <strong>{identifier.system}: {identifier.value}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <strong>—</strong>
        )}
      </div>
    </div>
  );
}

export function Dashboard() {
  const [data, setData] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [patientKind, setPatientKind] = useState<
    "all" | "golden" | "singleton"
  >(
    "all",
  );
  const [conditionDuplicates, setConditionDuplicates] = useState<
    "all" | "present"
  >("all");
  const [page, setPage] = useState(1);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const abortController = new AbortController();
    const load = async () => {
      try {
        const searchParams = new URLSearchParams({
          patientKind,
          conditionDuplicates,
          page: String(page),
          pageSize: "20",
        });
        const response = await fetch(`/api/state?${searchParams}`, {
          cache: "no-store",
          signal: abortController.signal,
        });
        const body = (await response.json()) as State & { error?: string };
        if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
        if (active) {
          setData(body);
          if (body.registry.page !== page) setPage(body.registry.page);
          setError(null);
        }
      } catch (caught) {
        if (active && !abortController.signal.aborted) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      } finally {
        if (active) timer = window.setTimeout(load, 2000);
      }
    };
    void load();
    return () => {
      active = false;
      abortController.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [conditionDuplicates, page, patientKind]);

  const analyticsReady = Boolean(data && !data.analytics.error);
  const analyticsMatches =
    data &&
    analyticsReady &&
    Number(data.analytics.sources) === data.aidbox.sources &&
    Number(data.analytics.clusters) === data.aidbox.clusters &&
    Number(data.analytics.receipts) === data.aidbox.receipts;
  const visiblePatients = data?.patientCards ?? [];
  const registry = data?.registry;
  const firstVisible =
    registry && registry.total > 0
      ? (registry.page - 1) * registry.pageSize + 1
      : 0;
  const lastVisible = registry
    ? Math.min(registry.page * registry.pageSize, registry.total)
    : 0;

  return (
    <main>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">M</span>
          <div>
            <strong>HL7v2 Ingestion</strong>
            <span>MDMbox · Patient matching</span>
          </div>
        </div>
        <nav>
          <a href="http://localhost:8890" target="_blank">Aidbox</a>
          <a href="http://localhost:3011" target="_blank">Interbox</a>
          <a href="http://localhost:3002/d/mdm-real-world" target="_blank">Grafana</a>
          <a href="http://localhost:3005/api/docs" target="_blank">MDMbox API</a>
        </nav>
        <div className="live">
          <StatusMark ok={!error} />
          {error ? "Disconnected" : "Live · 2s"}
        </div>
      </header>

      <section className="hero">
        <div>
          <h1>Ingestion status</h1>
          <p className="lede">
            Source records, patient clusters, and analytics delivery.
          </p>
        </div>
        <div className="hero-state">
          <span>Last updated</span>
          <strong>
            {data
              ? new Date(data.generatedAt).toLocaleTimeString("en-US")
              : "Loading…"}
          </strong>
          <small>{data?.aidbox.receipts ?? 0} messages committed</small>
        </div>
      </section>

      {error && (
        <section className="notice">
          Unable to load data: <code>{error}</code>
        </section>
      )}

      <section className="metrics" aria-label="Ingestion metrics">
        <Metric label="Source patients" value={data?.aidbox.sources ?? "—"} note="original records" />
        <Metric label="Active clusters" value={data?.aidbox.clusters ?? "—"} note={`${data?.aidbox.memberships ?? 0} memberships`} />
        <Metric label="Source conditions" value={data?.aidbox.conditions ?? "—"} note="original diagnosis records" />
        <Metric label="Unique diagnoses" value={data?.aidbox.uniqueConditions ?? "—"} note={`${data?.aidbox.conditionLinkages ?? 0} diagnosis groups`} />
      </section>

      <section className="lower-grid">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Analytics delivery</p>
              <h2>Aidbox ↔ ClickHouse</h2>
            </div>
            <span className={analyticsMatches ? "fresh" : "stale"}>
              {analyticsMatches ? "In sync" : "Pending sync"}
            </span>
          </div>
          <div className="comparison">
            <div>
              <span>Aidbox</span>
              <b>{data?.aidbox.sources ?? "—"} / {data?.aidbox.clusters ?? "—"} / {data?.aidbox.receipts ?? "—"}</b>
              <small>patients / clusters / commits</small>
            </div>
            <div className="comparison-arrow">→</div>
            <div>
              <span>ClickHouse</span>
              <b>
                {analyticsReady
                  ? `${data?.analytics.sources} / ${data?.analytics.clusters} / ${data?.analytics.receipts}`
                  : "Unavailable"}
              </b>
              <small>patients / clusters / commits</small>
            </div>
          </div>
          <div className="destinations">
            {(data?.destinations ?? []).map((destination) => (
              <span key={destination.id}>
                <StatusMark ok={destination.ok} />
                {destination.id.replace("-clickhouse", "")}
              </span>
            ))}
          </div>
        </div>

      </section>

      <section className="workspace">
        <div className="panel">
          <div className="panel-heading registry-heading">
            <div>
              <h2>Patient registry</h2>
            </div>
            <div className="registry-controls">
              <div className="filter" aria-label="Record type">
                {[
                  ["all", "All"],
                  ["golden", "Clusters"],
                  ["singleton", "Singletons"],
                ].map(([value, label]) => (
                  <button
                    className={patientKind === value ? "filter-active" : ""}
                    key={value}
                    onClick={() => {
                      setPatientKind(
                        value as "all" | "golden" | "singleton",
                      );
                      setPage(1);
                    }}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="filter" aria-label="Duplicate diagnoses">
                {[
                  ["all", "All diagnoses"],
                  ["present", "With duplicates"],
                ].map(([value, label]) => (
                  <button
                    className={
                      conditionDuplicates === value ? "filter-active" : ""
                    }
                    key={value}
                    onClick={() => {
                      setConditionDuplicates(value as "all" | "present");
                      setPage(1);
                    }}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="registry-result-count">
                {registry
                  ? `${firstVisible}–${lastVisible} of ${registry.total}`
                  : "—"}
              </span>
            </div>
          </div>
          <div className="patient-registry">
            <div className="registry-row registry-columns">
              <span>Patient</span>
              <span>Type</span>
              <span className="registry-numeric-heading">Sources</span>
              <span className="registry-numeric-heading">Conditions</span>
              <span className="registry-numeric-heading">Unique</span>
              <div className="registry-duplicates-heading">
                <span>Duplicates</span>
                <details className="column-info">
                  <summary aria-label="About duplicate conditions">i</summary>
                  <div className="column-info-content">
                    Extra source condition records for this patient:
                    <strong>Conditions − Unique.</strong>
                    For example, 4 records representing 2 unique diagnoses count as 2 duplicates.
                  </div>
                </details>
              </div>
            </div>
            {visiblePatients.map((card) => (
              <a
                className="registry-row registry-record"
                href={`/patients/${card.kind}/${card.id}`}
                key={`${card.kind}-${card.id}`}
              >
                <div className="registry-patient">
                  <strong>{card.patient.name}</strong>
                  <span>
                    {card.patient.birthDate ?? "Birth date unknown"}
                  </span>
                  <div className="registry-reference">
                    <code>{card.reference}</code>
                  </div>
                </div>
                <div>
                  <span className={`patient-kind patient-kind-${card.kind}`}>
                    {card.kind === "golden" ? "Cluster" : "Singleton"}
                  </span>
                </div>
                <strong className="registry-count">{card.patientCount}</strong>
                <strong className="registry-count">
                  {card.totalConditionCount}
                </strong>
                <strong className="registry-count registry-count-unique">
                  {card.uniqueConditionCount}
                </strong>
                <strong className={`registry-count ${card.duplicateConditionCount > 0 ? "registry-count-duplicates" : "registry-count-zero"}`}>
                  {card.duplicateConditionCount}
                </strong>
              </a>
            ))}
            {data && visiblePatients.length === 0 && (
              <div className="empty">
                {data.registry.total === 0
                  ? "No records match these filters."
                  : "No records on this page."}
              </div>
            )}
            {registry && registry.total > 0 && (
              <div
                className="registry-pagination"
                aria-label="Patient registry pages"
              >
                <button
                  disabled={registry.page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  type="button"
                >
                  ← Previous
                </button>
                <span>
                  Page {registry.page} of {registry.totalPages}
                </span>
                <button
                  disabled={registry.page >= registry.totalPages}
                  onClick={() =>
                    setPage((current) =>
                      Math.min(registry.totalPages, current + 1),
                    )
                  }
                  type="button"
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

    </main>
  );
}
