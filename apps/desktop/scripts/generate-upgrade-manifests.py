import json
import pathlib
import subprocess

root = pathlib.Path(__file__).resolve().parents[3]
tool = root / "node_modules/.pnpm/7zip-bin@5.2.0/node_modules/7zip-bin/win/x64/7za.exe"
delivery = root.parent
archives = {
    "1.2.0": root / "apps/desktop/release/Nullpoint-zh-Setup-1.2.0-x64.exe",
    "1.2.1": delivery / "local-1.2.1/Nullpoint-zh-Setup-1.2.1-x64.exe",
    "1.2.2": delivery / "local-1.2.2/Nullpoint-zh-Setup-1.2.2-x64.exe",
    "1.2.4": delivery / "local-1.2.4/Nullpoint-zh-Setup-1.2.4-x64.exe",
    "1.2.5": delivery / "local-1.2.5/Nullpoint-zh-Setup-1.2.5-x64.exe",
}

def read_paths(archive):
    result = subprocess.run([str(tool), "l", "-slt", str(archive)], capture_output=True, text=True,
                            encoding="utf-8", errors="strict", check=True)
    body = result.stdout.split("----------", 1)[1]
    paths = set()
    for block in body.strip().split("\n\n"):
        for line in block.splitlines():
            if line.startswith("Path = "):
                paths.add(line[7:].replace("/", "\\"))
    paths.update(["Uninstall Nullpoint-zh.exe", "uninstallerIcon.ico"])
    return sorted(paths, key=str.lower)

versions = {version: read_paths(path) for version, path in archives.items()}
previous_123 = set()
for previous in [
    delivery / "local-1.2.3/Nullpoint-zh-Setup-1.2.3-x64.exe",
    delivery / "local-1.2.3-renamed/Nullpoint-zh-Setup-1.2.3-x64.exe",
    delivery / "local-1.2.3-no-mark/Nullpoint-zh-Setup-1.2.3-x64.exe",
]:
    previous_123.update(read_paths(previous))
versions["1.2.3"] = sorted(previous_123, key=str.lower)
current = {p for p in versions["1.2.2"] if p.lower() != "resources\\renderer" and not p.lower().startswith("resources\\renderer\\")}
web_dist = root / "apps/web/dist"
if not web_dist.exists():
    raise SystemExit("Build apps/web before generating the current manifest")
current.add("resources\\renderer")
for path in web_dist.rglob("*"):
    rel = path.relative_to(web_dist)
    if len(rel.parts) == 1 and rel.name.startswith("mock-") and rel.suffix == ".html":
        continue
    current.add("resources\\renderer\\" + str(rel).replace("/", "\\"))
versions["1.2.6"] = sorted(current, key=str.lower)
out = root / "apps/desktop/build/upgrade-manifests.json"
out.write_text(json.dumps({"schema": 1, "versions": versions}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Wrote", out, {version: len(paths) for version, paths in versions.items()})
