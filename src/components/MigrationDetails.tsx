import { Database, Settings as SettingsIcon, Trash2, Check, Link } from "lucide-react";
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
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import TestConnectionDialog from "./dialogs/TestConnectionDialog";

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
  const [formData, setFormData] = useState({
    apiUrl: '',
    apiKey: '',
    username: '',
    password: '',
    endpoint: '',
    authType: 'api_key',
    // OAuth2 fields
    clientId: '',
    clientSecret: '',
    authUrl: '',
    tokenUrl: '',
    scope: '',
    redirectUri: '',
    // Custom/Keycloak fields
    realm: '',
    issuer: '',
    // Infrastructure fields
    sslVerification: true,
    proxyHost: '',
    proxyPort: '',
    vpnSettings: '',
  });

  const hasInConnector = !!project.connectors?.in;
  const hasOutConnector = !!project.connectors?.out;

  // Fetch available data sources for linking
  useEffect(() => {
    const fetchDataSources = async () => {
      if (!project.projectId) {
        // If no project ID, load all active data sources (fallback)
        const { data, error } = await supabase
          .from('data_sources')
          .select('*')
          .eq('is_active', true);
        
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

  // Define objects based on system type
  const getSystemObjects = (system: string) => {
    const systemObjects: Record<string, { value: string; label: string }[]> = {
      "Jira Atlassian (Cloud)": [
        { value: "task", label: "Task" },
        { value: "issue", label: "Issue" },
        { value: "epic", label: "Epic" },
        { value: "story", label: "Story" },
        { value: "bug", label: "Bug" },
        { value: "subtask", label: "Subtask" },
      ],
      "Jira Atlassian (Server)": [
        { value: "task", label: "Task" },
        { value: "issue", label: "Issue" },
        { value: "epic", label: "Epic" },
        { value: "story", label: "Story" },
        { value: "bug", label: "Bug" },
        { value: "subtask", label: "Subtask" },
      ],
      "Azure DevOps": [
        { value: "user-story", label: "User Story" },
        { value: "task", label: "Task" },
        { value: "bug", label: "Bug" },
        { value: "feature", label: "Feature" },
        { value: "epic", label: "Epic" },
      ],
      "Monday.com": [
        { value: "item", label: "Item" },
        { value: "task", label: "Task" },
        { value: "project", label: "Project" },
        { value: "milestone", label: "Milestone" },
      ],
      "ClickUp": [
        { value: "task", label: "Task" },
        { value: "subtask", label: "Subtask" },
        { value: "checklist", label: "Checklist" },
        { value: "doc", label: "Doc" },
      ],
      "Asana": [
        { value: "project", label: "Project" },
        { value: "task", label: "Task" },
        { value: "section", label: "Section" },
        { value: "milestone", label: "Milestone" },
        { value: "tag", label: "Tag" },
      ],
      "Trello": [
        { value: "board", label: "Board" },
        { value: "card", label: "Card" },
        { value: "list", label: "List" },
        { value: "label", label: "Label" },
      ],
      "Notion": [
        { value: "page", label: "Page" },
        { value: "database", label: "Database" },
        { value: "task", label: "Task" },
        { value: "project", label: "Project" },
      ],
      "Linear": [
        { value: "issue", label: "Issue" },
        { value: "project", label: "Project" },
        { value: "cycle", label: "Cycle" },
        { value: "milestone", label: "Milestone" },
      ],
    };
    return systemObjects[system] || [];
  };

  const sourceObjects = getSystemObjects(project.sourceSystem);
  const targetObjects = getSystemObjects(project.targetSystem);

  const handleEdit = (type: 'in' | 'out') => {
    setConfigType(type);
    
    // Load existing connector data if available
    const connector = type === 'in' ? project.connectors?.in : project.connectors?.out;
    if (connector) {
      const config = connector.additional_config || {};
      setFormData({
        apiUrl: connector.api_url || '',
        apiKey: connector.api_key || '',
        username: connector.username || '',
        password: connector.password || '',
        endpoint: connector.endpoint || '',
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
      });
    } else {
      setFormData({
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
      });
    }
    
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
        const { error: progressError } = await supabase
          .from('migrations')
          .update({ progress: newProgress })
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

      const additionalConfig = dataSource.additional_config || {};

      const connectorData = {
        migration_id: project.id,
        connector_type: linkType,
        api_url: dataSource.api_url,
        api_key: dataSource.api_key,
        username: dataSource.username,
        password: dataSource.password,
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

  const handleSaveConnector = async () => {
    try {
      const connector = configType === 'in' ? project.connectors?.in : project.connectors?.out;
      const isCreating = !connector;
      const wasTested = connector?.is_tested || false;
      
      const additionalConfig: Record<string, any> = {
        ssl_verification: formData.sslVerification,
      };

      // Add OAuth2 fields if auth type is oauth2
      if (formData.authType === 'oauth2') {
        additionalConfig.client_id = formData.clientId;
        additionalConfig.client_secret = formData.clientSecret;
        additionalConfig.auth_url = formData.authUrl;
        additionalConfig.token_url = formData.tokenUrl;
        additionalConfig.scope = formData.scope;
        additionalConfig.redirect_uri = formData.redirectUri;
      }

      // Add custom/Keycloak fields if auth type is custom
      if (formData.authType === 'custom') {
        additionalConfig.realm = formData.realm;
        additionalConfig.issuer = formData.issuer;
        additionalConfig.client_id = formData.clientId;
        additionalConfig.client_secret = formData.clientSecret;
      }

      // Add infrastructure fields if provided
      if (formData.proxyHost) additionalConfig.proxy_host = formData.proxyHost;
      if (formData.proxyPort) additionalConfig.proxy_port = formData.proxyPort;
      if (formData.vpnSettings) additionalConfig.vpn_settings = formData.vpnSettings;

      const connectorData = {
        migration_id: project.id,
        connector_type: configType,
        api_url: formData.apiUrl,
        api_key: formData.apiKey,
        username: formData.username,
        password: formData.password,
        endpoint: formData.endpoint,
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

      setIsConfigDialogOpen(false);
      await onRefresh();
    } catch (error: any) {
      toast.error(error.message || "Fehler beim Speichern");
      console.error(error);
    }
  };

  return (
    <div className="h-full p-8 pb-6 space-y-6">
      {activeTab === "general" && (
        <div className="space-y-6 pb-6">
          {/* Progress Card - Full width */}
          <div className="flex justify-center items-center py-4">
            <div className="relative">
              <CircularProgress progress={project.progress} />
              <p className="text-center mt-4 text-sm text-muted-foreground">Progress</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left column - Cards */}
            <div className="lg:col-span-2 space-y-6">
              {/* Meta model Card */}
              <Card className="bg-card border-border">
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
                    </div>
                    <div className={`w-12 h-12 rounded-full border-4 ${
                      project.progress === 100 ? "border-success" : "border-muted"
                    } flex items-center justify-center`}>
                      <Database className="h-5 w-5" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Inconnector Card */}
              <Card className="bg-card border-border">
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
              <Card className="bg-card border-border">
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

            {/* Right column - Activity Timeline */}
            <div className="lg:col-span-1">
              <Card className="bg-card border-border h-full">
                <CardHeader>
                  <CardTitle className="text-base">Activity</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <ScrollArea className="h-[400px] px-6 py-4">
                    <ActivityTimeline activities={project.activities} />
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}

      {activeTab === "mapping" && (
        <div className="space-y-6 pb-6">
          {/* Dropdowns Section */}
          <div className="grid grid-cols-2 gap-6">
            {/* Left Dropdown - Source System Objects */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                {project.sourceSystem} Objects
              </label>
              <Select>
                <SelectTrigger className="w-full bg-background">
                  <SelectValue placeholder="Select source object" />
                </SelectTrigger>
                <SelectContent>
                  {sourceObjects.map((obj) => (
                    <SelectItem key={obj.value} value={obj.value}>
                      {obj.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Right Dropdown - Target System Objects */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                {project.targetSystem} Objects
              </label>
              <Select>
                <SelectTrigger className="w-full bg-background">
                  <SelectValue placeholder="Select target object" />
                </SelectTrigger>
                <SelectContent>
                  {targetObjects.map((obj) => (
                    <SelectItem key={obj.value} value={obj.value}>
                      {obj.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Whiteboard Canvas Area */}
          <div className="bg-background border-2 border-border rounded-lg min-h-[600px] p-4">
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
              Mapping canvas area
            </div>
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
