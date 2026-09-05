export type AssetKind = 'texture' | 'sprite' | 'model' | 'sound' | 'any';

export type AssetSourceName =
  | 'kenney'
  | 'opengameart'
  | 'polypizza'
  | 'polyhaven'
  | 'pollinations'
  | 'huggingface'
  | 'procedural';

export type AssetSourcePreference =
  | 'auto'
  | 'kenney'
  | 'opengameart'
  | 'polypizza'
  | 'polyhaven'
  | 'pollinations'
  | 'procedural';

export interface AssetSearchRequest {
  query: string;
  asset_type?: AssetKind;
  source?: AssetSourcePreference;
  /** e.g. pixel art, low poly, seamless */
  style?: string;
  /** Optional filename stem (extension added automatically) */
  filename?: string;
}

export interface AssetSearchHit {
  source: AssetSourceName;
  title: string;
  url: string;
  score: number;
  assetKind: AssetKind;
  license?: string;
  ext?: string;
}

export interface AssetDownloadResult {
  success: boolean;
  source: AssetSourceName;
  title: string;
  /** Suggested project-relative path */
  localPath: string;
  contentType: string;
  /** Raw bytes — populated server-side; serialized as base64 over HTTP */
  data: Uint8Array;
  /** How to load in Three.js / Phaser */
  usageHint: string;
  error?: string;
}

export interface AssetSearchEnv {
  polyPizzaApiKey?: string;
  huggingFaceApiKey?: string;
}
