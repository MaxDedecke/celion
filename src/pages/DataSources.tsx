import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Trash2,
  Pencil,
  Database,
  GitBranch,
  Github,
  Gitlab,
  Cloud,
  Box,
  Plug,
  ShieldCheck,
  Globe2,
  Power,
  Link2,
  Sparkles,
  Plus
} from "lucide-react";
import { Button } from "@/components/ui/button";
import DataFlowLoader from "@/components/DataFlowLoader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { useMinimumLoader } from "@/hooks/useMinimumLoader";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DATA_SOURCE_TYPE_OPTIONS, type DataSourceType } from "@/constants/sourceTypes";
import { WizardSteps, type WizardStep } from "@/components/ui/wizard-steps";
import InfoTooltip from "@/components/InfoTooltip";
import {
  createHeaderField,
  headersToConfigEntries,
  mapHeadersToFields,
  parseCommaSeparatedIntegers,
  parseInteger,
  pruneConfig,
  successCodesToString,
  type DeltaStrategy,
  type HeaderField,
  type PaginationStrategy,
} from "@/lib/config-helpers";

type DataSourceRow = Tables<"data_sources">;
type DataSourceWithProjects = DataSourceRow & { assigned_projects: string[] };
type ProjectSummary = Pick<Tables<"projects">, "id" | "name">;

type BaseDataSourceForm = Omit<
  TablesInsert<"data_sources">,
  "user_id" | "id" | "created_at" | "updated_at" | "additional_config"
> & {
  api_url: string;
  api_key: string;
  username: string;
  password: string;
};

