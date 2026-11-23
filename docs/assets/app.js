/**
 * Explore Elinor: shared page code for the static site in docs/.
 *
 * Every page is a thin HTML shell with <body data-page="...">. This script loads the dated
 * snapshot (data/snapshot.json, written by scripts/build_snapshot.py), draws the shared chrome
 * (menu bar, "Under development" ribbon, footer) and then the page itself:
 *   home    - the collection and its four ways in
 *   article - one way in, with the preservation map (?id=ostrom)
 *   browse  - the card catalog with search and filters (?q=&way=&copy=&type=&lang=&flag=)
 *   work    - one record, its copies and its forms (?key=ZOTEROKEY)
 *   about   - the warning, the ReCite project, the data
 *
 * All text from Zotero is inserted with textContent (never innerHTML), and only http(s) links
 * are rendered, because record fields are written by many people.
 */

const TYPE_LABELS = {
  book: "Book", journalArticle: "Journal article", bookSection: "Book section",
  webpage: "Web page", newspaperArticle: "Newspaper article", magazineArticle: "Magazine article",
  blogPost: "Blog post", encyclopediaArticle: "Encyclopedia article", report: "Report",
  thesis: "Thesis", conferencePaper: "Conference paper", dictionaryEntry: "Dictionary entry",
  tvBroadcast: "TV broadcast", document: "Document", videoRecording: "Video",
  presentation: "Presentation",
};

/** Item types whose original lives on the open web and can vanish: the fragile ones. */
const WEB_TYPES = new Set(["webpage", "blogPost", "newspaperArticle", "magazineArticle",
  "videoRecording", "presentation", "document", "tvBroadcast"]);

/**
 * Preservation states, each with a symbol and a word so colour is never the only signal.
 * These follow the original preservation-map sketch (● Live, ◐ Rescued, ◌ Endangered,
 * ✕ Vanished), but only what we know without a link check: whether a copy exists. "copy" covers
 * live-or-rescued, "none" covers endangered-or-vanished; the link check will split them.
 * "unchecked" means nobody has looked for a copy yet (no archive pass for that way in), so we
 * don't claim one is missing.
 */
const STATES = {
  copy: { symbol: "◐", label: "Archive copy" },
  openlibrary: { symbol: "◔", label: "Open Library only" },
  none: { symbol: "◌", label: "No copy found" },
  unchecked: { symbol: "–", label: "Not checked yet" },
  unmatched: { symbol: "?", label: "Not matched yet" },
};

/**
 * Link to the exact Wikipedia revision a way in was collected from.
 * @param {Object} way - a snapshot way with wikiTitle and revision.
 * @returns {string|null}
 */
function revisionUrl(way) {
  if (!way.wikiTitle || !way.revision) return null;
  return `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(way.wikiTitle)}&oldid=${encodeURIComponent(way.revision)}`;
}

const ZOTERO_ITEM = (snap, key) => `${snap.group.url}/items/${encodeURIComponent(key)}`;

