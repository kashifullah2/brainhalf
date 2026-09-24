import { database, migrate } from './index.ts';
try { migrate(); console.log('Database migrations applied'); } finally { database.close(); }
