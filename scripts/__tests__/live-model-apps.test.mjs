import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertGenerationEvidence, createEvidence, recordFrame } from '../test-live-model-apps.mjs';

const model = { name: '@cf/zai-org/glm-5.3-flash', provider: 'cloudflare' };
const send = (state, direction, message) => recordFrame(state, direction, JSON.stringify(message));
const request = { prompt: 'Build the task app', model: model.name, provider: model.provider, projectId: 'new-test-project' };

test('a starter or empty completion cannot pass a live model app check', () => {
  const state = createEvidence(model, request.projectId);
  send(state, 'received', { type: 'file_updated', path: '/src/App.jsx' });
  send(state, 'sent', request);
  send(state, 'received', { type: 'stream', chunk: { done: true } });
  assert.throws(() => assertGenerationEvidence(state), /No generated file/);
  send(state, 'received', { type: 'file_updated', path: '/src/App.jsx' });
  assert.doesNotThrow(() => assertGenerationEvidence(state));
});

test('live checks reject fallback models, wrong providers and cross-project requests', () => {
  for (const change of [{ model: 'another-model' }, { provider: 'aws' }, { projectId: 'another-project' }]) {
    const state = createEvidence(model, request.projectId);
    send(state, 'sent', { ...request, ...change });
    send(state, 'received', { type: 'file_updated', path: '/src/App.jsx' });
    send(state, 'received', { type: 'stream', chunk: { done: true } });
    assert.throws(() => assertGenerationEvidence(state), /selected model/);
  }
});

test('an internal continuation must finish and provider errors cannot be hidden by completion', () => {
  const state = createEvidence(model, request.projectId);
  send(state, 'sent', request);
  send(state, 'received', { type: 'file_updated', path: '/src/App.jsx' });
  send(state, 'received', { type: 'trigger-auto-reply' });
  send(state, 'received', { type: 'stream', chunk: { done: true } });
  assert.throws(() => assertGenerationEvidence(state), /not completed/);
  send(state, 'sent', { ...request, prompt: 'Internal continuation' });
  assert.throws(() => assertGenerationEvidence(state), /not completed/);
  send(state, 'received', { type: 'stream', chunk: { done: true } });
  assert.doesNotThrow(() => assertGenerationEvidence(state));
  send(state, 'received', { type: 'error', error: 'Provider unavailable' });
  assert.throws(() => assertGenerationEvidence(state), /Provider unavailable/);
});
