export type DiscoveryPaginationType =
  | "offset"
  | "offset_limit"
  | "page"
  | "page_limit"
  | "page_per_page"
  | "startAt_maxResults"
  | "cursor"
  | "continuationToken"
  | "page_size_offset"
  | "skip_top"
  | "none"
  | null;

export interface DiscoveryPaginationConfig {
  type: DiscoveryPaginationType;
  paramStart?: string;
  paramLimit?: string;
  paramPage?: string;
  paramCursor?: string;
  paramOffset?: string;
  paramContinuation?: string;
  headerContinuation?: string;
  defaultLimit?: number;
  firstPage?: number;
}

export interface DiscoveryConfig {
  endpoints?: Record<string, string>;
  pagination?: DiscoveryPaginationConfig | null;
  graphqlQueryObjects?: string[];
  objectTypes?: string[];
}

export interface SchemeAuthConfig {
  type: string;
  headerTemplate?: string | null;
  requiresToken?: boolean;
  requiresEmail?: boolean;
  requiresApiToken?: boolean;
  requiresPassword?: boolean;
  probeEndpoint: string;
  probeMethod?: string;
  probeBody?: unknown;
  successStatus: number;
}

export interface SchemeDefinition {
  system: string;
  apiType: string;
  baseUrlPattern?: string;
  apiBaseUrl?: string;
  auth: SchemeAuthConfig;
  discovery?: DiscoveryConfig;
  headers?: Record<string, string>;
}
