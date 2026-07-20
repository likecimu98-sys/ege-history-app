'use strict';

const FIRESTORE_COLLECTIONS = Object.freeze([
  ['public', 'students'],
  ['private', 'state'],
  ['public', 'teachers'],
  ['public', 'orgs'],
  ['public', 'classes'],
  ['public', 'matches'],
  ['public', 'loginTokens'],
  ['public', 'loginSessions'],
  ['public', 'notifyJobs'],
  ['public', 'config'],
  ['public', 'leaderboards'],
]);

module.exports = { FIRESTORE_COLLECTIONS };
