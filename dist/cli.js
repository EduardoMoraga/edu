#!/usr/bin/env node
import {
  createProgram
} from "./chunk-2AFRPVYQ.js";
import "./chunk-QOO7FIV3.js";
import "./chunk-KHGOLX7N.js";
import "./chunk-SZMGXORF.js";
import "./chunk-CAIOC5OU.js";
import "./chunk-BXZ573JQ.js";
import "./chunk-UOFOJCQU.js";
import "./chunk-MJWWG6V6.js";
import "./chunk-NQTHVZEM.js";
import "./chunk-2V65STGZ.js";
import "./chunk-PZTNRBLR.js";
import "./chunk-KP6K4SHS.js";
import "./chunk-CVB7YSGO.js";
import "./chunk-WRB5MXFD.js";
import "./chunk-Q7UWRSBU.js";
import "./chunk-Z4K2UNKS.js";
import "./chunk-66HGH7YW.js";
import "./chunk-ROTDA577.js";
import "./chunk-B5FNIIOI.js";
import "./chunk-SD2BBY42.js";
import "./chunk-ZKAXB4VP.js";
import "./chunk-IULFTIQE.js";

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