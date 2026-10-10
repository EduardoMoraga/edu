import {
  createCommandHandler
} from "./chunk-RGLLJYTJ.js";
import {
  executeRun
} from "./chunk-SSA6DJ42.js";
import "./chunk-BXZ573JQ.js";
import {
  uiLang
} from "./chunk-VIZUUMRZ.js";
import "./chunk-WRB5MXFD.js";
import "./chunk-DDWOZAZN.js";
import {
  openWorkspace
} from "./chunk-IIELWA3V.js";
import "./chunk-3FSLIEUM.js";
import "./chunk-E5BOGIGG.js";

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

// src/cli/run/live.ts
async function runInTui(ctx, opts) {
  const { renderTui } = await import("./tui-BJOJUO6I.js");
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
  const { renderTui } = await import("./tui-BJOJUO6I.js");
  const channel = createChannel();
  const bridge = new ApprovalBridge();
  let abort;
  const startRun = (goal) => {
    if (abort) return;
    const current = new AbortController();
    abort = current;
    void executeRun(ctx, {
      goal,
      cwd: opts.cwd,
      lang: opts.lang,
      mode: "solo",
      signal: current.signal,
      onEvent: (event) => {
        bridge.observe(event);
        channel.push(event);
      },
      approve: bridge.approve
    }).catch((error) => {
      channel.push({ type: "error", message: error instanceof Error ? error.message : String(error), at: (/* @__PURE__ */ new Date()).toISOString() });
    }).finally(() => {
      abort = void 0;
    });
  };
  const app = renderTui({
    events: channel,
    name: opts.name,
    lang: uiLang(opts.lang, ctx.env),
    onSubmit: startRun,
    onCommand: createCommandHandler({ lang: opts.lang, brain: (await openWorkspace(ctx, opts.cwd)).brain }),
    onApprove: bridge.answer,
    onCancel: () => {
      abort?.abort();
      bridge.rejectAll();
    }
  });
  await app.waitUntilExit();
  abort?.abort();
  bridge.rejectAll();
  channel.close();
}
async function playInTui(events, name, lang = "en") {
  const { renderTui } = await import("./tui-BJOJUO6I.js");
  const app = renderTui({ events, name, lang });
  await app.waitUntilExit();
}
export {
  playInTui,
  runHome,
  runInTui
};
//# sourceMappingURL=live-L3QOFDZQ.js.map