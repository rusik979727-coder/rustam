#!/usr/bin/env bash
# Apps Script-ке қойылатын файлдарды apps-script/* түпнұсқаларынан жинайды:
#   dist/Code.gs, dist/App.html               — Белес
#   dist/primemed/Code.gs, dist/primemed/App.html — PrimeMed (логотип, түстер, атауы басқа)
set -euo pipefail
cd "$(dirname "$0")/.."

bundle() {
  echo "// $1 — Код.gs"
  echo "// Apps Script-тегі ескі кодты толық өшіріп, осы файлды түгел қойыңыз."
  echo "// Қойғаннан кейін БІР РЕТ: ▶ Выполнить → setup → рұқсат беру."
  echo
  for f in Code Patients Sheet Dates; do
    echo "// ════════ $f.gs ════════"
    cat "apps-script/$f.gs"
    echo
  done
}

mkdir -p dist/primemed
bundle "Белес График" > dist/Code.gs
cp apps-script/App.html dist/App.html

bundle "PrimeMed График" | python3 -c "
import sys
s = sys.stdin.read()
old = \"appTitle: 'Белес График',\"
assert old in s
sys.stdout.write(s.replace(old, \"appTitle: 'PrimeMed График',\"))
" > dist/primemed/Code.gs

python3 - <<'EOF'
s = open('apps-script/App.html', encoding='utf8').read()
def rep(old, new):
    global s
    assert old in s, old[:60]
    s = s.replace(old, new)
# Түстер PrimeMed логотипінен: қою көк-жасыл және көгілдір «+»
rep("/* Ақ, жеңіл, медициналық, BELES логотипінің түстерімен: қою көк және көгілдір-жасыл.",
    "/* Ақ, жеңіл, медициналық, PrimeMed+ логотипінің түстерімен: қою көк-жасыл және көгілдір.")
rep("--ink: #122c43;", "--ink: #0b3b4c;")
rep("--accent: #126d72;", "--accent: #046a87;")
rep("--accent-light: #22a9b1;", "--accent-light: #04b8c4;")
rep("--accent-soft: #e5f2f2;", "--accent-soft: #e1f3f6;")
# Логотип шрифті — дөңгелек, жуан
rep("family=Golos+Text:wght@400;500;600;700&family=Montserrat:wght@600;700",
    "family=Golos+Text:wght@400;500;600;700&family=Montserrat:wght@600;700&family=Nunito:wght@800")
rep("  .brand-word .b2 { color: var(--accent); }",
    "  .brand-word .b2 { color: var(--accent); }\n"
    "  .brand-word.pm { font: 800 21px/1 'Nunito', var(--brand-font); letter-spacing: 0; color: var(--accent); }\n"
    "  .brand-word.pm .b1, .brand-word.pm .b2 { color: var(--accent); }\n"
    "  .brand-plus { width: 17px; height: 17px; flex: none; margin-left: -4px; align-self: center; }")
rep("""      <? if (logo) { ?><img class="brand-mark" width="32" height="32" alt="" src="<?= logo ?>"><? } ?>
      <span class="brand-word" aria-label="Beles"><span class="b1">BEL</span><span class="b2">ES</span></span>""",
    """      <span class="brand-word pm" aria-label="PrimeMed"><span class="b1">Prime</span><span class="b2">Med</span></span>
      <svg class="brand-plus" viewBox="0 0 24 24" aria-hidden="true"><path fill="#04b8c4" d="M9 2.5h6a1 1 0 0 1 1 1V8h4.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H16v4.5a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V16H3.5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1H8V3.5a1 1 0 0 1 1-1z"/></svg>""")
rep("localStorage.getItem('beles.' + k)", "localStorage.getItem('primemed.' + k)")
rep("localStorage.setItem('beles.' + k, v)", "localStorage.setItem('primemed.' + k, v)")
assert 'Beles' not in s and 'BEL<' not in s
open('dist/primemed/App.html', 'w', encoding='utf8').write(s)
EOF

# Нұсқа белгісі: түпнұсқа файлдардың хэші + күн. Code.gs пен App.html-ге бірдей қойылады.
BUILD="$(date +%d.%m)-$(cat apps-script/*.gs apps-script/App.html | sha256sum | cut -c1-6)"
for f in dist/Code.gs dist/primemed/Code.gs; do
  python3 - "$f" "$BUILD" <<'PY'
import sys
p, b = sys.argv[1], sys.argv[2]
s = open(p, encoding='utf8').read()
assert "var APP_BUILD = 'dev';" in s
open(p, 'w', encoding='utf8').write(s.replace("var APP_BUILD = 'dev';", "var APP_BUILD = '%s';" % b))
PY
done
for f in dist/App.html dist/primemed/App.html; do
  python3 - "$f" "$BUILD" <<'PY'
import sys
p, b = sys.argv[1], sys.argv[2]
s = open(p, encoding='utf8').read()
assert "var CLIENT_BUILD = 'dev';" in s
open(p, 'w', encoding='utf8').write(s.replace("var CLIENT_BUILD = 'dev';", "var CLIENT_BUILD = '%s';" % b))
PY
done
echo "build: $BUILD"

for f in dist/Code.gs dist/primemed/Code.gs; do
  node -e "new Function(require('fs').readFileSync('$f','utf8'))"
done
echo "built: dist/Code.gs dist/App.html dist/primemed/Code.gs dist/primemed/App.html"
