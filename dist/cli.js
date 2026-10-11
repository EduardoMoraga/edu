#!/usr/bin/env node
import {
  createProgram
} from "./chunk-VUM5IWG5.js";
import "./chunk-PDBZCGBU.js";
import "./chunk-CVB7YSGO.js";
import "./chunk-ECRVBJKY.js";
import "./chunk-IK4YS5DS.js";
import "./chunk-AFWQLIDO.js";
import "./chunk-AYSVDMYS.js";
import "./chunk-RUHAFZVS.js";
import "./chunk-MYNTXVD4.js";
import "./chunk-IJYUKTMB.js";
import "./chunk-BXZ573JQ.js";
import "./chunk-NTU4RUMO.js";
import "./chunk-QNEUTXM7.js";
import "./chunk-W7JGHIFF.js";
import "./chunk-UOL7F4KI.js";
import "./chunk-VBXK6WDY.js";
import "./chunk-DTZQMMSR.js";
import "./chunk-DGIFDAPF.js";
import "./chunk-ROTDA577.js";
import "./chunk-5U2RISJO.js";
import "./chunk-ZV7GWXEB.js";
import "./chunk-GGQ7M56W.js";
import "./chunk-Z3A63UQL.js";
import "./chunk-SLMZCFBQ.js";
import "./chunk-V372C4AW.js";

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