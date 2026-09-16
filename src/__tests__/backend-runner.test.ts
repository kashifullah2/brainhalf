import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseEnvFile,
  checkUnsupportedBackendFeatures,
  InMemoryDataStore,
  validateBackendFiles,
  isFullStackProject,
  executeBackendRequest
} from '../lib/backend-runner';
import { exportProjectAsZip } from '../lib/zip-export';
import JSZip from 'jszip';

describe('BrainHalf Full-Stack Backend Runner', () => {
  describe('Environment Variable (.env) Parser', () => {
    it('parses .env key-value pairs, strips whitespace, quotes, and ignores comments', () => {
      const envContent = `
# Server Configuration
PORT=3001
NODE_ENV="production"
JWT_SECRET='super_secret_jwt_key_98765'
EMPTY_LINE=

# Database URI (supports SQLite, Postgres, MongoDB credentials)
DATABASE_URL="postgres://user:password@localhost:5432/myapp"
`;
      const env = parseEnvFile(envContent);
      expect(env.PORT).toBe('3001');
      expect(env.NODE_ENV).toBe('production');
      expect(env.JWT_SECRET).toBe('super_secret_jwt_key_98765');
      expect(env.DATABASE_URL).toBe('postgres://user:password@localhost:5432/myapp');
      expect(env.EMPTY_LINE).toBe('');
      expect(env['# Server Configuration']).toBeUndefined();
    });

    it('handles empty or missing .env gracefully', () => {
      expect(parseEnvFile('')).toEqual({});
    });
  });

  describe('Out of Scope Feature Interception', () => {
    it('flags multi-region deployment as not yet supported', () => {
      const check = checkUnsupportedBackendFeatures('Please deploy my backend across multiple regions for low latency');
      expect(check.supported).toBe(false);
      expect(check.reason).toContain('Multi-region deployment is not yet supported');
    });

    it('flags custom backend runtimes beyond Node/Python as not yet supported', () => {
      const goCheck = checkUnsupportedBackendFeatures('I want to build this backend in Go lang');
      expect(goCheck.supported).toBe(false);
      expect(goCheck.reason).toContain('Custom backend runtime "go lang" is not yet supported');

      const rustCheck = checkUnsupportedBackendFeatures('Write the backend in Rust with actix');
      expect(rustCheck.supported).toBe(false);
      expect(rustCheck.reason).toContain('Custom backend runtime "rust" is not yet supported');
    });

    it('flags manual database schema migration tools as not yet supported', () => {
      const flywayCheck = checkUnsupportedBackendFeatures('Include flyway migration tool for DB versioning');
      expect(flywayCheck.supported).toBe(false);
      expect(flywayCheck.reason).toContain('Manual database schema migration tools are not yet supported');
    });

    it('allows standard Node.js/Express, Python/FastAPI, and SQLite/Postgres configurations', () => {
      const checkNode = checkUnsupportedBackendFeatures('Build an Express REST API with SQLite store');
      expect(checkNode.supported).toBe(true);

      const checkPython = checkUnsupportedBackendFeatures('Generate a FastAPI service connected to PostgreSQL');
      expect(checkPython.supported).toBe(true);
    });
  });

  describe('In-Memory / SQLite Data Store', () => {
    let store: InMemoryDataStore;

    beforeEach(() => {
      store = new InMemoryDataStore();
    });

    it('performs full CRUD lifecycle on entities', () => {
      // 1. Create
      const created = store.create('products', { name: 'Wireless Headphones', price: 99.99 });
      expect(created.id).toBeDefined();
      expect(created.name).toBe('Wireless Headphones');
      expect(created.price).toBe(99.99);
      expect(created.createdAt).toBeDefined();

      // 2. Find All
      const all = store.findAll('products');
      expect(all.length).toBe(1);
      expect(all[0].name).toBe('Wireless Headphones');

      // 3. Find By ID
      const found = store.findById('products', created.id);
      expect(found).not.toBeNull();
      expect(found?.name).toBe('Wireless Headphones');

      // 4. Update
      const updated = store.update('products', created.id, { price: 89.99, sale: true });
      expect(updated).not.toBeNull();
      expect(updated?.price).toBe(89.99);
      expect(updated?.sale).toBe(true);
      expect(updated?.updatedAt).toBeDefined();

      // 5. Delete
      const deleted = store.delete('products', created.id);
      expect(deleted).toBe(true);
      expect(store.findAll('products').length).toBe(0);
      expect(store.findById('products', created.id)).toBeNull();
    });
  });

  describe('Full-Stack File Validation & Detection', () => {
    it('detects full-stack projects accurately', () => {
      expect(isFullStackProject({
        '/src/App.jsx': 'export default function App() {}',
        '/server/index.js': 'import express from "express";'
      })).toBe(true);

      expect(isFullStackProject({
        '/src/App.jsx': 'export default function App() {}',
        '/server.js': 'console.log("hello");'
      })).toBe(true);

      expect(isFullStackProject({
        '/src/App.jsx': 'export default function App() {}',
        '/src/styles.css': 'body {}'
      })).toBe(false);
    });

    it('validates syntax in backend files and attributes errors to Backend', () => {
      const validFiles = {
        '/server/index.js': `
          const x = 10;
          function test() { return x * 2; }
        `
      };
      expect(validateBackendFiles(validFiles)).toBeNull();

      const brokenFiles = {
        '/server/routes/items.js': `
          const x = ; // SyntaxError
        `
      };
      const result = validateBackendFiles(brokenFiles);
      expect(result).not.toBeNull();
      expect(result?.error).toContain('[Backend Error]');
      expect(result?.file).toBe('/server/routes/items.js');
    });
  });

  describe('Backend Request Dispatcher & Auto-CRUD Execution', () => {
    let store: InMemoryDataStore;

    beforeEach(() => {
      store = new InMemoryDataStore();
    });

    it('handles authentication routes: login, register, me', async () => {
      const files = {
        '/server/.env': 'JWT_SECRET=test_secret'
      };

      // Register
      const regRes = await executeBackendRequest(files, {
        method: 'POST',
        url: 'http://localhost/api/auth/register',
        body: { email: 'alice@example.com', password: 'password123' }
      }, store);
      expect(regRes.status).toBe(201);
      expect(regRes.body.success).toBe(true);
      expect(regRes.body.token).toBeDefined();

      // Login
      const loginRes = await executeBackendRequest(files, {
        method: 'POST',
        url: 'http://localhost/api/auth/login',
        body: { email: 'alice@example.com', password: 'password123' }
      }, store);
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.token).toBeDefined();

      // Auth Me with token
      const meRes = await executeBackendRequest(files, {
        method: 'GET',
        url: 'http://localhost/api/auth/me',
        headers: { authorization: `Bearer ${loginRes.body.token}` }
      }, store);
      expect(meRes.status).toBe(200);
      expect(meRes.body.email).toBeDefined();

      // Auth Me without token -> 401
      const meUnauthorized = await executeBackendRequest(files, {
        method: 'GET',
        url: 'http://localhost/api/auth/me'
      }, store);
      expect(meUnauthorized.status).toBe(401);
    });

    it('auto-generates CRUD endpoints for resources requested by frontend (e.g., /api/products)', async () => {
      const files = {
        '/server/index.js': 'console.log("running");'
      };

      // 1. Initial GET seeds sample items if collection empty
      const getRes = await executeBackendRequest(files, {
        method: 'GET',
        url: 'http://localhost/api/products'
      }, store);
      expect(getRes.status).toBe(200);
      expect(Array.isArray(getRes.body)).toBe(true);
      expect(getRes.body.length).toBeGreaterThan(0);

      // 2. POST create new product
      const postRes = await executeBackendRequest(files, {
        method: 'POST',
        url: 'http://localhost/api/products',
        body: { name: 'Mechanical Keyboard', price: 149 }
      }, store);
      expect(postRes.status).toBe(201);
      expect(postRes.body.id).toBeDefined();
      expect(postRes.body.name).toBe('Mechanical Keyboard');
      const newId = postRes.body.id;

      // 3. GET product by ID
      const getByIdRes = await executeBackendRequest(files, {
        method: 'GET',
        url: `http://localhost/api/products/${newId}`
      }, store);
      expect(getByIdRes.status).toBe(200);
      expect(getByIdRes.body.name).toBe('Mechanical Keyboard');

      // 4. PUT update product
      const putRes = await executeBackendRequest(files, {
        method: 'PUT',
        url: `http://localhost/api/products/${newId}`,
        body: { price: 129, inStock: true }
      }, store);
      expect(putRes.status).toBe(200);
      expect(putRes.body.price).toBe(129);
      expect(putRes.body.inStock).toBe(true);

      // 5. DELETE product
      const delRes = await executeBackendRequest(files, {
        method: 'DELETE',
        url: `http://localhost/api/products/${newId}`
      }, store);
      expect(delRes.status).toBe(200);
      expect(delRes.body.success).toBe(true);

      // 6. Confirm 404 after deletion
      const checkDeleted = await executeBackendRequest(files, {
        method: 'GET',
        url: `http://localhost/api/products/${newId}`
      }, store);
      expect(checkDeleted.status).toBe(404);
      expect(checkDeleted.layer).toBe('backend');
    });

    it('returns structured 404 with layer: backend when endpoint does not exist', async () => {
      const res = await executeBackendRequest({}, {
        method: 'POST',
        url: 'http://localhost/api/unknown/subroute/nested'
      }, store);
      expect(res.status).toBe(404);
      expect(res.layer).toBe('backend');
      expect(res.body.error).toContain('[Backend Error] Route not found');
    });
  });
});
