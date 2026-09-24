import { HttpError, MdmSendFailure, planMdmCommand, type CommitPlan, type MdmCommand, type PlannerConfig } from "./planning.ts";
import { decodeCommand } from "./command.ts";

function baseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function auth(config: PlannerConfig): string {
  return `Basic ${Buffer.from(
    `${config.aidboxUser}:${config.aidboxPassword}`,
  ).toString("base64")}`;
}

function headers(config: PlannerConfig): Record<string, string> {
  return {
    Authorization: auth(config),
    "Content-Type": "application/fhir+json",
    Accept: "application/fhir+json",
  };
}

function bodyText(body: unknown): string {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return text.length > 1200 ? `${text.slice(0, 1200)}…` : text;
}

function transientStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 425 || status === 429;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function issueCodes(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const direct = (body as { issue?: Array<{ code?: string }> }).issue;
  const entries = (
    body as {
      entry?: Array<{
        resource?: { issue?: Array<{ code?: string }> };
      }>;
    }
  ).entry;
  return [
    ...(direct ?? []).map((issue) => issue.code ?? ""),
    ...(entries ?? []).flatMap((entry) =>
      (entry.resource?.issue ?? []).map((issue) => issue.code ?? ""),
    ),
  ];
}

function transactionFailed(body: unknown): boolean {
  const entries = (
    body as { entry?: Array<{ response?: { status?: string } }> } | undefined
  )?.entry;
  return Boolean(
    entries?.some((entry) => {
      const status = Number(entry.response?.status?.slice(0, 3));
      return Number.isFinite(status) && status >= 400;
    }),
  );
}

function conflict(error: unknown): boolean {
  const text = error instanceof HttpError
    ? bodyText(error.body).toLowerCase()
    : "";
  return (
    error instanceof HttpError &&
    ([409, 412].includes(error.status) ||
      issueCodes(error.body).some((code) =>
        ["conflict", "duplicate"].includes(code),
      ) ||
      text.includes("conflict"))
  );
}

async function postCommit(
  config: PlannerConfig,
  url: string,
  body: unknown,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new MdmSendFailure(
      "transient",
      "destination_unreachable",
      error instanceof Error ? error.message : String(error),
    );
  }
  const responseBody = await readBody(response);
  if (!response.ok || transactionFailed(responseBody)) {
    throw new HttpError(
      response.status,
      responseBody,
      `POST ${url} returned ${response.status}: ${bodyText(responseBody)}`,
    );
  }
}

export async function commitPlan(
  config: PlannerConfig,
  plan: CommitPlan,
): Promise<void> {
  if (plan.kind === "committed") return;
  await postCommit(
    config,
    `${baseUrl(config.aidboxUrl)}/fhir`,
    plan.transaction,
  );
}

function classify(error: unknown): MdmSendFailure {
  if (error instanceof MdmSendFailure) return error;
  if (error instanceof HttpError) {
    const transient = transientStatus(error.status);
    return new MdmSendFailure(
      transient ? "transient" : "permanent",
      transient ? "destination_unreachable" : "destination_rejected",
      error.message,
    );
  }
  return new MdmSendFailure(
    "permanent",
    "mdm_planning_failed",
    error instanceof Error ? error.message : String(error),
  );
}

export async function commitCommand(
  config: PlannerConfig,
  initialCommand: MdmCommand,
): Promise<void> {
  let command = initialCommand;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const plan = await planMdmCommand(config, command);
    if (plan.kind === "committed") return;
    try {
      await commitPlan(config, plan);
      return;
    } catch (error) {
      if (!conflict(error)) throw error;
      console.info(`mdm-aidbox: CAS conflict; replanning attempt ${attempt + 1}`);
      command = {
        ...command,
        casReplanCount: (command.casReplanCount ?? 0) + 1,
      };
    }
  }
  throw new MdmSendFailure(
    "transient",
    "cas_contention",
    `CAS contention did not settle for ${initialCommand.messageId}`,
  );
}

export type DeliveryOutcome<R> = {
  readonly resource: R;
  readonly status: "accepted" | "rejected" | "retry";
  readonly errorKind?: string;
  readonly message?: string;
};

export async function deliverCommands<R>(
  config: PlannerConfig,
  resources: readonly R[],
): Promise<DeliveryOutcome<R>[]> {
  const outcomes: DeliveryOutcome<R>[] = [];
  for (const resource of resources) {
    try {
      await commitCommand(config, decodeCommand(resource));
      outcomes.push({ resource, status: "accepted" });
    } catch (error) {
      const failure = classify(error);
      outcomes.push({ resource, status: failure.failure === "transient" ? "retry" : "rejected", errorKind: failure.errorKind, message: failure.message });
    }
  }
  return outcomes;
}
