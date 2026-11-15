"""Who is changing what, so people can stay out of each other's way and avoid merge conflicts.

Three sources are put into one list of work items:
  - branches that are not merged yet: what each one changes, down to the column, measure, relationship and visual;
  - housekeeping issues someone has picked up (In progress);
  - claims: open "Working on" issues that name the tables or report pages someone is about to change.

Work that is only on someone's own machine cannot be seen until it is pushed; that is what claims are for.
`collect` returns what docs/data/work.json holds: the items, an entry per table and report page, and the overlaps.
"""
import glob
import json
import os
import re
import subprocess
from datetime import date, datetime, timedelta, timezone

from tmdl import ROOT, parse_text, settings, unquote

SHARED = "Shared files"
_TABLE = re.compile(r"\.SemanticModel/definition/tables/[^/]+\.tmdl$")
_VISUAL = re.compile(r"\.Report/definition/pages/([^/]+)/visuals/([^/]+)/visual\.json$")
_PAGE = re.compile(r"\.Report/definition/pages/([^/]+)/page\.json$")


def git(root, *args):
    """stdout of a git command, or None when it fails (no git, not a repository, unknown ref)."""
    try:
        out = subprocess.run(["git", "-C", root, *args], capture_output=True, check=True)
    except (OSError, subprocess.CalledProcessError):
        return None
    return out.stdout.decode("utf-8-sig", errors="replace")


# ---- what one file holds, as {(kind, area, object): signature}; two versions are then compared

def _sig(obj):
    return json.dumps([obj["description"], obj["expression"], obj["props"]], sort_keys=True)


def table_objects(text):
    out = {}
    for t in parse_text(text or ""):
        if t["type"] != "table":
            continue
        out[("table", t["name"], t["name"])] = _sig(t)
        for c in t["children"]:
            out[(c["type"], t["name"], c["name"])] = _sig(c)
    return out


def relationship_objects(text):
    out = {}
    for r in parse_text(text or ""):
        if r["type"] != "relationship" or "fromColumn" not in r["props"] or "toColumn" not in r["props"]:
            continue
        ft, _, fc = r["props"]["fromColumn"].rpartition(".")
        tt, _, tc = r["props"]["toColumn"].rpartition(".")
        props = {k: v for k, v in r["props"].items()}
        out[("relationship", unquote(ft), f"{unquote(ft)}[{unquote(fc)}] to {unquote(tt)}[{unquote(tc)}]")] = json.dumps(props, sort_keys=True)
    return out


def _compare(before, after):
    """[(kind, area, object, change)] between two {(kind, area, object): signature} maps."""
    out = []
    for key in sorted(set(before) | set(after), key=str):
        if before.get(key) != after.get(key):
            out.append((*key, "added" if key not in before else "removed" if key not in after else "changed"))
    # a table that is new or gone is one change, not one per column
    whole = {(a, c) for k, a, o, c in out if k == "table" and c != "changed"}
    return [x for x in out if x[0] == "table" or (x[1], x[3]) not in whole]


def _json(text):
    try:
        return json.loads(text) if text else {}
    except ValueError:
        return {}


def visual_label(text, fallback):
    """A visual's title, or its type and first field when it has no title."""
    v = _json(text).get("visual") or {}
    try:
        title = v["visualContainerObjects"]["title"][0]["properties"]["text"]["expr"]["Literal"]["Value"].strip("'")
    except (KeyError, IndexError, TypeError, AttributeError):
        title = ""
    if title:
        return title
    fields = [p.get("nativeQueryRef") for role in ((v.get("query") or {}).get("queryState") or {}).values()
              for p in role.get("projections", []) if p.get("nativeQueryRef")]
    kind = v.get("visualType") or "visual"
    return f"{kind}: {fields[0]}" if fields else f"{kind} ({fallback})"


