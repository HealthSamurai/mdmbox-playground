# MDMbox Examples

All examples use MDMbox alongside Aidbox. The two services share an Aidbox database, so examples can use Aidbox's FHIR API for resources and MDMbox's API for master-data-management operations.

The Compose example uses MDMbox `2608` with Aidbox `2608`. These monthly tags receive updates within the selected versions; run `docker compose pull` and recreate the containers to update. Use an exact published `YYMM.N` tag when you need a fixed version. MDMbox supports Aidbox versions from the current LTS through the latest release. `edge` is a development image; only the [Continuous matching review](continuous-match-review/README.md) example uses it, through its own Compose override.

## Set Up Aidbox and MDMbox

For unattended activation, get an MDMbox license from the [portal](https://aidbox.app/ui/portal) and configure Aidbox using its [licensing guide](https://www.health-samurai.io/docs/aidbox/overview/aidbox-user-portal/licenses). Create a local `.env` file in this directory:

```dotenv
AIDBOX_LICENSE=<Aidbox license JWT>
MDMBOX_LICENSE=<MDMbox license JWT>
```

From this directory, start Aidbox and MDMbox:

```bash
docker compose up
```

Once the services are running, open Aidbox at http://localhost:8888 and MDMbox at http://localhost:3003.

The shared Compose configuration passes the same `BOX_WEB_BASE_URL: http://localhost:8888` to Aidbox and MDMbox. If you deploy elsewhere, change this value in both services to the public Aidbox base URL used by browsers and API clients. MDMbox uses it for the Aidbox activation link and resource URLs in matching results; there is no runtime default. Aidbox's legacy `AIDBOX_BASE_URL` alias is also accepted.

If you have not supplied license JWTs, activate Aidbox in its browser page, then open MDMbox and click **Sign in to activate**. MDMbox saves the issued development license in the database and reuses it on restart. Its operations are available immediately after activation.

You'll see the [Welcome to MDMbox](http://localhost:3003/welcome) page. Click your way through the setup steps to import sample patients and install a matching model.

## Explore

Once everything is set up, explore the examples that interest you:

- [MDMbox as an Aidbox App](aidbox-app/README.md)
- [Automatic merge on Patient creation](auto-merge/README.md)
- [Continuous matching review](continuous-match-review/README.md)
- [Data Steward UI](data-steward-ui/README.md)
- [Linkage](linkage/README.md)
- [Automatic Linkage golden-view updates](linkage-auto-update/README.md)
- [Merge without deleting the source](merge-without-deletion/README.md)
- [Keycloak JWT without an Aidbox User](token-introspector-without-user/README.md)
