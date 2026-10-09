#!/usr/bin/env node
// Entry point. Commands are wired in src/cli/ by the frontend role (see docs/ARCHITECTURE.md §13).
const [, , cmd] = process.argv;
if (cmd === '--version' || cmd === '-v') {
  console.log('0.1.0');
} else {
  console.log('edu — under construction. See docs/ARCHITECTURE.md');
}
