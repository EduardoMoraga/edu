#!/usr/bin/env node
import {
  createProgram
} from "./chunk-AE3NTAKZ.js";
import "./chunk-FDNIHS6K.js";
import "./chunk-CVB7YSGO.js";
import "./chunk-ECRVBJKY.js";
import "./chunk-IK4YS5DS.js";
import "./chunk-KASE4LVP.js";
import "./chunk-CENROBBY.js";
import "./chunk-DH4EIM7E.js";
import "./chunk-RUHAFZVS.js";
import "./chunk-7LJHTGM6.js";
import "./chunk-J5MIJF3Y.js";
import "./chunk-BXZ573JQ.js";
import "./chunk-NTU4RUMO.js";
import "./chunk-QNEUTXM7.js";
import "./chunk-W7JGHIFF.js";
import "./chunk-7FNZIGS7.js";
import "./chunk-3XK4452K.js";
import "./chunk-DTZQMMSR.js";
import "./chunk-DGIFDAPF.js";
import "./chunk-ROTDA577.js";
import "./chunk-5U2RISJO.js";
import "./chunk-I62QII6I.js";
import "./chunk-QVZFTRHO.js";
import "./chunk-626YQMQX.js";
import "./chunk-3DNLLTV6.js";
import "./chunk-OYQ5GEHR.js";

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