import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ignored = new Set(['.git', 'node_modules', 'dist']);
const violations = [];

async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await scan(file);
    else if (/\.(?:js|mjs|html|css|json|md)$/i.test(entry.name)) {
      const text = await readFile(file, 'utf8');
      const legacyPlatform = new RegExp('base' + '44', 'i');
      if (legacyPlatform.test(text) && !file.includes('REBUILD-BLUEPRINT.md') && !file.includes('CLAUDE-AUDIT-BRIEF.md') && !file.endsWith('README.md')) violations.push(file);
    }
  }
}

await scan(process.cwd());
if (violations.length) {
  console.error(`Forbidden legacy references:\n${violations.join('\n')}`);
  process.exit(1);
}
console.log('No runtime legacy-platform references found.');
