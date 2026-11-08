#!/usr/bin/env node
import {
  createProgram
} from "./chunk-SC7HRPID.js";
import "./chunk-CVB7YSGO.js";
import "./chunk-ECRVBJKY.js";
import "./chunk-YJLGOKUC.js";
import "./chunk-45SZPNSY.js";
import "./chunk-F3V3R3DO.js";
import "./chunk-IK4YS5DS.js";
import "./chunk-B5NPY3SB.js";
import "./chunk-JDL4D36N.js";
import "./chunk-VXRMRQCF.js";
import "./chunk-JP6AHW2T.js";
import "./chunk-BOBMQZKA.js";
import "./chunk-D45JK3LN.js";
import "./chunk-5G4RNW33.js";
import "./chunk-6GXTQRCF.js";
import "./chunk-CZCNDHVV.js";
import "./chunk-PGQM5MLC.js";
import "./chunk-QNEUTXM7.js";
import "./chunk-EUPH3NDK.js";
import "./chunk-6LWDCFL2.js";
import "./chunk-UMNFFIZJ.js";
import "./chunk-YAIL4E7R.js";
import "./chunk-ZFF2VUTT.js";
import "./chunk-BXZ573JQ.js";
import "./chunk-AUCN5GYG.js";
import "./chunk-DGIFDAPF.js";
import "./chunk-RWOFVLBN.js";
import "./chunk-C4BNEOC5.js";
import "./chunk-VHSIB24T.js";
import "./chunk-W3BITYSE.js";
import "./chunk-KQ7WE6FL.js";
import "./chunk-WTXFW2MX.js";
import "./chunk-3CEC2RSP.js";
import "./chunk-GC5WYT3E.js";
import "./chunk-I6JWASFE.js";
import "./chunk-2P2KBRRT.js";
import "./chunk-YPR7PZSQ.js";

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