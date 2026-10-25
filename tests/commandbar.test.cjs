const test = require('node:test');
const assert = require('node:assert');
const { load, win, tab } = require('./harness.cjs');

const DAY = 24 * 60 * 60 * 1000;

function browser(opts = {}) {
  return load(Object.assign({ windows: [win(1, [
    tab(10, { active: true, url: 'https://news.ycombinator.com/', title: 'Hacker News' }),
    tab(11, { url: 'https://www.netflix.com/browse', title: 'Home - Netflix' }),
    tab(12, { url: 'https://leetcode.com/problemset/', title: 'Problems - LeetCode' }),
  ], true)] }, opts));
}

// Calls recorded inside the worker's realm; copy them out before deepStrictEqual.
const plain = (value) => JSON.parse(JSON.stringify(value));
const kinds = (results) => results.map(r => r.kind + ':' + (r.url || r.text));

async function query(h, text) {
  await h.call(`commandBarQuery(${JSON.stringify({ query: text, seq: 7 })})`);
  h.call('commandBarLatestSeq = 0');
  const reply = h.lastSent('command_bar_results');
  assert.strictEqual(reply.seq, 7, 'the reply carries the query it answers');
  return reply.results;
}

test('typed text is recognised as an address or a search', () => {
  const h = load();
  const typed = (t) => h.call(`commandBarTypedUrl(${JSON.stringify(t)})`);
  assert.strictEqual(typed('github.com'), 'https://github.com');
  assert.strictEqual(typed('github.com/anthropics'), 'https://github.com/anthropics');
  assert.strictEqual(typed('localhost:3000'), 'http://localhost:3000');
  assert.strictEqual(typed('192.168.1.1/admin'), 'http://192.168.1.1/admin');
  assert.strictEqual(typed('chrome://settings'), 'chrome://settings');
  assert.strictEqual(typed('how to cook rice'), null);
  assert.strictEqual(typed('netflix'), null);
  assert.strictEqual(typed('javascript:alert(1)'), null);
});

test('Cmd+T opens an empty bar over the focused window', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  assert.deepStrictEqual(h.lastSent('show_command_bar'), { action: 'show_command_bar', mode: 'new_tab', text: '' });
  assert.deepStrictEqual(h.g('commandBarTarget'), { mode: 'new_tab', windowId: 1, tabId: 10 });
});

test('Cmd+L opens the bar holding the current address', async () => {
  const h = browser();
  await h.call(`commandBarOpen("current_tab")`);
  assert.strictEqual(h.lastSent('show_command_bar').text, 'https://news.ycombinator.com/');
});

test('Cmd+L on the New Tab page starts empty', async () => {
  const h = load({ windows: [win(1, [tab(10, { active: true, url: 'chrome://newtab/' })], true)] });
  await h.call(`commandBarOpen("current_tab")`);
  assert.strictEqual(h.lastSent('show_command_bar').text, '');
});

test('a profile without the focused window stays quiet', async () => {
  const h = load({ windows: [win(1, [tab(10, { active: true })], false)] });
  await h.call(`commandBarOpen("new_tab")`);
  assert.strictEqual(h.lastSent('show_command_bar'), undefined);
});

test('an empty bar lists the top sites with their favicons', async () => {
  const h = browser({ topSites: [
    { url: 'https://www.netflix.com/browse', title: 'Home - Netflix' },
    { url: 'https://youtube.com/', title: 'YouTube' },
  ] });
  const results = await query(h, '');
  assert.deepStrictEqual(kinds(results), ['top:https://www.netflix.com/browse', 'top:https://youtube.com/']);
  assert.strictEqual(results[1].detail, 'youtube.com');
  assert.strictEqual(results[0].favicon, 'data:image/png;base64,AQID');
});

