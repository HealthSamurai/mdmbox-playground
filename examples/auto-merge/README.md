# Auto-Merge

This example shows how to configure Aidbox to notify a small auto-merge handler
app when a new Patient is created.

The app receives the notification, asks MDMbox if the new Patient is a
duplicate, and if it is, sends the merge request — all automatically.

## Set Up Aidbox and MDMbox

First of all, start Aidbox and MDMbox (see the [parent README](../README.md)):

```bash
$ docker compose up
```

Once Aidbox is up and running, browse http://localhost:8888 and click "Continue
with Aidbox account". This will automatically issue a developer license for you
and redirect you back.

Then do the same with MDMbox. Open http://localhost:3003 and click "Sign in to
activate". Walk through the [Welcome to MDMBox](http://localhost:3003/welcome)
setup: import sample patients and install the matching model.

## Start the Auto-Merge Handler App

The handler app is a **long-running service** — Aidbox calls it whenever a
Patient is created. Start it from this directory:

```bash
$ docker compose up
```

This runs `auto_merge_handler_app.py` as the
`auto-merge-handler-app` service on the shared `mdmbox-playground` network, so
Aidbox can reach it at `http://auto-merge-handler-app:3301`.

## Run the Auto-Merge Flow

The driver is a plain Python script.
It sets up the subscription, creates a duplicate Patient, and watches the
handler merge it:

```bash
$ python3 run.py
```

It prints each step and its request/response. The flow runs in six steps:

1. **PUT `AidboxSubscriptionTopic/mdmbox-patient-created`** — topic for `Patient/create`.
2. **POST `AidboxTopicDestination`** — webhook destination pointing at the handler app.
3. **PUT `Patient/<main>`** — an existing Patient (the survivor candidate).
4. **POST `Patient`** — the new duplicate; this create fires the webhook.
5. **GET `<handler>/api/events?patientId=<new>`** — poll the handler's flow log
   until the async `$match` + `$merge` reaches a terminal state
   (`merged` / `no-match` / `error`).
6. **GET `Patient/<target>`** — read the merged survivor. The merge **target is
   chosen by `$match`**, not by the driver, so this reads whichever existing
   record the duplicate was merged into.

## How it works

The driver creates an `AidboxSubscriptionTopic` for the patient-create event:

```json
{
  "resourceType": "AidboxSubscriptionTopic",
  "id": "mdmbox-patient-created",
  "url": "http://mdmbox.example/SubscriptionTopic/mdmbox-patient-created",
  "status": "active",
  "trigger": [
    {
      "resource": "Patient",
      "supportedInteraction": ["create"]
    }
  ]
}
```

Then it creates an `AidboxTopicDestination`. This tells Aidbox where to send a
request when the event is triggered — the auto-merge handler app:

```json
{
  "resourceType": "AidboxTopicDestination",
  "id": "mdmbox-automerge-webhook",
  "meta": {
    "profile": [
      "http://aidbox.app/StructureDefinition/aidboxtopicdestination-webhook-at-least-once"
    ]
  },
  "status": "active",
  "kind": "webhook-at-least-once",
  "topic": "http://mdmbox.example/SubscriptionTopic/mdmbox-patient-created",
  "content": "full-resource",
  "includeEntryAction": true,
  "includeVersionId": true,
  "parameter": [
    {
      "name": "endpoint",
      "valueUrl": "http://auto-merge-handler-app:3301/webhooks/patient-created"
    },
    {
      "name": "header",
      "valueString": "Authorization: Bearer aidbox-to-bun-secret"
    }
  ]
}
```

When a Patient is created, Aidbox POSTs the notification to the handler app. The
handler (`auto_merge_handler_app.py`) reads the new Patient, runs `$match`
against MDMbox, and — if there is a single confident match — builds a merge plan
(PUT the merged target + DELETE the source) and runs `$merge`. Every step is
recorded in an in-memory flow log the driver polls via `/api/events`.

```mermaid
sequenceDiagram
    participant Client
    participant Aidbox
    participant Handler as Handler app
    participant MDMbox

    Client->>Aidbox: POST /fhir/Patient - new duplicate
    Aidbox->>Handler: webhook via AidboxTopicDestination
    Handler->>MDMbox: match request
    MDMbox-->>Handler: candidate existing Patient
    Handler->>MDMbox: merge request
    MDMbox-->>Handler: merged
```
