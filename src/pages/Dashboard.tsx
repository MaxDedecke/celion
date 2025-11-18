import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Sidebar from "@/components/Sidebar";
import UserMenu from "@/components/UserMenu";
import AccountDialog from "@/components/dialogs/AccountDialog";
import AddMigrationDialog from "@/components/dialogs/AddMigrationDialog";
import EditMigrationDialog from "@/components/dialogs/EditMigrationDialog";
import MigrationDetails from "@/components/MigrationDetails";
import DataFlowLoader from "@/components/DataFlowLoader";
import { Button } from "@/components/ui/button";
import {
  Plus,
  FolderKanban,
  Workflow,
  CheckCircle2,
  Timer,
  Activity as ActivityIcon,
  BarChart3,
  Rocket,
  ArrowRight,
  Settings
} from "lucide-react";
import { toast } from "sonner";
import { supabaseDatabase } from "@/api/supabaseDatabase";
import { useMinimumLoader } from "@/hooks/useMinimumLoader";
import type { Activity } from "@/components/ActivityTimeline";
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
import type { MigrationStatus, NewMigrationInput } from "@/types/migration";
import {
  AUTH_DETAIL_CREDENTIALS,
  AUTH_DETAIL_TOKEN,
  CONNECTOR_AUTH_LABEL,
  CONNECTOR_ENDPOINT_LABEL,
} from "@/constants/migrations";
import { duplicateMigration } from "@/lib/migrationDuplication";

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

