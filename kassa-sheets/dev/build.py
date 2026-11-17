"""Builds Index.html (the file pasted into Apps Script) from Index.src.html with the logo inlined."""
import base64, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
logo = "data:image/png;base64," + base64.b64encode((root / "dev" / "logo.png").read_bytes()).decode()
src = (root / "Index.src.html").read_text(encoding="utf-8")
(root / "Index.html").write_text(src.replace("__LOGO__", logo), encoding="utf-8")
print("Index.html", len(src.replace("__LOGO__", logo)), "bytes")
