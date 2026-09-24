import { budgetRegistry } from './helpers/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleModelTest } from '../lib/model-tester';
import { PROVIDER_CREDENTIALS } from '../lib/runtime-config';

const providers = vi.hoisted(() => ({
  bedrock: vi.fn(() => vi.fn(() => ({ provider: 'aws' }))),
  anthropic: vi.fn(() => vi.fn(() => ({ provider: 'anthropic' }))),
  stream: vi.fn(() => ({
    textStream: (async function* () {
      yield '<file path="/src/App.jsx">export default function App() { return <main>Ready</main>; }</file>';
    })(),
  })),
}));

vi.mock('@ai-sdk/amazon-bedrock', () => ({ createAmazonBedrock: providers.bedrock }));
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: providers.anthropic }));
vi.mock('ai', () => ({ streamText: providers.stream }));

beforeEach(() => vi.clearAllMocks());

describe('Model test runtime configuration', () => {
  it('reports invalid required-provider configuration before calling inference', async () => {
    const run = vi.fn();
    const request = new Request('https://brainhalf.com/api/test/simple?model=@cf/openai/gpt-oss-120b');
    const response = await handleModelTest(request, {
      REQUIRED_MODEL_PROVIDERS: 'cloudflare,anthropic', AI: { run },
    }, 'simple');
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ success: false, error: 'Required provider anthropic is not configured' });
    expect(run).not.toHaveBeenCalled();
    expect(providers.stream).not.toHaveBeenCalled();
  });

  it.each(PROVIDER_CREDENTIALS.aws.filter(group => group.length === 1))('uses %s without accidentally rerouting to native Anthropic', async alias => {
    const response = await handleModelTest(new Request('https://brainhalf.com/api/test/simple?model=claude-sonnet-6&provider=aws'), {
      REGISTRY: budgetRegistry(), REQUIRED_MODEL_PROVIDERS: 'aws', [alias]: 'mock-bearer',
    }, 'simple', { userId: 'owner' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, provider: 'aws' });
    expect(providers.bedrock).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'mock-bearer' }));
    expect(providers.anthropic).not.toHaveBeenCalled();
  });

  it('rejects a legacy Atria key stored as its URL before sending credentials', async () => {
    const response = await handleModelTest(new Request('https://brainhalf.com/api/test/simple?model=Atria-Dawn-Preview&provider=atria'), {
      REQUIRED_MODEL_PROVIDERS: 'atria', ATRIA_API_KEY: 'mock-key', ATRIA_BASE_URL: 'private-value-never-echo',
    }, 'simple');
    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toContain('ATRIA_BASE_URL must be an HTTPS URL');
    expect(body).not.toContain('private-value-never-echo');
    expect(providers.stream).not.toHaveBeenCalled();
  });
});
