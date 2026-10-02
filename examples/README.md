# MDMbox Examples

All examples use MDMbox alongside Aidbox. The two services share an Aidbox database, so examples can use Aidbox's FHIR API for resources and MDMbox's API for master-data-management operations.

<<<<<<< HEAD
The Compose example uses MDMbox `2608` with Aidbox `2608.4`. The monthly MDMbox tag follows that month's latest minor; run `docker compose pull` and recreate the containers to update. Use an exact published `YYMM.N` tag when you need a fixed version. `edge` is a development image; only the [Continuous matching review](continuous-match-review/README.md) example uses it, through its own Compose override.
=======
The Compose example uses MDMbox `2608` with Aidbox `2608`. These monthly tags receive updates within the selected versions; run `docker compose pull` and recreate the containers to update. MDMbox supports Aidbox versions from the current LTS through the latest release. `edge` is a development image and is not used by these examples.
>>>>>>> 0d60ef7 (Use monthly image tags and clarify example setup)

## Set Up Aidbox and MDMbox

Get an MDMbox license from the [portal](https://aidbox.app/ui/portal) and configure Aidbox using its [licensing guide](https://www.health-samurai.io/docs/aidbox/overview/aidbox-user-portal/licenses). Create a local `.env` file in this directory:

```dotenv
AIDBOX_LICENSE=<Aidbox license JWT>
MDMBOX_LICENSE=<MDMbox license JWT>
```

From this directory, start Aidbox and MDMbox:

```bash
docker compose up
```

Once the services are running, open Aidbox at http://localhost:8888 and MDMbox at http://localhost:3003.

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
