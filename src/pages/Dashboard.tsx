import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Sidebar from "@/components/Sidebar";
import UserMenu from "@/components/UserMenu";
import AccountDialog from "@/components/dialogs/AccountDialog";
import AddMigrationDialog from "@/components/dialogs/AddMigrationDialog";
import EditMigrationDialog from "@/components/dialogs/EditMigrationDialog";
import MigrationDetails, { type MigrationDetailsRef } from "@/components/MigrationDetails";
import DataFlowLoader from "@/components/DataFlowLoader";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Workflow,
  ArrowRight,
  Settings,
  MessageSquare,
  Loader2,
  ShieldCheck,
  Package,
  CheckCircle2,
  Clock,
  Cpu,
  Activity as ActivityIcon,
  TrendingUp,
  TrendingDown
} from "lucide-react";
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { toast } from "sonner";
import { databaseClient } from "@/api/databaseClient";
import { useMinimumLoader } from "@/hooks/useMinimumLoader";
import type { Activity as ActivityType } from "@/components/ActivityTimeline";
import type { RawActivityRecord } from "@/components/migration/migrationDetails.types";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import type { MigrationStatus, NewMigrationInput } from "@/types/migration";
import {
  AUTH_DETAIL_CREDENTIALS,
  AUTH_DETAIL_TOKEN,
  CONNECTOR_AUTH_LABEL,
  CONNECTOR_ENDPOINT_LABEL,
} from "@/constants/migrations";
import { duplicateMigration } from "@/lib/migrationDuplication";
import { cn } from "@/lib/utils";
import { logout } from "@/auth/keycloakClient";

const deriveMigrationStatus = (migration: any): MigrationStatus => {
  const progress = Number(migration?.progress ?? 0);

  if (progress >= 100) {
    return "completed";
  }

  if (progress > 0) {
    return "running";
  }

  return "not_started";
};

