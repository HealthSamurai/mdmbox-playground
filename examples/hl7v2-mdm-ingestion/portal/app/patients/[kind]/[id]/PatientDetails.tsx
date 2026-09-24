"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  PatientFacts,
  type PatientCard,
} from "../../../Dashboard";

type RegistryState = {
  patientCards: PatientCard[];
};

export function PatientDetails({
  kind,
  id,
}: {
  kind: string;
  id: string;
}) {
  const [card, setCard] = useState<PatientCard | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const searchParams = new URLSearchParams({
          patientKind: kind,
          patientId: id,
          pageSize: "1",
        });
        const response = await fetch(`/api/state?${searchParams}`, {
          cache: "no-store",
        });
        const body = (await response.json()) as RegistryState & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(body.error ?? `HTTP ${response.status}`);
        }
        const found =
          body.patientCards.find(
            (candidate) => candidate.kind === kind && candidate.id === id,
          ) ?? null;
        if (active) {
          setCard(found);
          setLoaded(true);
          setError(null);
        }
      } catch (caught) {
        if (active) {
          setLoaded(true);
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      }
    };
    void load();
    const timer = window.setInterval(load, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [id, kind]);

  return (
    <main>
      <header className="topbar detail-topbar">
        <div className="brand">
          <span className="brand-mark">M</span>
          <div>
            <strong>HL7v2 Ingestion</strong>
            <span>Patient details</span>
          </div>
        </div>
        <Link className="back-link" href="/">
          ← Patient registry
        </Link>
      </header>

      {!loaded && <section className="detail-loading">Loading patient…</section>}
      {error && <section className="notice">{error}</section>}
      {loaded && !error && !card && (
        <section className="detail-loading">
          Patient not found. <Link href="/">Back to registry</Link>
        </section>
      )}

      {card && (
        <>
          <section className="detail-hero">
            <div>
              <span className={`patient-kind patient-kind-${card.kind}`}>
                {card.kind === "golden" ? "Cluster" : "Singleton"}
              </span>
              <h1>{card.patient.name}</h1>
              <code>
                {card.reference} · v{card.version}
              </code>
            </div>
            <div className="detail-stats">
              <div>
                <span>Sources</span>
                <strong>{card.patientCount}</strong>
              </div>
              <div>
                <span>Conditions</span>
                <strong>{card.totalConditionCount}</strong>
              </div>
              <div>
                <span>Unique diagnoses</span>
                <strong>{card.uniqueConditionCount}</strong>
              </div>
            </div>
          </section>

          <section className="detail-grid">
            <article className="panel detail-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">
                    {card.kind === "golden" ? "Golden view" : "Source record"}
                  </p>
                  <h2>Demographics</h2>
                </div>
              </div>
              <div className="detail-panel-body">
                <PatientFacts patient={card.patient} />
              </div>
            </article>

            <article className="panel detail-panel">
              <div className="panel-heading">
                <div>
                  <h2>Diagnoses</h2>
                </div>
                <span className="counter">{card.uniqueConditionCount}</span>
              </div>
              <div className="condition-list">
                {card.conditions.map((condition) => (
                  <article className="condition-card" key={condition.reference}>
                    <div className="condition-heading">
                      <div>
                        <span
                          className={`condition-kind condition-kind-${condition.kind}`}
                        >
                          {condition.kind === "linked"
                            ? `${condition.evidence.length} source records`
                            : "1 source record"}
                        </span>
                        <h3>{condition.display}</h3>
                        <code>
                          {condition.system} · {condition.code}
                        </code>
                      </div>
                      <time>
                        {condition.onset
                          ? new Date(condition.onset).toLocaleDateString("en-US")
                          : "Onset unknown"}
                      </time>
                    </div>
                    <div className="condition-evidence">
                      {condition.evidence.map((evidence) => (
                        <details key={evidence.id}>
                          <summary>
                            <strong>{evidence.source ?? "unknown"}</strong>
                            <span>{evidence.subject}</span>
                            <code>{evidence.reference}</code>
                          </summary>
                          <div>
                            <span>Source record</span>
                            <strong>{evidence.display}</strong>
                            <code>
                              {evidence.system} · {evidence.code} · v
                              {evidence.version}
                            </code>
                          </div>
                        </details>
                      ))}
                    </div>
                  </article>
                ))}
                {card.conditions.length === 0 && (
                  <div className="empty">No conditions recorded.</div>
                )}
              </div>
            </article>

            {card.kind === "golden" && (
              <article className="panel detail-panel detail-sources">
                <div className="panel-heading">
                  <div>
                    <h2>Source patients</h2>
                  </div>
                  <span className="counter">{card.sources.length}</span>
                </div>
                <div className="source-records detail-panel-body">
                  {card.sources.map((source, index) => (
                    <details className="source-record" key={source.id}>
                      <summary>
                        <span>Source {index + 1}</span>
                        <strong>{source.source ?? "unknown"}</strong>
                        <code>
                          Patient/{source.id} · v{source.version}
                        </code>
                      </summary>
                      <div className="source-record-body">
                        <PatientFacts patient={source} />
                      </div>
                    </details>
                  ))}
                </div>
              </article>
            )}
          </section>
        </>
      )}
    </main>
  );
}
