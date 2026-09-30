import type { OperationOutcome } from "./fhir";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly outcome?: OperationOutcome,
  ) {
    super(message);
  }
}

type RequestOptions = {
  method?: string;
  accept?: string;
  /** Sent as JSON. */
  body?: unknown;
};

/**
 * Calls the MDMbox (`/api/...`) or Aidbox (`/fhir/...`) API through the dev-server proxy,
 * which adds the credentials. Errors carry the OperationOutcome text when there is one.
 */
export async function request<T>(url: string, { method = "GET", accept = "application/json", body }: RequestOptions = {}): Promise<T> {
  const response = await fetch(url, {
    method,
    // Always read live data. Browsers keep a `410 Gone` without Cache-Control indefinitely,
    // so a record restored by $unmerge would otherwise still look deleted.
    cache: "no-store",
    // Until its license is activated, Aidbox or MDMbox redirects API requests to its start page.
    redirect: "manual",
    headers: {
      Accept: accept,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.type === "opaqueredirect") {
    const service = url.startsWith("/api/") ? "MDMbox" : "Aidbox";
    throw new ApiError(`${service} redirected ${method} ${url} to its start page. Activate the ${service} license first.`, 0);
  }
  const text = await response.text();
  const data = text ? parseJson(text) : undefined;
  if (!response.ok) {
    const outcome = (data as OperationOutcome | undefined)?.resourceType === "OperationOutcome" ? (data as OperationOutcome) : undefined;
    throw new ApiError(outcomeMessage(outcome) ?? `${method} ${url} failed with HTTP ${response.status}`, response.status, outcome);
  }
  return data as T;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function outcomeMessage(outcome?: OperationOutcome): string | undefined {
  const issue = outcome?.issue?.find((i) => i.severity === "error" || i.severity === "fatal") ?? outcome?.issue?.[0];
  return issue?.details?.text ?? issue?.diagnostics;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
