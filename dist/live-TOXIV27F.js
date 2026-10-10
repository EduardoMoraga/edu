import {
  createCommandHandler
} from "./chunk-QOVEGWBL.js";
import {
  executeRun
} from "./chunk-J5MIJF3Y.js";
import {
  packageTemplatesDir
} from "./chunk-BXZ573JQ.js";
import {
  t,
  uiLang
} from "./chunk-NTU4RUMO.js";
import "./chunk-QNEUTXM7.js";
import {
  initBrain
} from "./chunk-3XK4452K.js";
import {
  effectiveConfig,
  exists,
  openWorkspace
} from "./chunk-I62QII6I.js";
import "./chunk-QVZFTRHO.js";
import "./chunk-626YQMQX.js";
import "./chunk-3DNLLTV6.js";
import "./chunk-OYQ5GEHR.js";

// src/cli/run/live.ts
import { join } from "path";

// src/cli/run/bridge.ts
var ApprovalBridge = class {
  current;
  waiting = /* @__PURE__ */ new Map();
  early = /* @__PURE__ */ new Map();
  observe(event) {
    if (event.type === "approval.request") this.current = event.approvalId;
  }
  approve = (_request) => {
    const id = this.current;
    if (!id) return Promise.resolve(false);
    const answered = this.early.get(id);
    if (answered !== void 0) {
      this.early.delete(id);
      return Promise.resolve(answered);
    }
    return new Promise((resolve) => this.waiting.set(id, resolve));
  };
  answer = (approvalId, approved) => {
    const resolve = this.waiting.get(approvalId);
    if (resolve) {
      this.waiting.delete(approvalId);
      resolve(approved);
    } else {
      this.early.set(approvalId, approved);
    }
  };
  /** Rejects every outstanding approval (used on cancel/quit). */
  rejectAll() {
    for (const [id, resolve] of this.waiting) {
      this.waiting.delete(id);
      resolve(false);
    }
  }
};

// src/cli/run/channel.ts
function createChannel() {
  const buffer = [];
  const waiters = [];
  let closed = false;
  return {
    push(value) {
      if (closed) return;
      const waiter = waiters.shift();
      if (waiter) waiter({ value, done: false });
      else buffer.push(value);
    },
    close() {
      closed = true;
      for (const waiter of waiters.splice(0)) waiter({ value: void 0, done: true });
    },
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (buffer.length) return Promise.resolve({ value: buffer.shift(), done: false });
          if (closed) return Promise.resolve({ value: void 0, done: true });
          return new Promise((resolve) => waiters.push(resolve));
        }
      };
    }
  };
}

// src/cli/run/home.ts
function createHomeSession(deps) {
  let tail = Promise.resolve();
  const handle = async (raw) => {
    const text = raw.trim();
    if (!text) return;
    const run = /^\/run(?:\s+([\s\S]*))?$/i.exec(text);
    const ask = /^\/ask(?:\s+([\s\S]*))?$/i.exec(text);
    if (run || ask) {
      const message = (run?.[1] ?? ask?.[1] ?? "").trim();
      if (!message) {
        deps.say(t(deps.lang, "home.commandUsage", { command: run ? "/run <goal>" : "/ask <question>" }));
        return;
      }
      if (run) {
        deps.say(t(deps.lang, "home.task", { goal: message }));
        await deps.runTask(message);
        return;
      }
      await deps.respond({ message, forceChat: true });
      return;
    }
    const result = await deps.respond({ message: text, forceChat: false });
    if (result.kind === "task") {
      deps.say(t(deps.lang, "home.task", { goal: result.goal }));
      await deps.runTask(result.goal);
    }
  };
  return {
    submit(text) {
      const message = text.trim();
      if (message) deps.emit?.({ type: "chat.user", text: message, at: (/* @__PURE__ */ new Date()).toISOString() });
      const next = tail.then(() => handle(text));
      tail = next.catch(() => {
      });
      return next;
    }
  };
}

