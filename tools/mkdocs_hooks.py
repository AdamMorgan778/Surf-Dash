"""MkDocs hook: a version stamp on every link to the site's own scripts and styles.

The site's scripts and styles keep the same addresses from one build to the next, so a browser can go on using a copy it
saved earlier and show an old version of a page after an update. This adds ?v=<short hash of the file> to each link under
assets/, so the address changes exactly when the file does. Registered under `hooks:` in mkdocs.yml.
"""
import hashlib
import os
import re

_LINK = re.compile(r'((?:src|href)=")([^"?#]*assets/[^"?#]+\.(?:js|css))(")')


def stamp(html, docs_dir):
    """Add ?v=<hash> to every assets/*.js and assets/*.css link in `html` whose file is in `docs_dir`."""
    def add(m):
        path = os.path.join(docs_dir, "assets", m.group(2).split("assets/", 1)[1])
        if not os.path.isfile(path):
            return m.group(0)   # the theme's own files, which already carry a version
        with open(path, "rb") as f:
            digest = hashlib.sha1(f.read()).hexdigest()[:10]
        return f"{m.group(1)}{m.group(2)}?v={digest}{m.group(3)}"
    return _LINK.sub(add, html)


def on_post_page(output, page, config, **kwargs):
    return stamp(output, config["docs_dir"])
