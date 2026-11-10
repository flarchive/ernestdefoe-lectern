// Fails when a script asks for a translation key locale/en.yml doesn't have,
// which would show the raw key to readers.
const fs = require('fs');
const path = require('path');

const yml = fs.readFileSync(path.join(__dirname, '../locale/en.yml'), 'utf8');
const keys = new Set();
const stack = [];
for (const line of yml.split('\n')) {
  const m = line.match(/^( *)([\w-]+):/);
  if (!m) continue;
  const depth = m[1].length / 2;
  stack.length = depth;
  stack[depth] = m[2];
  keys.add(stack.join('.'));
}

const missing = [];
const scan = (dir, prefix) => {
  for (const file of fs.readdirSync(dir, { recursive: true })) {
    if (!/\.(js|tsx?)$/.test(file)) continue;
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const [, key] of src.matchAll(/\bt\('([\w.]+)'/g)) {
      if (!keys.has(prefix + key)) missing.push(`${file}: ${prefix + key}`);
    }
  }
};
scan(path.join(__dirname, 'src/forum'), 'ernestdefoe-lectern.forum.');
scan(path.join(__dirname, 'src/admin'), 'ernestdefoe-lectern.admin.');
for (const key of ['error_open', 'error_denied', 'error_missing', 'error_password', 'error_browser', 'error_open_file', 'title_word', 'title_sheet', 'sheet_cut_rows', 'sheet_cut_columns']) {
  if (!keys.has('ernestdefoe-lectern.forum.' + key)) missing.push('Viewer error: ' + key);
}
for (const key of ['ernestdefoe-lectern.admin.template.name', 'ernestdefoe-lectern.admin.template.description']) {
  if (!keys.has(key)) missing.push('PdfTemplate.php: ' + key);
}

if (missing.length) {
  console.error('Missing locale keys:\n' + missing.join('\n'));
  process.exit(1);
}
console.log(`All locale keys present (${keys.size} in en.yml).`);
