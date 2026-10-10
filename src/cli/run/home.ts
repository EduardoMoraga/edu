/** Sequential home input routing, independent of the Ink view. */
import type { ChatResult } from '../../chat/respond.js';
import { t, type Lang } from '../i18n.js';

export interface HomeSessionDeps {
  respond(input: { message: string; forceChat: boolean }): Promise<ChatResult>;
  runTask(goal: string): Promise<void>;
  say(text: string): void;
  lang: Lang;
}

export function createHomeSession(deps: HomeSessionDeps): { submit(text: string): Promise<void> } {
  let tail = Promise.resolve();
  const handle = async (raw: string): Promise<void> => {
    const text = raw.trim();
    if (!text) return;
    const run = /^\/run(?:\s+([\s\S]*))?$/i.exec(text);
    const ask = /^\/ask(?:\s+([\s\S]*))?$/i.exec(text);
    if (run || ask) {
      const message = (run?.[1] ?? ask?.[1] ?? '').trim();
      if (!message) {
        deps.say(t(deps.lang, 'home.commandUsage', { command: run ? '/run <goal>' : '/ask <question>' }));
        return;
      }
      if (run) {
        deps.say(t(deps.lang, 'home.task', { goal: message }));
        await deps.runTask(message);
        return;
      }
      await deps.respond({ message, forceChat: true });
      return;
    }
    const result = await deps.respond({ message: text, forceChat: false });
    if (result.kind === 'task') {
      deps.say(t(deps.lang, 'home.task', { goal: result.goal }));
      await deps.runTask(result.goal);
    }
  };
  return {
    submit(text) {
      const next = tail.then(() => handle(text));
      tail = next.catch(() => {});
      return next;
    },
  };
}