type DataSourceFormData = BaseDataSourceForm & {
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

const SOURCE_TYPE_OPTIONS = DATA_SOURCE_TYPE_OPTIONS;

const DATA_SOURCE_WIZARD_STEPS: WizardStep[] = [
  {
    title: "Grundlagen",
    description: "Name, Typ und Sichtbarkeit festlegen",
  },
  {
    title: "Zugang",
    description: "Authentifizierung und Infrastruktur konfigurieren",
  },
  {
    title: "Endpunkte",
    description: "API-Endpunkte, Header und Payload definieren",
  },
  {
    title: "Automatisierung",
    description: "Pagination, Limits, Zeitpläne und Projekte steuern",
  },
];

const createInitialDataSourceFormData = (): DataSourceFormData => ({
  name: "",
  source_type: SOURCE_TYPE_OPTIONS[0],
  api_url: "",
  api_key: "",
  username: "",
  password: "",
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

const mapDataSourceToFormData = (source?: DataSourceWithProjects): DataSourceFormData => {
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

const buildDataSourceAdditionalConfig = (form: DataSourceFormData): Record<string, any> => {
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

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unbekannter Fehler";

const DataSources = () => {
  const navigate = useNavigate();
  const [dataSources, setDataSources] = useState<DataSourceWithProjects[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const loaderVisible = useMinimumLoader(loading, 1000);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [editingSource, setEditingSource] = useState<DataSourceWithProjects | null>(null);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [formData, setFormData] = useState<DataSourceFormData>(() => createInitialDataSourceFormData());

  const totalSteps = DATA_SOURCE_WIZARD_STEPS.length;
  const isLastStep = currentStep === totalSteps - 1;

  const handleDialogOpenChange = (open: boolean) => {
    setIsDialogOpen(open);
    if (!open) {
      setCurrentStep(0);
    }
  };

  const handleNextStep = () => {
    setCurrentStep((previous) => Math.min(previous + 1, totalSteps - 1));
  };

  const handlePreviousStep = () => {
    setCurrentStep((previous) => Math.max(previous - 1, 0));
  };

  const sourceTypeOptions = SOURCE_TYPE_OPTIONS.includes(
    formData.source_type as DataSourceType
  )
    ? [...SOURCE_TYPE_OPTIONS]
    : [formData.source_type, ...SOURCE_TYPE_OPTIONS];

  const checkAuth = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate("/");
    }
  }, [navigate]);

  const getSourceIcon = (sourceType: string) => {
    const type = sourceType.toLowerCase();
    if (type.includes('jira')) return Database;
    if (type.includes('azure') || type.includes('devops')) return Cloud;
    if (type.includes('github')) return Github;
    if (type.includes('gitlab')) return Gitlab;
    if (type.includes('git')) return GitBranch;
    return Box;
  };

  const loadProjects = useCallback(async (): Promise<void> => {
    try {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name")
        .order("name", { ascending: true });

      if (error) throw error;
      setProjects(data ?? []);
    } catch (error: unknown) {
      console.error("Fehler beim Laden der Projekte:", error);
    }
  }, []);

  const loadDataSources = useCallback(async (): Promise<void> => {
    try {
      const { data, error } = await supabase
        .from("data_sources")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Load project assignments for each data source
      const sourcesWithProjects = await Promise.all(
        (data ?? []).map(async (source): Promise<DataSourceWithProjects> => {
          const { data: assignments } = await supabase
            .from("data_source_projects")
            .select("project_id")
            .eq("data_source_id", source.id);

          return {
            ...source,
            assigned_projects: assignments?.map((assignment) => assignment.project_id) ?? [],
          };
        })
      );

      setDataSources(sourcesWithProjects);
    } catch (error: unknown) {
      toast.error("Fehler beim Laden der Datenquellen");
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkAuth();
    void loadProjects();
    void loadDataSources();
  }, [checkAuth, loadProjects, loadDataSources]);

  const handleOpenDialog = (source?: DataSourceWithProjects) => {
    if (source) {
      setEditingSource(source);
      setFormData(mapDataSourceToFormData(source));
      setSelectedProjects(source.assigned_projects ?? []);
    } else {
      setEditingSource(null);
      setFormData(createInitialDataSourceFormData());
      setSelectedProjects([]);
    }
    setCurrentStep(0);
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Nicht authentifiziert");

      let sourceId: string;

      const additionalConfig = buildDataSourceAdditionalConfig(formData);

      const baseData: TablesInsert<"data_sources"> = {
        name: formData.name,
        source_type: formData.source_type,
        api_url: formData.api_url || null,
        api_key: formData.api_key || null,
        username: formData.username || null,
        password: formData.password || null,
        auth_type: formData.auth_type,
        is_active: formData.is_active,
        is_global: formData.is_global,
        additional_config: additionalConfig,
        user_id: user.id,
      };

      if (editingSource) {
        const { error } = await supabase
          .from("data_sources")
          .update({ ...baseData, user_id: editingSource.user_id })
          .eq("id", editingSource.id);

        if (error) throw error;
        sourceId = editingSource.id;

        // Delete existing project assignments
        await supabase
          .from("data_source_projects")
          .delete()
          .eq("data_source_id", sourceId);
        
        toast.success("Datenquelle aktualisiert");
      } else {
        const { data, error } = await supabase
          .from("data_sources")
          .insert(baseData)
          .select()
          .single();

        if (error) throw error;
        sourceId = data.id;
        toast.success("Datenquelle erstellt");
      }

      // Add new project assignments (only if not global)
      if (!formData.is_global && selectedProjects.length > 0) {
        const assignments = selectedProjects.map((projectId) => ({
          data_source_id: sourceId,
          project_id: projectId,
        }));

        const { error: assignmentError } = await supabase
          .from("data_source_projects")
          .insert(assignments);

        if (assignmentError) throw assignmentError;
      }

      setIsDialogOpen(false);
      setCurrentStep(0);
      setFormData(createInitialDataSourceFormData());
      await loadDataSources();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error) || "Fehler beim Speichern");
      console.error(error);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase
        .from("data_sources")
        .delete()
        .eq("id", id);

      if (error) throw error;
      toast.success("Datenquelle gelöscht");
      await loadDataSources();
    } catch (error: unknown) {
      toast.error("Fehler beim Löschen");
      console.error(error);
    }
  };

  const handleRemoveProject = (projectId: string) => {
    setSelectedProjects((current) => current.filter((id) => id !== projectId));
  };

  const handleAddHeader = () => {
    setFormData((prev) => ({
      ...prev,
      headers: [...prev.headers, createHeaderField()],
    }));
  };

  const handleHeaderChange = (id: string, field: 'key' | 'value', value: string) => {
    setFormData((prev) => ({
      ...prev,
      headers: prev.headers.map((header) =>
        header.id === id ? { ...header, [field]: value } : header
      ),
    }));
  };

  const handleRemoveHeaderField = (id: string) => {
    setFormData((prev) => {
      const remaining = prev.headers.filter((header) => header.id !== id);
      return {
        ...prev,
        headers: remaining.length > 0 ? remaining : [createHeaderField()],
      };
    });
  };

  useEffect(() => {
    if (formData.is_global) {
      setSelectedProjects([]);
    }
  }, [formData.is_global]);

  if (loaderVisible) {
    return (
      <div className="app-shell flex min-h-screen items-center justify-center p-6">
        <DataFlowLoader size="lg" />
      </div>
    );
  }

  return (
    <div className="app-shell flex min-h-screen flex-col p-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="app-surface flex items-center justify-between rounded-3xl px-6 py-5">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/dashboard")}
              className="rounded-full border border-border/60"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-foreground/5">
                <Plug className="h-6 w-6 text-foreground" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-foreground">Datenquellen</h1>
                <p className="text-sm text-muted-foreground">Verwalte die Systeme, die du anbindest.</p>
              </div>
            </div>
          </div>
          <Button
            type="button"
            onClick={() => handleOpenDialog()}
            className="rounded-full px-5 py-2"
          >
            + Datenquelle
          </Button>
        </div>

        <div className="app-surface rounded-3xl p-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {dataSources.map((source) => {
              const SourceIcon = getSourceIcon(source.source_type);
              const availabilityText = source.is_global
                ? "Global"
                : source.assigned_projects && source.assigned_projects.length > 0
                ? `${source.assigned_projects.length} ${source.assigned_projects.length === 1 ? "Projekt" : "Projekte"}`
                : "Kein Zugriff";
              return (
                <Card key={source.id} className="app-subtle border border-border/50">
                  <CardHeader className="flex flex-row items-center gap-4 pb-3">
                    <div className="flex-shrink-0">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border/50 bg-foreground/5">
                        <SourceIcon className="h-6 w-6 text-foreground" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-lg text-foreground">{source.name}</CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">{source.source_type}</p>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleOpenDialog(source)}
                        className="rounded-full hover:bg-foreground/5"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(source.id)}
                        className="rounded-full text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="ml-16 space-y-3 text-sm">
                      {source.api_url && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Link2 className="h-4 w-4" />
                          <span className="truncate">{source.api_url}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <ShieldCheck className="h-4 w-4" />
                        <span>Auth: {source.auth_type}</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Globe2 className="h-4 w-4" />
                        <span>{availabilityText}</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Power className={`h-4 w-4 ${source.is_active ? "text-success" : ""}`} />
                        <span className={source.is_active ? "text-success" : "text-muted-foreground"}>
                          {source.is_active ? "Aktiv" : "Inaktiv"}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {dataSources.length === 0 && (
              <div className="app-subtle col-span-full flex flex-col items-center justify-center gap-4 rounded-2xl px-10 py-16 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-foreground/5">
                  <Sparkles className="h-6 w-6 text-foreground" />
                </div>
                <p className="text-muted-foreground">Noch keine Datenquellen vorhanden</p>
                <Button
                  type="button"
                  onClick={() => handleOpenDialog()}
                  variant="outline"
                  className="rounded-full px-5"
                >
                  + Datenquelle
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingSource ? "Datenquelle bearbeiten" : "Neue Datenquelle"}
            </DialogTitle>
            <DialogDescription>
              Schritt {currentStep + 1} von {totalSteps}: {DATA_SOURCE_WIZARD_STEPS[currentStep]?.description}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-2">
            <WizardSteps steps={DATA_SOURCE_WIZARD_STEPS} currentStep={currentStep} />
            <div className="space-y-6">
              {currentStep === 0 && (
                <div className="space-y-6">
                  <Alert className="border-border/50 bg-muted/40">
                    <AlertTitle>Grunddaten klar benennen</AlertTitle>
                    <AlertDescription className="space-y-2 text-sm text-muted-foreground">
                      <p>Vergeben Sie einen eindeutigen Namen, der System und Umgebung widerspiegelt (z. B. „Salesforce PROD“).</p>
                      <p>Prüfen Sie, ob die angegebene URL ohne VPN erreichbar ist oder zusätzliche Infrastruktur benötigt.</p>
                    </AlertDescription>
                  </Alert>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="name">Name</Label>
                        <InfoTooltip
                          content={
                            <div className="space-y-1">
                              <p>Nutzen Sie eine sprechende Bezeichnung inkl. System, Mandant oder Region.</p>
                              <p>Dies erleichtert das Auffinden in der Projektübersicht.</p>
                            </div>
                          }
                        />
                      </div>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="source_type">Typ</Label>
                        <InfoTooltip
                          content={
                            <div className="space-y-1">
                              <p>Wählen Sie das System oder Protokoll, das am besten passt.</p>
                              <p>Fehlt ein Typ, nutzen Sie den generischen Eintrag „custom“.</p>
                            </div>
                          }
                        />
                      </div>
                      <Select
                        value={formData.source_type}
                        onValueChange={(value) => setFormData({ ...formData, source_type: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Quelle auswählen" />
                        </SelectTrigger>
                        <SelectContent>
                          {sourceTypeOptions.map((type) => (
                            <SelectItem key={type} value={type}>
                              {type}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="api_url">API URL</Label>
                      <InfoTooltip
                        content={
                          <div className="space-y-1">
                            <p>Tragen Sie die vollständige Basis-URL inklusive Protokoll ein.</p>
                            <p>Bei Subpfaden (z. B. /api/v1) bitte den gesamten Pfad ergänzen.</p>
                          </div>
                        }
                      />
                    </div>
                    <Input
                      id="api_url"
                      value={formData.api_url}
                      onChange={(e) => setFormData({ ...formData, api_url: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">Beispiel: https://api.system.de/v1</p>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Aktiv</Label>
                      <div className="flex items-center justify-between rounded-2xl border border-border/50 px-3 py-2">
                        <span className="text-sm text-muted-foreground">Connector aktiv</span>
                        <Switch
                          checked={formData.is_active}
                          onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Global verfügbar</Label>
                      <div className="flex items-center justify-between rounded-2xl border border-border/50 px-3 py-2">
                        <span className="text-sm text-muted-foreground">Für alle Projekte verfügbar</span>
                        <Switch
                          checked={formData.is_global}
                          onCheckedChange={(checked) => setFormData({ ...formData, is_global: checked })}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {currentStep === 1 && (
                <div className="space-y-6">
                  <Alert className="border-border/50 bg-muted/40">
                    <AlertTitle>Zugänge nachvollziehbar dokumentieren</AlertTitle>
                    <AlertDescription className="space-y-2 text-sm text-muted-foreground">
                      <p>Notieren Sie, welche Credentials produktiv genutzt werden dürfen und wer sie verwaltet.</p>
                      <p>Vermerken Sie Rotationszyklen oder Ablaufdaten direkt in den Notizen.</p>
                    </AlertDescription>
                  </Alert>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="auth-type">Authentifizierung</Label>
                      <InfoTooltip
                        content={
                          <div className="space-y-1">
                            <p>Wählen Sie das Verfahren, das die Datenquelle erwartet.</p>
                            <p>Die Maske blendet automatisch die benötigten Felder ein.</p>
                          </div>
                        }
                      />
                    </div>
                    <Select
                      value={formData.auth_type}
                      onValueChange={(value) => setFormData({ ...formData, auth_type: value })}
                    >
                      <SelectTrigger id="auth-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="api_key">API Key</SelectItem>
                        <SelectItem value="basic">Basic Auth</SelectItem>
                        <SelectItem value="oauth2">OAuth2</SelectItem>
                        <SelectItem value="custom">Custom (Keycloak)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="api_key">API Key</Label>
                        <InfoTooltip
                          content={
                            <div className="space-y-1">
                              <p>Geben Sie den Key exakt so ein, wie er vom Provider geliefert wurde.</p>
                              <p>Falls der Key nur temporär gültig ist, ergänzen Sie das Ablaufdatum.</p>
                            </div>
                          }
                        />
                      </div>
                      <Input
                        id="api_key"
                        value={formData.api_key}
                        onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="username">Benutzername</Label>
                      <Input
                        id="username"
                        value={formData.username}
                        onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2 lg:col-span-1">
                      <Label htmlFor="password">Passwort</Label>
                      <Input
                        id="password"
                        type="password"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      />
                    </div>
                  </div>

                  {formData.auth_type === "oauth2" && (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="client-id">Client ID</Label>
                        <Input
                          id="client-id"
                          value={formData.clientId}
                          onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="client-secret">Client Secret</Label>
                        <Input
                          id="client-secret"
                          type="password"
                          value={formData.clientSecret}
                          onChange={(e) => setFormData({ ...formData, clientSecret: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="auth-url">Authorization URL</Label>
                        <Input
                          id="auth-url"
                          value={formData.authUrl}
                          onChange={(e) => setFormData({ ...formData, authUrl: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="token-url">Token URL</Label>
                        <Input
                          id="token-url"
                          value={formData.tokenUrl}
                          onChange={(e) => setFormData({ ...formData, tokenUrl: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="scope">Scope</Label>
                        <Input
                          id="scope"
                          value={formData.scope}
                          onChange={(e) => setFormData({ ...formData, scope: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="redirect-uri">Redirect URI</Label>
                        <Input
                          id="redirect-uri"
                          value={formData.redirectUri}
                          onChange={(e) => setFormData({ ...formData, redirectUri: e.target.value })}
                        />
                      </div>
                    </div>
                  )}

                  {formData.auth_type === "custom" && (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="realm">Realm</Label>
                        <Input
                          id="realm"
                          value={formData.realm}
                          onChange={(e) => setFormData({ ...formData, realm: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="issuer">Issuer URL</Label>
                        <Input
                          id="issuer"
                          value={formData.issuer}
                          onChange={(e) => setFormData({ ...formData, issuer: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="custom-client-id">Client ID</Label>
                        <Input
                          id="custom-client-id"
                          value={formData.clientId}
                          onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="custom-client-secret">Client Secret</Label>
                        <Input
                          id="custom-client-secret"
                          type="password"
                          value={formData.clientSecret}
                          onChange={(e) => setFormData({ ...formData, clientSecret: e.target.value })}
                        />
                      </div>
                    </div>
                  )}

                  <div className="space-y-4 rounded-2xl border border-border/50 p-4">
                    <h3 className="text-sm font-semibold text-foreground">🧱 Infrastruktur</h3>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">SSL-Verifizierung aktiv</span>
                      <Switch
                        checked={formData.sslVerification}
                        onCheckedChange={(checked) => setFormData({ ...formData, sslVerification: checked })}
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="proxy-host">Proxy Host</Label>
                        <Input
                          id="proxy-host"
                          value={formData.proxyHost}
                          onChange={(e) => setFormData({ ...formData, proxyHost: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="proxy-port">Proxy Port</Label>
                        <Input
                          id="proxy-port"
                          value={formData.proxyPort}
                          onChange={(e) => setFormData({ ...formData, proxyPort: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="vpn-settings">VPN / Tunnel</Label>
                        <Input
                          id="vpn-settings"
                          placeholder="Konfigurationshinweise"
                          value={formData.vpnSettings}
                          onChange={(e) => setFormData({ ...formData, vpnSettings: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {currentStep === 2 && (
                <div className="space-y-6">
                  <Alert className="border-border/50 bg-muted/40">
                    <AlertTitle>Datenfluss transparent beschreiben</AlertTitle>
                    <AlertDescription className="space-y-2 text-sm text-muted-foreground">
                      <p>Notieren Sie zu jedem Endpunkt Zweck, Pflichtparameter und Antwortstruktur.</p>
                      <p>Beispiele helfen Teams, Payloads ohne zusätzliche Abstimmung zu testen.</p>
                    </AlertDescription>
                  </Alert>
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-foreground">🌐 Endpunkte & Operationen</h3>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Label htmlFor="list-endpoint">Listen-Endpunkt</Label>
                          <InfoTooltip
                            content={
                              <div className="space-y-1">
                                <p>Pfad zum Abruf mehrerer Objekte.</p>
                                <p>Optionale Filter können unten beschrieben werden.</p>
                              </div>
                            }
                          />
                        </div>
                        <Input
                          id="list-endpoint"
                          value={formData.listEndpoint}
                          onChange={(e) => setFormData({ ...formData, listEndpoint: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="detail-endpoint">Detail-Endpunkt</Label>
                        <Input
                          id="detail-endpoint"
                          value={formData.detailEndpoint}
                          onChange={(e) => setFormData({ ...formData, detailEndpoint: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="create-endpoint">Create-Endpunkt</Label>
                        <Input
                          id="create-endpoint"
                          value={formData.createEndpoint}
                          onChange={(e) => setFormData({ ...formData, createEndpoint: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="update-endpoint">Update-Endpunkt</Label>
                        <Input
                          id="update-endpoint"
                          value={formData.updateEndpoint}
                          onChange={(e) => setFormData({ ...formData, updateEndpoint: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="delete-endpoint">Delete-Endpunkt</Label>
                        <Input
                          id="delete-endpoint"
                          value={formData.deleteEndpoint}
                          onChange={(e) => setFormData({ ...formData, deleteEndpoint: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="healthcheck-endpoint">Healthcheck-Endpunkt</Label>
                        <Input
                          id="healthcheck-endpoint"
                          value={formData.healthcheckEndpoint}
                          onChange={(e) => setFormData({ ...formData, healthcheckEndpoint: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Label htmlFor="write-method">Write-Methode</Label>
                          <InfoTooltip
                            content={
                              <div className="space-y-1">
                                <p>Definiert die HTTP-Methode für schreibende Operationen.</p>
                                <p>Nur angeben, wenn die Datenquelle Änderungen zulässt.</p>
                              </div>
                            }
                          />
                        </div>
                        <Select
                          value={formData.writeHttpMethod}
                          onValueChange={(value) => setFormData({ ...formData, writeHttpMethod: value })}
                        >
                          <SelectTrigger id="write-method">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="POST">POST</SelectItem>
                            <SelectItem value="PUT">PUT</SelectItem>
                            <SelectItem value="PATCH">PATCH</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="request-timeout">Request Timeout (Sekunden)</Label>
                        <Input
                          id="request-timeout"
                          value={formData.requestTimeout}
                          onChange={(e) => setFormData({ ...formData, requestTimeout: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="success-codes">Erfolgsstatus-Codes</Label>
                        <InfoTooltip
                          content={
                            <div className="space-y-1">
                              <p>Kommagetrennte Liste der HTTP-Codes, die als erfolgreich gelten.</p>
                              <p>Nutzen Sie nur Codes, die keinen erneuten Versuch auslösen.</p>
                            </div>
                          }
                        />
                      </div>
                      <Input
                        id="success-codes"
                        placeholder="200,201"
                        value={formData.successStatusCodes}
                        onChange={(e) => setFormData({ ...formData, successStatusCodes: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="identifier-field">Identifier Feld</Label>
                      <Input
                        id="identifier-field"
                        value={formData.identifierField}
                        onChange={(e) => setFormData({ ...formData, identifierField: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="request-payload">Request Payload Vorlage</Label>
                      <InfoTooltip
                        content={
                          <div className="space-y-1">
                            <p>Nutzen Sie Platzhalter ({'{{source.field}}'}) für dynamische Werte.</p>
                            <p>Dokumentieren Sie Pflichtfelder und Formatvorgaben.</p>
                          </div>
                        }
                      />
                    </div>
                    <Textarea
                      id="request-payload"
                      className="min-h-[80px]"
                      value={formData.requestPayloadTemplate}
                      onChange={(e) => setFormData({ ...formData, requestPayloadTemplate: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="response-sample">Beispiel Response</Label>
                      <InfoTooltip
                        content={
                          <div className="space-y-1">
                            <p>Hinterlegen Sie eine repräsentative Antwort inklusive Status- und Datenfelder.</p>
                            <p>Kennzeichnen Sie optionale Felder mit Kommentaren oder Beispieldaten.</p>
                          </div>
                        }
                      />
                    </div>
                    <Textarea
                      id="response-sample"
                      className="min-h-[80px]"
                      value={formData.responseSample}
                      onChange={(e) => setFormData({ ...formData, responseSample: e.target.value })}
                    />
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-foreground">🧾 Header & Datenformat</h3>
                    <div className="space-y-3">
                      {formData.headers.map((header) => (
                        <div key={header.id} className="grid grid-cols-[1fr_1fr_auto] items-center gap-3">
                          <Input
                            placeholder="Header Name"
                            value={header.key}
                            onChange={(e) => handleHeaderChange(header.id, "key", e.target.value)}
                          />
                          <Input
                            placeholder="Header Wert"
                            value={header.value}
                            onChange={(e) => handleHeaderChange(header.id, "value", e.target.value)}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveHeaderField(header.id)}
                            className="text-destructive hover:text-destructive"
                            aria-label="Header entfernen"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      <Button type="button" variant="outline" onClick={handleAddHeader} className="w-full justify-center">
                        <Plus className="mr-2 h-4 w-4" /> Header hinzufügen
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="date-format">Datumsformat</Label>
                        <Input
                          id="date-format"
                          value={formData.dateFormat}
                          onChange={(e) => setFormData({ ...formData, dateFormat: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="timezone">Zeitzone</Label>
                        <Input
                          id="timezone"
                          value={formData.timezone}
                          onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {currentStep === 3 && (
                <div className="space-y-6">
                  <Alert className="border-border/50 bg-muted/40">
                    <AlertTitle>Automatisierung präzise planen</AlertTitle>
                    <AlertDescription className="space-y-2 text-sm text-muted-foreground">
                      <p>Dokumentieren Sie, wie Paginierung, Delta-Updates und Limits zusammenspielen.</p>
                      <p>So lassen sich Laufzeiten und Ressourcen frühzeitig abschätzen.</p>
                    </AlertDescription>
                  </Alert>
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-foreground">🔁 Pagination & Delta</h3>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <div className="space-y-2 md:col-span-1">
                        <div className="flex items-center gap-2">
                          <Label htmlFor="pagination-strategy">Paginierungsstrategie</Label>
                          <InfoTooltip
                            content={
                              <div className="space-y-1">
                                <p>Steuert, wie weitere Seiten geladen werden.</p>
                                <p>Cursor-basierte APIs benötigen unten zusätzliche Parameter.</p>
                              </div>
                            }
                          />
                        </div>
                        <Select
                          value={formData.paginationStrategy}
                          onValueChange={(value) =>
                            setFormData({ ...formData, paginationStrategy: value as PaginationStrategy })
                          }
                        >
                          <SelectTrigger id="pagination-strategy">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Keine</SelectItem>
                            <SelectItem value="offset">Offset</SelectItem>
                            <SelectItem value="page">Seitenbasiert</SelectItem>
                            <SelectItem value="cursor">Cursor</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="page-size">Page Size</Label>
                        <Input
                          id="page-size"
                          value={formData.pageSize}
                          onChange={(e) => setFormData({ ...formData, pageSize: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="page-param">Page Parameter</Label>
                        <Input
                          id="page-param"
                          value={formData.pageParam}
                          onChange={(e) => setFormData({ ...formData, pageParam: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="limit-param">Limit Parameter</Label>
                        <Input
                          id="limit-param"
                          value={formData.limitParam}
                          onChange={(e) => setFormData({ ...formData, limitParam: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="cursor-param">Cursor Parameter</Label>
                        <Input
                          id="cursor-param"
                          value={formData.cursorParam}
                          onChange={(e) => setFormData({ ...formData, cursorParam: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="cursor-path">Cursor Pfad</Label>
                        <Input
                          id="cursor-path"
                          value={formData.cursorPath}
                          onChange={(e) => setFormData({ ...formData, cursorPath: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="filter-template">Standard-Filter</Label>
                        <InfoTooltip
                          content={
                            <div className="space-y-1">
                              <p>Beschreiben Sie Default-Query-Parameter inklusive Beispielwerten.</p>
                              <p>Nutzen Sie & zum Verknüpfen mehrerer Parameter.</p>
                            </div>
                          }
                        />
                      </div>
                      <Textarea
                        id="filter-template"
                        className="min-h-[70px]"
                        value={formData.filterTemplate}
                        onChange={(e) => setFormData({ ...formData, filterTemplate: e.target.value })}
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="delta-field">Delta Feld</Label>
                        <Input
                          id="delta-field"
                          value={formData.deltaField}
                          onChange={(e) => setFormData({ ...formData, deltaField: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Label htmlFor="delta-strategy">Delta Strategie</Label>
                          <InfoTooltip
                            content={
                              <div className="space-y-1">
                                <p>Legt fest, wie Änderungen erkannt werden (z. B. Timestamp oder ID).</p>
                                <p>Stimmen Sie die Strategie mit den verfügbaren Feldern ab.</p>
                              </div>
                            }
                          />
                        </div>
                        <Select
                          value={formData.deltaStrategy}
                          onValueChange={(value) =>
                            setFormData({ ...formData, deltaStrategy: value as DeltaStrategy })
                          }
                        >
                          <SelectTrigger id="delta-strategy">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="timestamp">Zeitstempel</SelectItem>
                            <SelectItem value="incremental">Fortlaufende ID</SelectItem>
                            <SelectItem value="cursor">Cursor</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="delta-initial">Initialer Wert</Label>
                        <Input
                          id="delta-initial"
                          value={formData.deltaInitialValue}
                          onChange={(e) => setFormData({ ...formData, deltaInitialValue: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-foreground">⚙️ Limits & Ausführung</h3>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Label htmlFor="rpm">Requests pro Minute</Label>
                          <InfoTooltip
                            content={
                              <div className="space-y-1">
                                <p>Maximale Anzahl von Aufrufen pro Minute laut Anbieter.</p>
                                <p>Planen Sie eine Reserve ein, um Rate-Limits zu vermeiden.</p>
                              </div>
                            }
                          />
                        </div>
                        <Input
                          id="rpm"
                          value={formData.requestsPerMinute}
                          onChange={(e) => setFormData({ ...formData, requestsPerMinute: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="concurrency">Parallele Requests</Label>
                        <Input
                          id="concurrency"
                          value={formData.concurrencyLimit}
                          onChange={(e) => setFormData({ ...formData, concurrencyLimit: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="retry-header">Retry-After Header</Label>
                        <Input
                          id="retry-header"
                          value={formData.retryAfterHeader}
                          onChange={(e) => setFormData({ ...formData, retryAfterHeader: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="batch-size">Batchgröße</Label>
                        <Input
                          id="batch-size"
                          value={formData.batchSize}
                          onChange={(e) => setFormData({ ...formData, batchSize: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="max-objects">Max. Objekte pro Lauf</Label>
                        <Input
                          id="max-objects"
                          value={formData.maxObjectsPerRun}
                          onChange={(e) => setFormData({ ...formData, maxObjectsPerRun: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Label htmlFor="poll-interval">Poll-Intervall (Minuten)</Label>
                          <InfoTooltip
                            content={
                              <div className="space-y-1">
                                <p>Bestimmt, wie häufig neue Daten abgefragt werden.</p>
                                <p>Berücksichtigen Sie SLAs und Lastspitzen.</p>
                              </div>
                            }
                          />
                        </div>
                        <Input
                          id="poll-interval"
                          value={formData.pollIntervalMinutes}
                          onChange={(e) => setFormData({ ...formData, pollIntervalMinutes: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="cron-schedule">Cron-Ausdruck</Label>
                        <Input
                          id="cron-schedule"
                          value={formData.cronSchedule}
                          onChange={(e) => setFormData({ ...formData, cronSchedule: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="notes">Notizen & Besonderheiten</Label>
                        <InfoTooltip
                          content={
                            <div className="space-y-1">
                              <p>Halten Sie Abhängigkeiten, Ansprechpartner und manuelle Schritte fest.</p>
                              <p>Diese Informationen helfen beim Onboarding weiterer Teams.</p>
                            </div>
                          }
                        />
                      </div>
                      <Textarea
                        id="notes"
                        className="min-h-[80px]"
                        value={formData.notes}
                        onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      />
                    </div>
                  </div>

                  {!formData.is_global && (
                    <div className="space-y-2">
                      <Label>Projekte</Label>
                      <div className="rounded-2xl border border-border/50 p-4">
                        <Select
                          value=""
                          onValueChange={(value) => {
                            if (value && !selectedProjects.includes(value)) {
                              setSelectedProjects((current) => [...current, value]);
                            }
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Projekt auswählen" />
                          </SelectTrigger>
                          <SelectContent>
                            {projects.map((project) => (
                              <SelectItem key={project.id} value={project.id}>
                                {project.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {selectedProjects.map((projectId) => {
                            const project = projects.find((p) => p.id === projectId);
                            return (
                              <button
                                key={projectId}
                                type="button"
                                onClick={() => handleRemoveProject(projectId)}
                                className="flex items-center gap-1 rounded-full border border-border/50 px-3 py-1 text-xs text-muted-foreground transition hover:bg-foreground/5"
                                aria-label={`${project?.name ?? projectId} entfernen`}
                              >
                                <span>{project?.name || projectId}</span>
                                <Trash2 className="h-3 w-3" />
                              </button>
                            );
                          })}
                          {selectedProjects.length === 0 && (
                            <span className="text-sm text-muted-foreground">Noch keine Projekte zugewiesen</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <Button
              variant="ghost"
              onClick={() => handleDialogOpenChange(false)}
              className="order-2 rounded-full sm:order-1"
            >
              Abbrechen
            </Button>
            <div className="flex w-full items-center justify-end gap-2 sm:order-2 sm:w-auto">
              <Button
                variant="outline"
                onClick={handlePreviousStep}
                disabled={currentStep === 0}
                className="rounded-full"
              >
                Zurück
              </Button>
              {isLastStep ? (
                <Button onClick={handleSave} className="rounded-full px-5">
                  Speichern
                </Button>
              ) : (
                <Button onClick={handleNextStep} className="rounded-full px-5">
                  Weiter
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DataSources;
