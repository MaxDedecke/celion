import { DATA_SOURCE_TYPE_OPTIONS } from "@/constants/sourceTypes";
import {
  createHeaderField,
  headersToConfigEntries,
  mapHeadersToFields,
  parseCommaSeparatedIntegers,
  parseInteger,
  pruneConfig,
  successCodesToString,
} from "@/lib/config-helpers";
import type { DataSourceFormData, DataSourceWithProjects } from "@/types/dataSource";

const SOURCE_TYPE_OPTIONS = DATA_SOURCE_TYPE_OPTIONS;

export const createInitialDataSourceFormData = (): DataSourceFormData => ({
  name: "",
  source_type: SOURCE_TYPE_OPTIONS[0],
  api_url: "",
  api_key: "",
  username: "",
  password: "",
  email: "",
  auth_type: "api_key",
  is_active: true,
  is_global: false,
  clientId: "",
  clientSecret: "",
  authUrl: "",
  tokenUrl: "",
  scope: "",
  redirectUri: "",
  realm: "",
  issuer: "",
  sslVerification: true,
  proxyHost: "",
  proxyPort: "",
  vpnSettings: "",
  headers: [createHeaderField()],
  listEndpoint: "",
  detailEndpoint: "",
  createEndpoint: "",
  updateEndpoint: "",
  deleteEndpoint: "",
  healthcheckEndpoint: "",
  writeHttpMethod: "POST",
  requestPayloadTemplate: "",
  responseSample: "",
  successStatusCodes: "",
  paginationStrategy: "none",
  pageSize: "",
  pageParam: "",
  limitParam: "",
  cursorParam: "",
  cursorPath: "",
  filterTemplate: "",
  deltaField: "",
  deltaInitialValue: "",
  deltaStrategy: "timestamp",
  identifierField: "",
  dateFormat: "",
  timezone: "",
  requestsPerMinute: "",
  concurrencyLimit: "",
  retryAfterHeader: "",
  requestTimeout: "",
  batchSize: "",
  maxObjectsPerRun: "",
  pollIntervalMinutes: "",
  cronSchedule: "",
  notes: "",
});

export const mapDataSourceToFormData = (source?: DataSourceWithProjects): DataSourceFormData => {
  const base = createInitialDataSourceFormData();
  if (!source) return base;

  const config = (source.additional_config as Record<string, any>) || {};
  const endpoints = (config.endpoints as Record<string, any>) || {};
  const operations = (config.operations as Record<string, any>) || {};
  const pagination = (config.pagination as Record<string, any>) || {};
  const filtering = (config.filtering as Record<string, any>) || {};
  const rateLimiting = (config.rate_limiting as Record<string, any>) || {};
  const batching = (config.batching as Record<string, any>) || {};
  const scheduling = (config.scheduling as Record<string, any>) || {};
  const dataFormat = (config.data_format as Record<string, any>) || {};
  const identifiers = (config.identifiers as Record<string, any>) || {};

  return {
    ...base,
    name: source.name,
    source_type: source.source_type,
    api_url: source.api_url || "",
    api_key: source.api_key || "",
    username: source.username || "",
    password: source.password || "",
    email: (config.email as string) || "",
    auth_type: source.auth_type,
    is_active: source.is_active,
    is_global: source.is_global,
    clientId: (config.client_id as string) || "",
    clientSecret: (config.client_secret as string) || "",
    authUrl: (config.auth_url as string) || "",
    tokenUrl: (config.token_url as string) || "",
    scope: (config.scope as string) || "",
    redirectUri: (config.redirect_uri as string) || "",
    realm: (config.realm as string) || "",
    issuer: (config.issuer as string) || "",
    sslVerification: (config.ssl_verification as boolean) ?? true,
    proxyHost: (config.proxy_host as string) || "",
    proxyPort: (config.proxy_port as string) || "",
    vpnSettings: (config.vpn_settings as string) || "",
    headers: mapHeadersToFields(config.headers as any),
    listEndpoint: endpoints.list || "",
    detailEndpoint: endpoints.detail || "",
    createEndpoint: endpoints.create || "",
    updateEndpoint: endpoints.update || "",
    deleteEndpoint: endpoints.delete || "",
    healthcheckEndpoint: endpoints.healthcheck || "",
    writeHttpMethod: operations.write_method || "POST",
    requestPayloadTemplate: operations.payload_template || "",
    responseSample: operations.response_sample || "",
    successStatusCodes: successCodesToString(operations.success_status_codes),
    paginationStrategy: pagination.strategy || "none",
    pageSize: pagination.page_size ? String(pagination.page_size) : "",
    pageParam: pagination.page_param || "",
    limitParam: pagination.limit_param || "",
    cursorParam: pagination.cursor_param || "",
    cursorPath: pagination.cursor_path || "",
    filterTemplate: filtering.default_params || "",
    deltaField: filtering.delta_field || "",
    deltaInitialValue: filtering.initial_value || "",
    deltaStrategy: filtering.delta_strategy || "timestamp",
    identifierField: identifiers.primary_key || "",
    dateFormat: dataFormat.date_format || "",
    timezone: dataFormat.timezone || "",
    requestsPerMinute: rateLimiting.requests_per_minute ? String(rateLimiting.requests_per_minute) : "",
    concurrencyLimit: rateLimiting.concurrent_requests ? String(rateLimiting.concurrent_requests) : "",
    retryAfterHeader: rateLimiting.retry_after_header || "",
    requestTimeout: operations.request_timeout ? String(operations.request_timeout) : "",
    batchSize: batching.batch_size ? String(batching.batch_size) : "",
    maxObjectsPerRun: batching.max_objects_per_run ? String(batching.max_objects_per_run) : "",
    pollIntervalMinutes: scheduling.poll_interval_minutes ? String(scheduling.poll_interval_minutes) : "",
    cronSchedule: scheduling.cron || "",
    notes: (config.notes as string) || "",
  };
};

