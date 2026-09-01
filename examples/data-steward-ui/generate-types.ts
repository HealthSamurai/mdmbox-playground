import { APIBuilder } from "@atomic-ehr/codegen";

const builder = new APIBuilder()
  .fromPackage("hl7.fhir.r4.core", "4.0.1")
  .typeSchema({
    treeShake: {
      "hl7.fhir.r4.core#4.0.1": {
        "http://hl7.org/fhir/StructureDefinition/Patient": {},
      },
    },
  })
  .typescript({})
  .outputTo("./src/fhir-types");

await builder.generate();

console.log("FHIR R4 types generated in ./src/fhir-types/");
