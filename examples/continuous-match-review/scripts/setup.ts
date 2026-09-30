// Installs the example BulkMatchingModel in Aidbox and starts continuous matching for it in MDMbox.
// Bun reads AIDBOX_URL, AIDBOX_AUTH, MDMBOX_URL and MDMBOX_AUTH from .env.
import model from "../bulk-matching-model.json";

const AIDBOX_URL = process.env.AIDBOX_URL ?? "http://localhost:8888";
const MDMBOX_URL = process.env.MDMBOX_URL ?? "http://localhost:3003";

// The sample data set of the MDMbox welcome page.
const SAMPLE_PATIENTS = "https://storage.googleapis.com/aidbox-public/fake1000.ndjson.gz";

async function call<T = any>(base: string, auth: string | undefined, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method,
    // Until its license is activated, Aidbox or MDMbox redirects API requests to its start page.
    redirect: "manual",
    headers: {
      Accept: "application/json",
      ...(auth ? { Authorization: auth } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error(
      `${method} ${base}${path} was redirected to ${response.headers.get("location")}. Activate the license: open ${base} in a browser.`,
    );
  }
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${base}${path} → HTTP ${response.status}: ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

const aidbox = <T = any>(method: string, path: string, body?: unknown) => call<T>(AIDBOX_URL, process.env.AIDBOX_AUTH, method, path, body);
const mdmbox = <T = any>(method: string, path: string, body?: unknown) => call<T>(MDMBOX_URL, process.env.MDMBOX_AUTH, method, path, body);

// Status is FHIR Parameters; batch counts are parts of `progress`.
const parameter = (status: any, name: string) => status.parameter?.find((p: any) => p.name === name);
const part = (param: any, name: string) => param?.part?.find((p: any) => p.name === name);

// Saving a model creates a new version, and a process running an older version reports that it
// needs a rebuild, so the model is saved only when its content differs.
const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value !== null && typeof value === "object"
      ? `{${Object.keys(value)
          .filter((key) => key !== "meta")
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
          .join(",")}}`
      : JSON.stringify(value);

async function setup() {
  // 1. Patients to match
  const { total } = await aidbox("GET", "/fhir/Patient?_count=0&_total=accurate");
  if (total > 0) {
    console.log(`Aidbox has ${total} patients.`);
  } else {
    console.log("No patients yet: loading the MDMbox sample data set…");
    await aidbox("POST", "/fhir/$load", { source: SAMPLE_PATIENTS });
    console.log(`Loaded ${(await aidbox("GET", "/fhir/Patient?_count=0&_total=accurate")).total} patients.`);
  }

  // 2. The model
  const saved = await aidbox("GET", `/fhir/BulkMatchingModel/${model.id}`).catch(() => undefined);
  if (saved && canonical(saved) === canonical(model)) {
    console.log(`BulkMatchingModel/${model.id} is up to date.`);
  } else {
    await aidbox("PUT", `/fhir/BulkMatchingModel/${model.id}`, model);
    console.log(`Saved BulkMatchingModel/${model.id}.`);
  }

  // 3. The process: prepares the data, matches the existing patients, then keeps matching inserts
  const started = await mdmbox("POST", `/api/continuous-match/${model.id}/start`, {});
  console.log(`Continuous matching is ${parameter(started, "status")?.valueCode}. Waiting for the existing patients to be matched…`);

  for (let attempt = 0; attempt < 120; attempt++) {
    await Bun.sleep(2000);
    const status = await mdmbox("GET", `/api/continuous-match/${model.id}/status`);
    const state = parameter(status, "status")?.valueCode;
    const pending = ["pending", "running"].reduce((sum, name) => sum + (part(parameter(status, "progress"), name)?.valueDecimal ?? 0), 0);
    if (state === "failed") throw new Error(`Continuous matching failed: ${parameter(status, "error")?.valueString}`);
    if (state === "running" && pending === 0) {
      console.log(`Done: ${parameter(status, "pairs")?.valueDecimal ?? 0} pairs found. Start the app with \`bun dev\`.`);
      return;
    }
  }
  console.log("Matching is still in progress; follow it in the app.");
}

await setup().catch((error: Error) => {
  console.error(`Setup failed: ${error.message}`);
  process.exit(1);
});
