// Both stores must expose this exact contract so tests cannot accidentally exercise a different app.
export const repositoryMethods = [
  'initialise', 'findUserByEmail', 'countUsers', 'insertUser',
  'findSessionByTokenHash', 'insertSession', 'deleteSession', 'pruneSessions',
  'listWorks', 'listOpenTasks', 'listRecentAuditEvents', 'listForOperations',
  'appendAuditEvent', 'insertDeposit', 'findDeposit', 'retrieveDeposit', 'replaceDepositParse',
  'recordStripeEvent', 'insertOrderWithEntitlement',
];