test('a tab whose site starts with the query comes before the search row', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  const results = await query(h, 'netf');
  assert.deepStrictEqual(kinds(results).slice(0, 2), ['tab:https://www.netflix.com/browse', 'search:netf']);
  assert.strictEqual(results[0].tabId, 11);
  assert.strictEqual(results[0].hint, 'Switch to Tab');
});

test('a tab whose title starts with the query comes first too', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  const results = await query(h, 'problems');
  assert.strictEqual(results[0].tabId, 12);
});

test('a loose match stays below the search row', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  const results = await query(h, 'code');
  assert.deepStrictEqual(kinds(results), ['search:code', 'tab:https://leetcode.com/problemset/']);
});

test('the tab the bar opened over is not offered', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  const results = await query(h, 'hacker');
  assert.deepStrictEqual(kinds(results), ['search:hacker']);
});

test('a page open in a tab and in history is listed once, as the tab', async () => {
  const h = browser({ history: [
    { url: 'https://www.netflix.com/browse', title: 'Netflix', visitCount: 50, lastVisitTime: Date.now() },
    { url: 'https://www.netflix.com/title/123', title: 'Some show - Netflix', visitCount: 1, lastVisitTime: Date.now() - 30 * DAY },
  ] });
  await h.call(`commandBarOpen("new_tab")`);
  const results = await query(h, 'netflix');
  assert.deepStrictEqual(kinds(results), [
    'tab:https://www.netflix.com/browse', 'search:netflix', 'history:https://www.netflix.com/title/123',
  ]);
});

test('frequently visited history outranks a bookmark', async () => {
  const h = browser({
    history: [{ url: 'https://docs.python.org/3/', title: 'Python docs', visitCount: 40, typedCount: 10, lastVisitTime: Date.now() }],
    bookmarks: [{ url: 'https://example.com/python-old', title: 'Old python notes' }],
  });
  await h.call(`commandBarOpen("new_tab")`);
  const results = await query(h, 'python');
  assert.deepStrictEqual(kinds(results),
    ['history:https://docs.python.org/3/', 'search:python', 'bookmark:https://example.com/python-old']);
});

test('an address leads with opening it, then searching for it', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  const results = await query(h, 'example.org/page');
  assert.deepStrictEqual(kinds(results), ['url:https://example.org/page', 'search:example.org/page']);
});

test('an address that is already open in a tab switches to it', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  const results = await query(h, 'leetcode.com/problemset');
  assert.strictEqual(results[0].tabId, 12);
});

test('history visited after the bar first loaded is found', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  h.chrome.history.onVisited.emit({ url: 'https://zed.dev/', title: 'Zed', visitCount: 1, lastVisitTime: Date.now() });
  const results = await query(h, 'zed');
  assert.strictEqual(results[0].url, 'https://zed.dev/');
});

test('a query overtaken by a newer one is not answered', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  const older = h.call(`commandBarQuery({ query: "ne", seq: 1 })`);
  const newer = h.call(`commandBarQuery({ query: "net", seq: 2 })`);
  await Promise.all([older, newer]);
  assert.deepStrictEqual(h.sent.filter(m => m.action === 'command_bar_results' && !m.refresh).map(m => m.seq), [2]);
});

test('the start of a site name leads with the site and completes it in the field', async () => {
  const h = browser({ history: [
    { url: 'https://www.youtube.com/watch?v=1', title: 'A video - YouTube', visitCount: 3, lastVisitTime: Date.now() },
    { url: 'https://www.youtube.com/', title: 'YouTube', visitCount: 30, lastVisitTime: Date.now() },
  ] });
  await h.call(`commandBarOpen("new_tab")`);
  const results = await query(h, 'You');
  assert.deepStrictEqual(kinds(results), ['url:https://www.youtube.com/', 'search:You', 'history:https://www.youtube.com/watch?v=1']);
  assert.strictEqual(results[0].title, 'youtube.com');
  assert.strictEqual(results[0].detail, 'Visit');
  assert.strictEqual(h.lastSent('command_bar_results').autocomplete, 'Youtube.com/');
});

