#!/usr/bin/env node
import {
  createProgram
} from "./chunk-6ZSRQJWW.js";
import "./chunk-ECRVBJKY.js";
import "./chunk-PX3H6RZE.js";
import "./chunk-XXUT2MO4.js";
import "./chunk-QFACUWBN.js";
import "./chunk-IK4YS5DS.js";
import "./chunk-23I7IHDX.js";
import "./chunk-BXZ573JQ.js";
import "./chunk-L4E64GJT.js";
import "./chunk-DDWOZAZN.js";
import "./chunk-CVB7YSGO.js";
import "./chunk-TRNZ5EV4.js";
import "./chunk-D23CA5MT.js";
import "./chunk-IIELWA3V.js";
import "./chunk-QMELCHFL.js";
import "./chunk-6R4ND5ZU.js";
import "./chunk-66HGH7YW.js";
import "./chunk-ROTDA577.js";
import "./chunk-B5FNIIOI.js";
import "./chunk-4OPVMGWY.js";
import "./chunk-3FSLIEUM.js";
import "./chunk-E5BOGIGG.js";

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