import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUSINESS_APPS, businessValidationPrompt } from '../../src/lib/business-apps.ts';
import { selectedModels } from '../test-live-model-apps.mjs';
import { DEFAULT_MODEL_ID } from '../../src/lib/models.ts';

test('the initial live smoke check uses exactly the default model unless all models are explicitly requested', () => {
  assert.deepEqual(selectedModels([]).map(model => model.name), [DEFAULT_MODEL_ID]);
  assert.ok(selectedModels(['--all-models']).length > 1);
});
test('five domain acceptance prompts require persistent data, real identity and independent verification', () => {
  assert.deepEqual(BUSINESS_APPS.map(app => app.id), ['inventory', 'booking', 'crm', 'tasks', 'portal']);
  for (const app of BUSINESS_APPS) {
    const prompt = businessValidationPrompt(app, 'Acceptance app');
    assert.match(prompt, /managed authentication/); assert.match(prompt, /direct D1 assertions/);
    assert.match(prompt, /other users get 404/i); assert.match(prompt, /brainhalf.verify.json/);
    assert.ok(Object.keys(app.invalid).length); assert.ok(Object.keys(app.update).length);
  }
});
