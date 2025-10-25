import { Database, Settings as SettingsIcon, Trash2, Check, Link, Download, RefreshCw, Loader2, Upload, ArrowLeftRight, Workflow, Plus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import CircularProgress from "./CircularProgress";
import ActivityTimeline, { Activity } from "./ActivityTimeline";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import TestConnectionDialog from "./dialogs/TestConnectionDialog";
import { FieldMapper } from "./FieldMapper";
import { getSystemObjectOptions } from "@/lib/schema-registry";
import { applyMappingsToRecord, buildSampleRecordFromMappings } from "@/lib/migration-pipeline";
import { loadMappingsFromDatabase, loadAllMappingsForSource } from "@/lib/mapping-storage";
import type { FieldMapping } from "@/types/mapping";
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

interface MigrationProject {
  id: string;
  name: string;
  progress: number;
  sourceSystem: string;
  targetSystem: string;
  inConnector: string;
  inConnectorDetail: string;
  outConnector: string;
  outConnectorDetail: string;
  objectsTransferred: string;
  mappedObjects: string;
  projectId?: string;
  activities: Activity[];
  connectors?: {
    in?: any;
    out?: any;
  };
}

interface MigrationDetailsProps {
  project: MigrationProject;
  activeTab: "general" | "mapping";
  onRefresh: () => Promise<void>;
}

type ConnectorFormData = {
  apiUrl: string;
  apiKey: string;
  username: string;
  password: string;
  endpoint: string;
  authType: string;
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
  pollIntervalMinutes: string;
  cronSchedule: string;
  requestsPerMinute: string;
  concurrencyLimit: string;
  retryAfterHeader: string;
  requestTimeout: string;
  batchSize: string;
  maxObjectsPerRun: string;
  notes: string;
};

const createInitialConnectorFormData = (): ConnectorFormData => ({
  apiUrl: '',
  apiKey: '',
  username: '',
  password: '',
  endpoint: '',
  authType: 'api_key',
  clientId: '',
  clientSecret: '',
  authUrl: '',
  tokenUrl: '',
  scope: '',
  redirectUri: '',
  realm: '',
  issuer: '',
  sslVerification: true,
  proxyHost: '',
  proxyPort: '',
  vpnSettings: '',
  headers: [createHeaderField()],
  listEndpoint: '',
  detailEndpoint: '',
  createEndpoint: '',
  updateEndpoint: '',
  deleteEndpoint: '',
  healthcheckEndpoint: '',
  writeHttpMethod: 'POST',
  requestPayloadTemplate: '',
  responseSample: '',
  successStatusCodes: '',
  paginationStrategy: 'none',
  pageSize: '',
  pageParam: '',
  limitParam: '',
  cursorParam: '',
  cursorPath: '',
  filterTemplate: '',
  deltaField: '',
  deltaInitialValue: '',
  deltaStrategy: 'timestamp',
  identifierField: '',
  dateFormat: '',
  timezone: '',
  pollIntervalMinutes: '',
  cronSchedule: '',
  requestsPerMinute: '',
  concurrencyLimit: '',
  retryAfterHeader: '',
  requestTimeout: '',
  batchSize: '',
  maxObjectsPerRun: '',
  notes: '',
});

const buildConnectorFormData = (connector?: any): ConnectorFormData => {
  const base = createInitialConnectorFormData();
  if (!connector) return base;

  const config = connector.additional_config || {};
  const endpoints = config.endpoints || {};
  const operations = config.operations || {};
  const pagination = config.pagination || {};
  const filtering = config.filtering || {};
  const rateLimiting = config.rate_limiting || {};
  const batching = config.batching || {};
  const scheduling = config.scheduling || {};
  const dataFormat = config.data_format || {};
  const identifiers = config.identifiers || {};

  return {
    ...base,
    apiUrl: connector.api_url || '',
    apiKey: connector.api_key || '',
    username: connector.username || '',
    password: connector.password || '',
    endpoint: connector.endpoint || endpoints.list || '',
    authType: connector.auth_type || 'api_key',
    clientId: config.client_id || '',
    clientSecret: config.client_secret || '',
    authUrl: config.auth_url || '',
    tokenUrl: config.token_url || '',
    scope: config.scope || '',
    redirectUri: config.redirect_uri || '',
    realm: config.realm || '',
    issuer: config.issuer || '',
    sslVerification: config.ssl_verification ?? true,
    proxyHost: config.proxy_host || '',
    proxyPort: config.proxy_port || '',
    vpnSettings: config.vpn_settings || '',
    headers: mapHeadersToFields(config.headers),
    listEndpoint: endpoints.list || '',
    detailEndpoint: endpoints.detail || '',
    createEndpoint: endpoints.create || '',
    updateEndpoint: endpoints.update || '',
    deleteEndpoint: endpoints.delete || '',
    healthcheckEndpoint: endpoints.healthcheck || '',
    writeHttpMethod: operations.write_method || 'POST',
    requestPayloadTemplate: operations.payload_template || '',
    responseSample: operations.response_sample || '',
    successStatusCodes: successCodesToString(operations.success_status_codes),
    paginationStrategy: pagination.strategy || 'none',
    pageSize: pagination.page_size ? String(pagination.page_size) : '',
    pageParam: pagination.page_param || '',
    limitParam: pagination.limit_param || '',
    cursorParam: pagination.cursor_param || '',
    cursorPath: pagination.cursor_path || '',
    filterTemplate: filtering.default_params || '',
    deltaField: filtering.delta_field || '',
    deltaInitialValue: filtering.initial_value || '',
    deltaStrategy: filtering.delta_strategy || 'timestamp',
    identifierField: identifiers.primary_key || '',
    dateFormat: dataFormat.date_format || '',
    timezone: dataFormat.timezone || '',
    pollIntervalMinutes: scheduling.poll_interval_minutes ? String(scheduling.poll_interval_minutes) : '',
    cronSchedule: scheduling.cron || '',
    requestsPerMinute: rateLimiting.requests_per_minute ? String(rateLimiting.requests_per_minute) : '',
    concurrencyLimit: rateLimiting.concurrent_requests ? String(rateLimiting.concurrent_requests) : '',
    retryAfterHeader: rateLimiting.retry_after_header || '',
    requestTimeout: operations.request_timeout ? String(operations.request_timeout) : '',
    batchSize: batching.batch_size ? String(batching.batch_size) : '',
    maxObjectsPerRun: batching.max_objects_per_run ? String(batching.max_objects_per_run) : '',
    notes: config.notes || '',
  };
};

const MigrationDetails = ({ project, activeTab, onRefresh }: MigrationDetailsProps) => {
  const [isConfigDialogOpen, setIsConfigDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isTestDialogOpen, setIsTestDialogOpen] = useState(false);
  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
  const [deleteType, setDeleteType] = useState<'in' | 'out'>('in');
  const [configType, setConfigType] = useState<'in' | 'out'>('in');
  const [testType, setTestType] = useState<'in' | 'out'>('in');
  const [linkType, setLinkType] = useState<'in' | 'out'>('in');
  const [dataSources, setDataSources] = useState<any[]>([]);
  const [selectedDataSourceId, setSelectedDataSourceId] = useState<string>('');
  const [isMetaModelApproved, setIsMetaModelApproved] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [hasImported, setHasImported] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [hasExported, setHasExported] = useState(false);
  const [exportProgressVisual, setExportProgressVisual] = useState(0);
  const [isValidating, setIsValidating] = useState(false);
  const [hasValidated, setHasValidated] = useState(false);
  const [selectedSourceObject, setSelectedSourceObject] = useState<string>('');
  const [selectedTargetObject, setSelectedTargetObject] = useState<string>('');
  const [formData, setFormData] = useState<ConnectorFormData>(() => createInitialConnectorFormData());

  const hasInConnector = !!project.connectors?.in;
  const hasOutConnector = !!project.connectors?.out;

  const loadActiveMappings = useCallback(async (): Promise<FieldMapping[]> => {
    if (!selectedSourceObject || !selectedTargetObject) {
      return [];
    }

    return await loadMappingsFromDatabase(project.id, selectedSourceObject, selectedTargetObject);
  }, [project.id, selectedSourceObject, selectedTargetObject]);

  // Load meta model approval status from database
  useEffect(() => {
    const loadMetaModelStatus = async () => {
      const { data, error } = await supabase
        .from('migrations')
        .select('meta_model_approved')
        .eq('id', project.id)
        .single();
      
      if (!error && data) {
        setIsMetaModelApproved(data.meta_model_approved);
      }
    };

    loadMetaModelStatus();
  }, [project.id]);

  // Sync objects_transferred with mapped_objects if needed
  useEffect(() => {
    const syncObjectCounts = async () => {
      // Check if objects_transferred is "0/0" but mapped_objects has a value
      if (project.objectsTransferred === "0/0" && 
          project.mappedObjects && 
          project.mappedObjects !== "0/0") {
        const { error } = await supabase
          .from('migrations')
          .update({ objects_transferred: project.mappedObjects })
          .eq('id', project.id);
        
        if (!error) {
          await onRefresh();
        }
      }
    };

    syncObjectCounts();
  }, [project.id, project.objectsTransferred, project.mappedObjects]);

  // Check if import was already completed
  useEffect(() => {
    const [transferredStr, totalStr] = project.objectsTransferred.split('/');
    const transferredCount = parseInt(transferredStr) || 0;
    const totalCount = parseInt(totalStr) || 0;
    const hasImportActivity = project.activities?.some((activity) =>
      activity.title?.includes('Import abgeschlossen')
    ) ?? false;

    const importCompleted = (totalCount > 0 && transferredCount >= totalCount) || hasImportActivity;
    setHasImported(importCompleted);
  }, [project.objectsTransferred, project.activities]);

  useEffect(() => {
    const hasExportActivity = project.activities?.some((activity) =>
      activity.title?.includes('Export abgeschlossen')
    ) ?? false;
    setHasExported(hasExportActivity);
  }, [project.activities]);

  useEffect(() => {
    if (hasExported) {
      setExportProgressVisual(1);
      return;
    }

    if (isExporting) {
      const start = Date.now();
      const duration = 2000; // Match simulated export duration
      let animationFrame: number;

      const animate = () => {
        const progress = Math.min((Date.now() - start) / duration, 1);
        setExportProgressVisual(progress);

        if (progress < 1 && isExporting) {
          animationFrame = requestAnimationFrame(animate);
        }
      };

      animationFrame = requestAnimationFrame(animate);

      return () => {
        if (animationFrame) {
          cancelAnimationFrame(animationFrame);
        }
      };
    }

    setExportProgressVisual(0);
  }, [isExporting, hasExported]);


  // Fetch available data sources for linking
  useEffect(() => {
    const fetchDataSources = async () => {
      if (!project.projectId) {
        // If no project ID, only show global data sources
        const { data, error } = await supabase
          .from('data_sources')
          .select('*')
          .eq('is_active', true)
          .eq('is_global', true);
        
        if (!error && data) {
          setDataSources(data);
        }
        return;
      }

      // Load data sources that are either global or assigned to this project
      const { data: globalSources, error: globalError } = await supabase
        .from('data_sources')
        .select('*')
        .eq('is_active', true)
        .eq('is_global', true);

      const { data: projectAssignments, error: assignmentError } = await supabase
        .from('data_source_projects')
        .select('data_source_id')
        .eq('project_id', project.projectId);

      if (globalError || assignmentError) {
        console.error('Error loading data sources:', globalError || assignmentError);
        return;
      }

      const assignedSourceIds = projectAssignments?.map(a => a.data_source_id) || [];
      
      if (assignedSourceIds.length > 0) {
        const { data: assignedSources, error: assignedError } = await supabase
          .from('data_sources')
          .select('*')
          .eq('is_active', true)
          .in('id', assignedSourceIds);

        if (!assignedError) {
          // Combine global and assigned sources, remove duplicates
          const allSources = [...(globalSources || []), ...(assignedSources || [])];
          const uniqueSources = Array.from(
            new Map(allSources.map(s => [s.id, s])).values()
          );
          setDataSources(uniqueSources);
        }
      } else {
        setDataSources(globalSources || []);
      }
    };

    fetchDataSources();
  }, [project.projectId]);

  // Filter data sources by connector type
  const getAvailableDataSources = (type: 'in' | 'out') => {
    const systemType = type === 'in' ? project.sourceSystem : project.targetSystem;
    return dataSources.filter(ds => ds.source_type === systemType);
  };

  // Load available objects for mapping
  const sourceObjects = useMemo(
    () => getSystemObjectOptions(project.sourceSystem),
    [project.sourceSystem]
  );
  const targetObjects = useMemo(
    () => getSystemObjectOptions(project.targetSystem),
    [project.targetSystem]
  );

  const handleEdit = (type: 'in' | 'out') => {
    // Check if inconnector is tested before allowing outconnector edit
    if (type === 'out' && !project.connectors?.in?.is_tested) {
      toast.error("Bitte erstellen und testen Sie zuerst den Inconnector");
      return;
    }
    
    setConfigType(type);
    
    // Load existing connector data if available
    const connector = type === 'in' ? project.connectors?.in : project.connectors?.out;
    setFormData(buildConnectorFormData(connector));

    setIsConfigDialogOpen(true);
  };

  const handleTest = (type: 'in' | 'out') => {
    setTestType(type);
    setIsTestDialogOpen(true);
  };

  const handleTestComplete = async () => {
    try {
      const connector = testType === 'in' ? project.connectors?.in : project.connectors?.out;
      if (!connector) return;

      // Check if connector was already tested
      const wasAlreadyTested = connector.is_tested;

      // Update connector to mark as tested
      const { error: updateError } = await supabase
        .from('connectors')
        .update({ is_tested: true })
        .eq('id', connector.id);

      if (updateError) throw updateError;

      // Only update migration progress by 2.5% if not already tested
      if (!wasAlreadyTested) {
        const newProgress = Math.min(project.progress + 2.5, 100);
        
        // If it's an inconnector test, also update mapped_objects and objects_transferred
        let updateData: any = { progress: newProgress };
        
        if (testType === 'in') {
          // Generate realistic number of objects found (50-200)
          const foundObjects = Math.floor(Math.random() * 151) + 50; // Random between 50 and 200
          updateData.mapped_objects = `0/${foundObjects}`;
          updateData.objects_transferred = `0/${foundObjects}`;
        }
        
        const { error: progressError } = await supabase
          .from('migrations')
          .update(updateData)
          .eq('id', project.id);

        if (progressError) throw progressError;
      }

      // Add system activity
      await supabase.from('migration_activities').insert({
        migration_id: project.id,
        type: 'system',
        title: `${testType === 'in' ? 'Inconnector' : 'Outconnector'} erfolgreich getestet`,
        timestamp: new Date().toLocaleString('de-DE'),
      });

      toast.success("Test erfolgreich abgeschlossen");
      await onRefresh();
    } catch (error: any) {
      toast.error("Fehler beim Test");
      console.error(error);
    }
  };

  const handleDeleteClick = (type: 'in' | 'out') => {
    setDeleteType(type);
    setIsDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    try {
      const connector = deleteType === 'in' ? project.connectors?.in : project.connectors?.out;
      
      // Calculate progress decrease based on whether it was tested
      const progressDecrease = connector?.is_tested ? 5 : 2.5;
      const newProgress = Math.max(project.progress - progressDecrease, 0);

      // Delete connector
      const { error } = await supabase
        .from('connectors')
        .delete()
        .eq('migration_id', project.id)
        .eq('connector_type', deleteType);

      if (error) throw error;

      // Update migration progress
      const { error: progressError } = await supabase
        .from('migrations')
        .update({ progress: newProgress })
        .eq('id', project.id);

      if (progressError) throw progressError;

      // Add system activity
      const { error: activityError } = await supabase.from('migration_activities').insert({
        migration_id: project.id,
        type: 'system',
        title: `${deleteType === 'in' ? 'Inconnector' : 'Outconnector'} gelöscht`,
        timestamp: new Date().toLocaleString('de-DE'),
      });

      if (activityError) {
        console.error('Error creating activity:', activityError);
      }

      toast.success(`${deleteType === 'in' ? 'Inconnector' : 'Outconnector'} gelöscht`);
      setIsDeleteDialogOpen(false);
      await onRefresh();
    } catch (error: any) {
      toast.error("Fehler beim Löschen");
      console.error(error);
    }
  };

  const handleLinkDataSource = (type: 'in' | 'out') => {
    // Check if inconnector is tested before allowing outconnector link
    if (type === 'out' && !project.connectors?.in?.is_tested) {
      toast.error("Bitte erstellen und testen Sie zuerst den Inconnector");
      return;
    }
    
    setLinkType(type);
    setSelectedDataSourceId('');
    setIsLinkDialogOpen(true);
  };

  const confirmLinkDataSource = async () => {
    try {
      const dataSource = dataSources.find(ds => ds.id === selectedDataSourceId);
      if (!dataSource) {
        toast.error("Keine Datenquelle ausgewählt");
        return;
      }

      const connector = linkType === 'in' ? project.connectors?.in : project.connectors?.out;
      const isCreating = !connector;
      const wasTested = connector?.is_tested || false;

      const additionalConfig = (pruneConfig(dataSource.additional_config) as Record<string, any>) || {};
      const derivedEndpoint =
        (additionalConfig?.endpoints?.list as string | undefined) ||
        (additionalConfig?.endpoint as string | undefined) ||
        undefined;

      const connectorData = {
        migration_id: project.id,
        connector_type: linkType,
        api_url: dataSource.api_url,
        api_key: dataSource.api_key,
        username: dataSource.username,
        password: dataSource.password,
        endpoint: derivedEndpoint,
        auth_type: dataSource.auth_type,
        additional_config: additionalConfig,
      };

      // Calculate progress change
      let progressChange = 0;
      if (isCreating) {
        progressChange = 2.5; // New connector
      } else if (wasTested) {
        progressChange = -5; // Editing a tested connector removes both config and test progress
      }

      if (connector) {
        // Update existing connector - reset is_tested to false
        const { error } = await supabase
          .from('connectors')
          .update({ ...connectorData, is_tested: false })
          .eq('id', connector.id);

        if (error) throw error;

        // Add system activity
        await supabase.from('migration_activities').insert({
          migration_id: project.id,
          type: 'system',
          title: `${linkType === 'in' ? 'Inconnector' : 'Outconnector'} mit Datenquelle verknüpft`,
          timestamp: new Date().toLocaleString('de-DE'),
        });

        toast.success("Connector mit Datenquelle verknüpft");
      } else {
        // Create new connector
        const { error } = await supabase
          .from('connectors')
          .insert(connectorData);

        if (error) throw error;

        // Add system activity
        await supabase.from('migration_activities').insert({
          migration_id: project.id,
          type: 'system',
          title: `${linkType === 'in' ? 'Inconnector' : 'Outconnector'} mit Datenquelle erstellt`,
          timestamp: new Date().toLocaleString('de-DE'),
        });

        toast.success("Connector mit Datenquelle erstellt");
      }

      // Update migration progress
      if (progressChange !== 0) {
        const newProgress = Math.max(0, Math.min(100, project.progress + progressChange));
        await supabase
          .from('migrations')
          .update({ progress: newProgress })
          .eq('id', project.id);
      }

      setIsLinkDialogOpen(false);
      await onRefresh();
    } catch (error: any) {
      toast.error(error.message || "Fehler beim Verknüpfen");
      console.error(error);
    }
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

  const handleRemoveHeader = (id: string) => {
    setFormData((prev) => {
      const remaining = prev.headers.filter((header) => header.id !== id);
      return {
        ...prev,
        headers: remaining.length > 0 ? remaining : [createHeaderField()],
      };
    });
  };

  // Determine current migration step
  const getCurrentStep = () => {
    // Step 1: Inconnector must be tested
    if (!hasInConnector || !project.connectors?.in?.is_tested) return "Inconnector";
    // Step 2: Outconnector must be tested
    if (!hasOutConnector || !project.connectors?.out?.is_tested) return "Outconnector";
    // Step 3: Meta model must be approved
    if (!isMetaModelApproved) return "Mapping (MetaModel)";
    // Step 4: Transfer (import from source)
    const hasFoundObjects = project.objectsTransferred && project.objectsTransferred.startsWith("0/");
    if (hasFoundObjects && project.objectsTransferred.split("/")[0] === "0") return "Transfer";
    // Step 5: Export to target
    if (!hasExported) return "Export";
    // Step 6: Validation
    if (!hasValidated) return "Validierung";
    if (project.progress < 100) return "Abschluss";
    return "Insights";
  };

  const handleMetaModelApproval = async (approved: boolean) => {
    try {
      setIsMetaModelApproved(approved);
      
      if (approved) {
        // Increase progress by 20% when meta model is approved
        const newProgress = Math.min(project.progress + 20, 100);
        const { error: updateError } = await supabase
          .from('migrations')
          .update({ 
            progress: newProgress,
            meta_model_approved: true 
          })
          .eq('id', project.id);

        if (updateError) throw updateError;

        // Add system activity
        await supabase.from('migration_activities').insert({
          migration_id: project.id,
          type: 'system',
          title: 'Meta-Modell freigegeben',
          timestamp: new Date().toLocaleString('de-DE'),
        });

        toast.success("Meta-Modell freigegeben");
        await onRefresh();
      } else {
        // Decrease progress by 20% when meta model approval is revoked
        const newProgress = Math.max(project.progress - 20, 0);
        const { error: updateError } = await supabase
          .from('migrations')
          .update({ 
            meta_model_approved: false,
            progress: newProgress
          })
          .eq('id', project.id);

        if (updateError) throw updateError;
        
        toast.success("Meta Modell Freigabe wurde zurückgezogen");
        await onRefresh();
      }
    } catch (error: any) {
      toast.error("Fehler beim Freigeben des Meta-Modells");
      console.error(error);
      setIsMetaModelApproved(false);
    }
  };

  const handleImportStart = async () => {
    try {
      setIsImporting(true);

      const activeMappings = await loadActiveMappings();

      if (activeMappings.length > 0) {
        const sampleRecord = buildSampleRecordFromMappings(activeMappings);
        const populatedSample = Object.keys(sampleRecord).reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = `Sample(${key})`;
          return acc;
        }, {});

        try {
          const { errors, logs, result: transformedSample } = await applyMappingsToRecord(populatedSample, activeMappings, {
            sourceSystem: project.sourceSystem,
            targetSystem: project.targetSystem,
            sourceObject: selectedSourceObject,
            targetObject: selectedTargetObject,
          });

          if (logs.length) {
            console.groupCollapsed('Mapping Pipeline Preview');
            logs.forEach((log) => console.log(`[${log.level}] ${log.message}`, log.detail ?? ''));
            console.groupEnd();
          }

          if (errors.length) {
            errors.forEach((log) => console.error(`[Pipeline Error] ${log.message}`, log.detail ?? ''));
            toast.error("Mapping-Validierung fehlgeschlagen. Bitte Konfiguration prüfen.");
            setIsImporting(false);
            return;
          }

          console.debug('Transformierte Pipeline-Vorschau', transformedSample);
        } catch (error) {
          console.error('Fehler bei der Pipeline-Ausführung', error);
          toast.error('Fehler bei der Mapping-Auswertung in der Pipeline');
          setIsImporting(false);
          return;
        }
      }

      // Get the target count from mapped_objects
      const [, targetCountStr] = project.mappedObjects.split('/');
      const targetCount = parseInt(targetCountStr) || 0;

      if (targetCount === 0) {
        toast.error("Keine Objekte zum Importieren gefunden");
        setIsImporting(false);
        return;
      }

      // Simulate gradual import process
      const steps = 10;
      const incrementPerStep = Math.floor(targetCount / steps);
      let currentCount = 0;

      for (let i = 1; i <= steps; i++) {
        await new Promise(resolve => setTimeout(resolve, 300)); // 300ms delay between steps
        
        currentCount = i === steps ? targetCount : currentCount + incrementPerStep;
        
        await supabase
          .from('migrations')
          .update({ 
            objects_transferred: `${currentCount}/${targetCount}`,
            progress: Math.min(project.progress + (i === steps ? 20 : 0), 100)
          })
          .eq('id', project.id);
        
        await onRefresh();
      }

      // Add activity when import completes
      await supabase.from('migration_activities').insert({
        migration_id: project.id,
        type: 'system',
        title: `Import abgeschlossen: ${targetCount} Objekte übertragen`,
        timestamp: new Date().toLocaleString('de-DE'),
      });

      setHasImported(true);
      toast.success("Import erfolgreich abgeschlossen");
    } catch (error: any) {
      toast.error("Fehler beim Import");
      console.error(error);
    } finally {
      setIsImporting(false);
    }
  };

  const handleExportStart = async () => {
    try {
      setIsExporting(true);
      
      // Get the target count from objects_transferred
      const [transferredCountStr] = project.objectsTransferred.split('/');
      const transferredCount = parseInt(transferredCountStr) || 0;
      
      if (transferredCount === 0) {
        toast.error("Keine Objekte zum Exportieren gefunden");
        setIsExporting(false);
        return;
      }

      // Simulate export process
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second export simulation

      // Add activity when export completes
      await supabase.from('migration_activities').insert({
        migration_id: project.id,
        type: 'success',
        title: `Export abgeschlossen: ${transferredCount} Objekte exportiert`,
        timestamp: new Date().toLocaleString('de-DE'),
      });

      // Update progress
      const newProgress = Math.min(project.progress + 20, 100);
      await supabase
        .from('migrations')
        .update({ progress: newProgress })
        .eq('id', project.id);

      setHasExported(true);
      toast.success("Export erfolgreich abgeschlossen");
      await onRefresh();
    } catch (error: any) {
      toast.error("Fehler beim Export");
      console.error(error);
    } finally {
      setIsExporting(false);
    }
  };

  const handleValidationStart = async () => {
    try {
      setIsValidating(true);
      
      // Get the current mapped objects
      const [currentMapped, totalMapped] = project.mappedObjects.split('/').map(n => parseInt(n) || 0);
      
      if (totalMapped === 0) {
        toast.error("Keine Objekte zum Validieren gefunden");
        setIsValidating(false);
        return;
      }

      // Simulate gradual validation process
      const steps = 10;
      const incrementPerStep = Math.floor(totalMapped / steps);
      let validatedCount = currentMapped;

      for (let i = 1; i <= steps; i++) {
        await new Promise(resolve => setTimeout(resolve, 300)); // 300ms delay between steps
        
        validatedCount = i === steps ? totalMapped : validatedCount + incrementPerStep;
        
        await supabase
          .from('migrations')
          .update({ 
            mapped_objects: `${validatedCount}/${totalMapped}`,
          })
          .eq('id', project.id);
        
        await onRefresh();
      }

      // Generate random count for outconnector objects_transferred (80-100% of total)
      const randomPercentage = 0.8 + Math.random() * 0.2; // Random between 80% and 100%
      const randomCount = Math.floor(totalMapped * randomPercentage);

      // Update progress by 20% and set random objects_transferred
      const newProgress = Math.min(project.progress + 20, 100);
      await supabase
        .from('migrations')
        .update({ 
          progress: newProgress,
          objects_transferred: `${randomCount}/${totalMapped}`
        })
        .eq('id', project.id);

      // Add activity when validation completes
      await supabase.from('migration_activities').insert({
        migration_id: project.id,
        type: 'success',
        title: `Validierung abgeschlossen: ${randomCount} von ${totalMapped} Objekten erfolgreich validiert`,
        timestamp: new Date().toLocaleString('de-DE'),
      });

      setHasValidated(true);
      toast.success("Validierung erfolgreich abgeschlossen");
      await onRefresh();
    } catch (error: any) {
      toast.error("Fehler bei der Validierung");
      console.error(error);
    } finally {
      setIsValidating(false);
    }
  };

  const handleSaveConnector = async () => {
    try {
      const connector = configType === 'in' ? project.connectors?.in : project.connectors?.out;
      const isCreating = !connector;
      const wasTested = connector?.is_tested || false;
      
      const oauthFields: Record<string, any> = formData.authType === 'oauth2'
        ? {
            client_id: formData.clientId,
            client_secret: formData.clientSecret,
            auth_url: formData.authUrl,
            token_url: formData.tokenUrl,
            scope: formData.scope,
            redirect_uri: formData.redirectUri,
          }
        : {};

      const customAuthFields: Record<string, any> = formData.authType === 'custom'
        ? {
            realm: formData.realm,
            issuer: formData.issuer,
            client_id: formData.clientId,
            client_secret: formData.clientSecret,
          }
        : {};

      const endpointConfig = {
        list: formData.listEndpoint || formData.endpoint,
        detail: formData.detailEndpoint,
        create: formData.createEndpoint,
        update: formData.updateEndpoint,
        delete: formData.deleteEndpoint,
        healthcheck: formData.healthcheckEndpoint,
      };

      const operationsConfig = {
        write_method: formData.writeHttpMethod,
        payload_template: formData.requestPayloadTemplate,
        response_sample: formData.responseSample,
        success_status_codes: parseCommaSeparatedIntegers(formData.successStatusCodes),
        request_timeout: parseInteger(formData.requestTimeout),
      };

      const paginationConfig = {
        strategy: formData.paginationStrategy,
        page_size: parseInteger(formData.pageSize),
        page_param: formData.pageParam,
        limit_param: formData.limitParam,
        cursor_param: formData.cursorParam,
        cursor_path: formData.cursorPath,
      };

      const filteringConfig = {
        default_params: formData.filterTemplate,
        delta_field: formData.deltaField,
        delta_strategy: formData.deltaStrategy,
        initial_value: formData.deltaInitialValue,
      };

      const rateLimitingConfig = {
        requests_per_minute: parseInteger(formData.requestsPerMinute),
        concurrent_requests: parseInteger(formData.concurrencyLimit),
        retry_after_header: formData.retryAfterHeader,
      };

      const batchingConfig = {
        batch_size: parseInteger(formData.batchSize),
        max_objects_per_run: parseInteger(formData.maxObjectsPerRun),
      };

      const schedulingConfig = {
        poll_interval_minutes: parseInteger(formData.pollIntervalMinutes),
        cron: formData.cronSchedule,
      };

      const dataFormatConfig = {
        date_format: formData.dateFormat,
        timezone: formData.timezone,
      };

      const identifiersConfig = {
        primary_key: formData.identifierField,
      };

      const baseConfig: Record<string, any> = {
        ssl_verification: formData.sslVerification,
        proxy_host: formData.proxyHost,
        proxy_port: formData.proxyPort,
        vpn_settings: formData.vpnSettings,
        notes: formData.notes,
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

      const headerEntries = headersToConfigEntries(formData.headers);
      if (headerEntries.length > 0) {
        baseConfig.headers = headerEntries;
      }

      const additionalConfig = (pruneConfig(baseConfig) as Record<string, any>) ?? {};

      const connectorData = {
        migration_id: project.id,
        connector_type: configType,
        api_url: formData.apiUrl,
        api_key: formData.apiKey,
        username: formData.username,
        password: formData.password,
        endpoint: formData.endpoint || formData.listEndpoint,
        auth_type: formData.authType,
        additional_config: additionalConfig,
      };

      // Calculate progress change
      let progressChange = 0;
      if (isCreating) {
        progressChange = 2.5; // New connector
      } else if (wasTested) {
        progressChange = -5; // Editing a tested connector removes both config and test progress
      }

      if (connector) {
        // Update existing connector - reset is_tested to false
        const { error } = await supabase
          .from('connectors')
          .update({ ...connectorData, is_tested: false })
          .eq('id', connector.id);

        if (error) throw error;

        // Add system activity
        const { error: activityError } = await supabase.from('migration_activities').insert({
          migration_id: project.id,
          type: 'system',
          title: `${configType === 'in' ? 'Inconnector' : 'Outconnector'} aktualisiert`,
          timestamp: new Date().toLocaleString('de-DE'),
        });

        if (activityError) {
          console.error('Error creating activity:', activityError);
          toast.error('Fehler beim Protokollieren der Aktivität');
        }

        toast.success("Connector aktualisiert");
      } else {
        // Create new connector
        const { error } = await supabase
          .from('connectors')
          .insert(connectorData);

        if (error) throw error;

        // Add system activity
        const { error: activityError } = await supabase.from('migration_activities').insert({
          migration_id: project.id,
          type: 'system',
          title: `${configType === 'in' ? 'Inconnector' : 'Outconnector'} erstellt`,
          timestamp: new Date().toLocaleString('de-DE'),
        });

        if (activityError) {
          console.error('Error creating activity:', activityError);
          toast.error('Fehler beim Protokollieren der Aktivität');
        }

        toast.success("Connector erstellt");
      }

      // Update migration progress
      if (progressChange !== 0) {
        const newProgress = Math.max(0, Math.min(100, project.progress + progressChange));
        const { error: progressError } = await supabase
          .from('migrations')
          .update({ progress: newProgress })
          .eq('id', project.id);

        if (progressError) {
          console.error('Error updating progress:', progressError);
        }
      }

      setFormData(createInitialConnectorFormData());
      setIsConfigDialogOpen(false);
      await onRefresh();
    } catch (error: any) {
      toast.error(error.message || "Fehler beim Speichern");
      console.error(error);
    }
  };

  const [transferredCount, totalCount] = project.objectsTransferred
    .split('/')
    .map((value) => parseInt(value) || 0);

  const rawImportProgress = totalCount > 0 ? transferredCount / totalCount : 0;
  const importEdgeFill = hasImported ? 100 : Math.min(100, rawImportProgress * 100);
  const exportEdgeFill = hasExported ? 100 : Math.min(100, exportProgressVisual * 100);

  const renderNode = (
    label: string,
    Icon: LucideIcon,
    isActive: boolean,
    isProcessing: boolean
  ) => (
    <div className="flex flex-col items-center gap-2">
      <div
        className={`w-14 h-14 rounded-full border-2 flex items-center justify-center transition-all duration-500 ${
          isActive
            ? 'bg-primary text-primary-foreground border-primary/70 shadow-lg shadow-primary/30'
            : 'bg-muted text-muted-foreground border-border'
        } ${isProcessing ? 'animate-pulse' : ''}`}
      >
        <Icon className="h-6 w-6" />
      </div>
      <span className={`text-xs font-medium ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
        {label}
      </span>
    </div>
  );

  const renderEdge = (
    fill: number,
    isActive: boolean,
    label: string,
    showLabel: boolean
  ) => (
    <div className="flex flex-1 flex-col items-center gap-1">
      <div
        className={`w-full h-1.5 rounded-full bg-muted relative overflow-hidden ${isActive ? 'shadow-[0_0_12px_rgba(59,130,246,0.4)]' : ''}`}
      >
        <div
          className="absolute inset-y-0 left-0 bg-primary transition-all duration-500"
          style={{ width: `${fill}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs text-muted-foreground">{label}: {Math.round(fill)}%</span>
      )}
    </div>
  );

  const importStatus = hasImported
    ? 'Import abgeschlossen'
    : isImporting
    ? 'Import läuft'
    : 'Bereit für Import';

  const exportStatus = hasExported
    ? 'Export abgeschlossen'
    : isExporting
    ? 'Export läuft'
    : 'Bereit für Export';

  const connectorsReadyForTransfer = Boolean(
    hasInConnector &&
    hasOutConnector &&
    project.connectors?.in?.is_tested &&
    project.connectors?.out?.is_tested
  );

  const shouldShowStatusRow =
    importStatus !== 'Bereit für Import' || exportStatus !== 'Bereit für Export';

  const shouldShowImportLabel =
    connectorsReadyForTransfer || isImporting || hasImported;

  const shouldShowExportLabel =
    connectorsReadyForTransfer || isExporting || hasExported;

  return (
    <div className="h-full p-8 pb-6 space-y-6">
      {activeTab === "general" && (
        <div className="space-y-6 pb-6">
          {/* Progress Card - Full width */}
          <div className="grid grid-cols-1 md:grid-cols-2 items-center gap-10 py-4">
            <div className="flex justify-center">
              <div className="text-center">
                <p className="text-sm font-semibold text-foreground mb-1">Nächster Schritt:</p>
                <p className="text-lg font-bold text-primary">{getCurrentStep()}</p>
              </div>
            </div>
            <div className="flex justify-center">
              <div className="relative flex flex-col items-center">
                <CircularProgress progress={project.progress} />
                <p className="text-center mt-4 text-sm text-muted-foreground">Progress</p>
              </div>
            </div>
          </div>

          <Card className="bg-card border-border">
            <CardContent className="pt-6">
              <div className="space-y-4">
                {shouldShowStatusRow && (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">Status</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{importStatus}</span>
                      <span className="text-muted-foreground/40">•</span>
                      <span>{exportStatus}</span>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  {renderNode('Quelle', Download, true, isImporting && importEdgeFill < 100)}
                  {renderEdge(importEdgeFill, isImporting || hasImported, 'Import', shouldShowImportLabel)}
                  {renderNode('Celion', Workflow, hasImported || importEdgeFill >= 100, isImporting && importEdgeFill < 100)}
                  {renderEdge(exportEdgeFill, isExporting || hasExported, 'Export', shouldShowExportLabel)}
                  {renderNode('Zielsystem', Upload, hasExported || exportEdgeFill >= 100, isExporting && exportEdgeFill < 100)}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6">
            <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-6">
              <div className="grid gap-6">
                {/* Meta model Card */}
                <Card className="bg-card border-border h-full">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-8">
                        <div>
                          <p className="text-sm font-medium">Meta modell</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Mapped objects</p>
                          <p className="text-foreground font-medium">{project.mappedObjects}</p>
                        </div>
                        {getCurrentStep() === "Validierung" && (
                          <Button
                            onClick={handleValidationStart}
                            disabled={isValidating}
                            className="bg-success hover:bg-success/90 text-white"
                          >
                            {isValidating ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Validiere...
                              </>
                            ) : (
                              "Validieren"
                            )}
                          </Button>
                        )}
                      </div>
                      <div className={`w-12 h-12 rounded-full border-4 transition-all duration-500 ${
                        project.progress === 100
                          ? "border-success"
                          : isValidating || (getCurrentStep() === "Validierung" && !hasValidated)
                          ? "border-primary"
                          : "border-muted"
                      } flex items-center justify-center`}>
                        <Database className="h-5 w-5" />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Inconnector Card */}
                <Card className={`bg-card border-border transition-shadow duration-300 ${
                  getCurrentStep() === "Inconnector" || getCurrentStep() === "Transfer"
                    ? "shadow-[0_0_20px_rgba(59,130,246,0.5)] dark:shadow-[0_0_20px_rgba(255,255,255,0.3)]"
                    : ""
                }`}>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-base">Inconnector</CardTitle>
                          {hasInConnector && (
                            <Check className="h-4 w-4 text-green-500" />
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          {project.inConnectorDetail}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {isMetaModelApproved && getCurrentStep() === "Transfer" && (
                        <>
                          {isImporting && (
                            <Loader2 className="h-4 w-4 text-primary animate-spin" />
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className={`text-success hover:text-success ${!hasImported ? "animate-gentle-bounce" : ""}`}
                            title={hasImported ? "Import wiederholen" : "Import starten"}
                            onClick={handleImportStart}
                            disabled={isImporting}
                          >
                            {hasImported ? (
                              <RefreshCw className="h-4 w-4" />
                            ) : (
                              <Download className="h-4 w-4" />
                            )}
                          </Button>
                        </>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <SettingsIcon className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleEdit('in')}>
                            {hasInConnector ? 'Bearbeiten' : 'Erstellen'}
                          </DropdownMenuItem>
                          {hasInConnector && (
                            <DropdownMenuItem onClick={() => handleTest('in')}>
                              Test
                            </DropdownMenuItem>
                          )}
                          {getAvailableDataSources('in').length > 0 && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => handleLinkDataSource('in')}>
                                <Link className="h-4 w-4 mr-2" />
                                Datenquelle verknüpfen
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      {hasInConnector && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteClick('in')}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2 text-sm">
                      <span className={project.connectors?.in?.is_tested ? "text-success" : "text-muted-foreground"}>
                        Connection {project.connectors?.in?.is_tested ? "✓" : "—"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Objects transferred {project.objectsTransferred}
                    </p>
                  </CardContent>
                </Card>

                {/* Outconnector Card */}
                <Card className={`bg-card border-border transition-shadow duration-300 ${
                  getCurrentStep() === "Outconnector" || getCurrentStep() === "Export"
                    ? "shadow-[0_0_20px_rgba(59,130,246,0.5)] dark:shadow-[0_0_20px_rgba(255,255,255,0.3)]"
                    : ""
                }`}>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-base">Outconnector</CardTitle>
                          {hasOutConnector && (
                            <Check className="h-4 w-4 text-green-500" />
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          {project.outConnectorDetail}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {hasImported && getCurrentStep() === "Export" && (
                        <>
                          {isExporting && (
                            <Loader2 className="h-4 w-4 text-primary animate-spin" />
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className={`text-success hover:text-success ${!hasExported ? "animate-gentle-bounce" : ""}`}
                            title={hasExported ? "Export wiederholen" : "Export starten"}
                            onClick={handleExportStart}
                            disabled={isExporting}
                          >
                            <Upload className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <SettingsIcon className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleEdit('out')}>
                            {hasOutConnector ? 'Bearbeiten' : 'Erstellen'}
                          </DropdownMenuItem>
                          {hasOutConnector && (
                            <DropdownMenuItem onClick={() => handleTest('out')}>
                              Test
                            </DropdownMenuItem>
                          )}
                          {getAvailableDataSources('out').length > 0 && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => handleLinkDataSource('out')}>
                                <Link className="h-4 w-4 mr-2" />
                                Datenquelle verknüpfen
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      {hasOutConnector && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteClick('out')}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2 text-sm">
                      <span className={project.connectors?.out?.is_tested ? "text-success" : "text-muted-foreground"}>
                        Connection {project.connectors?.out?.is_tested ? "✓" : "—"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Objects transferred {project.progress === 100 ? project.objectsTransferred : "0/0"}
                    </p>
                  </CardContent>
                </Card>
              </div>

              <div className="flex flex-col gap-6">
                <Card className="bg-card border-border h-full flex flex-col">
                  <CardHeader>
                    <CardTitle className="text-base">Activity</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0 flex-1">
                    <ScrollArea className="h-full max-h-[260px] px-6 py-4">
                      <ActivityTimeline activities={project.activities} />
                    </ScrollArea>
                  </CardContent>
                </Card>

                {/* Meta Model Approval Card - Always visible */}
                <Card className={`bg-card border-border transition-shadow duration-300 ${
                  getCurrentStep() === "Mapping (MetaModel)"
                    ? "shadow-[0_0_20px_rgba(59,130,246,0.5)] dark:shadow-[0_0_20px_rgba(255,255,255,0.3)]"
                    : ""
                }`}>
                  <CardHeader>
                    <CardTitle className="text-base">Meta Modell</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">Freigeben</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Bearbeite das Modell in der Mapping UI
                        </p>
                      </div>
                      <Switch
                        checked={isMetaModelApproved}
                        onCheckedChange={handleMetaModelApproval}
                        disabled={!hasOutConnector || !project.connectors?.out?.is_tested}
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "mapping" && (
        <div className="space-y-6 pb-6">
          {/* Dropdowns Section */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-6">
            {/* Left Dropdown - Source System Objects */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                {project.sourceSystem} Objects
              </label>
              <Select value={selectedSourceObject} onValueChange={setSelectedSourceObject}>
                <SelectTrigger className="w-full bg-background">
                  <SelectValue placeholder="Select source object" />
                </SelectTrigger>
                <SelectContent>
                  {sourceObjects.map((obj) => (
                    <SelectItem key={obj.id} value={obj.id}>
                      {obj.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end justify-center pb-2">
              <div className="p-2 rounded-full bg-muted text-muted-foreground">
                <ArrowLeftRight className="h-5 w-5 translate-y-[2px]" />
              </div>
            </div>

            {/* Right Dropdown - Target System Objects */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                {project.targetSystem} Objects
              </label>
              <Select value={selectedTargetObject} onValueChange={setSelectedTargetObject}>
                <SelectTrigger className="w-full bg-background">
                  <SelectValue placeholder="Select target object" />
                </SelectTrigger>
                <SelectContent>
                  {targetObjects.map((obj) => (
                    <SelectItem key={obj.id} value={obj.id}>
                      {obj.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Field Mapping Area */}
          <div className="border-transparent rounded-lg min-h-[600px]">
            {selectedSourceObject && selectedTargetObject ? (
              <FieldMapper
                migrationId={project.id}
                sourceSystem={project.sourceSystem}
                targetSystem={project.targetSystem}
                sourceObject={selectedSourceObject}
                targetObject={selectedTargetObject}
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-muted-foreground text-center py-12">
                <Workflow className="h-10 w-10" />
                <span>Wähle Source und Target Objects aus, um mit dem Mapping zu beginnen</span>
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog open={isConfigDialogOpen} onOpenChange={setIsConfigDialogOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {configType === 'in' ? 'Inconnector' : 'Outconnector'} {(configType === 'in' ? hasInConnector : hasOutConnector) ? 'bearbeiten' : 'erstellen'}
            </DialogTitle>
            <DialogDescription>
              Konfigurieren Sie die API-Verbindungseinstellungen für den {configType === 'in' ? 'Inconnector' : 'Outconnector'}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            {/* Basisdaten Section */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground">🔧 Basisdaten</h3>
              <div className="space-y-2">
                <Label htmlFor="api-url">API URL</Label>
                <Input
                  id="api-url"
                  placeholder="https://api.example.com"
                  type="url"
                  value={formData.apiUrl}
                  onChange={(e) => setFormData({ ...formData, apiUrl: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endpoint">Endpoint</Label>
                <Input
                  id="endpoint"
                  placeholder="/api/v1/data"
                  value={formData.endpoint}
                  onChange={(e) => setFormData({ ...formData, endpoint: e.target.value })}
                />
              </div>
            </div>

            {/* Authentifizierung Section */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground">🔑 Authentifizierung</h3>
              <div className="space-y-2">
                <Label htmlFor="auth-type">Authentifizierungstyp</Label>
                <Select
                  value={formData.authType}
                  onValueChange={(value) => setFormData({ ...formData, authType: value })}
                >
                  <SelectTrigger id="auth-type" className="w-full">
                    <SelectValue placeholder="Wählen Sie einen Typ" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="api_key">API Key</SelectItem>
                    <SelectItem value="basic">Basic Auth</SelectItem>
                    <SelectItem value="oauth2">OAuth2</SelectItem>
                    <SelectItem value="custom">Custom (Keycloak)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Conditional fields based on auth type */}
              {formData.authType === 'api_key' && (
                <div className="space-y-2">
                  <Label htmlFor="api-key">API Key</Label>
                  <Input
                    id="api-key"
                    placeholder="Enter API key"
                    type="password"
                    value={formData.apiKey}
                    onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                  />
                </div>
              )}

              {formData.authType === 'basic' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="username">Username</Label>
                    <Input
                      id="username"
                      placeholder="Enter username"
                      value={formData.username}
                      onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      placeholder="Enter password"
                      type="password"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    />
                  </div>
                </>
              )}

              {formData.authType === 'oauth2' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="client-id">Client ID</Label>
                      <Input
                        id="client-id"
                        placeholder="Client ID"
                        value={formData.clientId}
                        onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="client-secret">Client Secret</Label>
                      <Input
                        id="client-secret"
                        placeholder="Client Secret"
                        type="password"
                        value={formData.clientSecret}
                        onChange={(e) => setFormData({ ...formData, clientSecret: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="auth-url">Authorization URL</Label>
                    <Input
                      id="auth-url"
                      placeholder="https://auth.example.com/oauth/authorize"
                      value={formData.authUrl}
                      onChange={(e) => setFormData({ ...formData, authUrl: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="token-url">Token URL</Label>
                    <Input
                      id="token-url"
                      placeholder="https://auth.example.com/oauth/token"
                      value={formData.tokenUrl}
                      onChange={(e) => setFormData({ ...formData, tokenUrl: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="scope">Scope</Label>
                    <Input
                      id="scope"
                      placeholder="read write"
                      value={formData.scope}
                      onChange={(e) => setFormData({ ...formData, scope: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="redirect-uri">Redirect URI</Label>
                    <Input
                      id="redirect-uri"
                      placeholder="https://app.example.com/callback"
                      value={formData.redirectUri}
                      onChange={(e) => setFormData({ ...formData, redirectUri: e.target.value })}
                    />
                  </div>
                </>
              )}

              {formData.authType === 'custom' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="realm">Realm</Label>
                    <Input
                      id="realm"
                      placeholder="master"
                      value={formData.realm}
                      onChange={(e) => setFormData({ ...formData, realm: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="issuer">Issuer URL</Label>
                    <Input
                      id="issuer"
                      placeholder="https://keycloak.example.com/auth/realms/master"
                      value={formData.issuer}
                      onChange={(e) => setFormData({ ...formData, issuer: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="custom-client-id">Client ID</Label>
                      <Input
                        id="custom-client-id"
                        placeholder="Client ID"
                        value={formData.clientId}
                        onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="custom-client-secret">Client Secret</Label>
                      <Input
                        id="custom-client-secret"
                        placeholder="Client Secret"
                        type="password"
                        value={formData.clientSecret}
                        onChange={(e) => setFormData({ ...formData, clientSecret: e.target.value })}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Infrastruktur Section - Collapsible */}
            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-2 w-full">
                <h3 className="text-sm font-semibold text-foreground">🧱 Infrastruktur (optional)</h3>
                <span className="text-xs text-muted-foreground ml-auto">▼</span>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 mt-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="ssl-verification"
                    checked={formData.sslVerification}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, sslVerification: checked as boolean })
                    }
                  />
                  <Label htmlFor="ssl-verification" className="text-sm">
                    SSL Verification aktivieren
                  </Label>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="proxy-host">Proxy Host</Label>
                    <Input
                      id="proxy-host"
                      placeholder="proxy.example.com"
                      value={formData.proxyHost}
                      onChange={(e) => setFormData({ ...formData, proxyHost: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="proxy-port">Proxy Port</Label>
                    <Input
                      id="proxy-port"
                      placeholder="8080"
                      value={formData.proxyPort}
                      onChange={(e) => setFormData({ ...formData, proxyPort: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vpn-settings">VPN / Tunnel Settings</Label>
                  <Input
                    id="vpn-settings"
                    placeholder="VPN configuration details"
                    value={formData.vpnSettings}
                    onChange={(e) => setFormData({ ...formData, vpnSettings: e.target.value })}
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Endpunkte & Operationen */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground">🌐 Endpunkte & Operationen</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="list-endpoint">Listen-Endpunkt</Label>
                  <Input
                    id="list-endpoint"
                    placeholder="/api/v1/items"
                    value={formData.listEndpoint}
                    onChange={(e) => setFormData({ ...formData, listEndpoint: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="detail-endpoint">Detail-Endpunkt</Label>
                  <Input
                    id="detail-endpoint"
                    placeholder="/api/v1/items/{id}"
                    value={formData.detailEndpoint}
                    onChange={(e) => setFormData({ ...formData, detailEndpoint: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="create-endpoint">Create-Endpunkt</Label>
                  <Input
                    id="create-endpoint"
                    placeholder="/api/v1/items"
                    value={formData.createEndpoint}
                    onChange={(e) => setFormData({ ...formData, createEndpoint: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="update-endpoint">Update-Endpunkt</Label>
                  <Input
                    id="update-endpoint"
                    placeholder="/api/v1/items/{id}"
                    value={formData.updateEndpoint}
                    onChange={(e) => setFormData({ ...formData, updateEndpoint: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="delete-endpoint">Delete-Endpunkt</Label>
                  <Input
                    id="delete-endpoint"
                    placeholder="/api/v1/items/{id}"
                    value={formData.deleteEndpoint}
                    onChange={(e) => setFormData({ ...formData, deleteEndpoint: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="healthcheck-endpoint">Healthcheck-Endpunkt</Label>
                  <Input
                    id="healthcheck-endpoint"
                    placeholder="/api/v1/health"
                    value={formData.healthcheckEndpoint}
                    onChange={(e) => setFormData({ ...formData, healthcheckEndpoint: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="write-method">Schreibmethode</Label>
                  <Select
                    value={formData.writeHttpMethod}
                    onValueChange={(value) => setFormData({ ...formData, writeHttpMethod: value })}
                  >
                    <SelectTrigger id="write-method" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="POST">POST</SelectItem>
                      <SelectItem value="PUT">PUT</SelectItem>
                      <SelectItem value="PATCH">PATCH</SelectItem>
                      <SelectItem value="DELETE">DELETE</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="request-timeout">Timeout (Sekunden)</Label>
                  <Input
                    id="request-timeout"
                    placeholder="60"
                    value={formData.requestTimeout}
                    onChange={(e) => setFormData({ ...formData, requestTimeout: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="success-status">Erfolgsstatus-Codes</Label>
                  <Input
                    id="success-status"
                    placeholder="200,201"
                    value={formData.successStatusCodes}
                    onChange={(e) => setFormData({ ...formData, successStatusCodes: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="identifier-field">Primärschlüssel / Identifier</Label>
                  <Input
                    id="identifier-field"
                    placeholder="id"
                    value={formData.identifierField}
                    onChange={(e) => setFormData({ ...formData, identifierField: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* Payload */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground">📦 Payload & Response</h3>
              <div className="space-y-2">
                <Label htmlFor="request-payload">Request Payload Template</Label>
                <Textarea
                  id="request-payload"
                  placeholder='{"title": "{{source.summary}}"}'
                  value={formData.requestPayloadTemplate}
                  onChange={(e) => setFormData({ ...formData, requestPayloadTemplate: e.target.value })}
                  className="min-h-[100px]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="response-sample">Beispiel Response</Label>
                <Textarea
                  id="response-sample"
                  placeholder='{"id":123,"title":"Example"}'
                  value={formData.responseSample}
                  onChange={(e) => setFormData({ ...formData, responseSample: e.target.value })}
                  className="min-h-[100px]"
                />
              </div>
            </div>

            {/* Pagination & Delta */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground">🔁 Pagination & Delta-Handling</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="pagination-strategy">Paginierungsstrategie</Label>
                  <Select
                    value={formData.paginationStrategy}
                    onValueChange={(value) =>
                      setFormData({ ...formData, paginationStrategy: value as PaginationStrategy })
                    }
                  >
                    <SelectTrigger id="pagination-strategy" className="w-full">
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
                  <Label htmlFor="page-size">Page Size / Limit</Label>
                  <Input
                    id="page-size"
                    placeholder="100"
                    value={formData.pageSize}
                    onChange={(e) => setFormData({ ...formData, pageSize: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="page-param">Page Parameter</Label>
                  <Input
                    id="page-param"
                    placeholder="page"
                    value={formData.pageParam}
                    onChange={(e) => setFormData({ ...formData, pageParam: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="limit-param">Limit Parameter</Label>
                  <Input
                    id="limit-param"
                    placeholder="limit"
                    value={formData.limitParam}
                    onChange={(e) => setFormData({ ...formData, limitParam: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cursor-param">Cursor Parameter</Label>
                  <Input
                    id="cursor-param"
                    placeholder="cursor"
                    value={formData.cursorParam}
                    onChange={(e) => setFormData({ ...formData, cursorParam: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cursor-path">Cursor Pfad</Label>
                  <Input
                    id="cursor-path"
                    placeholder="data.next_cursor"
                    value={formData.cursorPath}
                    onChange={(e) => setFormData({ ...formData, cursorPath: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="filter-template">Standard-Filter / Query-Parameter</Label>
                <Textarea
                  id="filter-template"
                  placeholder="status=active&sort=updated_at"
                  value={formData.filterTemplate}
                  onChange={(e) => setFormData({ ...formData, filterTemplate: e.target.value })}
                  className="min-h-[80px]"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="delta-field">Delta Feld</Label>
                  <Input
                    id="delta-field"
                    placeholder="updated_at"
                    value={formData.deltaField}
                    onChange={(e) => setFormData({ ...formData, deltaField: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="delta-strategy">Delta Strategie</Label>
                  <Select
                    value={formData.deltaStrategy}
                    onValueChange={(value) =>
                      setFormData({ ...formData, deltaStrategy: value as DeltaStrategy })
                    }
                  >
                    <SelectTrigger id="delta-strategy" className="w-full">
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
                    placeholder="2024-01-01T00:00:00Z"
                    value={formData.deltaInitialValue}
                    onChange={(e) => setFormData({ ...formData, deltaInitialValue: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* Header & Datenformat */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground">🧾 Header & Datenformat</h3>
              <div className="space-y-3">
                {formData.headers.map((header) => (
                  <div key={header.id} className="grid grid-cols-[1fr_1fr_auto] gap-3 items-center">
                    <Input
                      placeholder="Header Name"
                      value={header.key}
                      onChange={(e) => handleHeaderChange(header.id, 'key', e.target.value)}
                    />
                    <Input
                      placeholder="Header Wert"
                      value={header.value}
                      onChange={(e) => handleHeaderChange(header.id, 'value', e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveHeader(header.id)}
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="date-format">Datumsformat</Label>
                  <Input
                    id="date-format"
                    placeholder="YYYY-MM-DDTHH:mm:ssZ"
                    value={formData.dateFormat}
                    onChange={(e) => setFormData({ ...formData, dateFormat: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="timezone">Zeitzone</Label>
                  <Input
                    id="timezone"
                    placeholder="UTC"
                    value={formData.timezone}
                    onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* Limits & Ausführung */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground">⚙️ Limits & Ausführung</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="rpm">Requests pro Minute</Label>
                  <Input
                    id="rpm"
                    placeholder="60"
                    value={formData.requestsPerMinute}
                    onChange={(e) => setFormData({ ...formData, requestsPerMinute: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="concurrency">Parallele Requests</Label>
                  <Input
                    id="concurrency"
                    placeholder="3"
                    value={formData.concurrencyLimit}
                    onChange={(e) => setFormData({ ...formData, concurrencyLimit: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="retry-header">Retry-After Header</Label>
                  <Input
                    id="retry-header"
                    placeholder="Retry-After"
                    value={formData.retryAfterHeader}
                    onChange={(e) => setFormData({ ...formData, retryAfterHeader: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="batch-size">Batchgröße</Label>
                  <Input
                    id="batch-size"
                    placeholder="100"
                    value={formData.batchSize}
                    onChange={(e) => setFormData({ ...formData, batchSize: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max-objects">Max. Objekte pro Lauf</Label>
                  <Input
                    id="max-objects"
                    placeholder="1000"
                    value={formData.maxObjectsPerRun}
                    onChange={(e) => setFormData({ ...formData, maxObjectsPerRun: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="poll-interval">Poll-Intervall (Minuten)</Label>
                  <Input
                    id="poll-interval"
                    placeholder="15"
                    value={formData.pollIntervalMinutes}
                    onChange={(e) => setFormData({ ...formData, pollIntervalMinutes: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cron-schedule">Cron-Ausdruck</Label>
                  <Input
                    id="cron-schedule"
                    placeholder="0 * * * *"
                    value={formData.cronSchedule}
                    onChange={(e) => setFormData({ ...formData, cronSchedule: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes-long">Weitere Hinweise</Label>
                  <Textarea
                    id="notes-long"
                    placeholder="z. B. manuelle Schritte oder Besonderheiten"
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="min-h-[80px]"
                  />
                </div>
              </div>
            </div>

            <Button onClick={handleSaveConnector} className="w-full">
              Speichern
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteType === 'in' ? 'Inconnector' : 'Outconnector'} löschen?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Sind Sie sicher, dass Sie diesen Connector löschen möchten? Diese Aktion kann nicht rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Test Connection Dialog */}
      <TestConnectionDialog
        open={isTestDialogOpen}
        onOpenChange={setIsTestDialogOpen}
        connectorType={testType}
        onTestComplete={handleTestComplete}
      />

      {/* Link Data Source Dialog */}
      <Dialog open={isLinkDialogOpen} onOpenChange={setIsLinkDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Datenquelle verknüpfen</DialogTitle>
            <DialogDescription>
              Wählen Sie eine vorkonfigurierte Datenquelle für den {linkType === 'in' ? 'Inconnector' : 'Outconnector'} aus.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Verfügbare Datenquellen</Label>
              <Select value={selectedDataSourceId} onValueChange={setSelectedDataSourceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Datenquelle auswählen" />
                </SelectTrigger>
                <SelectContent>
                  {getAvailableDataSources(linkType).map((ds) => (
                    <SelectItem key={ds.id} value={ds.id}>
                      <div className="flex flex-col">
                        <span className="font-medium">{ds.name}</span>
                        <span className="text-xs text-muted-foreground">{ds.source_type}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedDataSourceId && (
              <div className="bg-muted/50 p-3 rounded-lg space-y-1 text-sm">
                {(() => {
                  const ds = dataSources.find(d => d.id === selectedDataSourceId);
                  return (
                    <>
                      <p><span className="font-medium">Auth:</span> {ds?.auth_type}</p>
                      {ds?.api_url && <p><span className="font-medium">URL:</span> {ds.api_url}</p>}
                    </>
                  );
                })()}
              </div>
            )}
            <Button 
              onClick={confirmLinkDataSource} 
              className="w-full"
              disabled={!selectedDataSourceId}
            >
              Verknüpfen
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MigrationDetails;
