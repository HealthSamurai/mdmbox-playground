# MDMbox Auto-Merge from an Aidbox Subscription

This example shows how to subscribe to `Patient` create events in Aidbox and call
MDMbox from a small Bun app. When a new patient is created, the app runs
[$match](https://hl7.org/fhir/R4/patient-operation-match.html) with
`onlySingleMatch` and, if MDMbox returns a match, calls `$merge`.

## Set Up Aidbox and MDMbox

First of all, start Aidbox, MDMbox, and the notebook:

```bash
$ docker compose up
```

Once Aidbox is up and running, browse http://localhost:8888 and click
"Continue with Aidbox account". This will automatically issue a developer
license for you and redirect you back.

Then do the same with MDMbox. Open http://localhost:3003 and click
"Sign in to activate".

## Try the Auto-Merge Flow

Open http://localhost:3300 and follow the notebook.

Click **Setup resources** first. The notebook creates the Aidbox subscription
resources, creates a MDMbox API client, links an access policy, and loads
`MatchingModel/patient-example` from `matching-model-patient.json`.

Then click **Seed existing Jane Doe** to create a target record. After that,
click **Create Patient in Aidbox**. Aidbox sends the create event to the Bun app,
the app calls MDMbox `$match`, and if one match is returned, it calls `$merge`.

For a clean demo, use a fresh database or keep one obvious target patient. The
example sends `onlySingleMatch=true` because automatic merge needs one clear
target. Otherwise the app would have to decide which candidate should survive.
You can extend this example with a review queue where a person chooses the target
patient before `$merge` is called.

## How it works

What the notebook above actually does is create an
[`AidboxSubscriptionTopic`](https://www.health-samurai.io/docs/aidbox/modules/topic-based-subscriptions/aidbox-topic-based-subscriptions)
for `Patient/create`:

```json
{
  "resourceType": "AidboxSubscriptionTopic",
  "id": "mdmbox-patient-created",
  "url": "http://mdmbox.example/SubscriptionTopic/mdmbox-patient-created",
  "status": "active",
  "trigger": [
    {
      "resource": "Patient",
      "supportedInteraction": [
        "create"
      ]
    }
  ]
}
```

Then it creates an `AidboxTopicDestination` that points to the Bun webhook:

```json
{
  "resourceType": "AidboxTopicDestination",
  "id": "mdmbox-automerge-webhook",
  "status": "active",
  "kind": "webhook-at-least-once",
  "topic": "http://mdmbox.example/SubscriptionTopic/mdmbox-patient-created",
  "content": "full-resource",
  "includeEntryAction": true,
  "includeVersionId": true,
  "parameter": [
    {
      "name": "endpoint",
      "valueUrl": "http://notebook:3300/webhooks/patient-created"
    },
    {
      "name": "header",
      "valueString": "Authorization: Bearer aidbox-to-bun-secret"
    }
  ]
}
```

The notebook also prepares MDMbox access for the Bun app. It creates
`User/mdmbox-automerge-user` and `Client/mdmbox-automerge-client` through
MDMbox `/api/iam`, then creates an `AccessPolicy` linked to that client.

When the webhook arrives, the Bun app reads the created patient from Aidbox and
sends this `$match` request to MDMbox:

```json
{
  "resourceType": "Parameters",
  "parameter": [
    {
      "name": "modelId",
      "valueString": "patient-example"
    },
    {
      "name": "resource",
      "resource": {
        "resourceType": "Patient",
        "id": "incoming-jane-doe"
      }
    },
    {
      "name": "onlySingleMatch",
      "valueBoolean": true
    },
    {
      "name": "count",
      "valueInteger": 1
    }
  ]
}
```

The patient `id` is kept in the resource sent to `$match`.

If MDMbox returns a match, the app builds a simple `$merge` plan: the existing
matched record is the target and wins scalar conflicts, arrays are union-merged,
missing target fields are filled from the new record, and the new record is
deleted as the source.
