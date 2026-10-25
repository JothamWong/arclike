/**
 * Command bar: the Arc/Zen-style search bar that the native app draws over the browser on Cmd+T
 * and Cmd+L. The app owns the window and the keyboard. This side answers its queries with open
 * tabs, bookmarks and history, and opens whatever is chosen.
 */

var COMMAND_BAR_MAX_RESULTS = 8;
var COMMAND_BAR_TOP_SITES = 6;
var COMMAND_BAR_MAX_FAVICONS = 500;
// A match at least this good is put above the search row, so Enter goes straight to it: a host
// that starts with the query, or an open tab whose title starts with it.
var COMMAND_BAR_STRONG_HOST_MATCH = 100;
var COMMAND_BAR_STRONG_TAB_MATCH = 60;

// The bar on screen: the window it opened over, the tab Cmd+L would replace, and whether the
// choice opens in a new tab ("new_tab") or in that tab ("current_tab").
var commandBarTarget = null;
var commandBarFavicons = new Map();  // origin -> data URL, "" when Chrome had none

// History is matched in memory. chrome.history.search with text scans the whole history
// database, which takes over a second on a large profile, far too slow to run per keystroke.
// So the recent history is read once and kept current as pages are visited.
var COMMAND_BAR_HISTORY_DAYS = 90;
var COMMAND_BAR_HISTORY_LIMIT = 20000;
var COMMAND_BAR_HISTORY_WAIT_MS = 150;
var commandBarHistory = null;         // url -> HistoryItem, oldest visit first
var commandBarHistoryLoading = null;
var commandBarHistoryWaited = false;
// The newest query the app sent. An older one still in flight is dropped rather than answered.
var commandBarLatestSeq = 0;

var COMMAND_BAR_SCHEMES = /^(https?|file|ftp|chrome|chrome-extension|about|view-source):/i;

