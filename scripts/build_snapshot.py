"""Build the dated data snapshot that the Explore Elinor website reads.

Explore Elinor is a static site (in docs/, served by GitHub Pages). It never talks to Zotero
itself: this script reads the public "Wiki ReCite" Zotero group once, boils the collection down
to what the pages need, and writes docs/data/snapshot.json. Re-run it to refresh the "as of" date.

    python3 scripts/build_snapshot.py

Read-only by design: GET requests only, https only, api.zotero.org only. The group is public, so
no key is needed; if secrets/zotero_readonly_key exists it is sent anyway (higher rate limits).
Never put a full-access key there.

Inputs besides Zotero: data/refs/<article>.tsv, the numbered reference list of an article
(columns n, title, doi_or_id), used to lay out the preservation map in article order.
"""
import csv
import datetime
import json
import os
import re
import sys
import urllib.parse
import urllib.request

GROUP = "6513130"
GROUP_SLUG = "wiki_recite"
COLLECTION = "2NDJ8JJA"
API = f"https://api.zotero.org/groups/{GROUP}"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "docs", "data", "snapshot.json")

# The ways into the collection. Each Wikipedia article is a Zotero tag on the items it cites;
# "beyond" is the archive pass that found Ostrom works no article cites. The site links each
# article to its exact revision (wikiTitle + revision). revisionNote says how we know it:
# Ostrom's revision is recorded in the review notes; Arendt's, Westin's and Sen's are not, so
# we use the revision that was live on the tag date (their latest edits before the tag date,
# checked on 2026-11-23 with the Wikipedia API).
#
# archiveChecked: True once the way's records have been through an archive pass (someone looked
# for Wayback / archive.org copies). Records with no copy then read "No copy found"; in ways
# not yet checked they read "Not checked yet", so the site never claims a copy is missing when
# nobody has looked.
WAYS = [
    {"id": "ostrom", "kind": "article", "name": "Elinor Ostrom", "tag": "Wiki-Ostrom-20261112",
     "archiveChecked": True,
     "wikiTitle": "Elinor_Ostrom", "revision": "1384692204", "revisionDate": "2026-11-09",
     "revisionNote": "the revision reviewed", "refs": "ostrom.tsv"},
    {"id": "arendt", "kind": "article", "name": "Hannah Arendt", "tag": "Wiki-Arendt-20261123",
     "wikiTitle": "Hannah_Arendt", "revision": "1386106467", "revisionDate": "2026-11-16",
     "revisionNote": "the revision live when the citations were collected (2026-11-23)"},
    {"id": "westin", "kind": "article", "name": "Alan F. Westin", "tag": "Wiki-Westin-20261123",
     "wikiTitle": "Alan_F._Westin", "revision": "1368886387", "revisionDate": "2026-08-11",
     "revisionNote": "the revision live when the citations were collected (2026-11-23)"},
    {"id": "sen", "kind": "article", "name": "Amartya Sen", "tag": "Wiki-Sen-20261123",
     "wikiTitle": "Amartya_Sen", "revision": "1384153814", "revisionDate": "2026-11-06",
     "revisionNote": "the revision live when the citations were collected (2026-11-23)"},
    {"id": "beyond", "kind": "beyond", "name": "Beyond Wikipedia", "tag": "ArchivePass-20261113"},
]

# Zotero tags shown as flags on cards and work pages. Tag a record "Unprocessed" in Zotero to
# mark it as not yet cleaned up (for example, a TV interview typed as a book).
FLAG_TAGS = {"Unprocessed": "Unprocessed", "ISSUE": "Open issue", "TO ADD": "To add"}

LANGUAGES = {"en": "English", "eng": "English", "es": "Spanish", "spa": "Spanish",
             "zh": "Chinese", "chi": "Chinese", "fr": "French", "fre": "French",
             "de": "German", "ger": "German"}


def read_key():
    """Return the optional read-only key from secrets/zotero_readonly_key, or "" if absent."""
    path = os.path.join(REPO, "secrets", "zotero_readonly_key")
    if not os.path.exists(path):
        return ""
    with open(path) as f:
        return f.read().strip()


def check_url(url):
    """Exit unless url is https://api.zotero.org/... (the only place this script may talk to)."""
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != "https" or parts.hostname != "api.zotero.org":
        sys.exit(f"refused: {url}")