const normalizeActivityRecord = (activity: RawActivityRecord): Activity => {
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
    type: (activity?.type ?? "info") as Activity["type"],
    title: activity?.title ?? "",
    timestamp,
  };
};

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
  const [projectIdForNewMigration, setProjectIdForNewMigration] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const loaderVisible = useMinimumLoader(loading || transitioning, 1000);

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
    const { data: { session } } = await supabaseDatabase.getSession();
    if (!session) {
      navigate("/");
    }
  };

  const loadAllData = async () => {
    try {
      setLoading(true);
      
      // Load all projects
      const { data: projectsData, error: projectsError } = await supabaseDatabase.fetchProjects();

      if (projectsError) throw projectsError;
      setAllProjects(projectsData || []);

      // Load all migrations with project_id
      const allMigrationsWithProjects: any[] = [];
      for (const project of projectsData || []) {
        const { data: migrationsData, error: migrationsError } = await supabaseDatabase.fetchMigrationsByProject(project.id);

        if (migrationsError) throw migrationsError;
        const migrationsWithDetails = await loadMigrationDetails(migrationsData || [], project.id);
        allMigrationsWithProjects.push(...migrationsWithDetails);
      }
      setMigrations(allMigrationsWithProjects);

      // Load standalone migrations
      const { data: standaloneData, error: standaloneError } = await supabaseDatabase.fetchStandaloneMigrations();

      if (standaloneError) throw standaloneError;

      const standaloneWithDetails = await loadMigrationDetails(standaloneData || [], null);
      setStandaloneMigrations(standaloneWithDetails);
    } catch (error: any) {
      toast.error("Fehler beim Laden der Daten");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const loadMigrationDetails = async (migrationsData: any[], projectId: string | null) => {
    return await Promise.all(
      migrationsData.map(async (migration) => {
        const { data: activitiesData } = await supabaseDatabase.fetchMigrationActivities(migration.id);

        const activities = (activitiesData || []).map(normalizeActivityRecord);
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
  };

  // Optimized refresh for only the current migration
  const refreshCurrentMigration = async () => {
    if (!selectedMigration) return;
    
    try {
      // Load only the selected migration
      const { data: migrationData, error: migrationError } = await supabaseDatabase.fetchMigrationById(selectedMigration);

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

  const handleLogout = async () => {
    try {
      setTransitioning(true);
      await supabaseDatabase.signOut();
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
      const { data: { user } } = await supabaseDatabase.getUser();
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

      const { data: migration, error: migrationError } = await supabaseDatabase.insertMigration({
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
        password: sourceAuth.password ?? null,
      };

      const targetConnectorPayload = {
        migration_id: migration.id,
        api_url: targetUrl,
        auth_type: "api_key",
        api_key: targetAuth.apiToken ?? null,
        username: targetAuth.email ?? null,
        password: targetAuth.password ?? null,
      };

      const { error: connectorError } = await supabaseDatabase.insertConnectors([
        { ...sourceConnectorPayload, connector_type: 'in' },
        { ...targetConnectorPayload, connector_type: 'out' },
      ]);

      if (connectorError) throw connectorError;

      // Create initial activity
        await supabaseDatabase.insertMigrationActivity({
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
      
      const { error } = await supabaseDatabase.deleteMigration(migrationToDelete);

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

  const handleEditMigration = (migrationId: string) => {
    const migration = migrations.find((m) => m.id === migrationId);
    if (migration) {
      setEditingMigration(migration);
      setShowEditDialog(true);
    }
  };

  const handleUpdateMigration = async (name: string) => {
    try {
      const { error } = await supabaseDatabase.updateMigration(editingMigration.id, { name });

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
      const { data: sourceConnectorData, error: sourceConnectorError } = await supabaseDatabase.fetchConnectorByType(
        currentMigration.id,
        'in'
      );

      if (sourceConnectorError) throw sourceConnectorError;

      const { data: targetConnectorData, error: targetConnectorError } = await supabaseDatabase.fetchConnectorByType(
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
    if (!currentMigration) return;

    try {
      // Update migration
      const { error: migrationError } = await supabaseDatabase.updateMigration(currentMigration.id, {
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
        password: data.sourceAuth.password ?? null,
      };

      const targetConnectorUpdates: Record<string, any> = {
        api_url: data.targetUrl,
        auth_type: "api_key",
        api_key: data.targetAuth.apiToken ?? null,
        username: data.targetAuth.email ?? null,
        password: data.targetAuth.password ?? null,
      };

      // Update source connector
      const { error: sourceConnectorError } = await supabaseDatabase.updateConnectorByType(
        currentMigration.id,
        'in',
        sourceConnectorUpdates
      );

      if (sourceConnectorError) throw sourceConnectorError;

      // Update target connector
      const { error: targetConnectorError } = await supabaseDatabase.updateConnectorByType(
        currentMigration.id,
        'out',
        targetConnectorUpdates
      );

      if (targetConnectorError) throw targetConnectorError;

      toast.success("Konfiguration erfolgreich aktualisiert");
      setShowEditConfigDialog(false);
      await loadAllData();
    } catch (error: any) {
      toast.error("Fehler beim Aktualisieren der Konfiguration");
      console.error(error);
    }
  };

  const currentMigration = selectedMigration 
    ? [...migrations, ...standaloneMigrations].find((m) => m.id === selectedMigration)
    : null;

  if (loaderVisible) {
    return (
      <div className="app-shell flex min-h-screen items-center justify-center p-6">
        <DataFlowLoader size="lg" />
      </div>
    );
  }

  return (
    <div className="app-shell flex min-h-screen flex-col p-6">
      <div className="flex flex-1 gap-6">
        <Sidebar
          projects={allProjects}
          projectMigrations={migrations}
          standaloneMigrations={standaloneMigrations}
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
        />

        <div className="flex flex-1 flex-col gap-6">
          <header
            data-sidebar-anchor
            className="app-surface flex items-center justify-between rounded-3xl px-6 py-5"
          >
            {currentMigration ? (
              <div className="flex flex-wrap items-center gap-4">
                <div className="inline-flex items-center gap-2 rounded-full bg-foreground/5 px-4 py-1 text-sm text-muted-foreground">
                  Migration
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-base font-semibold text-foreground">
                    {currentMigration.name}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleOpenEditConfig}
                    className="h-8 w-8"
                  >
                    <Settings className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
                <p className="text-sm text-muted-foreground">Eine kompakte Übersicht deiner Migrationen.</p>
              </div>
            )}
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
          </header>

          <div className="flex-1 overflow-hidden">
            {currentMigration ? (
              <div className="app-surface h-full overflow-hidden rounded-3xl">
                <MigrationDetails
                  project={currentMigration}
                  onRefresh={refreshCurrentMigration}
                />
              </div>
            ) : (
              <div className="app-surface flex h-full flex-col gap-6 overflow-auto rounded-3xl px-8 py-8">
                <div>
                  <h2 className="text-2xl font-semibold text-foreground">Willkommen zurück!</h2>
                  <p className="mt-2 text-sm text-muted-foreground">Hier ist eine Übersicht deiner Migrationen.</p>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <div className="app-subtle rounded-2xl p-5">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <FolderKanban className="h-4 w-4" />
                      <span>Projekte</span>
                    </div>
                    <p className="mt-3 text-2xl font-semibold text-foreground">{allProjects.length}</p>
                  </div>
                  <div className="app-subtle rounded-2xl p-5">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Workflow className="h-4 w-4" />
                      <span>Migrationen</span>
                    </div>
                    <p className="mt-3 text-2xl font-semibold text-foreground">{migrations.length + standaloneMigrations.length}</p>
                  </div>
                  <div className="app-subtle rounded-2xl p-5">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <CheckCircle2 className="h-4 w-4 text-success" />
                      <span>Abgeschlossen</span>
                    </div>
                    <p className="mt-3 text-2xl font-semibold text-foreground">
                      {[...migrations, ...standaloneMigrations].filter(m => m.progress === 100).length}
                    </p>
                  </div>
                  <div className="app-subtle rounded-2xl p-5">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Timer className="h-4 w-4" />
                      <span>In Arbeit</span>
                    </div>
                    <p className="mt-3 text-2xl font-semibold text-foreground">
                      {[...migrations, ...standaloneMigrations].filter(m => m.progress > 0 && m.progress < 100).length}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <div className="app-subtle rounded-2xl p-6">
                    <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                      <ActivityIcon className="h-5 w-5 text-muted-foreground" />
                      Aktuelle Migrationen
                    </h3>
                    <div className="mt-4 space-y-4">
                      {[...migrations, ...standaloneMigrations]
                        .sort((a, b) => b.progress - a.progress)
                        .slice(0, 5)
                        .map((migration) => (
                          <button
                            key={migration.id}
                            className="w-full rounded-2xl border border-border/50 px-4 py-3 text-left transition-colors hover:border-border/70 hover:bg-foreground/5"
                            onClick={() => {
                              if (migration.projectId) {
                                navigate(`/projects/${migration.projectId}/migration/${migration.id}`);
                              } else {
                                navigate(`/migration/${migration.id}`);
                              }
                            }}
                          >
                            <div className="flex items-center justify-between gap-4">
                              <div>
                                <p className="font-medium text-foreground">{migration.name}</p>
                                <p className="text-sm text-muted-foreground">
                                  <span className="inline-flex items-center gap-2">
                                    <span>{migration.sourceSystem}</span>
                                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                                    <span>{migration.targetSystem}</span>
                                  </span>
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-medium text-foreground">{migration.progress}%</p>
                                <div className="mt-2 h-2 w-24 rounded-full bg-muted">
                                  <div
                                    className="h-full rounded-full bg-foreground/70 transition-all"
                                    style={{ width: `${migration.progress}%` }}
                                  />
                                </div>
                              </div>
                            </div>
                          </button>
                        ))}
                      {[...migrations, ...standaloneMigrations].length === 0 && (
                        <div className="rounded-2xl border border-border/40 px-6 py-8 text-center text-muted-foreground">
                          <div className="mb-3 flex justify-center">
                            <Workflow className="h-6 w-6" />
                          </div>
                          <p>Noch keine Migrationen vorhanden</p>
                          <Button
                            onClick={() => setShowAddDialog(true)}
                            variant="outline"
                            className="mt-4 rounded-full px-5"
                          >
                            <Plus className="mr-2 h-4 w-4" />
                            Migration erstellen
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="app-subtle rounded-2xl p-6">
                    <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                      <BarChart3 className="h-5 w-5 text-muted-foreground" />
                      Fortschrittsübersicht
                    </h3>
                    <div className="mt-4 space-y-4">
                      {allProjects.slice(0, 5).map((project) => {
                        const projectMigrations = migrations.filter(m => m.projectId === project.id);
                        const avgProgress = projectMigrations.length > 0
                          ? Math.round(projectMigrations.reduce((sum, m) => sum + m.progress, 0) / projectMigrations.length)
                          : 0;

                        return (
                          <div key={project.id} className="rounded-2xl border border-border/50 px-4 py-3">
                            <div className="mb-2 flex items-center justify-between">
                              <p className="font-medium text-foreground">{project.name}</p>
                              <p className="text-sm font-medium text-foreground">{avgProgress}%</p>
                            </div>
                            <div className="h-2 w-full rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-foreground/70 transition-all"
                                style={{ width: `${avgProgress}%` }}
                              />
                            </div>
                            <p className="mt-2 text-xs text-muted-foreground">
                              {projectMigrations.length} Migration{projectMigrations.length !== 1 ? 'en' : ''}
                            </p>
                          </div>
                        );
                      })}
                      {allProjects.length === 0 && (
                        <p className="rounded-2xl border border-border/40 px-6 py-8 text-center text-muted-foreground">
                          Noch keine Projekte vorhanden
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="app-subtle flex flex-col items-center gap-4 rounded-2xl px-8 py-8 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-foreground/5">
                    <Rocket className="h-6 w-6 text-foreground" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">Bereit für eine neue Migration?</h3>
                  <p className="text-sm text-muted-foreground">Starte jetzt und migriere deine Daten nahtlos.</p>
                  <Button
                    onClick={() => setShowAddDialog(true)}
                    className="rounded-full px-5 py-2"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Neue Migration erstellen
                  </Button>
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

