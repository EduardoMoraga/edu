#!/usr/bin/env node
// `edu` entry point. Command wiring lives in ./program.ts (see docs/ARCHITECTURE.md §13).
import { createProgram } from './program.js';

// A closed pipe (`edu demo | head`) is a normal way to stop reading, not a crash.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

createProgram()
  .parseAsync(process.argv)
  .catch((error: unknown) => {
    process.stderr.write(`edu: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
