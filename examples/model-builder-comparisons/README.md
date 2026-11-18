# Model Builder comparison examples

Requires MDMbox `edge`. These examples use explicit comparison lists and are not supported by the playground's default `2608` image.

Start the shared environment from `examples/` with this override:

```sh
docker compose -f docker-compose.yaml -f model-builder-comparisons/docker-compose.yaml up -d
```

Follow the [shared activation instructions](../README.md). Open [Model Builder](http://localhost:3003/mdmbox/admin/model-builder) and prepare your Patient records. Select scalar fields with the aliases below and an `id` column using `getResourceKey()`:

| Column | FHIRPath |
| --- | --- |
| `given` | `name.first().given.join(' ')` |
| `family` | `name.first().family` |
| `birth_date` | `birthDate` |
| `postal_code` | `address.first().postalCode` |
| `identifier` | `identifier.where(system = 'https://example.org/patient-card').first().value` |

Replace the example identifier system with your own. Each model below is complete for its listed fields. If you prepare additional fields, include each in `comparisons` too. Paste the selected file into **Train model → Model definition**, select **Build model**, inspect **Learned comparisons**, then **Review & save**. These snippets use helpers supplied by Model Builder; they are not standalone Node programs or fitted model exports.

## Boolean-only training

Two structured exports contain an account identifier, birth date and postal code. The author wants to learn from exact agreement and disagreement only, without treating nearby strings as similar.

List equality functions for every selected field. No spelling comparison is added automatically.

Use [boolean-only.js](boolean-only.js) with `identifier`, `birth_date`, `postal_code`.

Rebuild, inspect agreements and disagreements, and validate before choosing thresholds. A coarse Boolean model may lose recall on transcription errors; three equal fields are not a hand-written requirement for a match.

## Names and nicknames

A registration system stores William while another clinic records Bill. The remaining demographic fields are available in both sources.

Add the English name dictionary alongside `typos()` for given names.

Use [nicknames.js](nicknames.js) with `given`, `family`, `birth_date`, `postal_code`.

Rebuild the model and inspect nickname pairs alongside unrelated patients who share a surname or postal code. A dictionary relation alone does not require the records to match.

## Initials in a legacy export

A legacy export stores a single-letter given name such as J, while the registration system stores John. Both sources also contain complete given names.

Add an initial comparison. Return null when both values are complete names, so the additional rule supplies no observation for that case.

Use [initials.js](initials.js) with `given`, `family`, `birth_date`, `postal_code`.

Compare J with John, J with Peter, and John with James. Confirm that complete names still use spelling and dictionary comparisons. The initial result is evidence for training, not a final matching decision.

## Exchanged day and month

Two imports use complete ISO birth dates, but an earlier migration exchanged the day and month in some records: 1980-03-07 became 1980-07-03.

Add a comparison for different valid dates whose day and month are exchanged. Keep format normalization in data preparation; this comparison represents an uncertain data-entry error.

Use [date-swap.js](date-swap.js) with `given`, `family`, `birth_date`, `postal_code`.

Inspect swapped dates against the other demographic fields. Check unchanged dates, different years, partial dates and invalid calendar dates. Do not globally rewrite all ambiguous dates in the source data.

## Registry-specific aliases

A local registry uses AM for Alexandra Maria. These registry-specific aliases are maintained by the organisation and are not part of the built-in language dictionaries.

Import a UTF-8 CSV with the header name,variant under clinic-aliases in Name dictionaries, then add its ID alongside the English dictionary.

Use [local-aliases.js](local-aliases.js) with `given`, `family`, `birth_date`, `postal_code`.

Import [clinic-aliases.csv](clinic-aliases.csv) in **Name dictionaries** with ID `clinic-aliases` before building.

Rebuild and save the model after import. Check both a registered alias and an unrelated name with the same initials. Review aliases that are assigned to more than one full name.

## Exact identifiers

Two exports share numeric card identifiers. A one-digit difference must be recorded as disagreement on this field, while names can still contain spelling errors.

Replace spelling comparison for identifier with equality. Keep the existing comparisons for the other fields.

Use [exact-identifier.js](exact-identifier.js) with `given`, `family`, `birth_date`, `identifier`.

Verify that 12345 and 12346 disagree on identifier. This is a probabilistic observation, not a mandatory veto on the final match; an absolute matching rule belongs in a deterministic model.

## Use the saved model

Use the saved model ID for online `$match`, Bulk matching and Continuous matching. Keep the full exported JSON when moving the fitted model; format 3 includes dictionary snapshots. Older JavaScript exports must be rebuilt with the current templates. Importing a revised dictionary does not alter a saved model. Rebuild and validate to use new pairs.

The training examples do not imply clinical accuracy. Check reference-labelled pairs and candidate coverage on your own population before choosing thresholds. For a fixed final decision, use a deterministic model instead of treating one Boolean comparison as a mandatory match or veto.

See the [comparison documentation](https://www.health-samurai.io/docs/mdmbox/custom-comparison-examples) for the function contract and more explanation.
