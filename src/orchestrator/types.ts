import type { ContextPack, ContextRequest } from '../core/contracts.js';

/** Narrow seam for the context module, which is implemented independently. */
export type ContextProvider = { build(req: ContextRequest): Promise<ContextPack> };
