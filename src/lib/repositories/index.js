import { users } from './users.js'; import { sessions } from './sessions.js'; import { works } from './works.js'; import { tasks } from './tasks.js'; import { audit } from './audit.js'; import { deposits } from './deposits.js'; import { commerce } from './commerce.js';
import { repositoryMethods } from '../repository-interface.js';
export function createRepositories(databaseUrl) {
  const repositories = { initialise: async () => {}, ...users(databaseUrl), ...sessions(databaseUrl), ...works(databaseUrl), ...tasks(databaseUrl), ...audit(databaseUrl), ...deposits(databaseUrl), ...commerce(databaseUrl) };
  for (const method of repositoryMethods) if (typeof repositories[method] !== 'function') throw new Error(`Repository contract missing ${method}.`);
  return repositories;
}
