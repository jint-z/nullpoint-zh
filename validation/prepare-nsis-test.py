from pathlib import Path
import shutil

root = Path(__file__).resolve().parent.parent
base = root / "validation/.upgrade-guard-test/nsis-sandbox"
resources = base / "resources"
resources.mkdir(parents=True, exist_ok=True)
source = root / "apps/desktop/build"
for name in ["icon.ico", "installerHeader.bmp", "installerSidebar.bmp", "uninstallerSidebar.bmp",
             "upgrade-installer.nsh", "upgrade-manifests.json"]:
    shutil.copy2(source / name, resources / name)
include = resources / "upgrade-installer.nsh"
safe_initial_directory = str(base / "work/initial-installer-dir")
include.write_text('InstallDir "' + safe_initial_directory + '"\n' + include.read_text(encoding="utf-8-sig"), encoding="utf-8")
guid = "2b6d87f8-8e89-42c0-8ed1-a62f0123eaf1"
core = (source / "upgrade-core.ps1").read_text(encoding="utf-8-sig")
core = core.replace("4bba9de6-1625-56f4-9a08-fd7fccc27356", guid)
(resources / "upgrade-core.ps1").write_text(core, encoding="utf-8-sig")
guard = (source / "upgrade-guard.ps1").read_text(encoding="utf-8-sig")
test_profile = str(base / "work/profile").replace("'", "''")
test_backups = str(base / "work/backups").replace("'", "''")
guard = guard.replace("Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Nullpoint-zh'", "'" + test_profile + "'")
guard = guard.replace("Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Nullpoint-zh-upgrade-backups'", "'" + test_backups + "'")
if "GetFolderPath('ApplicationData')" in guard or "Nullpoint-zh-upgrade-backups" in guard:
    raise RuntimeError("Isolation substitution failed")
(resources / "upgrade-guard.ps1").write_text(guard, encoding="utf-8-sig")
print("Prepared isolated test resources", resources, "GUID", guid)