def changes(root, base, ref):
    """[(kind, area kind, area, object, change)] for what `ref` changes since it left `base`. PBIP files only."""
    merge_base = (git(root, "merge-base", base, ref) or "").strip()
    listing = git(root, "diff", "--name-status", "--no-renames", f"{merge_base}..{ref}") if merge_base else None
    out = []

    def show(rev, path):
        return git(root, "show", f"{rev}:{path}")

    for line in (listing or "").splitlines():
        status, _, path = line.partition("\t")
        change = {"A": "added", "D": "removed"}.get(status[:1], "changed")
        if _TABLE.search(path):
            out += [(k, "table", a, o, c) for k, a, o, c in _compare(table_objects(show(merge_base, path)), table_objects(show(ref, path)))]
        elif path.endswith(".SemanticModel/definition/relationships.tmdl"):
            out += [(k, "table", a, o, c) for k, a, o, c in
                    _compare(relationship_objects(show(merge_base, path)), relationship_objects(show(ref, path)))]
        elif _VISUAL.search(path) or _PAGE.search(path):
            m = _VISUAL.search(path) or _PAGE.search(path)
            page_json = path[:m.start()] + f".Report/definition/pages/{m.group(1)}/page.json"
            page = _json(show(ref, page_json) or show(merge_base, page_json)).get("displayName") or m.group(1)
            if _VISUAL.search(path):
                out.append(("visual", "page", page, visual_label(show(ref, path) or show(merge_base, path), m.group(2)), change))
            else:
                out.append(("page", "page", page, page, change))
        elif ".SemanticModel/" in path or ".Report/" in path or path.endswith(".pbip"):
            if "/.pbi/" not in path and not path.endswith(".platform"):
                out.append(("file", "shared", SHARED, path.rsplit("/", 1)[-1], change))
    return out


def branches(root, base, prefix="refs/remotes/origin/"):
    """[{name, ref, author, date}] for branches under `prefix` that have commits `base` does not."""
    listing = git(root, "for-each-ref", "--format=%(refname)|%(authorname)|%(committerdate:short)", prefix) or ""
    out = []
    for line in listing.splitlines():
        ref, author, when = line.split("|")
        name = ref[len(prefix):]
        if name == "HEAD" or ref.endswith("/" + base.split("/")[-1]):
            continue
        if (git(root, "rev-list", "--count", f"{base}..{ref}") or "0").strip() not in ("", "0"):
            out.append({"name": name, "ref": ref, "author": author, "date": when})
    return out


# ---- the three sources as work items

def _item(kind, area_kind, area, obj, change, who, source, ref, url, since, **extra):
    return {"kind": kind, "areaKind": area_kind, "area": area, "object": obj, "change": change, "who": who or "",
            "source": source, "ref": ref, "url": url, "since": since, **extra}


def branch_items(root, base, issues, slug, stale_days, today, prefix="refs/remotes/origin/"):
    pulls = {p["branch"]: p for p in issues.get("pulls") or []}
    out = []
    for b in branches(root, base, prefix):
        pr = pulls.get(b["name"])
        url = pr["url"] if pr else f"https://github.com/{slug}/tree/{b['name']}" if slug else ""
        stale = b["date"] < (today - timedelta(days=stale_days)).isoformat()
        for kind, area_kind, area, obj, change in changes(root, base, b["ref"]):
            out.append(_item(kind, area_kind, area, obj, change, (pr or {}).get("author") or b["author"], "branch", b["name"], url,
                             b["date"], stale=stale, pr=(pr or {}).get("number")))
    return out


def _kind_of(model, table, obj):
    t = next((t for t in model["tables"] if t["name"] == table), None)
    if not t:
        return "item"
    if obj == table:
        return "table"
    if any(c["name"] == obj for c in t["columns"]):
        return "column"
    if any(m["name"] == obj for m in t["measures"]):
        return "measure"
    return "relationship" if " to " in obj else "item"


def issue_items(model, issues):
    """Housekeeping items someone has picked up, and claims in open Working on issues."""
    out = []
    for i in issues.get("issues") or []:
        if i.get("state") != "open":
            continue
        who = ", ".join(i.get("assignees") or []) or i.get("author", "")
        ref = f"#{i['number']}"
        if i.get("work") == "in-progress":
            for it in i.get("items") or []:
                if not it["done"]:
                    table = it["table"]
                    out.append(_item(_kind_of(model, table, it["object"]), "table" if table != "(model)" else "shared",
                                     table if table != "(model)" else SHARED, it["object"], "housekeeping", who, "housekeeping",
                                     ref, i["url"], i.get("created", ""), branches=i.get("branches") or []))
        for c in i.get("claims") or []:
            out.append(_item(c["kind"], c["kind"], c["name"], c["name"], "claimed", who, "claim", ref, i["url"], i.get("created", "")))
    return out


