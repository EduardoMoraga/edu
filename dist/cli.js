#!/usr/bin/env node
import {
  createProgram
} from "./chunk-7ZTAPRRX.js";
import "./chunk-ADOFZROV.js";
import "./chunk-CVB7YSGO.js";
import "./chunk-ECRVBJKY.js";
import "./chunk-IK4YS5DS.js";
import "./chunk-AFWQLIDO.js";
import "./chunk-FNVUXJ44.js";
import "./chunk-AFUH4IVJ.js";
import "./chunk-2AOJKIZE.js";
import "./chunk-6GC5RZWN.js";
import "./chunk-BXZ573JQ.js";
import "./chunk-NTU4RUMO.js";
import "./chunk-QNEUTXM7.js";
import "./chunk-JWSBCKMM.js";
import "./chunk-Y6GHBOF4.js";
import "./chunk-UJCX5JZL.js";
import "./chunk-5O6OTBMN.js";
import "./chunk-DGIFDAPF.js";
import "./chunk-ROTDA577.js";
import "./chunk-VHSIB24T.js";
import "./chunk-6DJWO6KQ.js";
import "./chunk-GGQ7M56W.js";
import "./chunk-Z3A63UQL.js";
import "./chunk-ENGLJTB5.js";
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