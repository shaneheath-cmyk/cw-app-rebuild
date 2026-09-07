import { users } from './users.js'; import { sessions } from './sessions.js'; import { works } from './works.js'; import { tasks } from './tasks.js'; import { audit } from './audit.js'; import { deposits } from './deposits.js'; import { commerce } from './commerce.js';
import { repositoryMethods } from '../repository-interface.js';
import { verifyPostgresRuntime } from '../postgres.js';
import { abuse } from './abuse.js';
export function createRepositories(databaseUrl) {
  const repositories = { initialise: async () => { console.log(`PostgreSQL runtime verified as ${await verifyPostgresRuntime(databaseUrl)}`); }, ...users(databaseUrl), ...sessions(databaseUrl), ...works(databaseUrl), ...tasks(databaseUrl), ...audit(databaseUrl), ...deposits(databaseUrl), ...commerce(databaseUrl), ...abuse(databaseUrl) };
  for (const method of repositoryMethods) if (typeof repositories[method] !== 'function') throw new Error(`Repository contract missing ${method}.`);
  return repositories;
}
