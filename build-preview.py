from pathlib import Path

root = Path(__file__).parent
dist = root / 'dist'
html = (dist / 'index.html').read_text()
css = (dist / 'styles.css').read_text()
report = (dist / 'report.js').read_text().replace('export ', '')
config = (dist / 'config.js').read_text().replace('export ', '')
app = '\n'.join(line for line in (dist / 'app.js').read_text().splitlines() if not line.startswith('import '))
html = html.replace('<link rel="stylesheet" href="styles.css">', '<style>' + css + '</style>')
html = html.replace('<script type="module" src="app.js"></script>', '<script type="module">\n' + config + '\n' + report + '\n' + app + '\n</script>')
(root / 'repro-preview.html').write_text(html)
print('Wrote repro-preview.html')
