#!/usr/bin/env python3
"""Render a unified git diff (stdin) to a self-contained, navigable HTML page."""
import sys, html, re

lines = sys.stdin.read().split("\n")
files = []           # (path, status, [rendered rows], adds, dels)
cur = None

def newfile(path):
    return {"path": path, "rows": [], "add": 0, "del": 0, "status": "modified"}

for ln in lines:
    if ln.startswith("diff --git"):
        if cur: files.append(cur)
        m = re.match(r"diff --git a/(.*?) b/(.*)$", ln)
        path = m.group(2) if m else ln
        cur = newfile(path)
        continue
    if cur is None:
        continue
    if ln.startswith("new file"):   cur["status"] = "added"
    elif ln.startswith("deleted"):  cur["status"] = "removed"
    elif ln.startswith("rename"):   cur["status"] = "renamed"
    if ln.startswith(("index ", "--- ", "+++ ", "new file", "deleted file", "old mode", "new mode", "similarity", "rename ")):
        continue
    esc = html.escape(ln)
    if ln.startswith("@@"):
        cur["rows"].append(f'<div class="hunk">{esc}</div>')
    elif ln.startswith("+"):
        cur["add"] += 1
        cur["rows"].append(f'<div class="add">{esc}</div>')
    elif ln.startswith("-"):
        cur["del"] += 1
        cur["rows"].append(f'<div class="del">{esc}</div>')
    else:
        cur["rows"].append(f'<div class="ctx">{esc}</div>')
if cur: files.append(cur)

tot_a = sum(f["add"] for f in files)
tot_d = sum(f["del"] for f in files)
color = {"added": "#3fb950", "removed": "#f85149", "renamed": "#d29922", "modified": "#58a6ff"}

out = []
out.append(f"""<!doctype html><html><head><meta charset=utf-8>
<title>themelab — main..HEAD</title><style>
:root{{color-scheme:dark}}
body{{background:#0d1117;color:#c9d1d9;font:13px/1.5 'Google Sans Code',ui-monospace,SFMono-Regular,Menlo,monospace;margin:0}}
header{{position:sticky;top:0;background:#161b22;border-bottom:1px solid #30363d;padding:14px 20px;z-index:5}}
header h1{{margin:0 0 4px;font-size:15px}}
.meta{{color:#8b949e;font-size:12px}}
.wrap{{display:grid;grid-template-columns:300px 1fr;gap:0;align-items:start}}
nav{{position:sticky;top:64px;max-height:calc(100vh - 64px);overflow:auto;padding:12px;border-right:1px solid #30363d;font-size:12px}}
nav a{{display:flex;justify-content:space-between;gap:8px;color:#c9d1d9;text-decoration:none;padding:3px 6px;border-radius:5px;white-space:nowrap}}
nav a:hover{{background:#21262d}}
nav .p{{overflow:hidden;text-overflow:ellipsis;direction:rtl;text-align:left}}
nav .n{{color:#8b949e;flex:none}}
main{{padding:0 20px 60px;min-width:0}}
.file{{margin:22px 0;border:1px solid #30363d;border-radius:8px;overflow:hidden}}
.fh{{position:sticky;top:64px;background:#161b22;padding:8px 12px;border-bottom:1px solid #30363d;display:flex;justify-content:space-between;gap:10px;z-index:2}}
.fh .name{{font-weight:600;word-break:break-all}}
.badge{{font-size:11px;padding:1px 7px;border-radius:10px;border:1px solid;flex:none}}
.counts{{color:#8b949e;font-size:11px;flex:none}}
.code{{overflow:auto}}
.code div{{padding:0 12px;white-space:pre}}
.add{{background:#12261e;color:#aff5b4}}
.del{{background:#25171c;color:#ffdcd7}}
.hunk{{background:#161b22;color:#8b949e}}
.ctx{{color:#8b949e}}
</style></head><body>
<header><h1>themelab &nbsp;<span class=meta>git diff main..HEAD</span></h1>
<div class=meta>{len(files)} files · <span style="color:#3fb950">+{tot_a}</span> / <span style="color:#f85149">−{tot_d}</span> · generated bundle, lockfile & dist excluded</div></header>
<div class=wrap><nav>""")

for i, f in enumerate(files):
    out.append(f'<a href="#f{i}"><span class=p>{html.escape(f["path"])}</span>'
               f'<span class=n style="color:{color[f["status"]]}">+{f["add"]}/−{f["del"]}</span></a>')
out.append("</nav><main>")

for i, f in enumerate(files):
    c = color[f["status"]]
    out.append(f'<div class=file id=f{i}><div class=fh>'
               f'<span class=name>{html.escape(f["path"])}</span>'
               f'<span><span class=badge style="color:{c};border-color:{c}">{f["status"]}</span> '
               f'<span class=counts><span style="color:#3fb950">+{f["add"]}</span> '
               f'<span style="color:#f85149">−{f["del"]}</span></span></span></div>'
               f'<div class=code>{"".join(f["rows"])}</div></div>')

out.append("</main></div></body></html>")
sys.stdout.write("\n".join(out))