// The URL that typed text stands for, or null when the text reads as a search.
var commandBarTypedUrl = function(text) {
	text = text.trim();
	if (!text || /\s/.test(text)) {
		return null;
	}
	if (COMMAND_BAR_SCHEMES.test(text)) {
		return text;
	}
	if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?([\/?#]|$)/i.test(text)) {
		return "http://" + text;
	}
	if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,63}(:\d+)?([\/?#]|$)/i.test(text)) {
		return "https://" + text;
	}
	return null;
};

var commandBarDisplayUrl = function(url) {
	return url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
};

var commandBarHost = function(url) {
	var match = /^[a-z][a-z0-9+.-]*:\/\/([^\/?#:]+)/i.exec(url);
	return match ? match[1].toLowerCase().replace(/^www\./, "") : "";
};

// Two URLs that differ only in a fragment or a trailing slash are the same page.
var commandBarUrlKey = function(url) {
	return url.replace(/#.*$/, "").replace(/\/$/, "");
};

// The index of the first place `word` starts a word in `text`, or -1.
var commandBarWordStart = function(text, word) {
	var index = text.indexOf(word);
	while (index > 0 && /[a-z0-9]/.test(text[index - 1])) {
		index = text.indexOf(word, index + 1);
	}
	return index;
};

// How well a page matches the query, or -1 when a word of the query is in neither its title
// nor its URL. A host that starts with the query beats a title that starts with it, which
// beats a word inside the title.
var commandBarMatchScore = function(query, title, url) {
	var q = query.trim().toLowerCase();
	title = (title || "").toLowerCase();
	var lowerUrl = url.toLowerCase();
	var words = q.split(/\s+/);
	for (var i = 0; i < words.length; i++) {
		if (title.indexOf(words[i]) === -1 && lowerUrl.indexOf(words[i]) === -1) {
			return -1;
		}
	}
	var host = commandBarHost(url);
	var score = 10;
	if (host.indexOf(q) === 0) {
		score += 100;
	} else if (host.indexOf("." + q) !== -1) {
		score += 40;
	}
	var titleIndex = commandBarWordStart(title, q);
	if (titleIndex === 0) {
		score += 60;
	} else if (titleIndex > 0) {
		score += 30;
	}
	return score;
};

// Damerau-Levenshtein distance between a and b, or max + 1 as soon as it must exceed max.
var commandBarEditDistance = function(a, b, max) {
	if (Math.abs(a.length - b.length) > max) {
		return max + 1;
	}
	var before = null;
	var previous = [];
	for (var j = 0; j <= b.length; j++) {
		previous[j] = j;
	}
	for (var i = 1; i <= a.length; i++) {
		var current = [i];
		var rowMin = i;
		for (j = 1; j <= b.length; j++) {
			var value = Math.min(previous[j] + 1, current[j - 1] + 1,
				previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
				value = Math.min(value, before[j - 2] + 1);
			}
			current[j] = value;
			rowMin = Math.min(rowMin, value);
		}
		if (rowMin > max) {
			return max + 1;
		}
		before = previous;
		previous = current;
	}
	return previous[b.length];
};

// The words of a page's title and URL, kept on the item so each is split once.
var commandBarTokens = function(item, title, url) {
	if (!item.commandBarTokens) {
		item.commandBarTokens = ((title || "") + " " + url).toLowerCase().split(/[^a-z0-9]+/)
			.filter(function(token) { return token.length >= 3; });
	}
	return item.commandBarTokens;
};

// Whether `word` is the start of one of `tokens` with a typo or two: one for a word of 4 to 7
// letters, two from 8. A shorter word must match exactly.
var commandBarFuzzyWord = function(word, tokens) {
	var allowed = word.length >= 8 ? 2 : word.length >= 4 ? 1 : 0;
	if (allowed === 0) {
		return false;
	}
	for (var i = 0; i < tokens.length; i++) {
		// A typo almost never changes the first letter, short of swapping the first two. Checking
		// that first skips nearly every token, which keeps a pass over 10,000 pages fast.
		var token = tokens[i];
		if (token[0] !== word[0] && !(token[0] === word[1] && token[1] === word[0])) {
			continue;
		}
		for (var length = word.length - allowed; length <= word.length + allowed; length++) {
			if (length >= 3 && length <= tokens[i].length &&
				commandBarEditDistance(word, tokens[i].slice(0, length), allowed) <= allowed) {
				return true;
			}
		}
	}
	return false;
};

// The score of a page that matches the query only with typos, or -1. It ranks below every exact
// match and never leads the list, so a misspelled search still searches.
var COMMAND_BAR_FUZZY_SCORE = 5;
var commandBarFuzzyScore = function(query, item, title, url) {
	var words = query.trim().toLowerCase().split(/\s+/);
	var lowerTitle = (title || "").toLowerCase();
	var lowerUrl = url.toLowerCase();
	var tokens = null;
	for (var i = 0; i < words.length; i++) {
		if (lowerTitle.indexOf(words[i]) !== -1 || lowerUrl.indexOf(words[i]) !== -1) {
			continue;
		}
		tokens = tokens || commandBarTokens(item, title, url);
		if (!commandBarFuzzyWord(words[i], tokens)) {
			return -1;
		}
	}
	return COMMAND_BAR_FUZZY_SCORE;
};

// Pages visited lately, often or by typing their address rank higher. Recency halves every
// day. Frequency grows with the logarithm of the visit count and stops at 100 visits, so a page
// opened thousands of times does not bury everything else. The most a page can get stays below
// an open tab's bonus, so an open tab wins a tie.
var COMMAND_BAR_TAB_BONUS = 45;
var COMMAND_BAR_BOOKMARK_BONUS = 25;
var COMMAND_BAR_RECENCY_HALF_LIFE_HOURS = 24;

var commandBarHistoryBonus = function(item) {
	var ageHours = Math.max(0, (Date.now() - (item.lastVisitTime || 0)) / (60 * 60 * 1000));
	var recency = item.lastVisitTime ? Math.pow(0.5, ageHours / COMMAND_BAR_RECENCY_HALF_LIFE_HOURS) : 0;
	var frequency = Math.min(1, Math.log1p(item.visitCount || 0) / Math.log1p(100));
	var typed = Math.min(8, (item.typedCount || 0) * 2);
	return 15 * recency + 20 * frequency + typed;
};

var commandBarSearchRow = function(text) {
	return { kind: "search", title: text, detail: "Search with Google", hint: "", text: text };
};

// The row Enter falls back to for typed text: visit it as a URL, or search for it.
var commandBarDefaultRow = function(text) {
	var url = commandBarTypedUrl(text);
	if (url) {
		return { kind: "url", title: commandBarDisplayUrl(url), detail: "Visit", hint: "", url: url };
	}
	return commandBarSearchRow(text);
};

// A row that visits the site a page belongs to, for a query that is the start of its host.
var commandBarSiteRow = function(url) {
	var origin = url.split("/").slice(0, 3).join("/");
	return { kind: "url", title: commandBarHost(url), detail: "Visit", hint: "", url: origin + "/" };
};

// The field's inline completion for the query, the way Arc, Zen and Chrome complete a site as
// you type its name: "you" becomes "youtube.com/", with the added part selected. Only offered
// when the first row is that site, so Enter goes where the field says.
var commandBarAutocomplete = function(query, lead) {
	var text = query.trim();
	if (!lead || !lead.url || (lead.kind !== "url" && lead.kind !== "tab") || /[\s\/]/.test(text)) {
		return "";
	}
	var host = commandBarHost(lead.url);
	if (!host) {
		return "";
	}
	var site = (/^www\./i.test(text) ? "www." : "") + host + "/";
	if (site.indexOf(text.toLowerCase()) !== 0 || site.length - text.length < 2) {
		return "";
	}
	return text + site.slice(text.length);
};

// Commands the bar can run, like Chrome Palette's. Tab commands act on the tab the bar opened
// over. Pages open like any other address. A command that closes several tabs at once is left
// out on purpose: one stray Enter must not cost you your tabs.
var COMMAND_BAR_COMMANDS = [
	{ command: "close-tab", title: "Close Tab", hint: "⌘W", symbol: "xmark", tab: true },
	{ command: "pin-tab", title: "Pin Tab", unTitle: "Unpin Tab", state: "pinned", symbol: "pin", tab: true },
	{ command: "duplicate-tab", title: "Duplicate Tab", symbol: "plus.square.on.square", tab: true },
	{ command: "mute-tab", title: "Mute Tab", unTitle: "Unmute Tab", state: "muted", symbol: "speaker.slash", tab: true },
	{ command: "reload-tab", title: "Reload Tab", hint: "⌘R", symbol: "arrow.clockwise", tab: true },
	{ command: "move-tab-to-new-window", title: "Move Tab to New Window", symbol: "macwindow.badge.plus", tab: true },
	{ command: "copy-url", title: "Copy URL", hint: "⇧⌘C", symbol: "link", tab: true },
	{ command: "reopen-closed-tab", title: "Reopen Closed Tab", hint: "⇧⌘T", symbol: "arrow.uturn.backward" },
	{ command: "new-window", title: "New Window", hint: "⌘N", symbol: "macwindow" },
	{ command: "new-incognito-window", title: "New Incognito Window", hint: "⇧⌘N", symbol: "eyeglasses" },
	{ command: "full-screen", title: "Toggle Full Screen", hint: "⌃⌘F", symbol: "arrow.up.left.and.arrow.down.right" },
	{ url: "chrome://settings/", title: "Settings", hint: "⌘,", symbol: "gearshape" },
	{ url: "chrome://history/", title: "History", hint: "⌘Y", symbol: "clock" },
	{ url: "chrome://downloads/", title: "Downloads", hint: "⇧⌘J", symbol: "arrow.down.circle" },
	{ url: "chrome://extensions/", title: "Extensions", symbol: "puzzlepiece.extension" },
	{ url: "chrome://bookmarks/", title: "Bookmarks", hint: "⌥⌘B", symbol: "book" },
	{ url: "chrome://password-manager/", title: "Passwords", symbol: "key" },
	{ url: "chrome://settings/clearBrowserData", title: "Clear Browsing Data", hint: "⇧⌘⌫", symbol: "trash" }
];

// The commands whose name has a word starting with each word of the query, best first. `target`
// is the bar's target: without a tab, the tab commands are left out.
var commandBarMatchingCommands = function(text, target) {
	var words = text.toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) {
		return [];
	}
	var hasTab = Boolean(target) && target.tabId !== null && target.tabId !== undefined;
	var matches = [];
	COMMAND_BAR_COMMANDS.forEach(function(definition) {
		if (definition.tab && !hasTab) {
			return;
		}
		var title = definition.state && target && target[definition.state] ? definition.unTitle : definition.title;
		var lowerTitle = title.toLowerCase();
		var allWords = words.every(function(word) { return commandBarWordStart(lowerTitle, word) !== -1; });
		if (!allWords) {
			return;
		}
		var match = commandBarWordStart(lowerTitle, text.toLowerCase()) === 0 ? 60 : 30;
		var row = { kind: "command", title: title, detail: "", hint: definition.hint || "",
			symbol: definition.symbol, match: match };
		if (definition.url) {
			row.url = definition.url;
		} else {
			row.command = definition.command;
		}
		matches.push(row);
	});
	matches.sort(function(a, b) { return b.match - a.match; });
	return matches;
};

// When the exact pass finds fewer pages than this, a second pass allows typos.
var COMMAND_BAR_FUZZY_BELOW = 3;

// Rank open tabs, bookmarks and history for the query and put the typed text's own row (open
// the URL, or search) among them. A page that is in several sources is listed once, as an open
// tab first, then as a bookmark.
var commandBarRank = function(query, sources) {
	var text = query.trim();
	var candidates = [];
	var byKey = new Map();
	var fuzzy = false;
	var add = function(kind, item, title, url, bonus, extra) {
		if (!url || /^javascript:/i.test(url)) {
			return;
		}
		var match = fuzzy ? commandBarFuzzyScore(text, item, title, url) : commandBarMatchScore(text, title, url);
		if (match < 0) {
			return;
		}
		var key = commandBarUrlKey(url);
		var existing = byKey.get(key);
		if (existing) {
			existing.score = Math.max(existing.score, match + bonus);
			return;
		}
		var candidate = Object.assign({
			kind: kind,
			title: title || commandBarDisplayUrl(url),
			detail: commandBarDisplayUrl(url),
			hint: kind === "tab" ? "Switch to Tab" : kind === "bookmark" ? "Bookmark" : "",
			url: url,
			key: key,
			match: match,
			score: match + bonus
		}, extra);
		byKey.set(key, candidate);
		candidates.push(candidate);
	};
	var addAll = function() {
		(sources.tabs || []).forEach(function(tab) {
			add("tab", tab, tab.title, tab.url, COMMAND_BAR_TAB_BONUS, { tabId: tab.id });
		});
		(sources.bookmarks || []).forEach(function(bookmark) {
			add("bookmark", bookmark, bookmark.title, bookmark.url, COMMAND_BAR_BOOKMARK_BONUS);
		});
		(sources.history || []).forEach(function(item) {
			add("history", item, item.title, item.url, commandBarHistoryBonus(item));
		});
	};
	addAll();
	if (candidates.length < COMMAND_BAR_FUZZY_BELOW && text.length >= 4) {
		fuzzy = true;
		addAll();
	}
	candidates.sort(function(a, b) { return b.score - a.score; });
	var commands = commandBarMatchingCommands(text, sources.target);

	var results = [];
	var typedUrl = commandBarTypedUrl(text);
	if (typedUrl) {
		// The typed address itself first, unless a tab already has it open.
		var same = byKey.get(commandBarUrlKey(typedUrl));
		var lead = same && same.kind === "tab" ? same : commandBarDefaultRow(text);
		results.push(lead);
		if (!COMMAND_BAR_SCHEMES.test(text)) {
			results.push(commandBarSearchRow(text));
		}
	} else {
		var best = candidates[0];
		var strong = best && text.length >= 2 && (best.match >= COMMAND_BAR_STRONG_HOST_MATCH ||
			(best.kind === "tab" && best.match >= COMMAND_BAR_STRONG_TAB_MATCH));
		// A command whose name starts with the query leads when no page does: "set" is Settings.
		if (!strong && commands.length && commands[0].match >= COMMAND_BAR_STRONG_TAB_MATCH && text.length >= 3) {
			results.push(commands.shift());
		}
		if (strong) {
			// A site name leads with the site itself, unless a tab has a page of it open.
			var site = best.kind !== "tab" && commandBarHost(best.url).indexOf(text.toLowerCase()) === 0 ?
				commandBarSiteRow(best.url) : best;
			results.push(site);
			var siteKey = commandBarUrlKey(site.url);
			candidates = candidates.filter(function(c) { return c === site || c.key !== siteKey; });
		}
		results.push(commandBarSearchRow(text));
	}
	// Other commands come right after the typed text's own rows, at most two of them.
	commands.slice(0, 2).forEach(function(command) {
		results.push(command);
	});
	for (var i = 0; i < candidates.length && results.length < COMMAND_BAR_MAX_RESULTS; i++) {
		if (results.indexOf(candidates[i]) === -1) {
			results.push(candidates[i]);
		}
	}
	return results.slice(0, COMMAND_BAR_MAX_RESULTS).map(function(result) {
		var row = { kind: result.kind, title: result.title, detail: result.detail, hint: result.hint };
		["url", "tabId", "text", "command", "symbol"].forEach(function(field) {
			if (result[field] !== undefined) {
				row[field] = result[field];
			}
		});
		return row;
	});
};

// Chrome's own favicon for a page, as a data URL the app can draw. Read from Chrome's favicon
// cache through the extension's _favicon endpoint, so nothing goes over the network.
var commandBarFaviconKey = function(url) {
	return commandBarHost(url) ? url.split("/").slice(0, 3).join("/") : url;
};

var commandBarFavicon = async function(url) {
	var key = commandBarFaviconKey(url);
	if (commandBarFavicons.has(key)) {
		return commandBarFavicons.get(key);
	}
	var dataUrl = "";
	try {
		var response = await fetch(chrome.runtime.getURL("/_favicon/?pageUrl=" +
			encodeURIComponent(url) + "&size=32"));
		var bytes = new Uint8Array(await response.arrayBuffer());
		var binary = "";
		for (var i = 0; i < bytes.length; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		dataUrl = "data:" + (response.headers.get("content-type") || "image/png") + ";base64," + btoa(binary);
	} catch (e) {
		log("CommandBar::Favicon failed for " + url + ": " + e.message);
	}
	commandBarFavicons.set(key, dataUrl);
	if (commandBarFavicons.size > COMMAND_BAR_MAX_FAVICONS) {
		commandBarFavicons.delete(commandBarFavicons.keys().next().value);
	}
	return dataUrl;
};

var commandBarLoadHistory = function() {
	if (!commandBarHistoryLoading) {
		var startedAt = Date.now();
		commandBarHistoryLoading = chrome.history.search({
			text: "",
			startTime: Date.now() - COMMAND_BAR_HISTORY_DAYS * 24 * 60 * 60 * 1000,
			maxResults: COMMAND_BAR_HISTORY_LIMIT
		}).then(function(items) {
			commandBarTrace("history loaded: " + items.length + " entries in " + (Date.now() - startedAt) + " ms");
			var history = new Map();
			items.sort(function(a, b) { return (a.lastVisitTime || 0) - (b.lastVisitTime || 0); });
			items.forEach(function(item) { history.set(item.url, item); });
			commandBarHistory = history;
		}).catch(function(e) {
			log("CommandBar::Could not load history: " + e.message);
			commandBarHistoryLoading = null;
		});
	}
	return commandBarHistoryLoading;
};

chrome.history.onVisited.addListener(function(item) {
	if (!commandBarHistory) {
		return;
	}
	commandBarHistory.delete(item.url);
	commandBarHistory.set(item.url, item);
	if (commandBarHistory.size > COMMAND_BAR_HISTORY_LIMIT) {
		commandBarHistory.delete(commandBarHistory.keys().next().value);
	}
});

// Deleted history must not be suggested, so read it again.
chrome.history.onVisitRemoved.addListener(function() {
	commandBarHistory = null;
	commandBarHistoryLoading = null;
	commandBarLoadHistory();
});

var commandBarSearch = async function(query) {
	var results;
	if (!query.trim()) {
		var sites = await chrome.topSites.get();
		results = sites.slice(0, COMMAND_BAR_TOP_SITES).map(function(site) {
			return {
				kind: "top",
				title: site.title || commandBarDisplayUrl(site.url),
				detail: commandBarDisplayUrl(site.url),
				hint: "",
				url: site.url
			};
		});
	} else {
		// Right after the worker starts, give the history a moment to load, once. After that
		// the bar is answered with whatever is loaded rather than kept waiting.
		if (!commandBarHistory && !commandBarHistoryWaited) {
			commandBarHistoryWaited = true;
			await Promise.race([commandBarLoadHistory(), new Promise(function(resolve) {
				setTimeout(resolve, COMMAND_BAR_HISTORY_WAIT_MS);
			})]);
		}
		var found = await Promise.all([
			chrome.tabs.query({ windowType: "normal" }),
			chrome.bookmarks.search(query).catch(function() { return []; })
		]);
		// The tab the bar opened over is where you already are.
		var hereTabId = commandBarTarget ? commandBarTarget.tabId : null;
		results = commandBarRank(query, {
			tabs: found[0].filter(function(tab) { return tab.id !== hereTabId; }),
			bookmarks: found[1].filter(function(bookmark) { return bookmark.url; }),
			history: commandBarHistory ? Array.from(commandBarHistory.values()) : [],
			target: commandBarTarget
		});
	}
	results.forEach(function(result) {
		result.fill = commandBarFill(result);
		var cached = commandBarWantsFavicon(result) ? commandBarFavicons.get(commandBarFaviconKey(result.url)) : undefined;
		if (cached !== undefined) {
			result.favicon = cached;
		}
	});
	return results;
};

// What the field shows while a row is selected with the arrow keys, as in Arc and Zen: the
// row's address, or the query of a search. A command leaves the field as typed.
var commandBarFill = function(result) {
	if (result.kind === "search") {
		return result.text;
	}
	if (result.kind === "command" || !result.url) {
		return "";
	}
	return commandBarDisplayUrl(result.url);
};

// Commands draw their own symbol.
var commandBarWantsFavicon = function(result) {
	return Boolean(result.url) && result.kind !== "command";
};

// Fill in the favicons that were not cached. Returns whether any was added.
var commandBarAddFavicons = async function(results) {
	var added = false;
	await Promise.all(results.map(async function(result) {
		if (commandBarWantsFavicon(result) && result.favicon === undefined) {
			result.favicon = await commandBarFavicon(result.url);
			added = added || result.favicon !== "";
		}
	}));
	return added;
};

// Cmd+T or Cmd+L was pressed. Only the profile that owns the focused window answers, so with
// several profiles open the bar opens once, over the right window.
var commandBarOpen = async function(mode) {
	var win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
	if (!win || !win.focused) {
		log("CommandBar::No focused window in this profile - ignoring");
		return;
	}
	var tabs = await chrome.tabs.query({ active: true, windowId: win.id });
	var active = tabs[0];
	commandBarTarget = { mode: mode, windowId: win.id, tabId: active ? active.id : null,
		pinned: Boolean(active && active.pinned), muted: Boolean(active && active.mutedInfo && active.mutedInfo.muted) };
	var text = "";
	if (mode === "current_tab" && active && !/^chrome:\/\/newtab\/?$/.test(active.url || "")) {
		text = active.url || "";
	}
	sendToNativeHost({ action: "show_command_bar", mode: mode, text: text });
	commandBarLoadHistory();
};

// Answer a query at once, then again with its favicons. Chrome reads favicons on its history
// thread, which a large history can keep busy, so the rows must not wait for them.
var commandBarQuery = async function(message) {
	commandBarLatestSeq = Math.max(commandBarLatestSeq, message.seq);
	var query = message.query || "";
	var startedAt = Date.now();
	var results = [];
	try {
		results = await commandBarSearch(query);
	} catch (e) {
		commandBarTrace("query failed: " + e.message);
	}
	if (message.seq < commandBarLatestSeq) {
		return;
	}
	var autocomplete = query.trim() ? commandBarAutocomplete(query, results[0]) : "";
	sendToNativeHost({ action: "command_bar_results", seq: message.seq, results: results,
		autocomplete: autocomplete });
	commandBarTrace("answered \"" + query + "\" with " + results.length + " rows in " +
		(Date.now() - startedAt) + " ms");
	if (await commandBarAddFavicons(results) && message.seq === commandBarLatestSeq) {
		sendToNativeHost({ action: "command_bar_results", seq: message.seq, results: results,
			autocomplete: autocomplete, refresh: true });
	}
};

// Written to the app's debug log, which is easier to reach than the worker's console.
var commandBarTrace = function(text) {
	log("CommandBar::" + text);
	sendToNativeHost({ action: "log", message: "CommandBar: " + text });
};

// Open what was chosen. With no row chosen, typed text is opened or searched as typed, and an
// empty Cmd+T bar opens a plain new tab.
var commandBarChoose = async function(message) {
	var target = commandBarTarget;
	commandBarTarget = null;
	if (!target) {
		return;
	}
	var text = (message.text || "").trim();
	var item = message.item || (text ? commandBarDefaultRow(text) : null);
	var newTab = target.mode === "new_tab";
	try {
		if (!item) {
			if (newTab) {
				await chrome.tabs.create({ windowId: target.windowId });
			}
		} else if (item.kind === "command" && item.command) {
			await commandBarRunCommand(item.command, target);
		} else if (item.kind === "tab") {
			var tab = await chrome.tabs.get(item.tabId);
			await chrome.windows.update(tab.windowId, { focused: true });
			await chrome.tabs.update(tab.id, { active: true });
		} else if (item.kind === "search") {
			if (newTab || target.tabId === null) {
				await chrome.search.query({ text: item.text, disposition: "NEW_TAB" });
			} else {
				await chrome.search.query({ text: item.text, tabId: target.tabId });
			}
		} else if (newTab || target.tabId === null) {
			await chrome.tabs.create({ windowId: target.windowId, url: item.url });
		} else {
			await chrome.tabs.update(target.tabId, { url: item.url });
		}
	} catch (e) {
		log("CommandBar::Could not open the choice: " + e.message);
	}
};

var commandBarRunCommand = async function(command, target) {
	var tabId = target.tabId;
	switch (command) {
	case "close-tab":
		await chrome.tabs.remove(tabId);
		break;
	case "pin-tab":
		await chrome.tabs.update(tabId, { pinned: !target.pinned });
		break;
	case "duplicate-tab":
		await chrome.tabs.duplicate(tabId);
		break;
	case "mute-tab":
		await chrome.tabs.update(tabId, { muted: !target.muted });
		break;
	case "reload-tab":
		await chrome.tabs.reload(tabId);
		break;
	case "move-tab-to-new-window":
		await chrome.windows.create({ tabId: tabId });
		break;
	case "copy-url":
		// The app owns the clipboard and shows the same toast as Cmd+Shift+C.
		var tab = await chrome.tabs.get(tabId);
		sendToNativeHost({ action: "url_copied", url: tab.url, title: tab.title || "" });
		break;
	case "reopen-closed-tab":
		await chrome.sessions.restore();
		break;
	case "new-window":
		await chrome.windows.create({});
		break;
	case "new-incognito-window":
		await chrome.windows.create({ incognito: true });
		break;
	case "full-screen":
		var win = await chrome.windows.get(target.windowId);
		await chrome.windows.update(target.windowId, { state: win.state === "fullscreen" ? "normal" : "fullscreen" });
		break;
	default:
		log("CommandBar::Unknown command " + command);
	}
};

var commandBarClosed = function() {
	commandBarTarget = null;
};

commandBarLoadHistory();
