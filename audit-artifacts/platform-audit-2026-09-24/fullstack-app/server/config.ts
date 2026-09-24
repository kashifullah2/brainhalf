import { resolve } from 'node:path';

const production = process.env.NODE_ENV === 'production';
if (production && !process.env.APP_ORIGIN) throw new Error('APP_ORIGIN is required in production');
const origin = new URL(process.env.APP_ORIGIN || 'http://localhost:5173');
if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('APP_ORIGIN must be an HTTP(S) origin');
if (production && origin.protocol !== 'https:') throw new Error('Production APP_ORIGIN must use HTTPS');
const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
export const config = { production, port, origin: origin.origin, databasePath: resolve(process.env.DATABASE_PATH || './data/app.sqlite') };
