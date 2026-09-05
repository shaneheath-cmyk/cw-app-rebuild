import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const emptyState = {
  works: [
    {
      id: 'work-beneath-black-trees',
      title: 'Beneath the Black Trees',
      author: 'Collective Writings',
      status: 'editorial',
      formats: ['ebook', 'audiobook', 'hardcover'],
      digitalProductCode: 'title-beneath-black-trees-digital',
      kdpUrl: '',
      hardcoverDisplayPrice: 3495,
    },
  ],
  deposits: [],
  tasks: [],
  orders: [],
  entitlements: [],
  stripeEvents: [],
  auditEvents: [],
  users: [],
  sessions: [],
};

export class FileStore {
  constructor(dataDirectory) {
    this.path = join(dataDirectory, 'cw-store.json');
    this.dataDirectory = dataDirectory;
    this.queue = Promise.resolve();
  }

  async initialise() {
    await mkdir(this.dataDirectory, { recursive: true });
    try {
      await readFile(this.path, 'utf8');
    } catch {
      await writeFile(this.path, JSON.stringify(emptyState, null, 2), 'utf8');
    }
  }

  async read() {
    await this.initialise();
    const state = JSON.parse(await readFile(this.path, 'utf8'));
    for (const [key, value] of Object.entries(emptyState)) if (!Array.isArray(state[key])) state[key] = value;
    return state;
  }

  async update(mutator) {
    const operation = this.queue.then(async () => {
      const state = await this.read();
      const result = await mutator(state);
      await writeFile(this.path, JSON.stringify(state, null, 2), 'utf8');
      return result;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
}
