import { createApp } from './app.ts';
import { config } from './config.ts';
import { database } from './db/index.ts';

database.prepare('SELECT name FROM schema_migrations LIMIT 1').all();
const server = createApp();
server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.listen(config.port, '127.0.0.1', () => console.log('API listening on http://127.0.0.1:' + config.port));
const close = () => server.close(() => { database.close(); process.exit(0); });
process.once('SIGTERM', close);
process.once('SIGINT', close);
