# MDMbox Examples

All examples use MDMbox alongside Aidbox. The two services share an Aidbox
database, so examples can use Aidbox's FHIR API for resources and MDMbox's API
for master-data-management operations.

## Set Up Aidbox and MDMbox

From this directory, start Aidbox and MDMbox:

```bash
docker compose up
```

Once Aidbox is up and running, browse http://localhost:8888 and click
"Continue with Aidbox account". This will automatically issue a developer
license for you and redirect you back.

Then do the same with MDMbox. Open http://localhost:3003 and click
"Sign in to activate".

You'll see the [Welcome to MDMBox](http://localhost:3003/welcome)
page. Click your way through the setup steps to import sample patients
and install a matching model.

## Explore

Once everything is set up, explore the examples that interest you:

- [MDMbox as an Aidbox App](aidbox-app/README.md)
- [Automatic merge on Patient creation](auto-merge/README.md)
- [Data Steward UI](data-steward-ui/README.md)
- [Linkage](linkage/README.md)
- [Automatic Linkage golden-view updates](linkage-auto-update/README.md)
- [Merge without deleting the source](merge-without-deletion/README.md)
- [TokenIntrospector JWT without an Aidbox User](token-introspector-without-user/README.md)
