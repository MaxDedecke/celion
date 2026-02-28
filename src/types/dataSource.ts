import type { Tables, TablesInsert } from "@/integrations/database/types";
import type { DeltaStrategy, HeaderField, PaginationStrategy } from "@/lib/config-helpers";

export type DataSourceRow = Tables<"data_sources">;
export type DataSourceWithProjects = DataSourceRow & { assigned_projects: string[] };
export type ProjectSummary = Pick<Tables<"projects">, "id" | "name">;

export type BaseDataSourceForm = Omit<
  TablesInsert<"data_sources">,
  "user_id" | "id" | "created_at" | "updated_at" | "additional_config"
> & {
  api_url: string;
  api_key: string;
  username: string;
  password: string;
  email: string;
};

export type DataSourceFormData = BaseDataSourceForm & {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  scope: string;
  redirectUri: string;
  realm: string;
  issuer: string;
  sslVerification: boolean;
  proxyHost: string;
  proxyPort: string;
  vpnSettings: string;
  headers: HeaderField[];
  listEndpoint: string;
  detailEndpoint: string;
  createEndpoint: string;
  updateEndpoint: string;
  deleteEndpoint: string;
  healthcheckEndpoint: string;
  writeHttpMethod: string;
  requestPayloadTemplate: string;
  responseSample: string;
  successStatusCodes: string;
  paginationStrategy: PaginationStrategy;
  pageSize: string;
  pageParam: string;
  limitParam: string;
  cursorParam: string;
  cursorPath: string;
  filterTemplate: string;
  deltaField: string;
  deltaInitialValue: string;
  deltaStrategy: DeltaStrategy;
  identifierField: string;
  dateFormat: string;
  timezone: string;
  requestsPerMinute: string;
  concurrencyLimit: string;
  retryAfterHeader: string;
  requestTimeout: string;
  batchSize: string;
  maxObjectsPerRun: string;
  pollIntervalMinutes: string;
  cronSchedule: string;
  notes: string;
};