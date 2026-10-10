#!/usr/bin/env node
import {
  createProgram
} from "./chunk-PYUOSOD2.js";
import "./chunk-QOO7FIV3.js";
import "./chunk-KHGOLX7N.js";
import "./chunk-XDG54B5T.js";
import "./chunk-FZDCGUPB.js";
import "./chunk-BXZ573JQ.js";
import "./chunk-KSXISGXM.js";
import "./chunk-XI7L3C5X.js";
import "./chunk-NQTHVZEM.js";
import "./chunk-7USMROSH.js";
import "./chunk-PZTNRBLR.js";
import "./chunk-KP6K4SHS.js";
import "./chunk-CVB7YSGO.js";
import "./chunk-WRB5MXFD.js";
import "./chunk-X3WHFEFD.js";
import "./chunk-Z4K2UNKS.js";
import "./chunk-ZV65G7PD.js";
import "./chunk-ROTDA577.js";
import "./chunk-6ISBTR3J.js";
import "./chunk-VZNTNIW2.js";
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