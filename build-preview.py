"""Build a visual preview with the same ESM graph as the served application."""
import base64
import json
import re
from pathlib import Path

root = Path(__file__).parent
dist = root / 'dist'
html = (dist / 'index.html').read_text()
css = (dist / 'styles.css').read_text()
imports = {}

# Import maps preserve real module boundaries instead of stripping import/export
# statements. This preview remains separate from the HTTP-served live-call app.
for module in ['config', 'report', 'sandbox', 'app', 'bootstrap']:
    source = (dist / f'{module}.js').read_text()
    source = re.sub(r"from '\./([a-z-]+)\.js'", r"from 'repro/\1'", source)
    encoded = base64.b64encode(source.encode()).decode()
    imports[f'repro/{module}'] = f'data:text/javascript;base64,{encoded}'

html, css_count = re.subn(
    r'<link rel="stylesheet" href="styles\.css"\s*/?>',
    lambda _: f'<style>{css}</style>',
    html,
)
html, script_count = re.subn(
    r'<script type="module" src="bootstrap\.js"></script>',
    lambda _: '<script type="importmap">' + json.dumps({'imports': imports})
    + '</script>\n<script type="module">import "repro/bootstrap";</script>',
    html,
)
if css_count != 1 or script_count != 1:
    raise SystemExit('Preview entry points changed; update the builder before exporting.')

(root / 'repro-preview.html').write_text(html)
print('Wrote repro-preview.html')
