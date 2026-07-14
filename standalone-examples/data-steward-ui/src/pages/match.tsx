import { useParams, useSearchParams } from "react-router";
import { useCallback, useEffect, useState } from "react";
import Layout from "@/components/layout";
import { MatchTable } from "@/components/match-table";
import { api } from "@/api/client";
import type { PatientRow, PatientMatchRow, MatchingModel, MatchDetails } from "@/api/types";
import { paramsToObject } from "@/lib/utils";

// Max candidate matches to request from $match. The table paginates over
// these client-side, since the contract no longer paginates server-side.
const MATCH_RESULT_LIMIT = 100;

function fhirPatientToMatchRow(
  resource: Record<string, any>,
  duplicate: boolean,
  matchWeight?: number,
  matchDetails?: MatchDetails,
  normalizedScore?: number
): PatientMatchRow {
  return {
    id: resource.id || "",
    firstname: resource.name?.[0]?.given?.[0] || "",
    lastname: resource.name?.[0]?.family || "",
    birthdate: resource.birthDate || "",
    gender: resource.gender || "",
    email: resource.telecom?.find((t: any) => t.system === "email")?.value || "",
    street: resource.address?.[0]?.line?.[0] || "",
    city: resource.address?.[0]?.city || "",
    state: resource.address?.[0]?.state || "",
    zip: resource.address?.[0]?.postalCode || "",
    country: resource.address?.[0]?.country || "",
    weight: matchWeight,
    normalizedScore,
    duplicate,
    matchDetails,
  };
}

export function MatchPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();

  const [matchPatient, setMatchPatient] = useState<PatientRow | null>(null);
  const [data, setData] = useState<PatientMatchRow[]>([]);
  const [models, setModels] = useState<MatchingModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const params = paramsToObject(searchParams);
  const page = parseInt((params.page as string) || "1");
  const count = parseInt((params.count as string) || "10");
  const threshold = params.threshold ? parseFloat(params.threshold as string) : undefined;

  // Active model is derived from the `model-id` URL param (set by the picker),
  // falling back to "patient-model" or the first available model.
  const modelId = params["model-id"] as string | undefined;
  const model =
    models.find((m) => m.id === modelId) ??
    models.find((m) => m.id === "patient-model") ??
    models[0] ??
    null;

  // The model now exposes thresholds as { certain, probable }. Default to the
  // 'probable' cutoff (the lowest grade still shown in the list) when the user
  // hasn't set one in the UI. The old `manual` key no longer exists — relying
  // on it fell back to 16, which over-filtered candidates (empty Probability
  // column and a flat log-odds chart for the few that survived).
  const effectiveThreshold = threshold ?? model?.thresholds?.probable ?? 0;

  // Load the list of Patient models + patient info once
  useEffect(() => {
    if (!id) return;
    Promise.all([
      api.getModels("Patient"),
      api.getPatients({ page: 1, count: 1, filter: { id } }),
    ]).then(([loadedModels, patients]) => {
      setModels(loadedModels);
      if (patients.items[0]) setMatchPatient(patients.items[0]);
    });
  }, [id]);

  // Load match results when matching params change. The $match contract no
  // longer paginates server-side, so we fetch a capped set of candidates once
  // and let the table page through them client-side (page/count below drive
  // only the table, not the request).
  const fetchMatches = useCallback(async () => {
    if (!id || !model) return;
    setIsLoading(true);
    try {
      const response = await api.matchPatientById(id, {
        count: MATCH_RESULT_LIMIT,
        model: model.id,
        threshold: effectiveThreshold,
      });
      setData(
        response.results.map((r) =>
          fhirPatientToMatchRow(
            { id: r.id, ...r.resource },
            false,
            r.score,
            r.matchDetails,
            r.normalizedScore
          )
        )
      );
    } catch (e) {
      console.error("Failed to load matches", e);
    } finally {
      setIsLoading(false);
    }
  }, [id, model?.id, effectiveThreshold]);

  useEffect(() => {
    if (model) fetchMatches();
  }, [fetchMatches, model]);

  if (!matchPatient || !model) {
    return (
      <Layout breadcrumbItems={[{ title: "Patients", link: "/patients" }, { title: "Loading..." }]}>
        <div className="p-4">Loading...</div>
      </Layout>
    );
  }

  // Build the name from whichever parts exist, falling back to `Patient/:id`
  // so the breadcrumb stays informative for patients missing a first/last name.
  const patientName =
    [matchPatient.firstname, matchPatient.lastname].filter(Boolean).join(" ") ||
    `Patient/${matchPatient.id}`;

  return (
    <Layout
      breadcrumbItems={[
        { title: "Patients", link: "/patients" },
        { title: `Matches for ${patientName}` },
      ]}
    >
      <MatchTable
        matchPatient={matchPatient}
        data={data}
        isLoading={isLoading}
        linkageModels={models}
        selectedModel={model}
        threshold={effectiveThreshold}
        page={page}
        count={count}
      />
    </Layout>
  );
}
