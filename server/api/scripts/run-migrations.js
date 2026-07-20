'use strict';

const { runMigrations, pool } = require('../src/db');

runMigrations()
  .then(() => console.log('Database migrations applied.'))
  .finally(() => pool.end());
