#!/usr/bin/env node
import {
  createProgram
} from "./chunk-CI5MD46H.js";
import "./chunk-JE4OSXA5.js";
import "./chunk-CVB7YSGO.js";
import "./chunk-ECRVBJKY.js";
import "./chunk-IK4YS5DS.js";
import "./chunk-2UNKX35V.js";
import "./chunk-DSRX3UWP.js";
import "./chunk-RUHAFZVS.js";
import "./chunk-3BPSYPH5.js";
import "./chunk-RIAZ6FWA.js";
import "./chunk-BXZ573JQ.js";
import "./chunk-NTU4RUMO.js";
import "./chunk-QNEUTXM7.js";
import "./chunk-W7JGHIFF.js";
import "./chunk-XZVPAINC.js";
import "./chunk-2OSE2OFU.js";
import "./chunk-DTZQMMSR.js";
import "./chunk-DGIFDAPF.js";
import "./chunk-ROTDA577.js";
import "./chunk-5U2RISJO.js";
import "./chunk-24HJWHHE.js";
import "./chunk-3S2XBVXW.js";
import "./chunk-EQRHO5D6.js";
import "./chunk-BTL6QUSW.js";
import "./chunk-MWM3NETH.js";

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