#!/usr/bin/env node
import {
  createProgram
} from "./chunk-3HCZSQ5R.js";
import "./chunk-SYMBTMWU.js";
import "./chunk-CVB7YSGO.js";
import "./chunk-ECRVBJKY.js";
import "./chunk-IK4YS5DS.js";
import "./chunk-HVONK73M.js";
import "./chunk-H2NUAYY5.js";
import "./chunk-AFUH4IVJ.js";
import "./chunk-LE5MNAHZ.js";
import "./chunk-DWK7GEN5.js";
import "./chunk-BXZ573JQ.js";
import "./chunk-DOOFC4UY.js";
import "./chunk-QNEUTXM7.js";
import "./chunk-JWSBCKMM.js";
import "./chunk-TW4LMQVK.js";
import "./chunk-42XEKWTU.js";
import "./chunk-5O6OTBMN.js";
import "./chunk-DGIFDAPF.js";
import "./chunk-ROTDA577.js";
import "./chunk-VHSIB24T.js";
import "./chunk-KQO36KVT.js";
import "./chunk-5A4EJR4Z.js";
import "./chunk-QXXUVLOK.js";
import "./chunk-XCK7PFLA.js";
import "./chunk-7UTDQFLV.js";

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