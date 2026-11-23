"""Renders docs/embed-the-player.md to the HTML Ghost imports (tables as HTML cards)."""
import html, re, sys

def inline(text):
    parts = re.split(r"(`[^`]+`)", text)
    out = []
    for part in parts:
        if part.startswith("`") and part.endswith("`") and len(part) > 1:
            out.append("<code>" + html.escape(part[1:-1], quote=False) + "</code>")
            continue
        part = html.escape(part, quote=False)
        part = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', part)
        part = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", part)
        out.append(part)
    return "".join(out)

def cells(line):
    return [c.strip() for c in line.strip().strip("|").split("|")]

lines = re.sub(r"<!--.*?-->\s*", "", open("docs/embed-the-player.md", encoding="utf-8").read(), count=1, flags=re.S).split("\n")
out, i = [], 0
while i < len(lines):
    line = lines[i]
    if not line.strip():
        i += 1
    elif line.startswith("```"):
        lang = line[3:].strip()
        j = i + 1
        while not lines[j].startswith("```"): j += 1
        code = html.escape("\n".join(lines[i + 1:j]), quote=False)
        out.append(f'<pre><code{" class=\"language-" + lang + "\"" if lang else ""}>{code}</code></pre>')
        i = j + 1
    elif line.startswith("## "):
        out.append(f"<h2>{inline(line[3:])}</h2>"); i += 1
    elif line.startswith("|"):
        j = i
        while j < len(lines) and lines[j].startswith("|"): j += 1
        head, rows = cells(lines[i]), [cells(r) for r in lines[i + 2:j]]
        table = "<table>\n<thead><tr>" + "".join(f"<th>{inline(c)}</th>" for c in head) + "</tr></thead>\n<tbody>\n"
        table += "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>\n" for r in rows) + "</tbody>\n</table>"
        out.append("<!--kg-card-begin: html-->\n" + table + "\n<!--kg-card-end: html-->")
        i = j
    elif re.match(r"(\d+\.|-) ", line):
        ordered = line[0].isdigit()
        items = []
        while i < len(lines) and re.match(r"(\d+\.|-) ", lines[i]):
            items.append(re.sub(r"^(\d+\.|-) ", "", lines[i])); i += 1
        tag = "ol" if ordered else "ul"
        out.append(f"<{tag}>" + "".join(f"<li>{inline(x)}</li>" for x in items) + f"</{tag}>")
    else:
        out.append(f"<p>{inline(line)}</p>"); i += 1
result = "\n".join(out)
open("docs/embed-the-player.html", "w", encoding="utf-8", newline="\n").write(result)
print(len(result))