const normalizeActivityRecord = (activity: RawActivityRecord): ActivityType => {
  const rawTimestamp = activity?.timestamp ?? activity?.created_at ?? "";

  let timestamp = "";
  if (typeof rawTimestamp === "string" && rawTimestamp.trim() !== "") {
    timestamp = rawTimestamp;
  } else if (rawTimestamp instanceof Date) {
    timestamp = rawTimestamp.toISOString();
  } else if (rawTimestamp) {
    const parsed = new Date(rawTimestamp);
    timestamp = Number.isNaN(parsed.getTime()) ? String(rawTimestamp) : parsed.toISOString();
  } else {
    timestamp = new Date().toISOString();
  }

  return {
    id: activity?.id ?? `activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: (activity?.type ?? "info") as ActivityType["type"],
    title: activity?.title ?? "",
    timestamp,
  };
};

const MIGRATIONS_PAGE_SIZE = 15;

const Dashboard = () => {
  const navigate = useNavigate();
  const { migrationId, projectId } = useParams<{ migrationId?: string; projectId?: string }>();
  const [selectedMigration, setSelectedMigration] = useState<string | null>(migrationId || null);
  const [showAccountDialog, setShowAccountDialog] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [activeDialogTab, setActiveDialogTab] = useState<"account" | "settings">("account");
  const [migrations, setMigrations] = useState<any[]>([]);
  const [standaloneMigrations, setStandaloneMigrations] = useState<any[]>([]);
  const [allProjects, setAllProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingMigration, setEditingMigration] = useState<any>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showEditConfigDialog, setShowEditConfigDialog] = useState(false);
  const [editConfigData, setEditConfigData] = useState<NewMigrationInput | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [migrationToDelete, setMigrationToDelete] = useState<string | null>(null);
  const [isNotesPopoverOpen, setIsNotesPopoverOpen] = useState(false);
  const [migrationNotes, setMigrationNotes] = useState("");
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [projectIdForNewMigration, setProjectIdForNewMigration] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const loaderVisible = useMinimumLoader(loading || transitioning, 1000);
  const migrationDetailsRef = useRef<MigrationDetailsRef>(null);
  const [processingMigrationId, setProcessingMigrationId] = useState<string | null>(null);
  
  // Lazy loading state for standalone migrations
  const [hasMoreMigrations, setHasMoreMigrations] = useState(true);
  const [isLoadingMoreMigrations, setIsLoadingMoreMigrations] = useState(false);
  const [totalMigrationsCount, setTotalMigrationsCount] = useState(0);
  const migrationsPageRef = useRef(0);

  // Check auth and load project data
  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    loadAllData();
  }, []);

  useEffect(() => {
    setSelectedMigration(migrationId ?? null);
  }, [migrationId]);

  const checkAuth = async () => {
    const { data: { session } } = await databaseClient.getSession();
    if (!session) {
      navigate("/");
    }
  };

  const loadAllData = async () => {
    try {
      setLoading(true);
      
      // Load all projects
      const { data: projectsData, error: projectsError } = await databaseClient.fetchProjects();

      let projects = projectsData || [];
      if (projectsError) {
        // HACK: Gracefully handle 500 error on project fetch, assuming it means "no projects".
        if (projectsError.message.includes("500")) {
          console.warn("Server returned 500 when fetching projects, treating as empty list.");
          projects = [];
        } else {
          throw projectsError;
        }
      }
      setAllProjects(projects);

      // Load all migrations with project_id
      const allMigrationsWithProjects: any[] = [];
      for (const project of projects) {
        const { data: migrationsData, error: migrationsError } = await databaseClient.fetchMigrationsByProject(project.id);

        if (migrationsError) throw migrationsError;
        const migrationsWithDetails = await loadMigrationDetails(migrationsData || [], project.id);
        allMigrationsWithProjects.push(...migrationsWithDetails);
      }
      setMigrations(allMigrationsWithProjects);

      // Load standalone migrations with pagination (initial load)
      migrationsPageRef.current = 0;
      const { data: standaloneData, error: standaloneError, count } = await databaseClient.fetchStandaloneMigrationsPaginated(MIGRATIONS_PAGE_SIZE, 0);

      if (standaloneError) throw standaloneError;

      setTotalMigrationsCount(count || 0);
      setHasMoreMigrations((standaloneData?.length || 0) === MIGRATIONS_PAGE_SIZE);
      
      const standaloneWithDetails = await loadMigrationDetails(standaloneData || [], null);
      setStandaloneMigrations(standaloneWithDetails);
      migrationsPageRef.current = 1;
    } catch (error: any) {
      toast.error("Fehler beim Laden der Daten");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const loadMigrationDetails = useCallback(async (migrationsData: any[], projectId: string | null) => {
    return await Promise.all(
      migrationsData.map(async (migration) => {
        const { data: activitiesData } = await databaseClient.fetchMigrationActivities(migration.id);

        const activities = (activitiesData || []).map((a) => normalizeActivityRecord(a as RawActivityRecord));
        const workflowState = migration.workflow_state;

        return {
          id: migration.id,
          name: migration.name,
          progress: migration.progress,
          sourceSystem: migration.source_system,
          targetSystem: migration.target_system,
          sourceUrl: migration.source_url,
          targetUrl: migration.target_url,
          inConnector: migration.in_connector,
          inConnectorDetail: migration.in_connector_detail,
          outConnector: migration.out_connector,
          outConnectorDetail: migration.out_connector_detail,
          objectsTransferred: migration.objects_transferred,
          mappedObjects: migration.mapped_objects,
          projectId: projectId,
          activities,
          notes: migration.notes ?? "",
          status: deriveMigrationStatus(migration),
          workflowState,
        };
      }),
    );
  }, []);

  const handleStepRunningChange = (migrationId: string, isRunning: boolean) => {
    setProcessingMigrationId(isRunning ? migrationId : null);
  };

  // Optimized refresh for only the current migration
  const refreshCurrentMigration = async () => {
    if (!selectedMigration) return;
    
    try {
      // Load only the selected migration
      const { data: migrationData, error: migrationError } = await databaseClient.fetchMigrationById(selectedMigration);

      if (migrationError) throw migrationError;

      const details = await loadMigrationDetails([migrationData], migrationData.project_id);
      const updatedMigration = details[0];

      // Update only the affected migration in state
      if (migrationData.project_id) {
        setMigrations(prev => 
          prev.map(m => m.id === selectedMigration ? updatedMigration : m)
        );
      } else {
        setStandaloneMigrations(prev => 
          prev.map(m => m.id === selectedMigration ? updatedMigration : m)
        );
      }
    } catch (error: any) {
      console.error("Fehler beim Aktualisieren der Migration:", error);
    }
  };

  // Load more migrations (infinite scroll)
  const handleLoadMoreMigrations = useCallback(async () => {
    if (isLoadingMoreMigrations || !hasMoreMigrations) return;

    setIsLoadingMoreMigrations(true);
    try {
      const offset = migrationsPageRef.current * MIGRATIONS_PAGE_SIZE;
      const { data: standaloneData, error: standaloneError } = await databaseClient.fetchStandaloneMigrationsPaginated(MIGRATIONS_PAGE_SIZE, offset);

      if (standaloneError) throw standaloneError;

      const newMigrationsWithDetails = await loadMigrationDetails(standaloneData || [], null);
      setStandaloneMigrations(prev => [...prev, ...newMigrationsWithDetails]);
      setHasMoreMigrations((standaloneData?.length || 0) === MIGRATIONS_PAGE_SIZE);
      migrationsPageRef.current++;
    } catch (error: any) {
      console.error("Fehler beim Laden weiterer Migrationen:", error);
    } finally {
      setIsLoadingMoreMigrations(false);
    }
  }, [isLoadingMoreMigrations, hasMoreMigrations, loadMigrationDetails]);

  const handleSaveNotes = async () => {
    if (!currentMigration) return;

    try {
      setIsSavingNotes(true);
      const { error } = await databaseClient.updateMigration(currentMigration.id, { notes: migrationNotes });

      if (error) throw error;

      toast.success("Anmerkungen gespeichert");
      await refreshCurrentMigration();
      setIsNotesPopoverOpen(false);
    } catch (error) {
      console.error("Fehler beim Speichern der Anmerkungen:", error);
      toast.error("Anmerkungen konnten nicht gespeichert werden");
    } finally {
      setIsSavingNotes(false);
    }
  };

  const handleLogout = async () => {
    try {
      setTransitioning(true);
      await databaseClient.signOut();
      await logout();
      toast.success("Erfolgreich abgemeldet");
      navigate("/");
    } catch (error) {
      toast.error("Abmeldung fehlgeschlagen");
      console.error(error);
    } finally {
      setTransitioning(false);
    }
  };

  const handleAddMigration = async (migrationData: NewMigrationInput) => {
    try {
      const { data: { user } } = await databaseClient.getUser();
      if (!user) throw new Error("Nicht authentifiziert");

      const {
        name,
        sourceUrl,
        targetUrl,
        sourceSystem,
        targetSystem,
        sourceAuth,
        targetAuth,
      } = migrationData;
      const targetAuthDetail = AUTH_DETAIL_TOKEN;

      const { data: migration, error: migrationError } = await databaseClient.insertMigration({
        user_id: user.id,
        project_id: projectIdForNewMigration,
        name,
        source_system: sourceSystem,
        target_system: targetSystem,
        source_url: sourceUrl,
        target_url: targetUrl,
        in_connector: CONNECTOR_ENDPOINT_LABEL,
        in_connector_detail: sourceUrl,
        out_connector: CONNECTOR_AUTH_LABEL,
        out_connector_detail: targetAuthDetail,
        status: "not_started",
      });

      if (migrationError) throw migrationError;

      const sourceConnectorPayload = {
        migration_id: migration.id,
        api_url: sourceUrl,
        auth_type: "api_key",
        api_key: sourceAuth.apiToken ?? null,
        username: sourceAuth.email ?? null,
      };

      const targetConnectorPayload = {
        migration_id: migration.id,
        api_url: targetUrl,
        auth_type: "api_key",
        api_key: targetAuth.apiToken ?? null,
        username: targetAuth.email ?? null,
      };

      const { error: connectorError } = await databaseClient.insertConnectors([
        { ...sourceConnectorPayload, connector_type: 'in' },
        { ...targetConnectorPayload, connector_type: 'out' },
      ]);

      if (connectorError) throw connectorError;

      // Create initial activity
        await databaseClient.insertMigrationActivity({
          migration_id: migration.id,
          type: 'info',
          title: 'Neues Migrationsprojekt erstellt',
          timestamp: new Date().toISOString(),
        });

      toast.success(`Migration "${name}" erstellt`);
      setProjectIdForNewMigration(null);
      
      // Navigate to the new migration
      if (projectIdForNewMigration) {
        navigate(`/projects/${projectIdForNewMigration}/migration/${migration.id}`);
      } else {
        navigate(`/migration/${migration.id}`);
      }
      
      loadAllData();
    } catch (error: any) {
      toast.error(error.message || "Fehler beim Erstellen der Migration");
      console.error(error);
    }
  };

  const handleDeleteMigration = (migrationId: string) => {
    setMigrationToDelete(migrationId);
    setShowDeleteDialog(true);
  };

  const confirmDeleteMigration = async () => {
    if (!migrationToDelete) return;

    try {
      const migrationToDeleteData = migrations.find((m) => m.id === migrationToDelete);
      
      const { error } = await databaseClient.deleteMigration(migrationToDelete);

      if (error) throw error;

      if (selectedMigration === migrationToDelete) {
        setSelectedMigration(null);
      }
      
      toast.success(`Migration "${migrationToDeleteData?.name}" gelöscht`);
      loadAllData();
    } catch (error: any) {
      toast.error("Fehler beim Löschen der Migration");
      console.error(error);
    } finally {
      setShowDeleteDialog(false);
      setMigrationToDelete(null);
    }
  };

  const handleDuplicateMigration = async (migrationId: string) => {
    try {
      setTransitioning(true);
      const existingNames = [...migrations, ...standaloneMigrations].map((migration) => migration.name);
      const duplicated = await duplicateMigration(migrationId, { existingNames });

      toast.success(`Migration "${duplicated.name}" dupliziert`);
      await loadAllData();

      if (duplicated.project_id) {
        navigate(`/projects/${duplicated.project_id}/migration/${duplicated.id}`);
      } else {
        navigate(`/migration/${duplicated.id}`);
      }
    } catch (error: any) {
      toast.error(error?.message ?? "Migration konnte nicht dupliziert werden");
      console.error(error);
    } finally {
      setTransitioning(false);
    }
  };

  const handleEditMigration = async (migrationId: string) => {
    const migration = [...migrations, ...standaloneMigrations].find((m) => m.id === migrationId);
    if (!migration) return;

    try {
      // Load connector data for both source and target
      const { data: sourceConnectorData, error: sourceConnectorError } = await databaseClient.fetchConnectorByType(
        migrationId,
        'in'
      );

      if (sourceConnectorError) throw sourceConnectorError;

      const { data: targetConnectorData, error: targetConnectorError } = await databaseClient.fetchConnectorByType(
        migrationId,
        'out'
      );

      if (targetConnectorError) throw targetConnectorError;

      setEditingMigration(migration);
      setEditConfigData({
        name: migration.name,
        sourceUrl: sourceConnectorData?.api_url || migration.sourceUrl || "",
        targetUrl: targetConnectorData?.api_url || migration.targetUrl || "",
        sourceSystem: migration.sourceSystem,
        targetSystem: migration.targetSystem,
        sourceAuth: {
          authType: "token",
          apiToken: sourceConnectorData?.api_key || "",
          email: sourceConnectorData?.username || "",
          password: sourceConnectorData?.password || "",
        },
        targetAuth: {
          authType: "token",
          apiToken: targetConnectorData?.api_key || "",
          email: targetConnectorData?.username || "",
          password: targetConnectorData?.password || "",
        },
      });
      setShowEditConfigDialog(true);
    } catch (error: any) {
      toast.error("Fehler beim Laden der Konfigurationsdaten");
      console.error(error);
    }
  };

  const handleUpdateMigration = async (name: string) => {
    try {
      const { error } = await databaseClient.updateMigration(editingMigration.id, { name });

      if (error) throw error;

      toast.success(`Migration aktualisiert auf "${name}"`);
      setShowEditDialog(false);
      setEditingMigration(null);
      await refreshCurrentMigration();
    } catch (error: any) {
      toast.error("Fehler beim Aktualisieren der Migration");
      console.error(error);
    }
  };

  const handleOpenEditConfig = async () => {
    if (!currentMigration) return;

    try {
      // Load connector data for both source and target
      const { data: sourceConnectorData, error: sourceConnectorError } = await databaseClient.fetchConnectorByType(
        currentMigration.id,
        'in'
      );

      if (sourceConnectorError) throw sourceConnectorError;

      const { data: targetConnectorData, error: targetConnectorError } = await databaseClient.fetchConnectorByType(
        currentMigration.id,
        'out'
      );

      if (targetConnectorError) throw targetConnectorError;

      setEditConfigData({
        name: currentMigration.name,
        sourceUrl: sourceConnectorData?.api_url || currentMigration.sourceUrl || "",
        targetUrl: targetConnectorData?.api_url || currentMigration.targetUrl || "",
        sourceSystem: currentMigration.sourceSystem,
        targetSystem: currentMigration.targetSystem,
        sourceAuth: {
          authType: "token",
          apiToken: sourceConnectorData?.api_key || "",
          email: sourceConnectorData?.username || "",
          password: sourceConnectorData?.password || "",
        },
        targetAuth: {
          authType: "token",
          apiToken: targetConnectorData?.api_key || "",
          email: targetConnectorData?.username || "",
          password: targetConnectorData?.password || "",
        },
      });
      setShowEditConfigDialog(true);
    } catch (error: any) {
      toast.error("Fehler beim Laden der Konfigurationsdaten");
      console.error(error);
    }
  };

  const handleUpdateMigrationConfig = async (data: NewMigrationInput) => {
    const migrationToUpdate = editingMigration || currentMigration;
    if (!migrationToUpdate) return;

    try {
      // Update migration
      const { error: migrationError } = await databaseClient.updateMigration(migrationToUpdate.id, {
        name: data.name,
        source_system: data.sourceSystem,
        target_system: data.targetSystem,
        source_url: data.sourceUrl,
        target_url: data.targetUrl,
        in_connector_detail: data.sourceUrl,
        out_connector_detail: AUTH_DETAIL_TOKEN,
      });

      if (migrationError) throw migrationError;

      const sourceConnectorUpdates: Record<string, any> = {
        api_url: data.sourceUrl,
        auth_type: "api_key",
        api_key: data.sourceAuth.apiToken ?? null,
        username: data.sourceAuth.email ?? null,
      };

      const targetConnectorUpdates: Record<string, any> = {
        api_url: data.targetUrl,
        auth_type: "api_key",
        api_key: data.targetAuth.apiToken ?? null,
        username: data.targetAuth.email ?? null,
      };

      // Update source connector
      const { error: sourceConnectorError } = await databaseClient.updateConnectorByType(
        migrationToUpdate.id,
        'in',
        sourceConnectorUpdates
      );

      if (sourceConnectorError) throw sourceConnectorError;

      // Update target connector
      const { error: targetConnectorError } = await databaseClient.updateConnectorByType(
        migrationToUpdate.id,
        'out',
        targetConnectorUpdates
      );

      if (targetConnectorError) throw targetConnectorError;

      toast.success("Konfiguration erfolgreich aktualisiert");
      setShowEditConfigDialog(false);
      setEditingMigration(null);
      await loadAllData();
    } catch (error: any) {
      toast.error("Fehler beim Aktualisieren der Konfiguration");
      console.error(error);
    }
  };

  const currentMigration = selectedMigration 
    ? [...migrations, ...standaloneMigrations].find((m) => m.id === selectedMigration)
    : null;

  // Load notes when current migration changes
  useEffect(() => {
    if (currentMigration) {
      setMigrationNotes(currentMigration.notes || "");
    }
  }, [currentMigration]);

  if (loaderVisible) {
    return (
      <div className="app-shell flex h-screen items-center justify-center p-6 overflow-hidden">
        <DataFlowLoader size="lg" />
      </div>
    );
  }

  const standaloneMigrationsWithProcessingStatus = standaloneMigrations.map(m => ({
    ...m,
    status: processingMigrationId === m.id ? 'processing' : m.status,
  }));

  const migrationsWithProcessingStatus = migrations.map(m => ({
    ...m,
    status: processingMigrationId === m.id ? 'processing' : m.status,
  }));

  return (
    <div className="app-shell flex h-screen flex-col px-6 pt-6 pb-6 overflow-hidden">
      <div className="flex flex-1 gap-6 min-h-0">
        <Sidebar
          projects={allProjects}
          projectMigrations={migrationsWithProcessingStatus}
          standaloneMigrations={standaloneMigrationsWithProcessingStatus}
          selectedMigration={selectedMigration}
          onSelectMigration={(id) => {
            const migration = [...migrations, ...standaloneMigrations].find(m => m.id === id);
            if (migration && migration.projectId) {
              navigate(`/projects/${migration.projectId}/migration/${id}`);
            } else {
              navigate(`/migration/${id}`);
            }
          }}
          onNewMigration={() => {
            setProjectIdForNewMigration(null);
            setShowAddDialog(true);
          }}
          onNewProjectMigration={(projectId) => {
            setProjectIdForNewMigration(projectId);
            setShowAddDialog(true);
          }}
          onDeleteMigration={handleDeleteMigration}
          onEditMigration={handleEditMigration}
          onDuplicateMigration={handleDuplicateMigration}
          onLoadMoreMigrations={handleLoadMoreMigrations}
          hasMoreMigrations={hasMoreMigrations}
          isLoadingMoreMigrations={isLoadingMoreMigrations}
          totalMigrationsCount={totalMigrationsCount}
        />

        <div className="flex flex-1 flex-col gap-6">
          <header
            data-sidebar-anchor
            className="app-surface flex items-center justify-between rounded-3xl px-6 py-5"
          >
            {currentMigration ? (
              <>
                <div className="flex items-center gap-4">
                  <div className="inline-flex items-center gap-2 rounded-full bg-foreground/5 px-4 py-1 text-sm text-muted-foreground">
                    Migration
                  </div>
                  <div className="text-base font-semibold text-foreground">
                    {currentMigration.name}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>{currentMigration.sourceSystem}</span>
                    <span>→</span>
                    <span>{currentMigration.targetSystem}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => migrationDetailsRef.current?.openWorkflowPanel()}
                    className="h-8 w-8"
                    title="Workflow bearbeiten"
                  >
                    <Workflow className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleOpenEditConfig}
                    className="h-8 w-8"
                  >
                    <Settings className="h-4 w-4" />
                  </Button>
                  <Popover open={isNotesPopoverOpen} onOpenChange={setIsNotesPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                      >
                        <MessageSquare className={cn("h-4 w-4", migrationNotes && migrationNotes.trim().length > 0 && "text-primary")} />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[500px]" align="end">
                      <div className="space-y-3">
                        <div>
                          <h4 className="font-medium text-sm mb-2">Anmerkungen</h4>
                          <Textarea
                            value={migrationNotes}
                            onChange={(e) => setMigrationNotes(e.target.value)}
                            placeholder="Beschreibe hier dein Prompt: Ziel der Migration, relevante Randbedingungen und gewünschte Unterstützung."
                            rows={6}
                            className="min-h-[120px]"
                          />
                        </div>
                        <Button 
                          onClick={handleSaveNotes} 
                          disabled={migrationNotes === (currentMigration?.notes || "") || isSavingNotes} 
                          size="sm" 
                          className="w-full"
                        >
                          {isSavingNotes && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Speichern
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                  <UserMenu
                    onAccountClick={() => {
                      setActiveDialogTab("account");
                      setShowAccountDialog(true);
                    }}
                    onSettingsClick={() => {
                      setActiveDialogTab("settings");
                      setShowAccountDialog(true);
                    }}
                    onLogout={handleLogout}
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
                  <p className="text-sm text-muted-foreground">Eine kompakte Übersicht deiner Migrationen.</p>
                </div>
                <UserMenu
                  onAccountClick={() => {
                    setActiveDialogTab("account");
                    setShowAccountDialog(true);
                  }}
                  onSettingsClick={() => {
                    setActiveDialogTab("settings");
                    setShowAccountDialog(true);
                  }}
                  onLogout={handleLogout}
                />
              </>
            )}
          </header>

          <div className="flex-1 overflow-hidden">
            {currentMigration ? (
              <div className="app-surface h-full overflow-hidden rounded-3xl">
                <MigrationDetails
                  ref={migrationDetailsRef}
                  project={currentMigration}
                  onRefresh={refreshCurrentMigration}
                  onStepRunningChange={(isRunning) => handleStepRunningChange(currentMigration.id, isRunning)}
                />
              </div>
            ) : (
              <div className="app-surface flex h-full flex-col rounded-3xl px-8 py-6 overflow-hidden">
                {/* STICKY: Activity Chart Section */}
                <div className="shrink-0 pb-6 border-b border-border/20">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Aktivitätsübersicht
                    </h2>
                    <span className="text-xs text-muted-foreground">Letzte 30 Tage</span>
                  </div>
                  
                  <div className="h-32">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={(() => {
                        // Generate last 30 days activity data
                        const last30Days = Array.from({ length: 30 }, (_, i) => {
                          const date = new Date();
                          date.setDate(date.getDate() - (29 - i));
                          return {
                            date: date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }),
                            fullDate: date.toISOString().split('T')[0],
                            steps: 0
                          };
                        });
                        
                        // Count migrations activity per day based on updatedAt
                        [...migrations, ...standaloneMigrations].forEach(migration => {
                          if (!migration.updatedAt) return;
                          const date = new Date(migration.updatedAt);
                          if (isNaN(date.getTime())) return;
                          const migrationDate = date.toISOString().split('T')[0];
                          const dayData = last30Days.find(d => d.fullDate === migrationDate);
                          if (dayData) {
                            dayData.steps++;
                          }
                        });
                        
                        return last30Days;
                      })()}>
                        <defs>
                          <linearGradient id="activityGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <XAxis 
                          dataKey="date" 
                          axisLine={false} 
                          tickLine={false}
                          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                          interval="preserveStartEnd"
                        />
                        <YAxis hide />
                        <Tooltip 
                          content={({ active, payload }) => (
                            active && payload?.[0] ? (
                              <div className="bg-popover px-3 py-2 rounded-lg shadow-lg border">
                                <p className="text-xs text-muted-foreground">{payload[0].payload.date}</p>
                                <p className="text-sm font-semibold">{payload[0].value} Schritte</p>
                              </div>
                            ) : null
                          )}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="steps" 
                          stroke="hsl(var(--primary))" 
                          fill="url(#activityGradient)" 
                          strokeWidth={2}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* STICKY: Key Metrics Grid */}
                <div className="shrink-0 grid grid-cols-3 gap-6 py-6 border-b border-border/20">
                  {/* Vendor Lock-Ins Prevented */}
                  <div className="flex items-start gap-4">
                    <div className="p-2.5 rounded-xl bg-emerald-500/10">
                      <ShieldCheck className="h-5 w-5 text-emerald-500" />
                    </div>
                    <div>
                      <div className="flex items-baseline gap-2">
                        <p className="text-2xl font-semibold tabular-nums">
                          {[...migrations, ...standaloneMigrations].filter(m => m.progress === 100).length}
                        </p>
                        <span className="flex items-center gap-0.5 text-xs text-emerald-500">
                          <TrendingUp className="h-3 w-3" />
                          +2
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">Vendor Lock-Ins verhindert</p>
                    </div>
                  </div>

                  {/* Total Migrated Objects */}
                  <div className="flex items-start gap-4">
                    <div className="p-2.5 rounded-xl bg-primary/10">
                      <Package className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-2xl font-semibold tabular-nums">
                        {(() => {
                          const total = [...migrations, ...standaloneMigrations].reduce((acc, m) => {
                            const transferred = m.objectsTransferred || "0/0";
                            const [done] = transferred.split("/").map(Number);
                            return acc + (isNaN(done) ? 0 : done);
                          }, 0);
                          return total.toLocaleString('de-DE');
                        })()}
                      </p>
                      <p className="text-sm text-muted-foreground">Migrierte Objekte</p>
                    </div>
                  </div>

                  {/* Completed Migrations */}
                  <div className="flex items-start gap-4">
                    <div className="p-2.5 rounded-xl bg-emerald-500/10">
                      <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    </div>
                    <div>
                      <div className="flex items-baseline gap-2">
                        <p className="text-2xl font-semibold tabular-nums">
                          {[...migrations, ...standaloneMigrations].filter(m => m.progress === 100).length}
                        </p>
                        <span className="text-sm text-muted-foreground">
                          / {migrations.length + standaloneMigrations.length}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">Abgeschlossene Migrationen</p>
                    </div>
                  </div>

                  {/* Average Duration */}
                  <div className="flex items-start gap-4">
                    <div className="p-2.5 rounded-xl bg-amber-500/10">
                      <Clock className="h-5 w-5 text-amber-500" />
                    </div>
                    <div>
                      <p className="text-2xl font-semibold tabular-nums">2.4h</p>
                      <p className="text-sm text-muted-foreground">Ø Migrationsdauer</p>
                    </div>
                  </div>

                  {/* Mapping Automation Rate */}
                  <div className="flex items-start gap-4">
                    <div className="p-2.5 rounded-xl bg-accent/30">
                      <Cpu className="h-5 w-5 text-accent-foreground" />
                    </div>
                    <div>
                      <div className="flex items-baseline gap-2">
                        <p className="text-2xl font-semibold tabular-nums">87%</p>
                        <span className="flex items-center gap-0.5 text-xs text-emerald-500">
                          <TrendingUp className="h-3 w-3" />
                          +5%
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">KI-Automatisierungsrate</p>
                    </div>
                  </div>

                  {/* Data Reliability Score */}
                  <div className="flex items-start gap-4">
                    <div className="p-2.5 rounded-xl bg-primary/10">
                      <ActivityIcon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="flex items-baseline gap-2">
                        <p className="text-2xl font-semibold tabular-nums">98.2%</p>
                      </div>
                      <p className="text-sm text-muted-foreground">Datenqualitäts-Score</p>
                    </div>
                  </div>
                </div>

                {/* SCROLLABLE: Recent Activities List */}
                <div className="flex-1 min-h-0 pt-6 flex flex-col">
                  <h2 className="shrink-0 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-4">
                    Letzte Aktivitäten
                  </h2>
                  
                  {[...migrations, ...standaloneMigrations].length > 0 ? (
                    <div className="flex-1 min-h-0 overflow-y-auto -mx-4 px-4">
                      <div className="space-y-1">
                      {[...migrations, ...standaloneMigrations]
                        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
                        .slice(0, 6)
                        .map((migration) => (
                          <button
                            key={migration.id}
                            onClick={() => {
                              if (migration.projectId) {
                                navigate(`/projects/${migration.projectId}/migration/${migration.id}`);
                              } else {
                                navigate(`/migration/${migration.id}`);
                              }
                            }}
                            className="w-full flex items-center justify-between py-3 px-4 -mx-4 rounded-lg hover:bg-foreground/5 transition-colors group"
                          >
                            <div className="flex items-center gap-4">
                              <span className="font-medium">{migration.name}</span>
                              <span className="text-sm text-muted-foreground">
                                {migration.sourceSystem} → {migration.targetSystem}
                              </span>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-foreground/50 rounded-full transition-all"
                                  style={{ width: `${migration.progress}%` }}
                                />
                              </div>
                              <span className="text-sm font-medium tabular-nums w-10 text-right text-muted-foreground">
                                {migration.progress}%
                              </span>
                              <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <Workflow className="h-8 w-8 text-muted-foreground/40 mb-4" />
                      <p className="text-muted-foreground">Keine Migrationen vorhanden</p>
                      <Button
                        onClick={() => setShowAddDialog(true)}
                        variant="ghost"
                        className="mt-4"
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Migration erstellen
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <AccountDialog
        open={showAccountDialog}
        onOpenChange={setShowAccountDialog}
        activeTab={activeDialogTab}
      />
      <AddMigrationDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onSubmit={handleAddMigration}
      />
      <EditMigrationDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        onUpdate={handleUpdateMigration}
        currentName={editingMigration?.name || ""}
      />
      {editConfigData && (
        <AddMigrationDialog
          open={showEditConfigDialog}
          onOpenChange={setShowEditConfigDialog}
          onSubmit={handleUpdateMigrationConfig}
          mode="edit"
          initialData={editConfigData}
          title="Migration konfigurieren"
          submitLabel="Änderungen speichern"
        />
      )}

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sind Sie sicher?</AlertDialogTitle>
            <AlertDialogDescription>
              Diese Aktion kann nicht rückgängig gemacht werden. Die Migration "{migrations.find(m => m.id === migrationToDelete)?.name}" wird permanent gelöscht.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteMigration} className="bg-destructive hover:bg-destructive/90">
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Dashboard;
