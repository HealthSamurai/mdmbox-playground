import net from "node:net";

const host = process.env.INTERBOX_MLLP_HOST ?? "127.0.0.1";
const port = Number(process.env.INTERBOX_MLLP_PORT ?? "2576");
const aidboxUrl = process.env.AIDBOX_URL ?? "http://localhost:8890";
const aidboxUser = process.env.AIDBOX_USER ?? "root";
const aidboxPassword = process.env.AIDBOX_PASSWORD ?? "showcase";
const auth = `Basic ${Buffer.from(
  `${aidboxUser}:${aidboxPassword}`,
).toString("base64")}`;
const sourceCount = Number(process.argv[2] ?? "100");
const batchId =
  process.env.SHOWCASE_SEED_BATCH ?? Date.now().toString(36).toLowerCase();

if (
  !Number.isSafeInteger(sourceCount) ||
  sourceCount < 1 ||
  sourceCount > 5_000
) {
  throw new Error("Source patient count must be an integer between 1 and 5000");
}
if (!/^[a-z0-9-]{1,16}$/.test(batchId)) {
  throw new Error("SHOWCASE_SEED_BATCH must contain 1–16 characters: a-z, 0-9 or '-'");
}

type Message = {
  controlId: string;
  body: string;
  conditionKeys: string[];
};

type Person = {
  ordinal: number;
  messages: Message[];
  update?: Message;
};

const sources = ["REGISTRY", "HOSPITAL", "LAB", "CLAIMS"];
const diagnosisCatalog = [
  { code: "I10", display: "Essential hypertension" },
  { code: "E11.9", display: "Type 2 diabetes mellitus" },
  { code: "J18.9", display: "Pneumonia, unspecified organism" },
  { code: "I50.9", display: "Heart failure, unspecified" },
  { code: "N39.0", display: "Urinary tract infection" },
  { code: "J45.9", display: "Asthma, unspecified" },
];

type Diagnosis = {
  setId: number;
  code: string;
  display: string;
  onset: string;
};

function padded(value: number) {
  return String(value).padStart(5, "0");
}

function birthDate(ordinal: number) {
  const year = 1940 + (ordinal % 60);
  const month = String(1 + (ordinal % 12)).padStart(2, "0");
  const day = String(1 + (ordinal % 27)).padStart(2, "0");
  return `${year}${month}${day}`;
}

function adt({
  source,
  controlId,
  event = "A01",
  mrn,
  family,
  given,
  dateOfBirth,
  gender,
  address,
  phone,
  diagnoses = [],
}: {
  source: string;
  controlId: string;
  event?: "A01" | "A08";
  mrn: string;
  family: string;
  given: string;
  dateOfBirth: string;
  gender: "M" | "F";
  address: string;
  phone: string;
  diagnoses?: Diagnosis[];
}): Message {
  return {
    controlId,
    conditionKeys: diagnoses.map(
      (diagnosis) => `${diagnosis.code}|${diagnosis.onset}`,
    ),
    body: [
      `MSH|^~\\&|${source}|SHOWCASE-SEED|AIDBOX|MDM|20260728120000||ADT^${event}|${controlId}|P|2.5`,
      `EVN|${event}|20260728120000`,
      `PID|1||${mrn}^^^${source}^MR||${family}^${given}||${dateOfBirth}|${gender}|||${address}||${phone}`,
      "PV1|1|I",
      ...diagnoses.map(
        (diagnosis) =>
          `DG1|${diagnosis.setId}||${diagnosis.code}^${diagnosis.display}^http://hl7.org/fhir/sid/icd-10|${diagnosis.display}|${diagnosis.onset}|F`,
      ),
    ].join("\r"),
  };
}

function diagnoses(ordinal: number, sourceIndex: number): Diagnosis[] {
  if (ordinal % 5 === 0) return [];
  const month = String(1 + (ordinal % 9)).padStart(2, "0");
  const day = String(1 + (ordinal % 25)).padStart(2, "0");
  const shared = diagnosisCatalog[ordinal % diagnosisCatalog.length]!;
  const result: Diagnosis[] = [
    {
      setId: 1,
      ...shared,
      onset: `2025${month}${day}120000`,
    },
  ];
  if ((ordinal + sourceIndex) % 3 === 0) {
    const distinct =
      diagnosisCatalog[
        (ordinal + sourceIndex + 2) % diagnosisCatalog.length
      ]!;
    result.push({
      setId: 2,
      ...distinct,
      onset: `2026${month}${day}090000`,
    });
  }
  return result;
}

