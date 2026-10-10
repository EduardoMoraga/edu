#!/usr/bin/env node
import {
  createProgram
} from "./chunk-XKTCKABM.js";
import "./chunk-XZ2F225A.js";
import "./chunk-CVB7YSGO.js";
import "./chunk-ECRVBJKY.js";
import "./chunk-IK4YS5DS.js";
import "./chunk-2ESV4FFV.js";
import "./chunk-5NEOHZOP.js";
import "./chunk-TNDJ6T25.js";
import "./chunk-RUHAFZVS.js";
import "./chunk-IOHQYEYB.js";
import "./chunk-OP62KLG2.js";
import "./chunk-BXZ573JQ.js";
import "./chunk-NTU4RUMO.js";
import "./chunk-QNEUTXM7.js";
import "./chunk-W7JGHIFF.js";
import "./chunk-4TXLTDKE.js";
import "./chunk-SMG2RBWM.js";
import "./chunk-DTZQMMSR.js";
import "./chunk-DGIFDAPF.js";
import "./chunk-ROTDA577.js";
import "./chunk-5U2RISJO.js";
import "./chunk-VANKJPCB.js";
import "./chunk-B5OJ3EHS.js";
import "./chunk-2PHCBS7B.js";
import "./chunk-PKXEIY2U.js";
import "./chunk-RNBAJYPV.js";

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