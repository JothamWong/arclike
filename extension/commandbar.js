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

// Pages visited often, typed often or visited lately rank higher.
var commandBarHistoryBonus = function(item) {
	var bonus = Math.min(20, item.visitCount || 0) + Math.min(10, (item.typedCount || 0) * 2);
	var age = Date.now() - (item.lastVisitTime || 0);
	if (age < 24 * 60 * 60 * 1000) {
		bonus += 8;
	} else if (age < 7 * 24 * 60 * 60 * 1000) {
		bonus += 4;
	}
	return bonus;
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

// Rank open tabs, bookmarks and history for the query and put the typed text's own row (open
// the URL, or search) among them. A page that is in several sources is listed once, as an open
// tab first, then as a bookmark.
var commandBarRank = function(query, sources) {
	var text = query.trim();
	var candidates = [];
	var byKey = new Map();
	var add = function(kind, title, url, bonus, extra) {
		if (!url || /^javascript:/i.test(url)) {
			return;
		}
		var match = commandBarMatchScore(text, title, url);
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
	(sources.tabs || []).forEach(function(tab) {
		add("tab", tab.title, tab.url, 40, { tabId: tab.id });
	});
	(sources.bookmarks || []).forEach(function(bookmark) {
		add("bookmark", bookmark.title, bookmark.url, 20);
	});
	(sources.history || []).forEach(function(item) {
		add("history", item.title, item.url, commandBarHistoryBonus(item));
	});
	candidates.sort(function(a, b) { return b.score - a.score; });

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
	for (var i = 0; i < candidates.length && results.length < COMMAND_BAR_MAX_RESULTS; i++) {
		if (results.indexOf(candidates[i]) === -1) {
			results.push(candidates[i]);
		}
	}
	return results.slice(0, COMMAND_BAR_MAX_RESULTS).map(function(result) {
		var row = { kind: result.kind, title: result.title, detail: result.detail, hint: result.hint };
		["url", "tabId", "text"].forEach(function(field) {
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
			history: commandBarHistory ? Array.from(commandBarHistory.values()) : []
		});
	}
	results.forEach(function(result) {
		var cached = result.url ? commandBarFavicons.get(commandBarFaviconKey(result.url)) : undefined;
		if (cached !== undefined) {
			result.favicon = cached;
		}
	});
	return results;
};

// Fill in the favicons that were not cached. Returns whether any was added.
var commandBarAddFavicons = async function(results) {
	var added = false;
	await Promise.all(results.map(async function(result) {
		if (result.url && result.favicon === undefined) {
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
	commandBarTarget = { mode: mode, windowId: win.id, tabId: active ? active.id : null };
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

var commandBarClosed = function() {
	commandBarTarget = null;
};

commandBarLoadHistory();
