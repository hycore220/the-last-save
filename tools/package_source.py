"""Build the downloadable source without local credentials or repository metadata."""
from pathlib import Path
import hashlib
import zipfile

root = Path(__file__).resolve().parents[1]
output = root / "dist" / "last-save-source.zip"
files = [root / name for name in ("README.md", "LICENSE", "package.json", ".gitignore")]
for folder in ("dist", "tools", "tests", "reports", "docs"):
    files.extend(p for p in (root / folder).rglob("*")
                 if p.is_file() and not p.is_symlink() and p != output
                 and "__pycache__" not in p.parts and p.suffix != ".pyc")
with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(files):
        archive.write(path, Path("last-save") / path.relative_to(root))
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    assert all(".git/" not in n and ".openai/" not in n and ".env" not in n for n in archive.namelist())
    for name in ("dist/hints.js", "dist/index.html", "README.md", "reports/browser-inference.json"):
        assert archive.read("last-save/" + name) == (root / name).read_bytes()
print(f"Source ZIP verified: {len(files)} files, {output.stat().st_size} bytes, sha256={hashlib.sha256(output.read_bytes()).hexdigest()}")