# ---- overlaps

def _same_owner(a, b):
    if a["source"] == b["source"] and a["ref"] == b["ref"]:
        return True
    if a["who"] and a["who"].lower() == b["who"].lower():
        return True
    # a housekeeping issue and the branch created from it are the same piece of work
    return any(x["source"] == "housekeeping" and y["source"] == "branch" and y["ref"] in x.get("branches", [])
               for x, y in ((a, b), (b, a)))


def overlaps(items):
    """[{area, areaKind, object, kind, reason, parties: [item, item, ...]}]: the same thing in more than one person's hands."""
    found = {}

    def add(key, reason, a, b):
        entry = found.setdefault(key, {"areaKind": key[0], "area": key[1], "kind": key[2], "object": key[3], "reason": reason, "parties": []})
        for x in (a, b):
            party = {k: x[k] for k in ("who", "source", "ref", "url", "change")}
            if party not in entry["parties"]:
                entry["parties"].append(party)

    for n, a in enumerate(items):
        for b in items[n + 1:]:
            if _same_owner(a, b) or (a["areaKind"], a["area"]) != (b["areaKind"], b["area"]):
                continue
            if "claim" in (a["source"], b["source"]):
                claim, other = (a, b) if a["source"] == "claim" else (b, a)
                add((other["areaKind"], other["area"], other["kind"], other["object"]),
                    f"{claim['area']} is claimed by {claim['who'] or claim['ref']}", claim, other)
            elif (a["kind"], a["object"]) == (b["kind"], b["object"]):
                reason = "Shared file changed in more than one place" if a["areaKind"] == "shared" else "Changed in more than one place"
                add((a["areaKind"], a["area"], a["kind"], a["object"]), reason, a, b)
    return list(found.values())


def report_pages(root):
    names = []
    for path in sorted(glob.glob(os.path.join(root, "*.Report", "definition", "pages", "*", "page.json"))):
        with open(path, encoding="utf-8") as f:
            names.append(_json(f.read()).get("displayName") or os.path.basename(os.path.dirname(path)))
    return names


def collect(model, issues, root=ROOT, base=None, today=None, prefix="refs/remotes/origin/"):
    """Everything docs/data/work.json holds."""
    today = today or date.today()
    base = base or "origin/" + os.environ.get("DOCS_BRANCH", "main")
    slug = model.get("repo")
    note = "" if git(root, "rev-parse", "--verify", "--quiet", base) else \
        f"Branches were not compared: {base} is not available in this checkout."
    stale_days = int(settings(root).get("stale_branch_days", 30))
    items = ([] if note else branch_items(root, base, issues, slug, stale_days, today, prefix)) + issue_items(model, issues)
    areas = [{"kind": "table", "name": t["name"]} for t in model["tables"]] + [{"kind": "page", "name": p} for p in report_pages(root)]
    known = {(a["kind"], a["name"]) for a in areas}
    areas += [{"kind": k, "name": n} for k, n in sorted({(i["areaKind"], i["area"]) for i in items} - known)]   # new or shared
    for a in areas:
        mine = [i for i in items if (i["areaKind"], i["area"]) == (a["kind"], a["name"])]
        a["items"] = len(mine)
        a["workers"] = []
        for i in mine:
            w = {k: i[k] for k in ("who", "source", "ref", "url")}
            if w not in a["workers"]:
                a["workers"].append(w)
    return {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "repo": slug, "note": note,
            "staleDays": stale_days, "items": items, "areas": areas, "overlaps": overlaps(items),
            "branches": sorted({i["ref"] for i in items if i["source"] == "branch"}),
            "people": sorted({i["who"] for i in items if i["who"]}, key=str.lower)}
