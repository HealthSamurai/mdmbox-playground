import { env, pipeline } from "@health-samurai/interbox";
import {
  hl7v2Parser,
  mllpSource,
  aidboxSender,
} from "@health-samurai/interbox/builtins";
import { mdmMapper } from "./mapper.ts";

const mdmPipeline = pipeline("hl7-to-aidbox")
  .source(
    mllpSource({
      id: "showcase-mllp",
      host: env("MLLP_HOST"),
      port: env("MLLP_PORT"),
      parser: hl7v2Parser({ skipZSegments: false }),
    }),
  )
  .mapper(mdmMapper({}));

// Receipts and revision CAS also protect overlapping deliveries by different workers.
for (let worker = 0; worker < 4; worker += 1) {
  mdmPipeline.sender(
    aidboxSender({
      url: env("MDM_ADAPTER_URL"),
      auth: { kind: "bearer", token: env("MDM_ADAPTER_TOKEN") },
      validateFirst: false,
      batchSize: 1,
      maxRetries: 20,
    }),
  );
}