// src/cli/run/live.ts
async function runInTui(ctx, opts) {
  const { renderTui } = await import("./tui-ZPBRZEYF.js");
  const channel = createChannel();
  const bridge = new ApprovalBridge();
  const abort = new AbortController();
  const app = renderTui({
    events: channel,
    name: opts.name,
    lang: uiLang(opts.lang, ctx.env),
    onApprove: bridge.answer,
    onCommand: createCommandHandler({ lang: opts.lang, brain: (await openWorkspace(ctx, opts.cwd)).brain }),
    onCancel: () => {
      abort.abort();
      bridge.rejectAll();
    }
  });
  const exited = app.waitUntilExit().then(() => {
    abort.abort();
    bridge.rejectAll();
  });
  let result;
  try {
    result = await executeRun(ctx, {
      ...opts,
      signal: abort.signal,
      engines: ctx.engineFactory,
      available: ctx.availableClis,
      onEvent: (event) => {
        bridge.observe(event);
        channel.push(event);
      },
      approve: opts.autoApprove ? async () => true : bridge.approve,
      autoApprove: opts.autoApprove
    });
  } catch (error) {
    channel.push({ type: "error", message: error instanceof Error ? error.message : String(error), at: (/* @__PURE__ */ new Date()).toISOString() });
  }
  await exited;
  channel.close();
  return result;
}
async function runHome(ctx, opts) {
  const { renderTui } = await import("./tui-ZPBRZEYF.js");
  const { respond } = await import("./respond-47K7H77R.js");
  const { createEngine } = await import("./engine-GM3MJPFZ.js");
  const channel = createChannel();
  const bridge = new ApprovalBridge();
  const ws = await openWorkspace(ctx, opts.cwd);
  const available = ctx.availableClis ?? await ctx.detectClis();
  if (!await exists(join(ws.primary.root, "EDU.md"))) {
    await initBrain({ location: ws.primary, templatesDir: packageTemplatesDir(), detected: available, lang: opts.lang });
  }
  const config = await effectiveConfig(ws.primary.root, available);
  const history = { turns: [] };
  let abort;
  let closed = false;
  const runTurn = async (work) => {
    if (closed) throw new Error("Home view is closed");
    const current = new AbortController();
    abort = current;
    try {
      return await work(current.signal);
    } finally {
      abort = void 0;
    }
  };
  const emit = (event) => {
    bridge.observe(event);
    channel.push(event);
  };
  const home = createHomeSession({
    lang: opts.lang,
    emit,
    say: (text) => emit({ type: "agent.text", agentId: "edu", text, at: (/* @__PURE__ */ new Date()).toISOString() }),
    respond: ({ message, forceChat }) => runTurn((signal) => respond({
      message,
      forceChat,
      history,
      config,
      brain: ws.brain,
      engines: ctx.engineFactory ?? createEngine,
      cwd: opts.cwd,
      contractPath: join(ws.primary.root, "EDU.md"),
      onEvent: emit,
      signal
    })),
    runTask: (goal) => runTurn(async (signal) => {
      await executeRun(ctx, {
        goal,
        cwd: opts.cwd,
        lang: opts.lang,
        mode: "solo",
        signal,
        onEvent: emit,
        approve: bridge.approve,
        engines: ctx.engineFactory,
        available
      });
    })
  });
  const submit = (message) => {
    void home.submit(message).catch((error) => {
      emit({ type: "error", message: error instanceof Error ? error.message : String(error), at: (/* @__PURE__ */ new Date()).toISOString() });
    });
  };
  const app = renderTui({
    events: channel,
    name: opts.name,
    lang: uiLang(opts.lang, ctx.env),
    onSubmit: submit,
    onCommand: createCommandHandler({ lang: opts.lang, brain: ws.brain }),
    onApprove: bridge.answer,
    onCancel: () => {
      abort?.abort();
      bridge.rejectAll();
    }
  });
  await app.waitUntilExit();
  closed = true;
  abort?.abort();
  bridge.rejectAll();
  channel.close();
}
async function playInTui(events, name, lang = "en") {
  const { renderTui } = await import("./tui-ZPBRZEYF.js");
  const app = renderTui({ events, name, lang });
  await app.waitUntilExit();
}
export {
  playInTui,
  runHome,
  runInTui
};
//# sourceMappingURL=live-TOXIV27F.js.map