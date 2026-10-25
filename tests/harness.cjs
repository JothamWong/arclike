// Loads mainsw.js in a VM with stubbed browser APIs and hands back its globals, so the
// service worker's switch logic can be exercised without a browser.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = path.join(__dirname, '..', 'mainsw.js');

function makeEvent() {
  const listeners = [];
  return { addListener: (fn) => listeners.push(fn), emit: (...a) => listeners.forEach(fn => fn(...a)), listeners };
}

function load(opts = {}) {
  let port = null;               // the native messaging port the worker opened
  const sent = [];               // messages sent to the native host
  const activated = [];          // chrome.tabs.update calls
  const windowsFocused = [];
  let state = { windows: opts.windows || [] };

  const tabsById = () => {
    const m = new Map();
    state.windows.forEach(w => w.tabs.forEach(t => m.set(t.id, Object.assign({windowId: w.id}, t))));
    return m;
  };

  const chrome = {
    runtime: {
      getManifest: () => ({ version: '3.7.5' }),
      onInstalled: makeEvent(),
      onStartup: makeEvent(),
      onMessage: makeEvent(),
      lastError: null,
      connectNative: () => {
        port = { onMessage: makeEvent(), onDisconnect: makeEvent(), postMessage: (m) => sent.push(m) };
        return port;
      },
      connect: () => ({ onDisconnect: makeEvent(), postMessage: () => {} }),
    },
    commands: { onCommand: makeEvent() },
    tabs: {
      onActivated: makeEvent(), onUpdated: makeEvent(), onCreated: makeEvent(), onRemoved: makeEvent(),
      get: async (id) => { const t = tabsById().get(id); if (!t) throw new Error('No tab with id ' + id); return t; },
      query: async (q, cb) => {
        let all = [...tabsById().values()];
        if (q.active) all = all.filter(t => t.active);
        return all;
      },
      update: async (id, props) => { activated.push({ id, props }); return tabsById().get(id); },
      create: () => {},
      captureVisibleTab: async () => 'data:image/jpeg;base64,AAAA',
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged: makeEvent(),
      // Chrome supports both the callback and the promise form; so must the stub.
      getAll: (q, cb) => {
        const copy = JSON.parse(JSON.stringify(state.windows));
        if (typeof cb === 'function') { cb(copy); return undefined; }
        return Promise.resolve(copy);
      },
      get: async (id) => state.windows.find(w => w.id === id),
      getCurrent: async () => state.windows.find(w => w.focused) || state.windows[0],
      update: async (id, props) => { windowsFocused.push({ id, props }); return state.windows.find(w => w.id === id); },
    },
    storage: { local: { get: (k, cb) => cb && cb(opts.storage || {}), set: () => {} }, onChanged: makeEvent() },
  };

  const sandbox = {
    chrome,
    console: { log: opts.verbose ? console.log : () => {} },
    fetch: async () => ({ json: async () => ({}), blob: async () => ({}) }),
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
    Date, Math, JSON, Map, Set, Promise, Object, Array, String, Number, RegExp, Error, undefined,
    createImageBitmap: async () => ({ width: 2000, height: 1200, close: () => {} }),
    OffscreenCanvas: class { constructor(w, h) { this.width = w; this.height = h; }
      getContext() { return { drawImage: () => {} }; }
      async convertToBlob() { return { arrayBuffer: async () => new ArrayBuffer(8) }; } },
    Uint8Array, ArrayBuffer,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    navigator: { userAgent: opts.userAgent || 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36' },
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), ctx, { filename: 'mainsw.js' });

  const h = {
    ctx, sandbox, chrome, sent, activated, windowsFocused, state,
    // Values cross a realm boundary, so objects arrive with the VM's own prototypes. Copy
    // them into this realm before any deepStrictEqual comparison.
    g: (name) => {
      const value = vm.runInContext(name, ctx);
      return (value && typeof value === 'object') ? JSON.parse(JSON.stringify(value)) : value;
    },
    set: (name, value) => { sandbox.__v = value; vm.runInContext(`${name} = __v`, ctx); },
    call: (expr) => vm.runInContext(expr, ctx),
    // Deliver a message from the native app, then wait for the switch queue to drain.
    async deliver(message) {
      port.onMessage.emit(message);
      for (let i = 0; i < 8; i++) { await vm.runInContext('nativeSwitchQueue', ctx); }
      return h;
    },
    // Deliver several messages without draining between them, the way a fast Ctrl+Tab flip
    // arrives while the first press is still awaiting its browser query.
    async deliverBurst(messages) {
      messages.forEach(m => port.onMessage.emit(m));
      for (let i = 0; i < 12; i++) { await vm.runInContext('nativeSwitchQueue', ctx); }
      return h;
    },
    focusWindow(id) {
      state.windows.forEach(w => { w.focused = (w.id === id); });
      chrome.windows.onFocusChanged.emit(id);
    },
    lastSent: (action) => {
      const found = [...sent].reverse().find(m => m.action === action);
      return found ? JSON.parse(JSON.stringify(found)) : undefined;
    },
  };
  return h;
}

function win(id, tabs, focused = false) {
  return { id, focused, state: 'normal', type: 'normal', tabs };
}
function tab(id, extra = {}) {
  return Object.assign({ id, title: 'Tab ' + id, url: 'https://example.com/' + id, favIconUrl: '', active: false }, extra);
}

module.exports = { load, win, tab };
