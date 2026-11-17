import { readFileSync } from 'node:fs';
import { createApp } from '../../dist/app.js';
import { reportFields } from '../../dist/report.js';

// This is a browser/transport double, not a rendering engine. The real ESM app
// is imported without source rewriting or exposing its private state.
class Element {
  listeners = new Map();
  children = [];
  attributes = new Map();
  className = '';
  classList = {
    add: (name) => {
      this.className += ` ${name}`;
    },
    remove: (name) => {
      this.className = this.className.replace(name, '').trim();
    },
  };
  style = { setProperty() {} };
  elements = [];
  value = '';
  textContent = '';
  hidden = false;
  open = false;
  addEventListener(name, listener) {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }
  async emit(name, event = {}) {
    for (const listener of this.listeners.get(name) ?? []) await listener(event);
  }
  append(...children) {
    this.children.push(...children);
  }
  replaceChildren(...children) {
    this.children = children;
  }
  setAttribute(name, value) {
    this.attributes.set(name, value);
  }
  getAttribute(name) {
    return this.attributes.get(name);
  }
  remove() {
    this.removed = true;
  }
  click() {}
  focus() {}
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
  }
}

export function createHarness({ bus = [], search = '', embedLoaded = true } = {}) {
  const html = readFileSync(new URL('../../dist/index.html', import.meta.url), 'utf8');
  const nodes = new Map(
    [...html.matchAll(/id="([^"]+)"/g)].map((match) => [match[1], new Element()]),
  );
  const get = (id) => {
    if (!nodes.has(id)) throw new Error(`Missing element in index.html: ${id}`);
    return nodes.get(id);
  };
  const fields = Object.fromEntries(
    reportFields
      .filter((name) => name !== 'evidence')
      .map((name) => {
        const field = new Element();
        field.name = name;
        return [name, field];
      }),
  );
  get('report-form').elements = Object.values(fields);
  get('location').value = 'All locations';
  get('period').value = '2–8 Nov 2026';
  get('revenue').textContent = '£48,260';
  get('orders').textContent = '1,284';
  get('save-error').hidden = true;
  const timers = new Map(),
    blobs = [],
    sent = [],
    copied = [],
    opened = [],
    channels = [];
  let timerId = 0,
    investigation = 0;
  const document = {
    getElementById: (id) => nodes.get(id) ?? null,
    body: new Element(),
    head: new Element(),
    activeElement: null,
    querySelector: () => new Element(),
    querySelectorAll: () => [],
    createTextNode: (text) => text,
    createElement(tag) {
      const element = new Element();
      if (tag === 'tavus-embed') {
        element.sendMessage = async (message) => {
          sent.push(message);
        };
        element.endConversation = async () => {};
      }
      return element;
    },
  };
  class TestURL extends URL {
    static createObjectURL(blob) {
      blobs.push(blob);
      return 'blob:test';
    }
    static revokeObjectURL() {}
  }
  class Channel {
    constructor(name) {
      this.name = name;
      channels.push(this);
      bus.push(this);
    }
    postMessage(data) {
      for (const peer of bus) {
        if (peer !== this && !peer.closed && peer.name === this.name) peer.onmessage?.({ data });
      }
    }
    close() {
      this.closed = true;
    }
  }
  const browser = {
    document,
    location: { search, href: `http://localhost:4173/${search}` },
    URL: TestURL,
    URLSearchParams,
    Blob,
    crypto: { randomUUID: () => `investigation-${++investigation}` },
    BroadcastChannel: Channel,
    customElements: { get: () => embedLoaded, whenDefined: async () => {} },
    setTimeout: (fn, ms) => {
      const id = ++timerId;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    navigator: {
      clipboard: {
        writeText: async (text) => {
          copied.push(text);
        },
      },
    },
    window: {
      open: (...args) => {
        opened.push(args);
      },
    },
  };
  createApp(browser, { deploymentId: 'test-deployment', palTestUrl: null });
  const harness = {
    get,
    fields,
    sent,
    blobs,
    copied,
    opened,
    channels,
    browser,
    call: () => get('call-container').children[0],
    evidence: () => get('evidence-list').children.map((card) => card.children[1].textContent),
    message: (data) => channels.at(-1).onmessage({ data }),
    tick(ms) {
      for (const [id, timer] of [...timers]) {
        if (timer.ms !== ms) continue;
        timers.delete(id);
        timer.fn();
      }
    },
    async edit(name, value) {
      fields[name].value = value;
      document.activeElement = fields[name];
      await get('report-form').emit('input', { target: fields[name] });
      document.activeElement = null;
    },
    async exportReport(location = 'All locations') {
      get('location').value = location;
      await get('location').emit('change');
      const pending = get('export-button').emit('click');
      harness.tick(600);
      await pending;
    },
  };
  return harness;
}
export const start = (h) =>
  h.call().emit('tavus:conversation-started', {
    detail: { conversationId: 'test-conversation' },
  });
export const update = (call, id, patch) =>
  call.emit('tavus:tool-call', {
    detail: { name: 'update_bug_report', tool_call_id: id, arguments: JSON.stringify(patch) },
  });
