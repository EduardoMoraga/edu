#!/usr/bin/env node
import {
  createProgram
} from "./chunk-6QB7T6PT.js";
import "./chunk-ECRVBJKY.js";
import "./chunk-6THUD2EG.js";
import "./chunk-NZFSJDV4.js";
import "./chunk-I6F6MCT3.js";
import "./chunk-IK4YS5DS.js";
import "./chunk-23I7IHDX.js";
import "./chunk-BXZ573JQ.js";
import "./chunk-7I7XRYGQ.js";
import "./chunk-4GBQK4KJ.js";
import "./chunk-CVB7YSGO.js";
import "./chunk-NTU4RUMO.js";
import "./chunk-QNEUTXM7.js";
import "./chunk-EYREGPRL.js";
import "./chunk-QMELCHFL.js";
import "./chunk-KNYRQ5SA.js";
import "./chunk-NO3RXWHL.js";
import "./chunk-ROTDA577.js";
import "./chunk-B5FNIIOI.js";
import "./chunk-2U2XMYQH.js";
import "./chunk-PME7VQAI.js";
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