class ZoteroOnlyRedirects(urllib.request.HTTPRedirectHandler):
    """Follow a redirect only if it stays on https://api.zotero.org.

    urllib's default handler copies request headers, including Zotero-API-Key, to wherever a
    redirect points, even another site. Checking each target keeps the key from leaving Zotero.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        """Check the redirect target, then follow it as usual. Exits via check_url() if not allowed."""
        check_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


OPENER = urllib.request.build_opener(ZoteroOnlyRedirects)


def get_all(path, key):
    """GET every page of a Zotero list endpoint under the group.

    Args:
        path: endpoint path, e.g. "/items".
        key: optional API key ("" for none).
    Returns:
        (items, library_version): all JSON objects, and the library version header.
    Raises:
        SystemExit: if a URL, or a redirect, would leave https://api.zotero.org.
    """
    results, start, version = [], 0, None
    while True:
        url = f"{API}{path}?" + urllib.parse.urlencode({"limit": 100, "start": start})
        check_url(url)
        headers = {"Zotero-API-Version": "3", "User-Agent": "explore-elinor-snapshot/1.0"}
        if key:
            headers["Zotero-API-Key"] = key
        req = urllib.request.Request(url, method="GET", headers=headers)
        with OPENER.open(req, timeout=60) as resp:
            page = json.loads(resp.read())
            total = int(resp.headers.get("Total-Results", len(page)))
            version = resp.headers.get("Last-Modified-Version", version)
        results.extend(page)
        start += len(page)
        if not page or start >= total:
            return results, version


def year_of(date):
    """Return the first plausible four-digit year in a Zotero date string, or None."""
    m = re.search(r"\b(1[5-9]\d\d|20\d\d)\b", date or "")
    return int(m.group(1)) if m else None


def creators_of(data):
    """Return a short author line: up to three last names, then "et al."."""
    names = [c.get("lastName") or c.get("name") or "" for c in data.get("creators", [])]
    names = [n for n in names if n]
    return ", ".join(names[:3]) + (" et al." if len(names) > 3 else "")


def classify_link(url):
    """Sort an attachment URL into the kinds the site shows.

    Returns:
        "wayback", "archive" (an archive.org item), "openlibrary", "wikidata", "openalex",
        or "other".
    """
    host = urllib.parse.urlsplit(url).hostname or ""
    if host == "web.archive.org":
        return "wayback"
    if host == "archive.org" or host.endswith(".archive.org") and host != "scholar.archive.org":
        return "archive"
    if host.endswith("openlibrary.org"):
        return "openlibrary"
    if host.endswith("wikidata.org"):
        return "wikidata"
    if host.endswith("openalex.org"):
        return "openalex"
    return "other"


def ref_numbers(text):
    """Find Wikipedia ref numbers in attachment titles and notes.

    Matches phrases like "(ref 11)", "refs 11 and 16" or "refs 2, 3 and 7".
    Returns:
        A set of ints.
    """
    found = set()
    for m in re.finditer(r"\brefs? (\d+(?:(?:,\s*|\s+and\s+|,\s+and\s+)\d+)*)", text):
        found.update(int(n) for n in re.findall(r"\d+", m.group(1)))
    return found


def accessed_dates(titles):
    """Read Wikipedia access-dates from Wayback attachment titles.

    Titles look like "Wayback Machine snapshot (2025-10-19); Wikipedia accessed 2012-08-30
    (ref 11), 2018-03-03 (ref 16)". A date with no ref applies to every ref of the item.

    Args:
        titles: attachment titles of one item.
    Returns:
        A list of {"date": "YYYY-MM-DD", "refs": [ints]}.
    """
    out = []
    for title in titles:
        _, sep, rest = title.partition("Wikipedia accessed")
        if not sep:
            continue
        for m in re.finditer(r"(\d{4}-\d{2}-\d{2})(?:\s*\(refs? ([^)]*)\))?", rest):
            out.append({"date": m.group(1), "refs": [int(n) for n in re.findall(r"\d+", m.group(2) or "")]})
    return out


def norm(s):
    """Lowercase a title and keep only letters and digits, for loose matching."""
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def strip_html(s):
    """Remove HTML tags from a Zotero note."""
    return re.sub(r"<[^>]+>", " ", s or "")


def build(raw, version):
    """Turn raw Zotero items into the snapshot structure.

    Args:
        raw: list of Zotero API item objects for the whole group.
        version: the library version the items were read at.
    Returns:
        The snapshot dict (see docs/assets/app.js for how each field is used).
    """
    data = [r["data"] for r in raw]
    kids = {}
    for d in data:
        if d.get("parentItem"):
            kids.setdefault(d["parentItem"], []).append(d)
    top = [d for d in data if COLLECTION in d.get("collections", []) and not d.get("parentItem")
           and d["itemType"] not in ("attachment", "note")]
    tag_to_way = {w["tag"]: w["id"] for w in WAYS}
    checked_ways = {w["id"] for w in WAYS if w.get("archiveChecked")}

    items = []
    for d in top:
        tags = [t["tag"] for t in d.get("tags", [])]
        children = kids.get(d["key"], [])
        copies, links, text = [], [], []
        for k in children:
            text.append((k.get("title") or "") + " " + strip_html(k.get("note")))
            url = k.get("url") or ""
            if k["itemType"] != "attachment" or not url.startswith("https://") and not url.startswith("http://"):
                continue
            kind = classify_link(url)
            entry = {"kind": kind, "url": url, "title": k.get("title") or ""}
            (copies if kind in ("wayback", "archive") else links).append(entry)
        rel = d.get("relations", {}).get("dc:relation") or []
        rel = [rel] if isinstance(rel, str) else rel
        lang = (d.get("language") or "").strip()
        ways = [tag_to_way[t] for t in tags if t in tag_to_way]
        items.append({
            "key": d["key"],
            "type": d["itemType"],
            "title": d.get("title") or "(untitled)",
            "creators": creators_of(d),
            "year": year_of(d.get("date")),
            "date": d.get("date") or "",
            "language": LANGUAGES.get(lang.lower(), lang) if lang else "",
            "source": d.get("publicationTitle") or d.get("websiteTitle") or d.get("publisher") or "",
            "url": d.get("url") or "",
            "doi": d.get("DOI") or "",
            "isbn": d.get("ISBN") or "",
            "ways": ways,
            # Looked for an Archive copy: in a checked way, or a copy is already attached.
            "archiveChecked": bool(checked_ways.intersection(ways)) or bool(copies),
            "flags": [FLAG_TAGS[t] for t in tags if t in FLAG_TAGS],
            "copies": copies,
            "links": links,
            "related": [u.rstrip("/").split("/")[-1] for u in rel],
            "refs": sorted(ref_numbers(" ".join(text))),
            "accessed": accessed_dates([k.get("title") or "" for k in children]),
        })

    by_key = {i["key"]: i for i in items}
    ways = []
    for w in WAYS:
        way = {k: v for k, v in w.items() if k not in ("tag", "refs")}
        way["count"] = sum(w["id"] in i["ways"] for i in items)
        if w.get("refs"):
            way["refs"] = match_refs(os.path.join(REPO, "data", "refs", w["refs"]),
                                     [i for i in items if w["id"] in i["ways"]], by_key)
        ways.append(way)

    return {
        "asOf": datetime.date.today().isoformat(),
        "libraryVersion": version,
        "group": {"id": GROUP, "name": "Wiki ReCite",
                  "url": f"https://www.zotero.org/groups/{GROUP}/{GROUP_SLUG}"},
        "collection": {"key": COLLECTION, "name": "Elinor - under construction"},
        "ways": ways,
        # Sort by title, case-insensitive, ignoring leading punctuation. Not norm(): it drops
        # non-Latin letters, which sorted titles like "প্রিয়.কম" to the top as if blank.
        "items": sorted(items, key=lambda i: re.sub(r"^[\W_]+", "", i["title"].casefold())),
    }


def match_refs(path, candidates, by_key):
    """Match an article's numbered references to Zotero items.

    In order: by a ref number found in an item's attachment titles or notes, by DOI, then by
    exact (normalized) title. Title matching is guarded because titles repeat: several refs are
    titled just "Elinor Ostrom" (different sources), and refs 2 and 3 share a title but are a
    Nature and a Science piece. So a title match is skipped when the item already carries
    other ref numbers, or when the ref's DOI and the item's DOI disagree. This is a first
    pass: unmatched refs are kept with item None.

    Args:
        path: TSV with columns n, title, doi_or_id.
        candidates: items tagged with this article.
        by_key: all items by key (unused today, kept for later cross-article matching).
    Returns:
        A list of {"n", "title", "item"} in article order.
    """
    with open(path) as f:
        rows = [(int(r["n"]), r["title"], (r.get("doi_or_id") or "").strip().lower())
                for r in csv.DictReader(f, delimiter="\t")]
    by_ref, by_doi, by_title = {}, {}, {}
    for i in candidates:
        for n in i["refs"]:
            by_ref.setdefault(n, i)
        if i["doi"]:
            by_doi.setdefault(i["doi"].strip().lower(), i)
        if not i["refs"]:
            by_title.setdefault(norm(i["title"]), i)
    out = []
    for n, title, doi in rows:
        item = by_ref.get(n) or (by_doi.get(doi) if doi else None)
        if not item:
            guess = by_title.get(norm(title))
            # A DOI on both sides that disagrees means a different work with the same title.
            if guess and not (doi.startswith("10.") and guess["doi"] and guess["doi"].strip().lower() != doi):
                item = guess
        out.append({"n": n, "title": title, "item": item["key"] if item else None})
    return out


def main():
    """Fetch the group, build the snapshot and write docs/data/snapshot.json."""
    raw, version = get_all("/items", read_key())
    snap = build(raw, version)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(snap, f, ensure_ascii=False, separators=(",", ":"))
    matched = [r for w in snap["ways"] for r in w.get("refs", []) if r["item"]]
    print(f"{len(snap['items'])} items, ways: " +
          ", ".join(f"{w['id']} {w['count']}" for w in snap["ways"]) +
          f"; refs matched: {len(matched)}; written to {os.path.relpath(OUT, REPO)}")


if __name__ == "__main__":
    main()
