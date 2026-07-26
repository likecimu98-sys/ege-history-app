'use strict';

const apps = [{
    name: 'hist-api',
    cwd: '/opt/ege-history-api',
    script: 'src/server.js',
    interpreter: 'node',
    uid: 'hist-api',
    gid: 'hist-api',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '700M',
    env: {
      NODE_ENV: 'production',
      ENV_FILE: '/etc/ege-history/api.env'
    },
    time: true,
    merge_logs: true,
    error_file: '/var/log/ege-history/api-error.log',
    out_file: '/var/log/ege-history/api-out.log'
  }];

if (process.env.ENABLE_FIREBASE_INGEST === '1') apps.push({
    name: 'hist-firebase-ingest',
    cwd: '/opt/ege-history-api',
    script: 'src/firebase-ingest.js',
    interpreter: 'node',
    uid: 'hist-api',
    gid: 'hist-api',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '500M',
    env: { NODE_ENV: 'production', ENV_FILE: '/etc/ege-history/api.env' },
    time: true,
    merge_logs: true,
    error_file: '/var/log/ege-history/firebase-ingest-error.log',
    out_file: '/var/log/ege-history/firebase-ingest-out.log'
  });

module.exports = { apps };
