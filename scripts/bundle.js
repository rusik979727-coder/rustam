// Орнатуды жеңілдету: apps-script/ ішіндегі 6 файлды 2 файлға біріктіреді.
//   install/Code.gs    = Dates.gs + Sheet.gs + Code.gs
//   install/Index.html = Index.html (Styles.html мен App.html ішіне қойылған)
// Пайдаланушы Apps Script-ке тек осы 2 файлды көшіріп қояды.
//   node scripts/bundle.js
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'apps-script');
const OUT = path.join(__dirname, '..', 'install');

function read(name) {
  return fs.readFileSync(path.join(SRC, name), 'utf8');
}

function buildCode() {
  const header =
    '// Белес График. Бұл файл автоматты түрде жиналған (scripts/bundle.js).\n' +
    '// Өзгерту керек болса, apps-script/ ішіндегі түпнұсқаларды өзгертіп, npm run bundle іске қосыңыз.\n\n';
  return header + ['Code.gs', 'Sheet.gs', 'Dates.gs']
    .map((f) => '// ════════ ' + f + ' ════════\n' + read(f).trim() + '\n')
    .join('\n');
}

function buildIndex() {
  return read('Index.html').replace(/<\?!=\s*include\('(\w+)'\)\s*\?>/g, (_, name) => read(name + '.html').trim());
}

function build() {
  return { 'Code.gs': buildCode(), 'Index.html': buildIndex() };
}

if (require.main === module) {
  fs.mkdirSync(OUT, { recursive: true });
  const files = build();
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(OUT, name), content);
    console.log('install/' + name + ': ' + content.split('\n').length + ' жол');
  }
}

module.exports = { build, OUT };
