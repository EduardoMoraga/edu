#!/usr/bin/env node
import {
  createProgram
} from "./chunk-RGBY5ESN.js";
import "./chunk-ECRVBJKY.js";
import "./chunk-UPSPAYW3.js";
import "./chunk-FV3EKBKS.js";
import "./chunk-6JVLOZ4J.js";
import "./chunk-IK4YS5DS.js";
import "./chunk-AFUH4IVJ.js";
import "./chunk-CVB7YSGO.js";
import "./chunk-D6BNTVES.js";
import "./chunk-U6NP74BH.js";
import "./chunk-IYAELJBK.js";
import "./chunk-DXBGSU5D.js";
import "./chunk-TNLC3H7W.js";
import "./chunk-D45JK3LN.js";
import "./chunk-H6GDXPLG.js";
import "./chunk-DOOFC4UY.js";
import "./chunk-QNEUTXM7.js";
import "./chunk-BXZ573JQ.js";
import "./chunk-QNAQB26Y.js";
import "./chunk-JFEH3OAW.js";
import "./chunk-V2SOBIAN.js";
import "./chunk-DGIFDAPF.js";
import "./chunk-JWSBCKMM.js";
import "./chunk-VHSIB24T.js";
import "./chunk-JBEH5ZMK.js";
import "./chunk-JEK37NC7.js";
import "./chunk-Q53G7BAN.js";
import "./chunk-I6JWASFE.js";
import "./chunk-TH5GRG3L.js";
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