#!/usr/bin/env node
import {
  createProgram
} from "./chunk-ZVQ7BLNJ.js";
import "./chunk-ECRVBJKY.js";
import "./chunk-DYC4DXNX.js";
import "./chunk-ZGSAFC3Y.js";
import "./chunk-AJAVXPS7.js";
import "./chunk-IK4YS5DS.js";
import "./chunk-23I7IHDX.js";
import "./chunk-BXZ573JQ.js";
import "./chunk-SPL7O2VD.js";
import "./chunk-PYSJJP4V.js";
import "./chunk-CVB7YSGO.js";
import "./chunk-NTU4RUMO.js";
import "./chunk-QNEUTXM7.js";
import "./chunk-LZAMKNNP.js";
import "./chunk-QMELCHFL.js";
import "./chunk-KNYRQ5SA.js";
import "./chunk-NO3RXWHL.js";
import "./chunk-ROTDA577.js";
import "./chunk-B5FNIIOI.js";
import "./chunk-ALETVR3V.js";
import "./chunk-G74JOKZO.js";
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