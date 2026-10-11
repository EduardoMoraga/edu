#!/usr/bin/env node
import {
  createProgram
} from "./chunk-6YCTAHYC.js";
import "./chunk-AI7ZKOI7.js";
import "./chunk-CVB7YSGO.js";
import "./chunk-ECRVBJKY.js";
import "./chunk-IK4YS5DS.js";
import "./chunk-2UNKX35V.js";
import "./chunk-AJU3GAIM.js";
import "./chunk-RUHAFZVS.js";
import "./chunk-FGW3UIBN.js";
import "./chunk-6XMKXRZC.js";
import "./chunk-BXZ573JQ.js";
import "./chunk-NTU4RUMO.js";
import "./chunk-QNEUTXM7.js";
import "./chunk-W7JGHIFF.js";
import "./chunk-J7V2T52F.js";
import "./chunk-SWCSOI5I.js";
import "./chunk-DTZQMMSR.js";
import "./chunk-DGIFDAPF.js";
import "./chunk-ROTDA577.js";
import "./chunk-5U2RISJO.js";
import "./chunk-7Z67EAVU.js";
import "./chunk-3S2XBVXW.js";
import "./chunk-FJFRKIXC.js";
import "./chunk-DUVIFR5X.js";
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