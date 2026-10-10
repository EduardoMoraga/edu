#!/usr/bin/env node
import {
  createProgram
} from "./chunk-URNH7WY6.js";
import "./chunk-QOO7FIV3.js";
import "./chunk-KHGOLX7N.js";
import "./chunk-XCQF7OLL.js";
import "./chunk-EWNX4I6L.js";
import "./chunk-BXZ573JQ.js";
import "./chunk-PFWGYRAM.js";
import "./chunk-IFIRJDFB.js";
import "./chunk-NQTHVZEM.js";
import "./chunk-IX5FXKNL.js";
import "./chunk-PZTNRBLR.js";
import "./chunk-KP6K4SHS.js";
import "./chunk-CVB7YSGO.js";
import "./chunk-WRB5MXFD.js";
import "./chunk-YNDFGHRJ.js";
import "./chunk-Z4K2UNKS.js";
import "./chunk-33ZZBVGB.js";
import "./chunk-ROTDA577.js";
import "./chunk-FEHCOPF2.js";
import "./chunk-YOM6II2D.js";
import "./chunk-UJTVJ7X2.js";
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