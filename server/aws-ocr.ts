// ---------------------------------------------------------------------------
// AWS Textract and Bedrock, called directly over signed HTTPS.
//
// Both were previously reached through @aws-sdk/client-* packages that this
// project imported but never declared, so every build that included
// server/ocr-provider.ts failed to resolve them. They are plain JSON POSTs, so
// server/aws-sigv4.ts signs them and this file speaks the two wire protocols.
//
// Two behavioural fixes are baked in here rather than left in the provider:
//
//   * Confidence is measured, not asserted. The previous Textract adapter wrote
//     `_overall_confidence: 0.99` into every result. 0.99 is above any sane
//     review threshold, so every Textract-extracted document skipped the review
//     queue and skipped escalation -- the human-in-the-loop gate disengaged
//     silently on documents nothing had scored. Textract returns a real
//     per-block Confidence; that is what is reported now.
//
//   * The prompt is the one the caller built. The previous Bedrock adapter threw
//     away server/ocr-prompts.ts's output and substituted one hardcoded English
//     sentence, so mode, saved template and custom instructions were all ignored
//     and the reply came back in a shape the parser did not expect.
// ---------------------------------------------------------------------------

import { signAwsRequest, type AwsCredentials } from './aws-sigv4';

export interface AwsOcrConfig {
  region: string;
  credentials: AwsCredentials;
}

export interface AwsOcrEnv {
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_SESSION_TOKEN?: string;
  AWS_REGION?: string;
  AWS_BEDROCK_MODEL?: string;
}

const AWS_TIMEOUT_MS = 60_000;

/** Textract's synchronous operations cap the inline document at 5 MB. */
export const TEXTRACT_MAX_BYTES = 5 * 1024 * 1024;

export function resolveAwsConfig(env: AwsOcrEnv): AwsOcrConfig | null {
  const accessKeyId = env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) return null;
  return {
    region: env.AWS_REGION?.trim() || 'us-east-1',
    credentials: {
      accessKeyId,
      secretAccessKey,
      sessionToken: env.AWS_SESSION_TOKEN?.trim() || undefined,
    },
  };
}

export class AwsCallError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly awsErrorType: string | null,
  ) {
    super(message);
    this.name = 'AwsCallError';
  }
}

/** True for the statuses and error types worth trying again. */
export function isRetryableAwsError(error: unknown): boolean {
  if (!(error instanceof AwsCallError)) return true; // network / timeout
  if (error.status !== null && [429, 500, 502, 503, 504].includes(error.status)) return true;
  return (
    error.awsErrorType === 'ThrottlingException' ||
    error.awsErrorType === 'ProvisionedThroughputExceededException' ||
    error.awsErrorType === 'InternalServerError' ||
    error.awsErrorType === 'ServiceUnavailableException'
  );
}

async function postSigned(
  config: AwsOcrConfig,
  service: string,
  host: string,
  path: string,
  headers: Record<string, string>,
  body: string,
): Promise<unknown> {
  const signed = await signAwsRequest({
    method: 'POST',
    host,
    path,
    region: config.region,
    service,
    body,
    headers,
    credentials: config.credentials,
  });

  let response: Response;
  try {
    response = await fetch(`https://${host}${path}`, {
      method: 'POST',
      headers: signed,
      body,
      signal: AbortSignal.timeout(AWS_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new AwsCallError(`Could not reach ${service}: ${reason}`, null, null);
  }

  const text = await response.text();

  if (!response.ok) {
    // AWS reports the error type in a header on the JSON protocol, and in an
    // `__type` field on the REST protocol. Either is more useful than the status.
    let awsType =
      response.headers.get('x-amzn-errortype')?.split(':')[0] ?? null;
    let detail = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as { __type?: string; message?: string; Message?: string };
      awsType = awsType ?? parsed.__type?.split('#').pop() ?? null;
      detail = parsed.message ?? parsed.Message ?? detail;
    } catch {
      // Not JSON; the raw prefix is the best detail available.
    }
    throw new AwsCallError(detail || `${service} returned ${response.status}`, response.status, awsType);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new AwsCallError(`${service} returned a body that was not JSON`, response.status, null);
  }
}

export type TextractOperation =
  | 'DetectDocumentText'
  | 'AnalyzeDocument'
  | 'AnalyzeExpense';

export async function callTextract(
  config: AwsOcrConfig,
  operation: TextractOperation,
  base64Document: string,
): Promise<TextractResponse> {
  const payload: Record<string, unknown> = {
    Document: { Bytes: base64Document },
  };
  if (operation === 'AnalyzeDocument') {
    payload.FeatureTypes = ['FORMS', 'TABLES'];
  }

  return (await postSigned(
    config,
    'textract',
    `textract.${config.region}.amazonaws.com`,
    '/',
    {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `Textract.${operation}`,
    },
    JSON.stringify(payload),
  )) as TextractResponse;
}

export async function callBedrock(
  config: AwsOcrConfig,
  modelId: string,
  body: unknown,
): Promise<unknown> {
  // The wire path escapes the model id once; server/aws-sigv4.ts escapes it a
  // second time for the signature, which is what SigV4 requires.
  const path = `/model/${encodeURIComponent(modelId)}/invoke`;
  return postSigned(
    config,
    'bedrock',
    `bedrock-runtime.${config.region}.amazonaws.com`,
    path,
    { 'Content-Type': 'application/json', Accept: 'application/json' },
    JSON.stringify(body),
  );
}

// ---------------------------------------------------------------------------
// Textract response shapes, narrowed to what is read below.
// ---------------------------------------------------------------------------

export interface TextractBlock {
  Id?: string;
  BlockType?: string;
  Text?: string;
  Confidence?: number;
  EntityTypes?: string[];
  SelectionStatus?: string;
  Relationships?: Array<{ Type?: string; Ids?: string[] }>;
}

export interface TextractExpenseField {
  Type?: { Text?: string };
  LabelDetection?: { Text?: string; Confidence?: number };
  ValueDetection?: { Text?: string; Confidence?: number };
}

export interface TextractResponse {
  Blocks?: TextractBlock[];
  ExpenseDocuments?: Array<{
    SummaryFields?: TextractExpenseField[];
    LineItemGroups?: Array<{
      LineItems?: Array<{ LineItemExpenseFields?: TextractExpenseField[] }>;
    }>;
  }>;
}
