#!/usr/bin/env node
import {
  createProgram
} from "./chunk-B4CUYKKL.js";
import "./chunk-BCSFS53N.js";
import "./chunk-6R4ND5ZU.js";
import "./chunk-AGEVZL4M.js";
import "./chunk-SSA6DJ42.js";
import "./chunk-I4WLEQ24.js";
import "./chunk-KP6K4SHS.js";
import "./chunk-XXPGZ7G6.js";
import "./chunk-BXZ573JQ.js";
import "./chunk-VIZUUMRZ.js";
import "./chunk-WRB5MXFD.js";
import "./chunk-L4E64GJT.js";
import "./chunk-DDWOZAZN.js";
import "./chunk-IIELWA3V.js";
import "./chunk-CVB7YSGO.js";
import "./chunk-H52HBKSP.js";
import "./chunk-Z4K2UNKS.js";
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