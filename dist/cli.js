#!/usr/bin/env node
import {
  createProgram
} from "./chunk-KP3XRSDE.js";
import "./chunk-AMS5BSLZ.js";
import "./chunk-CVB7YSGO.js";
import "./chunk-ECRVBJKY.js";
import "./chunk-IK4YS5DS.js";
import "./chunk-2Z34OXJ6.js";
import "./chunk-YLECEONT.js";
import "./chunk-AFUH4IVJ.js";
import "./chunk-2AG4HMTN.js";
import "./chunk-FBNPQRWZ.js";
import "./chunk-BXZ573JQ.js";
import "./chunk-DOOFC4UY.js";
import "./chunk-QNEUTXM7.js";
import "./chunk-JWSBCKMM.js";
import "./chunk-KRYYQXME.js";
import "./chunk-LYXNQIVL.js";
import "./chunk-5O6OTBMN.js";
import "./chunk-DGIFDAPF.js";
import "./chunk-ROTDA577.js";
import "./chunk-VHSIB24T.js";
import "./chunk-PYOUPNRP.js";
import "./chunk-H72YZL6C.js";
import "./chunk-SZK6YXAF.js";
import "./chunk-IGGRYW7S.js";
import "./chunk-FW7CG3X3.js";

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