test('an open tab of the site is offered as the completion instead', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  await query(h, 'net');
  assert.strictEqual(h.lastSent('command_bar_results').autocomplete, 'netflix.com/');
});

test('a search is not completed', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  await query(h, 'code');
  assert.strictEqual(h.lastSent('command_bar_results').autocomplete, '');
});

test('rows are sent before their favicons, which follow', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  await h.call(`commandBarQuery({ query: "netf", seq: 3 })`);
  const replies = h.sent.filter(m => m.action === 'command_bar_results').map(m => JSON.parse(JSON.stringify(m)));
  assert.strictEqual(replies.length, 2);
  assert.strictEqual(replies[0].results[0].favicon, undefined);
  assert.strictEqual(replies[1].refresh, true);
  assert.strictEqual(replies[1].results[0].favicon, 'data:image/png;base64,AQID');
});

test('results are capped', async () => {
  const history = [];
  for (let i = 0; i < 20; i++) history.push({ url: 'https://wiki.example/' + i, title: 'Wiki ' + i });
  const h = browser({ history });
  await h.call(`commandBarOpen("new_tab")`);
  assert.strictEqual((await query(h, 'wiki')).length, 8);
});

test('choosing a tab switches to it', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  await h.call(`commandBarChoose({ item: { kind: "tab", tabId: 12 }, text: "prob" })`);
  assert.deepStrictEqual(plain(h.activated).map(a => a.id), [12]);
  assert.deepStrictEqual(plain(h.created), []);
});

test('Cmd+T opens the choice in a new tab of the same window', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  await h.call(`commandBarChoose({ item: { kind: "history", url: "https://example.org/" }, text: "exa" })`);
  assert.deepStrictEqual(plain(h.created), [{ windowId: 1, url: 'https://example.org/' }]);
});

test('Cmd+L opens the choice in the current tab', async () => {
  const h = browser();
  await h.call(`commandBarOpen("current_tab")`);
  await h.call(`commandBarChoose({ item: { kind: "url", url: "https://example.org/" }, text: "example.org" })`);
  assert.deepStrictEqual(plain(h.activated), [{ id: 10, props: { url: 'https://example.org/' } }]);
  assert.deepStrictEqual(plain(h.created), []);
});

test('a search runs in a new tab or in the current one', async () => {
  let h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  await h.call(`commandBarChoose({ item: { kind: "search", text: "rice" }, text: "rice" })`);
  assert.deepStrictEqual(plain(h.searched), [{ text: 'rice', disposition: 'NEW_TAB' }]);

  h = browser();
  await h.call(`commandBarOpen("current_tab")`);
  await h.call(`commandBarChoose({ item: { kind: "search", text: "rice" }, text: "rice" })`);
  assert.deepStrictEqual(plain(h.searched), [{ text: 'rice', tabId: 10 }]);
});

test('Enter with nothing chosen opens the typed text, or a blank new tab', async () => {
  let h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  await h.call(`commandBarChoose({ text: "github.com" })`);
  assert.deepStrictEqual(plain(h.created), [{ windowId: 1, url: 'https://github.com' }]);

  h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  await h.call(`commandBarChoose({ text: "" })`);
  assert.deepStrictEqual(plain(h.created), [{ windowId: 1 }]);

  h = browser();
  await h.call(`commandBarOpen("current_tab")`);
  await h.call(`commandBarChoose({ text: "" })`);
  assert.deepStrictEqual(plain(h.created), []);
  assert.deepStrictEqual(plain(h.activated), []);
});

test('a dismissed bar opens nothing', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  h.call(`commandBarClosed()`);
  await h.call(`commandBarChoose({ text: "github.com" })`);
  assert.deepStrictEqual(plain(h.created), []);
});

test('the extension tells the app it can answer the command bar', async () => {
  const h = browser();
  await h.deliver({ action: 'ready' });
  assert.deepStrictEqual(h.lastSent('register').features, ['command_bar']);
});