export const buildDataSourceAdditionalConfig = (form: DataSourceFormData): Record<string, any> => {
  const oauthFields: Record<string, any> = form.auth_type === "oauth2"
    ? {
        client_id: form.clientId,
        client_secret: form.clientSecret,
        auth_url: form.authUrl,
        token_url: form.tokenUrl,
        scope: form.scope,
        redirect_uri: form.redirectUri,
      }
    : {};

  const customAuthFields: Record<string, any> = form.auth_type === "custom"
    ? {
        realm: form.realm,
        issuer: form.issuer,
        client_id: form.clientId,
        client_secret: form.clientSecret,
      }
    : {};

  const endpointConfig = {
    list: form.listEndpoint,
    detail: form.detailEndpoint,
    create: form.createEndpoint,
    update: form.updateEndpoint,
    delete: form.deleteEndpoint,
    healthcheck: form.healthcheckEndpoint,
  };

  const operationsConfig = {
    write_method: form.writeHttpMethod,
    payload_template: form.requestPayloadTemplate,
    response_sample: form.responseSample,
    success_status_codes: parseCommaSeparatedIntegers(form.successStatusCodes),
    request_timeout: parseInteger(form.requestTimeout),
  };

  const paginationConfig = {
    strategy: form.paginationStrategy,
    page_size: parseInteger(form.pageSize),
    page_param: form.pageParam,
    limit_param: form.limitParam,
    cursor_param: form.cursorParam,
    cursor_path: form.cursorPath,
  };

  const filteringConfig = {
    default_params: form.filterTemplate,
    delta_field: form.deltaField,
    delta_strategy: form.deltaStrategy,
    initial_value: form.deltaInitialValue,
  };

  const rateLimitingConfig = {
    requests_per_minute: parseInteger(form.requestsPerMinute),
    concurrent_requests: parseInteger(form.concurrencyLimit),
    retry_after_header: form.retryAfterHeader,
  };

  const batchingConfig = {
    batch_size: parseInteger(form.batchSize),
    max_objects_per_run: parseInteger(form.maxObjectsPerRun),
  };

  const schedulingConfig = {
    poll_interval_minutes: parseInteger(form.pollIntervalMinutes),
    cron: form.cronSchedule,
  };

  const dataFormatConfig = {
    date_format: form.dateFormat,
    timezone: form.timezone,
  };

  const identifiersConfig = {
    primary_key: form.identifierField,
  };

  const baseConfig: Record<string, any> = {
    email: form.email,
    ssl_verification: form.sslVerification,
    proxy_host: form.proxyHost,
    proxy_port: form.proxyPort,
    vpn_settings: form.vpnSettings,
    notes: form.notes,
    ...oauthFields,
    ...customAuthFields,
    endpoints: endpointConfig,
    operations: operationsConfig,
    pagination: paginationConfig,
    filtering: filteringConfig,
    rate_limiting: rateLimitingConfig,
    batching: batchingConfig,
    scheduling: schedulingConfig,
    data_format: dataFormatConfig,
    identifiers: identifiersConfig,
  };

  const headerEntries = headersToConfigEntries(form.headers);
  if (headerEntries.length > 0) {
    baseConfig.headers = headerEntries;
  }

  return (pruneConfig(baseConfig) as Record<string, any>) || {};
};

export const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unbekannter Fehler";