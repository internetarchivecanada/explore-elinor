# Explore Elinor: a study in reusable citations for the knowledge commons

**Please note that this mostly Claude creation is under active development and is not meant to be referenced or used.** 
This static website explores the Zotero collection "Elinor - under construction" (group "Wiki ReCite"): how
safe its citations are, whether they resolve to one work, and how far each work reaches into
editions and translations. Four English Wikipedia articles (Elinor Ostrom, Hannah Arendt,
Alan F. Westin, Amartya Sen) are the ways in. The data work (cleanup, linking, review) happens
in Zotero; this repo holds the site and the script that snapshots its data.

**Status (2026-11-23):** first working version of all five pages, under active development.
Part of the ReCite project: https://meta.wikimedia.org/wiki/WikiCite/ReCite, specifically these trials:
https://meta.wikimedia.org/wiki/WikiCite/ReCite/Trials

## The site

Plain HTML, CSS and JavaScript in `docs/`, no build step, served by GitHub Pages from `docs/`
on `main`. Every page shows an "Under development" ribbon.

| Page | File | What it shows |
|---|---|---|
| Home | `docs/index.html` | The collection, and a way in per article plus "Beyond Wikipedia" (search is a small field in the menu bar of every page) |
| Article | `docs/article.html?id=ostrom` | The preservation map: one tile per reference in article order (Ostrom), or per item (others) |
| Browse | `docs/browse.html` | Card catalog with search and filters (way in, Archive copy, type, language, flags); filters live in the URL |
| Work | `docs/work.html?key=KEY` | One record: preservation, resolution (which refs cite it), reach (its Related forms) |
| About | `docs/about.html` | Development warning, link to ReCite, where the data comes from |

All page code is in `docs/assets/app.js`; styles in `docs/assets/style.css`.

### Data snapshot

The site reads only `docs/data/snapshot.json`, a dated snapshot. To refresh it (read-only, GET
to api.zotero.org only; the group is public, so no key is needed):

```sh
python3 scripts/build_snapshot.py
```

- Ways in are Zotero tags, configured in `WAYS` at the top of the script, with the exact
  Wikipedia revision each article page links to. Ostrom's is the reviewed revision; Arendt's
  Westin's and Sen's weren't recorded, so they are the revisions live on the tag date
  (2026-11-23). To add an article: tag its citations in Zotero, add an entry to `WAYS`, rebuild.
- Reference order for the preservation map comes from `data/refs/<article>.tsv` (today only
  Ostrom has one). Refs are matched to records by ref number in
  attachment titles and notes, then DOI, then title: a first pass, so a few may be wrong.
- Flags: tag a record `Unprocessed` in Zotero to flag it on the site (also shown: `ISSUE` as
  "Open issue", `TO ADD` as "To add"). Configured in `FLAG_TAGS`.
- Archive-copy status: "Archive copy" (a Wayback or archive.org attachment), "No copy found"
  (an archive pass looked and found none), or "Not checked yet" (no archive pass for that way
  in). Set `archiveChecked: True` on a way in `WAYS` once its archive pass is done; today only
  Ostrom has it.
- "Archive copy" means a Wayback or archive.org attachment. Link status (live, vanished) is
  not checked yet.

### Preview locally

```sh
python3 -m http.server 8000 --directory docs
```

Then open http://localhost:8000.

## Brief

### First three explorers

They map to the slide's three claims: citations are fragile, thin, and scattered in many forms.

| Explorer | Question it answers | Needs from the records |
|---|---|---|
| Preservation map: one tile per citation, by link status (live, rescued, endangered, vanished) | How many citations have an Archive copy, and which are at risk? Gives the "X of Y" figure. | IA attachment present or absent; link status |
| Identifier ladder: stacked bars by band (1, 2, 3) and type, "as imported" next to "after enrichment" | Where are identifiers thin, and how much did linking add? | Item type, identifiers, Wikidata and OpenAlex links |
| One work, many forms: tree from a work to editions, translations, archived copies | Does one work appear in many forms? | Related links and attachments |

### Later explorer possibilities

- Cited vs. not yet cited (what Wikipedia is missing; needs a pool tag and a section mapping).
- Timeline of publication years by type, cited vs. uncited, with the 2009 Nobel marked.
- Annotated article: Wikipedia text with each citation as a hover marker.
- Source mix: treemap of web citations by domain, shaded by link rot.
- Language and translation map.
- With more scholars: a scholar-by-scholar overlap matrix (Ostrom, Arendt, Sen, Habermas, Westin),
  and one IA footprint chart per scholar.

## Read-only

The site and the snapshot script never write to Zotero: GET requests to api.zotero.org only.
Changes to the data are made in Zotero itself.
