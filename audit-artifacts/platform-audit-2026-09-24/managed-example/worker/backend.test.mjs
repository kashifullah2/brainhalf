import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../dist-worker/index.js';
test('private CRUD validates input, persists data, and isolates users', async () => {
  const db = new DatabaseSync(':memory:'); db.exec(readFileSync('migrations/0001_items.sql','utf8'));
  const env = { BRAINHALF_MANAGED: 'true', DB: { prepare(sql) { return { bind(...params) { return { async all() { return {results:db.prepare(sql).all(...params)}; }, async run() { return {meta:db.prepare(sql).run(...params)}; } }; } }; } } };
  const call = (path, method='GET', body, user='alice') => worker.fetch(new Request('https://app.example'+path, {method,headers:{Origin:'https://app.example',...(user ? {'x-bh-user-id':user}:{}),'Content-Type':'application/json'},body:body === undefined ? undefined : JSON.stringify(body)}),env);
  try {
    assert.equal((await call('/api/items','GET',undefined,'')).status,401);
    assert.equal((await call('/api/items','POST',{title:''})).status,400);
    const response = await call('/api/items','POST',{title:'Saved destination'}); assert.equal(response.status,201); const {item}=await response.json();
    assert.equal((await (await call('/api/items')).json()).items[0].title,'Saved destination');
    assert.equal((await (await call('/api/items','GET',undefined,'bob')).json()).items.length,0);
    assert.equal((await call('/api/items/'+item.id,'DELETE',undefined,'bob')).status,404);
    assert.equal((await call('/api/items/'+item.id,'DELETE')).status,200);
    assert.equal((await (await call('/api/items')).json()).items.length,0);
  } finally { db.close(); }
});
