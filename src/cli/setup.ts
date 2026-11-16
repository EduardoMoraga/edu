/** `edu init` core. It moved to the workspace layer so that use cases outside the CLI can create a brain. */
export { initBrain, type InitOptions, type InitReport } from '../workspace/init.js';
