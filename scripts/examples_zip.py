"""Packs the quickstart with the built files it loads: release/<name>-examples.zip."""
import json, os, zipfile

version = json.load(open("package.json", encoding="utf-8"))["version"]
root = "openbeam-player-sdk/"
with zipfile.ZipFile(f"release/openbeam-player-sdk-{version}-examples.zip", "w", zipfile.ZIP_DEFLATED) as archive:
    for top in ("examples", "dist"):
        for folder, _, files in os.walk(top):
            for name in sorted(files):
                path = os.path.join(folder, name)
                archive.write(path, root + path.replace(os.sep, "/"))
    for name in ("README.md", "LICENSE", "package.json"):
        archive.write(name, root + name)
    print(len(archive.namelist()), "files")
