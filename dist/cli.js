#!/usr/bin/env node
import {
  createProgram
} from "./chunk-NHXIAL6N.js";
import "./chunk-ECRVBJKY.js";
import "./chunk-MSDLETZV.js";
import "./chunk-OI72I22L.js";
import "./chunk-MQXMLH5P.js";
import "./chunk-IK4YS5DS.js";
import "./chunk-23I7IHDX.js";
import "./chunk-BXZ573JQ.js";
import "./chunk-ECQLUDRK.js";
import "./chunk-US6QCIVG.js";
import "./chunk-CVB7YSGO.js";
import "./chunk-NTU4RUMO.js";
import "./chunk-QNEUTXM7.js";
import "./chunk-VYUC2ZDA.js";
import "./chunk-QMELCHFL.js";
import "./chunk-KNYRQ5SA.js";
import "./chunk-66HGH7YW.js";
import "./chunk-ROTDA577.js";
import "./chunk-B5FNIIOI.js";
import "./chunk-5CFFDI6K.js";
import "./chunk-RQB4HE56.js";
import "./chunk-PILVA3OM.js";

// src/cli/index.ts
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
createProgram().parseAsync(process.argv).catch((error) => {
  process.stderr.write(`edu: ${error instanceof Error ? error.message : String(error)}
`);
  process.exitCode = 1;
});
//# sourceMappingURL=cli.js.map