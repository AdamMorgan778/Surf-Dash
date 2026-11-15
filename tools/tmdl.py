"""Small TMDL reader plus shared helpers. Reads only what the docs need; it is not a full TMDL parser."""
import os
import re
import subprocess

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")

_OBJ = re.compile(r"^(table|column|measure|partition|relationship|expression)\s+('(?:[^']|'')+'|[^=\s]+)\s*(?:=\s*(.*))?$")
_PROP = re.compile(r"^([A-Za-z_]+)(?::\s*(.*)|\s*=\s*(.*))?$")


def unquote(name):
    name = name.strip()
    if name.startswith("'") and name.endswith("'"):
        return name[1:-1].replace("''", "'")
    return name


def settings(root=ROOT):
    """The project's settings.yml as a dict; empty when the file is missing. Every key is optional."""
    path = os.path.join(root, "settings.yml")
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def repo_slug():
    """owner/repo from GITHUB_REPOSITORY or the origin remote; None when neither is set."""
    slug = os.environ.get("GITHUB_REPOSITORY")
    if slug:
        return slug
    try:
        url = subprocess.run(["git", "-C", ROOT, "remote", "get-url", "origin"], capture_output=True,
                             text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None
    m = re.search(r"github\.com[:/]([^/]+/[^/]+?)(?:\.git)?/?$", url)
    return m.group(1) if m else None


def blob_link(path, line=None, slug=None):
    slug = slug or repo_slug()
    if not slug:
        return ""
    branch = os.environ.get("DOCS_BRANCH", "main")
    return f"https://github.com/{slug}/blob/{branch}/{path}" + (f"#L{line}" if line else "")


def parse_file(path):
    """Return the top-level objects in a TMDL file.

    Each object: {type, name, line, description, expression, props, children}. Bare flags such as
    `isHidden` are stored as True. Lines indented deeper than an object's properties are treated as
    continuation of the last expression (multi-line DAX or M).
    """
    with open(path, encoding="utf-8-sig") as f:
        lines = f.read().split("\n")
    objects, stack, pending, expr_target = [], [], [], None
    for no, raw in enumerate(lines, 1):
        if not raw.strip():
            continue
        indent = len(raw) - len(raw.lstrip("\t"))
        text = raw.strip()
        if text.startswith("///"):
            pending.append(text[3:].strip())
            continue
        while stack and stack[-1][0] >= indent:
            stack.pop()
        # continuation of a multi-line expression: deeper than the properties of the open object
        if expr_target is not None and stack and indent > stack[-1][0] + 1:
            key, obj = expr_target
            if key == "expression":
                obj["expression"] = (obj["expression"] + "\n" + text).strip()
            else:
                obj["props"][key] = (str(obj["props"].get(key) or "") + "\n" + text).strip()
            continue
        m = _OBJ.match(text)
        if m and (indent == 0 or (stack and indent == stack[-1][0] + 1)):
            obj = {"type": m.group(1), "name": unquote(m.group(2)), "line": no,
                   "description": " ".join(pending), "expression": (m.group(3) or "").strip(),
                   "props": {}, "children": []}
            pending = []
            (stack[-1][1]["children"] if stack else objects).append(obj)
            stack.append((indent, obj))
            expr_target = ("expression", obj) if m.group(3) is not None else None
            continue
        pending = []
        if not stack or text.startswith(("annotation ", "ref ")):
            expr_target = None
            continue
        p = _PROP.match(text)
        if p:
            obj = stack[-1][1]
            key = p.group(1)
            if p.group(3) is not None:  # `key = value`, possibly continued on the next lines
                obj["props"][key] = p.group(3).strip()
                expr_target = (key, obj)
            else:
                obj["props"][key] = True if p.group(2) is None else p.group(2).strip()
                expr_target = None
    return objects
