import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const output = join(process.cwd(), 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(join(process.cwd(), 'src', 'public'), output, { recursive: true });
console.log('Built static public assets to dist/.');
