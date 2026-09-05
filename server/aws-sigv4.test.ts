import { describe, expect, it } from 'vitest';

import { canonicalRequestFor, canonicalUri, signAwsRequest } from './aws-sigv4';

/**
 * AWS publishes a signing test suite ("aws-sig-v4-test-suite"). `get-vanilla` is
 * its simplest case and pins every step of the algorithm at once: canonical
 * request, string to sign, the four-stage signing key, and the Authorization
 * header. If this passes, the implementation is signing the way AWS verifies.
 */
const VECTOR = {
  credentials: {
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  },
  region: 'us-east-1',
  service: 'service',
  host: 'example.amazonaws.com',
  now: new Date('2015-08-30T12:36:00Z'),
};

describe('signAwsRequest — AWS get-vanilla vector', () => {
  it('builds the documented canonical request', async () => {
    const canonical = await canonicalRequestFor({
      method: 'GET',
      path: '/',
      body: '',
      ...VECTOR,
    });

    expect(canonical).toBe(
      [
        'GET',
        '/',
        '',
        'host:example.amazonaws.com',
        'x-amz-date:20150830T123600Z',
        '',
        'host;x-amz-date',
        // SHA-256 of the empty string.
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      ].join('\n'),
    );
  });

  it('produces the documented Authorization header', async () => {
    const headers = await signAwsRequest({
      method: 'GET',
      path: '/',
      body: '',
      ...VECTOR,
    });

    expect(headers.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
        'SignedHeaders=host;x-amz-date, ' +
        'Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
  });

  it('signs the extra headers a service call carries', async () => {
    const headers = await signAwsRequest({
      method: 'POST',
      path: '/',
      body: '{"a":1}',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'Textract.DetectDocumentText',
      },
      ...VECTOR,
    });

    // Header names are lowercased and sorted in SignedHeaders, and every header
    // present must appear there or AWS rejects the request as unsigned.
    expect(headers.Authorization).toContain(
      'SignedHeaders=content-type;host;x-amz-date;x-amz-target',
    );
  });

  it('carries a session token into the signature when one is supplied', async () => {
    const headers = await signAwsRequest({
      method: 'GET',
      path: '/',
      body: '',
      ...VECTOR,
      credentials: { ...VECTOR.credentials, sessionToken: 'session-token' },
    });

    expect(headers['x-amz-security-token']).toBe('session-token');
    expect(headers.Authorization).toContain('x-amz-security-token');
  });
});

describe('canonicalUri', () => {
  it('escapes an already-encoded path a second time, as SigV4 requires', () => {
    // A Bedrock model id contains a colon. The wire path carries %3A; the string
    // that gets signed has to carry %253A, or the signature will not verify.
    expect(canonicalUri('/model/anthropic.claude-3-5-sonnet-v2%3A0/invoke')).toBe(
      '/model/anthropic.claude-3-5-sonnet-v2%253A0/invoke',
    );
  });

  it('leaves the root path alone', () => {
    expect(canonicalUri('/')).toBe('/');
  });
});