/**
 * Create a DOM element.
 * @param {string} tag - element name.
 * @param {Object} [attrs] - attributes; "class", "href" (http(s) or relative only), "on*" handlers.
 * @param {...(Node|string|null|false)} children - nodes or text; falsy children are skipped.
 * @returns {HTMLElement}
 */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (name.startsWith("on")) el.addEventListener(name.slice(2), value);
    else if (name === "href") { const safe = safeHref(value); if (safe) el.setAttribute("href", safe); }
    else el.setAttribute(name, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/**
 * Replace an element's children, skipping null/false and flattening nested arrays
 * (plain replaceChildren would print "null" or "[object HTMLElement]" for those).
 * @param {HTMLElement} el
 * @param {...*} children
 */
function fill(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
}

/**
 * Allow only http(s) URLs and plain relative links; anything else (javascript:, data:) is dropped.
 * A relative link must not start with "//" or "\": browsers treat those as links to another
 * site ("//evil.example" is protocol-relative), so they'd slip past a "relative only" check.
 * @param {string} url
 * @returns {string|null}
 */
function safeHref(url) {
  if (typeof url !== "string") return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (/^[\w.?=&%#-][\w./?=&%#-]*$/.test(url) && !url.includes(":") && !url.startsWith("//")) return url;
  return null;
}

/** An external link that opens in a new tab, marked with an arrow. */
function extLink(url, text) {
  return h("a", { href: url, target: "_blank", rel: "noopener" }, text, " ↗");
}

/**
 * The preservation state of one record.
 * @param {Object|undefined} item - snapshot item, or undefined for an unmatched ref.
 * @returns {"copy"|"openlibrary"|"none"|"unchecked"|"unmatched"}
 */
function stateOf(item) {
  if (!item) return "unmatched";
  if (item.copies.length) return "copy";
  if (!item.archiveChecked) return "unchecked";
  if (item.links.some((l) => l.kind === "openlibrary")) return "openlibrary";
  return "none";
}

/** A small "● Archive copy" badge for a state. */
function stateBadge(state) {
  const s = STATES[state];
  return h("span", { class: `state state-${state}` }, `${s.symbol} ${s.label}`);
}

/** Read one query-string parameter. */
function param(name) {
  return new URLSearchParams(location.search).get(name);
}

/** Load the snapshot JSON. Throws if it can't be fetched. */
async function loadSnapshot() {
  const resp = await fetch("data/snapshot.json");
  if (!resp.ok) throw new Error(`snapshot: HTTP ${resp.status}`);
  return resp.json();
}

/**
 * Draw the menu bar, the ribbon and the footer around <main>.
 * Search is a small field in the menu bar rather than the centre of the home page: the site is
 * for exploring, and searching is a side door. Browse has its own full search box, so the menu
 * bar leaves it out there.
 * @param {Object} snap - the snapshot (for the "as of" date).
 * @param {string} page - the current page name (from <body data-page>).
 */
function renderChrome(snap, page) {
  const search = page === "browse" ? null
    : h("form", { class: "header-search", action: "browse.html", method: "get", role: "search" },
      h("label", { for: "site-q", class: "visually-hidden" }, "Search the collection"),
      h("input", { id: "site-q", name: "q", type: "search", placeholder: "Search the collection" }));
  document.body.prepend(
    h("header", { class: "site-header" },
      h("a", { class: "site-name", href: "index.html" }, "Explore Elinor"),
      h("nav", {}, search, h("a", { href: "browse.html" }, "Browse"), h("a", { href: "about.html" }, "About"))),
    h("div", { class: "ribbon", "aria-hidden": "true" }, h("span", {}, "Under development")),
  );
  document.body.append(
    h("footer", { class: "site-footer" },
      `Under active development: information is not complete or correct. Data as of ${snap.asOf}, from the public Zotero group `,
      extLink(snap.group.url, snap.group.name), ". ", h("a", { href: "about.html" }, "About this site")),
  );
}

/** The ways in that are Wikipedia articles (not "beyond Wikipedia"). */
function articles(snap) {
  return snap.ways.filter((w) => w.kind === "article");
}

/** Spell out small counts ("four articles"); larger ones stay as digits. */
function numberWord(n) {
  return ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] || String(n);
}

/** Join names as "A, B and C". */
function listNames(names) {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** Index items by Zotero key. */
function byKey(snap) {
  return new Map(snap.items.map((i) => [i.key, i]));
}

/**
 * The filled part of a progress bar.
 * Width is set through el.style (the CSSOM), not a style="" attribute: the pages' Content-
 * Security-Policy blocks inline style attributes but allows script-set styles.
 * @param {number} pct - 0 to 100.
 * @returns {HTMLElement}
 */
function barFill(pct) {
  const span = h("span");
  span.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  return span;
}

/** Count of a way's items that have an Archive copy. */
function archivedCount(snap, wayId) {
  return snap.items.filter((i) => i.ways.includes(wayId) && i.copies.length).length;
}

// ---------------------------------------------------------------------------------------------
// Pages

/** Home: the collection, its ways in, and browse-by links. (Search lives in the menu bar.) */
function renderHome(snap, main) {
  const cards = snap.ways.map((w) => {
    const archived = archivedCount(snap, w.id);
    const pct = w.count ? Math.round((100 * archived) / w.count) : 0;
    return h("a", { class: `card way-card ${w.kind === "beyond" ? "way-beyond" : ""}`, href: `article.html?id=${w.id}` },
      h("h3", {}, w.name),
      h("p", { class: "quiet" }, `${w.count} items`),
      w.kind === "beyond"
        ? h("p", {}, "Ostrom works found on archive.org that no article cites")
        // A way with no archive pass gets no bar: an empty bar would read as "none are safe".
        : w.archiveChecked
          ? [h("div", { class: "bar", role: "img", "aria-label": `${archived} of ${w.count} with an Archive copy` },
              barFill(pct)),
            h("p", {}, `${archived} with an Archive copy`)]
          : [h("div", { class: "bar bar-unchecked", role: "img", "aria-label": "Archive copies not checked yet" }),
            h("p", {}, "Archive copies: not checked yet")]);
  });

  const chip = (label, href) => h("a", { class: "chip", href }, label);
  main.append(
    h("section", { class: "hero" },
      h("h1", {}, "Explore Elinor: a study in reusable citations for the knowledge commons"),
      h("p", { class: "quiet" },
        `${snap.items.length} items behind ${numberWord(articles(snap).length)} Wikipedia articles, and beyond them. How well are they preserved and referenced?`)),
    h("section", {}, h("h2", {}, "Start from a Wikipedia article"), h("div", { class: "grid-4" }, cards)),
    h("section", { class: "browse-by" }, h("span", { class: "quiet" }, "Or browse by "),
      chip("Archive copy", "browse.html?copy=copy"), chip("Type", "browse.html#filters"),
      chip("Language", "browse.html#filters"), chip("Unprocessed", "browse.html?flag=Unprocessed")),
  );
}

/**
 * Article (or "beyond Wikipedia") page with the preservation map: one tile per reference in
 * article order where a ref list exists, otherwise one tile per item.
 */
function renderArticle(snap, main) {
  const way = snap.ways.find((w) => w.id === param("id")) || snap.ways[0];
  const items = byKey(snap);
  document.title = `${way.name} · Explore Elinor`;

  // Tiles: refs in article order when we have them; else the way's items, by title.
  const tiles = way.refs
    ? way.refs.map((r) => ({ label: String(r.n), ref: r, item: items.get(r.item) }))
    : snap.items.filter((i) => i.ways.includes(way.id)).map((i, n) => ({ label: String(n + 1), item: i }));
  const count = (s) => tiles.filter((t) => stateOf(t.item) === s).length;
  const unit = way.refs ? "references" : "items";

  const detail = h("div", { class: "card detail", "aria-live": "polite" },
    h("p", { class: "quiet" }, "Select a tile to see its record."));

  /** Fill the detail card for one tile: what it cites, when Wikipedia accessed it, its copies, next steps. */
  function showTile(t, button) {
    main.querySelectorAll(".tile[aria-pressed=true]").forEach((b) => b.setAttribute("aria-pressed", "false"));
    button.setAttribute("aria-pressed", "true");
    const item = t.item;
    const state = stateOf(item);
    if (!item) {
      fill(detail,
        h("h3", {}, `Ref ${t.ref.n} · ${t.ref.title}`),
        stateBadge(state),
        h("p", {}, "This reference isn't matched to a Zotero record yet."),
        h("p", {}, h("a", { href: `browse.html?q=${encodeURIComponent(t.ref.title)}` }, "Search the collection for it →")));
      return;
    }
    const sameItem = t.ref ? way.refs.filter((r) => r.item === item.key && r.n !== t.ref.n).map((r) => r.n) : [];
    // A date with no ref number applies to every ref of the item.
    const dates = item.accessed.filter((a) => !t.ref || !a.refs.length || a.refs.includes(t.ref.n)).map((a) => a.date);
    fill(detail,
      h("h3", {}, t.ref ? `Ref ${t.ref.n} · ` : "", item.title),
      h("p", { class: "quiet" }, [TYPE_LABELS[item.type] || item.type, item.source, item.year].filter(Boolean).join(" · ")),
      h("p", {}, stateBadge(state), WEB_TYPES.has(item.type) ? h("span", { class: "state state-web" }, "Web source (fragile)") : null),
      dates.length ? h("p", {}, `Wikipedia accessed: ${[...new Set(dates)].join(", ")}`) : null,
      item.copies.map((c) => h("p", {}, extLink(c.url, c.title || "Archive copy"))),
      sameItem.length ? h("p", {}, `Same record as ref ${sameItem.join(", ")}: one work, several citations.`) : null,
      item.flags.length ? h("p", {}, "Tagged: ", item.flags.map((f) => h("span", { class: "flag" }, f))) : null,
      h("p", { class: "card-links" },
        h("a", { href: `work.html?key=${encodeURIComponent(item.key)}` }, "Open work page →"),
        extLink(ZOTERO_ITEM(snap, item.key), "Zotero record"),
        // No copy yet: offer to make one. Save Page Now takes the original URL after /save/.
        !item.copies.length && /^https?:\/\//.test(item.url) ? extLink(`https://web.archive.org/save/${item.url}`, "Save Page Now") : null),
    );
  }

  const grid = h("div", { class: `tiles ${tiles.length > 100 ? "tiles-small" : ""}` },
    tiles.map((t) => {
      const state = stateOf(t.item);
      const web = t.item && WEB_TYPES.has(t.item.type);
      const name = t.ref ? `Ref ${t.ref.n}` : (t.item ? t.item.title : "");
      const button = h("button", {
        class: `tile tile-${state}`, type: "button", "aria-pressed": "false",
        "aria-label": `${name}: ${STATES[state].label}${web ? ", web source" : ""}`,
        title: t.item ? t.item.title : (t.ref ? t.ref.title : ""),
      }, `${t.label} `, h("span", { class: "sym", "aria-hidden": "true" }, STATES[state].symbol),
      web ? h("span", { class: "web-dot", "aria-hidden": "true" }) : null);
      button.addEventListener("click", () => showTile(t, button));
      return button;
    }));

  // Legend on the right, as in the sketch; Live and Vanished are shown as still to come.
  const legend = h("div", { class: "legend" },
    h("ul", {},
      Object.keys(STATES).filter((s) => tiles.some((t) => stateOf(t.item) === s)).map((s) =>
        h("li", {}, h("span", { class: `swatch tile-${s}`, "aria-hidden": "true" }), `${STATES[s].symbol} ${STATES[s].label}`)),
      h("li", {}, h("span", { class: "web-dot static", "aria-hidden": "true" }), "Web source (fragile)")),
    h("p", { class: "quiet" }, way.refs ? "Each tile is one Wikipedia ref number." : "Each tile is one Zotero record, in title order."),
    h("p", { class: "quiet" }, "After the link check: ● Live and ✕ Vanished will be told apart."));

  const rev = revisionUrl(way);
  main.append(
    h("p", { class: "crumbs" }, h("a", { href: "index.html" }, "Collection"), " › ", way.name),
    h("h1", {}, way.name),
    h("p", { class: "quiet" },
      rev ? ["English Wikipedia · ", extLink(rev, `revision ${way.revision} (${way.revisionDate})`), `, ${way.revisionNote}`]
        : "Found by the archive pass, not cited by any article",
      ` · data as of ${snap.asOf}`),
    count("unchecked") === tiles.length
      ? h("h2", { class: "headline" }, `Archive copies not checked yet for these ${tiles.length} ${unit}`)
      : h("h2", { class: "headline" }, `${count("copy")} of ${tiles.length} ${unit} have an Archive copy`),
    h("p", { class: "quiet" },
      [count("none") ? `${count("none")} have no copy found` : "",
        count("openlibrary") ? `${count("openlibrary")} only an Open Library link` : "",
        count("unchecked") && count("unchecked") < tiles.length ? `${count("unchecked")} not checked yet` : "",
        count("unmatched") ? `${count("unmatched")} aren't matched to a record yet` : ""].filter(Boolean).join(", "),
      count("unchecked") === tiles.length
        ? "No archive pass has been run for this article yet."
        : ". Original links haven't been checked yet."),
    h("div", { class: "map" }, grid, legend),
    detail,
    h("p", {}, h("a", { href: `browse.html?way=${way.id}` }, `Browse all ${way.count} items as cards →`)),
  );
}

/** Browse: search box, facet filters and catalog cards. State lives in the URL. */
function renderBrowse(snap, main) {
  const FACETS = [
    { id: "way", label: "Way in", values: (i) => i.ways, name: (v) => (snap.ways.find((w) => w.id === v) || {}).name || v },
    { id: "copy", label: "Archive copy", values: (i) => [i.copies.length ? "copy" : i.archiveChecked ? "nocopy" : "unchecked"],
      name: (v) => ({ copy: "Yes", nocopy: "No copy found", unchecked: "Not checked yet" })[v] || v },
    { id: "type", label: "Type", values: (i) => [i.type], name: (v) => TYPE_LABELS[v] || v },
    { id: "lang", label: "Language", values: (i) => [i.language || "Not recorded"], name: (v) => v },
    { id: "flag", label: "Flags", values: (i) => i.flags, name: (v) => v },
  ];
  const params = new URLSearchParams(location.search);
  const chosen = Object.fromEntries(FACETS.map((f) => [f.id, new Set(params.getAll(f.id))]));
  let query = params.get("q") || "";
  let shown = 60;

  const input = h("input", { id: "q", type: "search", value: query, placeholder: `Search ${snap.items.length} items: title, author, year` });
  const aside = h("aside", { id: "filters", class: "facets", "aria-label": "Filters" });
  const results = h("div", { class: "results" });

  /** Does an item pass the search and every facet except `skip`? */
  function passes(item, skip) {
    const q = query.trim().toLowerCase();
    if (q && ![item.title, item.creators, item.source, String(item.year || "")].join(" ").toLowerCase().includes(q)) return false;
    return FACETS.every((f) => f.id === skip || !chosen[f.id].size || f.values(item).some((v) => chosen[f.id].has(v)));
  }

  /** Write the current search and filters into the address bar, so a view can be shared. */
  function syncUrl() {
    const p = new URLSearchParams();
    if (query) p.set("q", query);
    for (const f of FACETS) for (const v of chosen[f.id]) p.append(f.id, v);
    history.replaceState(null, "", `${location.pathname}${p.toString() ? `?${p}` : ""}`);
  }

  /** Redraw the facets (counts reflect the other active filters) and the cards. */
  function draw() {
    fill(aside, FACETS.map((f) => {
      const counts = new Map();
      for (const i of snap.items) if (passes(i, f.id)) for (const v of f.values(i)) counts.set(v, (counts.get(v) || 0) + 1);
      for (const v of chosen[f.id]) if (!counts.has(v)) counts.set(v, 0);
      if (!counts.size) return null;
      const rows = [...counts].sort((a, b) => b[1] - a[1]).map(([v, n]) => {
        const box = h("input", { type: "checkbox", checked: chosen[f.id].has(v) });
        box.addEventListener("change", () => { box.checked ? chosen[f.id].add(v) : chosen[f.id].delete(v); shown = 60; syncUrl(); draw(); });
        return h("label", {}, box, ` ${f.name(v)} `, h("span", { class: "quiet" }, String(n)));
      });
      return h("fieldset", {}, h("legend", {}, f.label), rows);
    }));

    const hits = snap.items.filter((i) => passes(i));
    fill(results,
      h("p", { class: "quiet" }, `Showing ${Math.min(shown, hits.length)} of ${hits.length}`),
      h("div", { class: "grid-cards" }, hits.slice(0, shown).map((i) => itemCard(snap, i))),
      hits.length > shown ? h("button", { type: "button", class: "more", onclick: () => { shown += 60; draw(); } }, "Show more") : null,
    );
  }

  input.addEventListener("input", () => { query = input.value; shown = 60; syncUrl(); draw(); });
  main.append(
    h("h1", {}, "Browse the collection"),
    h("div", { class: "search", role: "search" }, h("label", { for: "q", class: "visually-hidden" }, "Search"), input),
    h("div", { class: "browse" }, aside, results));
  draw();
}

/** One catalog card for an item. */
function itemCard(snap, item) {
  const state = stateOf(item);
  const ways = item.ways.map((w) => (snap.ways.find((x) => x.id === w) || {}).name).filter(Boolean);
  return h("article", { class: "card item-card" },
    h("p", { class: "quiet" }, [item.flags.join(" · "), TYPE_LABELS[item.type] || item.type, item.year, item.language].filter(Boolean).join(" · ")),
    h("h3", {}, h("a", { href: `work.html?key=${encodeURIComponent(item.key)}` }, item.title)),
    item.creators || item.source ? h("p", { class: "quiet" }, [item.creators, item.source].filter(Boolean).join(" · ")) : null,
    h("p", {}, ways.length ? `Cited in: ${ways.filter((w) => w !== "Beyond Wikipedia").join(", ") || "no article (beyond Wikipedia)"}` : "Not tagged to an article"),
    item.refs.length > 1 ? h("p", {}, `Cited ${item.refs.length} times: refs ${item.refs.join(", ")}`) : null,
    h("p", {}, stateBadge(state), item.related.length ? ` · ${item.related.length} related` : ""),
    h("p", { class: "card-links" },
      h("a", { href: `work.html?key=${encodeURIComponent(item.key)}` }, "Open work →"), " ",
      extLink(ZOTERO_ITEM(snap, item.key), "Zotero")),
  );
}

/** Work: one record, where it is cited, its copies, and its forms (itself + Related links). */
function renderWork(snap, main) {
  const items = byKey(snap);
  const item = items.get(param("key"));
  if (!item) {
    main.append(h("h1", {}, "Record not found"), h("p", {}, "It may be outside the collection or newer than this snapshot. ",
      h("a", { href: "browse.html" }, "Browse the collection")));
    return;
  }
  document.title = `${item.title} · Explore Elinor`;
  const firstWay = snap.ways.find((w) => item.ways.includes(w.id));
  const citedIn = snap.ways.filter((w) => w.kind === "article" && item.ways.includes(w.id));
  const forms = [item, ...item.related.map((k) => items.get(k)).filter(Boolean)];
  const outside = item.related.filter((k) => !items.has(k));
  const languages = [...new Set(forms.map((f) => f.language).filter(Boolean))];
  const unrecorded = forms.filter((f) => !f.language).length;
  const langText = [languages.join(", "), unrecorded ? `${unrecorded} with no language recorded` : ""].filter(Boolean).join("; ");

  const tile = (name, ...body) => h("div", { class: "card measure" }, h("h3", {}, name), body);
  main.append(
    h("p", { class: "crumbs" }, h("a", { href: "index.html" }, "Collection"),
      firstWay ? [" › ", h("a", { href: `article.html?id=${firstWay.id}` }, firstWay.name)] : null, " › ", item.title),
    item.flags.length ? h("p", {}, item.flags.map((f) => h("span", { class: "flag" }, f))) : null,
    h("h1", {}, item.title),
    h("p", { class: "quiet" }, [TYPE_LABELS[item.type] || item.type, item.year, item.creators, item.source].filter(Boolean).join(" · "),
      " · ", extLink(ZOTERO_ITEM(snap, item.key), "Zotero record")),
    h("div", { class: "grid-3" },
      tile("Preservation", stateBadge(stateOf(item)),
        WEB_TYPES.has(item.type) ? h("p", { class: "quiet" }, "A web source: the original can vanish.") : null),
      tile("Resolution",
        h("p", {}, citedIn.length ? `Cited in: ${citedIn.map((w) => w.name).join(", ")}` : "Not cited by an article in this collection"),
        item.refs.length ? h("p", {}, `${item.refs.length > 1 ? `${item.refs.length} citations resolve here: ` : ""}ref ${item.refs.join(", ")}`) : null),
      tile("Reach", h("p", {}, `${forms.length} form${forms.length > 1 ? "s" : ""} in the collection · ${langText}`))),
    h("h2", {}, "Archive copies"),
    item.copies.length
      ? h("ul", {}, item.copies.map((c) => h("li", {}, extLink(c.url, c.title || c.url))))
      : h("p", { class: "quiet" }, item.archiveChecked ? "No Archive copy found." : "Not checked yet: no archive pass has looked for a copy of this record."),
    h("h2", {}, "Forms and copies"),
    h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Edition"), h("th", {}, "Language"), h("th", {}, "Archive copy"), h("th", {}, "Other links"))),
      h("tbody", {}, forms.map((f) => h("tr", {},
        h("td", {}, f === item ? `${f.title}${f.year ? `, ${f.year}` : ""} (this record)` : h("a", { href: `work.html?key=${encodeURIComponent(f.key)}` }, `${f.title}${f.year ? `, ${f.year}` : ""}`)),
        h("td", {}, f.language || "Not recorded"),
        h("td", {}, f.copies.length ? f.copies.map((c) => extLink(c.url, c.kind === "wayback" ? "Wayback" : "archive.org")) : "None yet"),
        h("td", {}, f.links.length ? f.links.map((l) => [extLink(l.url, l.title || l.kind), " "]) : "None"))))),
    outside.length ? h("p", { class: "quiet" }, `${outside.length} related record(s) are outside this collection: see the Zotero record.`) : null,
    h("p", { class: "quiet" }, "Other editions and languages not yet checked."),
    item.url ? h("p", {}, "Original: ", extLink(item.url, item.url)) : null,
  );
}

/** About: fill in the snapshot details; the rest of the page is static HTML. */
function renderAbout(snap) {
  const slot = document.getElementById("snapshot-facts");
  if (slot) slot.replaceChildren(`Counts come from a snapshot of the Zotero library as of ${snap.asOf} (library version ${snap.libraryVersion}): ${snap.items.length} items in the collection.`);
  const ways = document.getElementById("ways-in");
  if (ways) {
    const names = articles(snap).map((w) => w.name);
    ways.replaceChildren(`The site starts from ${numberWord(names.length)} English Wikipedia articles (${listNames(names)}), plus works found on archive.org that no article cites yet.`);
  }
}

/** Entry point: load data, draw chrome, then the page named by <body data-page>. */
async function start() {
  const main = document.querySelector("main");
  try {
    const snap = await loadSnapshot();
    const page = document.body.dataset.page;
    renderChrome(snap, page);
    ({ home: renderHome, article: renderArticle, browse: renderBrowse, work: renderWork, about: renderAbout })[page](snap, main);
  } catch (err) {
    main.append(h("p", { class: "error" }, `Couldn't load the data snapshot (${err.message}).`));
  }
}

start();
