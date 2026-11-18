"""Assemble public/index.html from src/head.html, src/app.js and src/assistant.js.

Usage: python scripts/build_site.py
"""
from pathlib import Path

root = Path(__file__).resolve().parent.parent
head = (root / 'src' / 'head.html').read_text(encoding='utf-8')
app = '\n'.join((root / 'src' / f).read_text(encoding='utf-8') for f in ('app.js', 'runner.js', 'assistant.js'))
out = root / 'public' / 'index.html'
out.write_text(head + '<script>\n' + app + '</script>\n</body>\n</html>\n', encoding='utf-8')
print(f'wrote {out.relative_to(root)} ({out.stat().st_size:,} bytes)')
