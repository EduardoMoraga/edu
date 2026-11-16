/**
 * Event-driven input for ink-testing-library views. Ink renders a key asynchronously, so tests wait
 * for the frame a key causes (or for an expectation) instead of sleeping a fixed time.
 */
import type { render } from 'ink-testing-library';
import { expect, vi } from 'vitest';

type View = ReturnType<typeof render>;

/** Generous for slow CI runners; a passing wait returns as soon as the frame is there. */
export const WAIT = { timeout: 5000, interval: 2 };

/** Waits until `assertion` passes (polls; no fixed sleep). */
export const until = (assertion: () => void): Promise<void> => vi.waitFor(assertion, WAIT);

/** Writes `input` (a key, an escape sequence or a pasted chunk) and waits for the frame it renders. */
export async function press(view: View, input: string): Promise<void> {
  const before = view.frames.length;
  view.stdin.write(input);
  await until(() => expect(view.frames.length).toBeGreaterThan(before));
}

/** Types `text` one key at a time, waiting for each key's frame. */
export async function type(view: View, text: string): Promise<void> {
  for (const key of text) await press(view, key);
}

/** Waits until the app has exited and released stdin (e.g. after ctrl+c or q). */
export const exited = (view: View): Promise<void> => until(() => expect(view.stdin.listenerCount('readable')).toBe(0));