function dataset(count: number): Person[] {
  const people: Person[] = [];
  let remaining = count;
  let ordinal = 1;
  let clustered = 0;

  while (remaining > 0) {
    const desiredSize = ordinal % 4 === 0 ? 1 : 2 + (ordinal % 3);
    const size = Math.min(desiredSize, remaining);
    const id = padded(ordinal);
    const family = `Seed${batchId}Family${id}`;
    const given = `SeedGiven${id}`;
    const dateOfBirth = birthDate(ordinal);
    const gender = ordinal % 2 === 0 ? "F" : "M";
    const phone = `+7496${String(ordinal).padStart(7, "0")}`;
    const personSources = sources.slice(0, size);
    const messages = personSources.map((source, sourceIndex) =>
      adt({
        source,
        controlId: `seed-${batchId}-p${id}-s${sourceIndex + 1}-a01`,
        mrn: `B${batchId}-${id}-${source}`,
        family,
        given,
        dateOfBirth,
        gender,
        address: `${ordinal} Bulk Street^^Moscow^^${110000 + ordinal}^RU`,
        phone,
        diagnoses: diagnoses(ordinal, sourceIndex),
      }),
    );

    const person: Person = { ordinal, messages };
    if (size > 1) {
      clustered += 1;
      if (clustered === 1 || clustered % 5 === 0) {
        person.update = adt({
          source: personSources[0],
          controlId: `seed-${batchId}-p${id}-s1-a08`,
          event: "A08",
          mrn: `B${batchId}-${id}-${personSources[0]}`,
          family,
          given,
          dateOfBirth,
          gender,
          address: `${ordinal} Bulk Street Apt 8^^Moscow^^${110000 + ordinal}^RU`,
          phone: `${phone}8`,
        });
      }
    }

    people.push(person);
    remaining -= size;
    ordinal += 1;
  }

  return people;
}

async function send(message: Message) {
  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`MLLP timeout for ${message.controlId}`));
    }, 15_000);
    let response = "";

    socket.on("connect", () => {
      socket.write(`\x0b${message.body}\x1c\x0d`);
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (!response.includes("\x1c\r")) return;
      clearTimeout(timer);
      socket.end();
      if (response.includes("|AA|") || response.includes("|CA|")) resolve();
      else reject(new Error(`Negative MLLP ACK for ${message.controlId}: ${response}`));
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function sendConcurrently(messages: Message[], concurrency = 20) {
  let cursor = 0;
  let delivered = 0;
  const workerCount = Math.min(concurrency, messages.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < messages.length) {
        const message = messages[cursor++];
        await send(message);
        delivered += 1;
        if (delivered % 25 === 0 || delivered === messages.length) {
          console.log(`MLLP accepted: ${delivered}/${messages.length}`);
        }
      }
    }),
  );
}

async function completedSeedTasks() {
  const completed = new Set<string>();
  const failed = new Map<string, string>();
  let page = 1;

  while (true) {
    const response = await fetch(
      `${aidboxUrl}/fhir/Task?_count=500&_page=${page}`,
      { headers: { Authorization: auth, Accept: "application/fhir+json" } },
    );
    if (!response.ok) {
      throw new Error(`Task search returned ${response.status}: ${await response.text()}`);
    }
    const bundle = await response.json();
    const entries = bundle.entry ?? [];
    for (const entry of entries) {
      const task = entry.resource;
      if (typeof task?.id !== "string" || !task.id.startsWith("seed-")) continue;
      if (task.status === "completed") completed.add(task.id);
      else if (["failed", "cancelled", "rejected"].includes(task.status)) {
        failed.set(task.id, task.status);
      }
    }
    if (entries.length < 500 || page * 500 >= (bundle.total ?? 0)) break;
    page += 1;
  }

  return { completed, failed };
}

async function waitCompleted(messages: Message[]) {
  const expected = new Set(messages.map((message) => message.controlId));
  const deadline =
    Date.now() + Math.max(120_000, Math.min(30 * 60_000, messages.length * 2_000));
  let lastReported = -1;

  while (Date.now() < deadline) {
    const { completed, failed } = await completedSeedTasks();
    for (const id of expected) {
      const status = failed.get(id);
      if (status) throw new Error(`Task/${id} reached terminal status ${status}`);
    }
    const count = [...expected].filter((id) => completed.has(id)).length;
    if (count !== lastReported) {
      console.log(`Aidbox completed Tasks: ${count}/${expected.size}`);
      lastReported = count;
    }
    if (count === expected.size) return;
    await Bun.sleep(1_000);
  }

  throw new Error(`Timed out waiting for ${expected.size} completed seed Tasks`);
}

const people = dataset(sourceCount);
const creates = people.flatMap((person) => person.messages);
const updates = people.flatMap((person) => (person.update ? [person.update] : []));
const clusterSizes = people
  .map((person) => person.messages.length)
  .filter((size) => size > 1);
const singletonCount = people.length - clusterSizes.length;
const rawConditionCount = creates.reduce(
  (count, message) => count + message.conditionKeys.length,
  0,
);
const uniqueConditionCount = people.reduce(
  (count, person) =>
    count +
    new Set(person.messages.flatMap((message) => message.conditionKeys)).size,
  0,
);

console.log(
  `seed ${batchId}: ${creates.length} source Patients, ${clusterSizes.length} clusters, ` +
    `${singletonCount} singletons, ${rawConditionCount} source Conditions, ` +
    `${uniqueConditionCount} unique diagnoses, ${updates.length} A08 updates`,
);
console.log("phase 1: create source records (concurrently, CAS/replan is expected)");
await sendConcurrently(creates);
await waitCompleted(creates);

if (updates.length > 0) {
  console.log("phase 2: update existing source records and golden views");
  await sendConcurrently(updates);
  await waitCompleted(updates);
}

console.log(
  `SEED READY (${batchId}): ${creates.length} sources, ${people.length} logical people, ` +
    `${clusterSizes.reduce((sum, size) => sum + size, 0)} memberships, ` +
    `${rawConditionCount} source Conditions, ${uniqueConditionCount} unique diagnoses, ` +
    `${creates.length + updates.length} receipts`,
);

export {};
