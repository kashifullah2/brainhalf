import { describe, expect, it } from 'vitest';

import {
  buildModelParams,
  capabilitiesFor,
  retryWithoutRejectedParam,
  usedTokens,
} from './openai-params';

const ALL_DESIRED = {
  temperature: 0,
  seed: 42,
  logprobs: true,
  jsonObject: true,
  maxCompletionTokens: 8192,
};

describe('capabilitiesFor', () => {
  it('treats the chat families as fully capable', () => {
    for (const model of ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-5', 'gpt-5.4-mini']) {
      expect(capabilitiesFor(model)).toMatchObject({
        temperature: true,
        seed: true,
        logprobs: true,
        vision: true,
      });
    }
  });

  it('treats the o-series as reasoning models that reject tuning parameters', () => {
    for (const model of ['o1', 'o3', 'o3-mini', 'o4-mini']) {
      expect(capabilitiesFor(model)).toMatchObject({
        temperature: false,
        seed: false,
        logprobs: false,
      });
    }
  });

  it('knows o3-mini cannot accept an image at all', () => {
    expect(capabilitiesFor('o3-mini').vision).toBe(false);
    // Its siblings do support vision, so this must not be a blanket o-series rule.
    expect(capabilitiesFor('o1').vision).toBe(true);
  });

  it('does not mistake a non-reasoning name beginning with o for the o-series', () => {
    // The prefix test requires a digit, so these must fall through to chat.
    expect(capabilitiesFor('omni-vision').temperature).toBe(true);
    expect(capabilitiesFor('openai-custom').logprobs).toBe(true);
  });

  it('defaults an unknown future model to the permissive chat profile', () => {
    // Deliberate: an over-estimate is recovered by retryWithoutRejectedParam,
    // whereas silently dropping logprobs on a capable model is unrecoverable and
    // would quietly restore the constant-confidence bug.
    expect(capabilitiesFor('gpt-7-turbo-2029').logprobs).toBe(true);
  });

  it('normalises case and surrounding whitespace', () => {
    expect(capabilitiesFor('  O3-Mini  ').vision).toBe(false);
  });
});

describe('buildModelParams', () => {
  it('sends every tuning parameter to a chat model', () => {
    expect(buildModelParams('gpt-5.4-mini', ALL_DESIRED)).toEqual({
      temperature: 0,
      seed: 42,
      logprobs: true,
      response_format: { type: 'json_object' },
      max_completion_tokens: 8192,
    });
  });

  it('omits temperature, seed and logprobs for a reasoning model', () => {
    const params = buildModelParams('o4-mini', ALL_DESIRED);
    expect(params).not.toHaveProperty('temperature');
    expect(params).not.toHaveProperty('seed');
    expect(params).not.toHaveProperty('logprobs');
    // The output cap still applies — reasoning models bill hidden tokens.
    expect(params.max_completion_tokens).toBe(8192);
  });

  it('never emits the deprecated max_tokens', () => {
    for (const model of ['gpt-4o', 'o1', 'gpt-5.4']) {
      expect(buildModelParams(model, ALL_DESIRED)).not.toHaveProperty('max_tokens');
    }
  });

  it('omits response_format when the caller does not want a JSON object', () => {
    // This is how `table` mode opts out: it asks for a JSON array, which
    // response_format: json_object forbids.
    const params = buildModelParams('gpt-4o', { ...ALL_DESIRED, jsonObject: false });
    expect(params).not.toHaveProperty('response_format');
  });

  it('keeps an explicit temperature of 0 rather than treating it as absent', () => {
    // A truthiness check here would silently drop 0, which is the whole point of
    // setting it for OCR.
    expect(buildModelParams('gpt-4o', { temperature: 0 })).toEqual({ temperature: 0 });
  });

  it('omits everything the caller did not ask for', () => {
    expect(buildModelParams('gpt-4o', {})).toEqual({});
  });
});

describe('retryWithoutRejectedParam', () => {
  const body = () => ({
    model: 'gpt-5.4-mini',
    messages: [{ role: 'user', content: [] }],
    temperature: 0,
    logprobs: true,
  });

  it('strips the parameter named in error.param', () => {
    const retry = retryWithoutRejectedParam(body(), {
      error: {
        message: "Unsupported parameter: 'temperature' is not supported with this model.",
        code: 'unsupported_parameter',
        param: 'temperature',
      },
    });

    expect(retry?.removed).toBe('temperature');
    expect(retry?.body).not.toHaveProperty('temperature');
    // Everything else must survive, including the payload.
    expect(retry?.body.logprobs).toBe(true);
    expect(retry?.body.messages).toBeDefined();
  });

  it('handles unsupported_value, where only the default is allowed', () => {
    const retry = retryWithoutRejectedParam(body(), {
      error: { code: 'unsupported_value', param: 'temperature' },
    });
    expect(retry?.removed).toBe('temperature');
  });

  it('falls back to the message when param is not populated', () => {
    const retry = retryWithoutRejectedParam(body(), {
      error: { message: "The 'logprobs' parameter is not supported.", param: null },
    });
    expect(retry?.removed).toBe('logprobs');
  });

  it('refuses to strip the payload even when the error names it', () => {
    // A retry without `messages` would convert a loud caller bug into a
    // confusing one, so only optional tuning fields are eligible.
    expect(
      retryWithoutRejectedParam(body(), {
        error: { message: "Invalid 'messages': too long.", param: 'messages' },
      }),
    ).toBeNull();
    expect(
      retryWithoutRejectedParam(body(), {
        error: { message: "Invalid 'model'.", param: 'model' },
      }),
    ).toBeNull();
  });

  it('returns null when the parameter is not in the body', () => {
    // Retrying an identical request would just fail the same way.
    expect(
      retryWithoutRejectedParam(body(), {
        error: { param: 'seed', code: 'unsupported_parameter' },
      }),
    ).toBeNull();
  });

  it('returns null for errors that are not about a parameter', () => {
    expect(retryWithoutRejectedParam(body(), { error: { message: 'Rate limited.' } })).toBeNull();
    expect(retryWithoutRejectedParam(body(), {})).toBeNull();
    expect(retryWithoutRejectedParam(body(), null)).toBeNull();
    expect(retryWithoutRejectedParam(body(), 'not json')).toBeNull();
  });

  it('does not mutate the body it was given', () => {
    const original = body();
    retryWithoutRejectedParam(original, { error: { param: 'temperature' } });
    expect(original).toHaveProperty('temperature');
  });
});

describe('usedTokens', () => {
  it('reads total_tokens from a usage block', () => {
    expect(usedTokens({ usage: { total_tokens: 1731 } })).toBe(1731);
  });

  it('distinguishes "not reported" from zero', () => {
    // null and 0 must not collapse, or quota accounting silently under-reports.
    expect(usedTokens({ usage: {} })).toBeNull();
    expect(usedTokens({})).toBeNull();
    expect(usedTokens(null)).toBeNull();
    expect(usedTokens({ usage: { total_tokens: 0 } })).toBe(0);
  });

  it('rejects a non-finite or non-numeric total', () => {
    expect(usedTokens({ usage: { total_tokens: '1731' } })).toBeNull();
    expect(usedTokens({ usage: { total_tokens: NaN } })).toBeNull();
  });
});
