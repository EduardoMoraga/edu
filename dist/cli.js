#!/usr/bin/env node
import {
  createProgram
} from "./chunk-UMKZURFH.js";
import "./chunk-34ZDJ6E5.js";
import "./chunk-CVB7YSGO.js";
import "./chunk-ECRVBJKY.js";
import "./chunk-IK4YS5DS.js";
import "./chunk-PE3YR4VO.js";
import "./chunk-FSG6YL5I.js";
import "./chunk-AFUH4IVJ.js";
import "./chunk-MDFEMRD5.js";
import "./chunk-EUO4RJ5K.js";
import "./chunk-BXZ573JQ.js";
import "./chunk-DOOFC4UY.js";
import "./chunk-QNEUTXM7.js";
import "./chunk-JWSBCKMM.js";
import "./chunk-6DCGFM54.js";
import "./chunk-GC2DKRZG.js";
import "./chunk-5O6OTBMN.js";
import "./chunk-DGIFDAPF.js";
import "./chunk-ROTDA577.js";
import "./chunk-VHSIB24T.js";
import "./chunk-BVE4BAYM.js";
import "./chunk-2B7QB3TI.js";
import "./chunk-HFF6JP3D.js";
import "./chunk-77SZIOWO.js";
import "./chunk-OITQR66D.js";

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