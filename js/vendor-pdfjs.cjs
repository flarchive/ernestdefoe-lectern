// Copies the pdf.js files the viewer loads into ../assets/pdfjs-<version>/,
// which Flarum publishes to public/assets/extensions/ernestdefoe-lectern/.
//
// Only the legacy build: the modern one relies on brand-new built-ins
// (Map.prototype.getOrInsertComputed) that Safari and older Chrome lack.
// Never the scripting engine (quickjs-eval): Lectern runs no PDF JavaScript.
// The files are renamed .mjs -> .js because many servers don't send a
// JavaScript MIME type for .mjs, and browsers refuse module scripts without one.
const fs = require('fs');
const path = require('path');

const pkg = path.dirname(require.resolve('pdfjs-dist/package.json'));
const { version } = require('pdfjs-dist/package.json');
const assets = path.join(__dirname, '..', 'assets');
const target = path.join(assets, `pdfjs-${version}`);

fs.rmSync(assets, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });

fs.copyFileSync(path.join(pkg, 'legacy/build/pdf.min.mjs'), path.join(target, 'pdf.min.js'));
fs.copyFileSync(path.join(pkg, 'legacy/build/pdf.worker.min.mjs'), path.join(target, 'pdf.worker.min.js'));
fs.copyFileSync(path.join(pkg, 'LICENSE'), path.join(target, 'LICENSE'));

for (const dir of ['cmaps', 'standard_fonts', 'iccs', 'wasm']) {
  fs.cpSync(path.join(pkg, dir), path.join(target, dir), {
    recursive: true,
    filter: (src) => !/quickjs/.test(path.basename(src)),
  });
}
