# MDMbox as an Aidbox App

This example shows how to configure Aidbox to forward [$match](https://hl7.org/fhir/R4/patient-operation-match.html) requests to MDMbox. This is useful if you want to keep your whole FHIR API on one domain.

## Set Up Aidbox and MDMbox

First of all, start Aidbox and MDMbox:

```bash
$ docker compose up
```

Once Aidbox is up and running, browse http://localhost:8888 and click "Continue with Aidbox account". This will automatically issue a developer license for you and redirect you back.

Then you do the same with MDMbox. Open http://localhost:3003 and click "Sign in to activate".

You'll see the [Welcome to MDMBox](http://localhost:3003/welcome) page. Click your way through the setup steps to import sample patients and install a matching model.

## Register MDMbox in Aidbox

Open http://localhost:3300 and follow the instructions there. This is a notebook that'll guide you through the necessary steps to link MDMbox and Aidbox together and test the request forwarding.

## How it works

What the notebook above actually does is simply help you register MDMbox as an [App](https://www.health-samurai.io/docs/aidbox/developer-experience/apps) in Aidbox. You make a `PUT /App/mdmbox.match` request with a body like this:

```json
{
  "resourceType": "App",
  "id": "mdmbox.match",
  "apiVersion": 1,
  "type": "app",
  "endpoint": {
    "type": "http-rpc",
    "url": "http://mdmbox:3000/api/aidbox-app-proxy",
    "secret": "mdmbox-match-secret"
  },
  "operations": {
    "patient-match": {
      "method": "POST",
      "path": [
        "fhir",
        "Patient",
        "$match"
      ]
    },
    "patient-merge": {
      "method": "POST",
      "path": [
        "$merge"
      ]
    }
  }
}
```

There you list which routes you operations you wish to be forwarded by Aidbox to the App.
