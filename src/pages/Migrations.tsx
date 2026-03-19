import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Sidebar from "@/components/Sidebar";
import UserMenu from "@/components/UserMenu";
import AccountDialog from "@/components/dialogs/AccountDialog";
import AddMigrationDialog from "@/components/dialogs/AddMigrationDialog";
import EditMigrationDialog from "@/components/dialogs/EditMigrationDialog";
import DataFlowLoader from "@/components/DataFlowLoader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { useMinimumLoader } from "@/hooks/useMinimumLoader";
import { databaseClient } from "@/api/databaseClient";
import { toast } from "sonner";
import type { NewMigrationInput } from "@/types/migration";
import {
  AUTH_DETAIL_CREDENTIALS,
  AUTH_DETAIL_TOKEN,
  CONNECTOR_AUTH_LABEL,
  CONNECTOR_ENDPOINT_LABEL,
} from "@/constants/migrations";
import { ArrowRight, Plus, Trash2, FolderKanban, Copy, Settings2 } from "lucide-react";
import { duplicateMigration } from "@/lib/migrationDuplication";

interface SidebarMigration {
  id: string;
  name: string;
  projectId: string | null;
}

interface ProjectMigrationCard {
  id: string;
  name: string;
  createdAt: string | null;
  sourceSystem?: string | null;
  targetSystem?: string | null;
  updatedAt?: string | null;
  progress?: number;
}

interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
}

const MIGRATIONS_PAGE_SIZE = 20;

const Migrations = () => {
  const navigate = useNavigate();

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [migrations, setMigrations] = useState<ProjectMigrationCard[]>([]);
  const [standaloneMigrations, setStandaloneMigrations] = useState<ProjectMigrationCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [transitioning, setTransitioning] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const loaderVisible = useMinimumLoader(loading || transitioning || duplicating, 900);

  const [showAccountDialog, setShowAccountDialog] = useState(false);
  const [showAddMigrationDialog, setShowAddMigrationDialog] = useState(false);
  const [showEditMigrationDialog, setShowEditMigrationDialog] = useState(false);
  const [editingMigration, setEditingMigration] = useState<any>(null);
  const [projectIdForNewMigration, setProjectIdForNewMigration] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [migrationToDelete, setMigrationToDelete] = useState<{ id: string; name: string } | null>(null);

  // Lazy loading state for standalone migrations
  const [hasMoreMigrations, setHasMoreMigrations] = useState(true);
  const [isLoadingMoreMigrations, setIsLoadingMoreMigrations] = useState(false);
  const [totalMigrationsCount, setTotalMigrationsCount] = useState(0);
  const migrationsPageRef = useRef(0);

  const checkAuth = useCallback(async () => {
    const {
      data: { session },
    } = await databaseClient.getSession();
    if (!session) {
      navigate("/");
    }
  }, [navigate]);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  const loadAllData = useCallback(async () => {
    try {
      const { data: projectsData, error: projectsError } = await databaseClient.fetchProjects();

      if (projectsError) throw projectsError;

      setProjects(
        (projectsData || []).map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
        }))
      );

      const allMigrations: ProjectMigrationCard[] = [];

      for (const project of projectsData || []) {
        const { data: projectMigrationsData, error: projectMigrationsError } = await databaseClient.fetchMigrationsByProject(project.id);

        if (projectMigrationsError) throw projectMigrationsError;

        allMigrations.push(
          ...(projectMigrationsData || []).map((migration) => ({
            id: migration.id,
            name: migration.name,
            createdAt: migration.created_at,
            sourceSystem: migration.source_system,
            targetSystem: migration.target_system,
            updatedAt: migration.updated_at,
            progress: migration.progress,
          }))
        );
      }

      setMigrations(allMigrations);

      // Reset standalone pagination
      migrationsPageRef.current = 0;
      const { data: standaloneData, error: standaloneError, count } = await databaseClient.fetchStandaloneMigrationsPaginated(MIGRATIONS_PAGE_SIZE, 0);

      if (standaloneError) throw standaloneError;

      setTotalMigrationsCount(count || 0);
      setHasMoreMigrations((standaloneData?.length || 0) === MIGRATIONS_PAGE_SIZE);
      migrationsPageRef.current = 1;

      setStandaloneMigrations(
        (standaloneData || []).map((migration) => ({
          id: migration.id,
          name: migration.name,
          createdAt: migration.created_at,
          sourceSystem: migration.source_system,
          targetSystem: migration.target_system,
          updatedAt: migration.updated_at,
          progress: migration.progress,
        }))
      );
    } catch (error) {
      console.error(error);
      toast.error("Fehler beim Laden der Daten");
    }
  }, []);

  // Load more migrations (infinite scroll)
  const handleLoadMoreMigrations = useCallback(async () => {
    if (isLoadingMoreMigrations || !hasMoreMigrations) return;

    setIsLoadingMoreMigrations(true);
    try {
      const offset = migrationsPageRef.current * MIGRATIONS_PAGE_SIZE;
      const { data: standaloneData, error: standaloneError } = await databaseClient.fetchStandaloneMigrationsPaginated(MIGRATIONS_PAGE_SIZE, offset);

      if (standaloneError) throw standaloneError;

      const newMigrations = (standaloneData || []).map(m => ({
        id: m.id,
        name: m.name,
        createdAt: m.created_at,
        sourceSystem: m.source_system,
        targetSystem: m.target_system,
        updatedAt: m.updated_at,
        progress: m.progress,
      }));
      setStandaloneMigrations(prev => [...prev, ...newMigrations]);
      setHasMoreMigrations((standaloneData?.length || 0) === MIGRATIONS_PAGE_SIZE);
      migrationsPageRef.current++;
    } catch (error: any) {
      console.error("Fehler beim Laden weiterer Migrationen:", error);
    } finally {
      setIsLoadingMoreMigrations(false);
    }
  }, [isLoadingMoreMigrations, hasMoreMigrations]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        await loadAllData();
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
  }, [loadAllData]);

  const handleLogout = async () => {
    try {
      setTransitioning(true);
      await databaseClient.signOut();
      navigate("/");
    } catch (error) {
      console.error(error);
      toast.error("Abmeldung fehlgeschlagen");
    } finally {
      setTransitioning(false);
    }
  };

  const handleSelectMigration = (id: string) => {
    const migration = [...migrations, ...standaloneMigrations].find((m) => m.id === id);
    if (migration) {
      const projId = projects.find(p => migrations.some(m => m.id === id))?.id;
      if (projId) {
        navigate(`/projects/${projId}/migration/${id}`);
      } else {
        navigate(`/migration/${id}`);
      }
    }
  };

  const handleAddMigration = async (migrationData: Partial<NewMigrationInput>) => {
    try {
      const {
        data: { user },
      } = await databaseClient.getUser();
      if (!user) throw new Error("Nicht authentifiziert");

      const name = migrationData.name || "Neue Migration";
      const sourceUrl = migrationData.sourceUrl || "";
      const targetUrl = migrationData.targetUrl || "";
      const sourceSystem = migrationData.sourceSystem || "TBD";
      const targetSystem = migrationData.targetSystem || "TBD";
      
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
        in_connector_detail: sourceUrl || "TBD",
        out_connector: CONNECTOR_AUTH_LABEL,
        out_connector_detail: targetAuthDetail,
      });

      if (migrationError) throw migrationError;

      if (migrationData.sourceAuth && migrationData.targetAuth) {
          const sourceConnectorPayload = {
            migration_id: migration.id,
            api_url: sourceUrl,
            auth_type: "api_key",
            api_key: migrationData.sourceAuth.apiToken ?? null,
            username: migrationData.sourceAuth.email ?? null,
          };
    
          const targetConnectorPayload = {
            migration_id: migration.id,
            api_url: targetUrl,
            auth_type: "api_key",
            api_key: migrationData.targetAuth.apiToken ?? null,
            username: migrationData.targetAuth.email ?? null,
          };
    
          const { error: connectorError } = await databaseClient.insertConnectors([
            { ...sourceConnectorPayload, connector_type: 'in' },
            { ...targetConnectorPayload, connector_type: 'out' },
          ]);
    
          if (connectorError) throw connectorError;
      }

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

  const handleDeleteMigration = async (migrationId: string) => {
    try {
      const { error } = await databaseClient.deleteMigration(migrationId);

      if (error) throw error;

      toast.success("Migration gelöscht");
      loadAllData();
    } catch (error: any) {
      toast.error("Fehler beim Löschen der Migration");
      console.error(error);
    }
  };

  const handleEditMigration = (migrationId: string) => {
    const migration = [...migrations, ...standaloneMigrations].find((m) => m.id === migrationId);
    if (migration) {
      setEditingMigration(migration);
      setShowEditMigrationDialog(true);
    }
  };

  const handleUpdateMigration = async (name: string) => {
    try {
      const { error } = await databaseClient.updateMigration(editingMigration.id, { name });

      if (error) throw error;

      toast.success("Migration aktualisiert");
      setShowEditMigrationDialog(false);
      setEditingMigration(null);
      loadAllData();
    } catch (error: any) {
      toast.error("Fehler beim Aktualisieren der Migration");
      console.error(error);
    }
  };

  const handleDuplicateMigration = async (migrationId: string) => {
    try {
      setDuplicating(true);
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
      toast.error(error instanceof Error ? error.message : "Migration konnte nicht dupliziert werden");
      console.error(error);
    } finally {
      setDuplicating(false);
    }
  };

  const projectMigrationsMemo = useMemo(() => 
    migrations.map(m => ({ ...m, projectId: projects.find(p => migrations.some(mig => mig.id === m.id))?.id || null })),
    [migrations, projects]
  );

  const standaloneMigrationsMemo = useMemo(() => 
    standaloneMigrations.map(m => ({ ...m, projectId: null })),
    [standaloneMigrations]
  );

  if (loaderVisible) {
    return (
      <div className="app-shell flex h-screen items-center justify-center p-6 overflow-hidden">
        <DataFlowLoader size="lg" message={duplicating ? "Dupliziere Migration..." : undefined} />
      </div>
    );
  }

  return (
    <div className="app-shell flex h-screen flex-col px-6 pt-6 pb-6 overflow-hidden">
      <div className="flex flex-1 gap-6 min-h-0">
        <Sidebar
          projects={projects}
          projectMigrations={projectMigrationsMemo}
          standaloneMigrations={standaloneMigrationsMemo}
          onSelectMigration={handleSelectMigration}
          onNewMigration={() => {
            setProjectIdForNewMigration(null);
            setShowAddMigrationDialog(true);
          }}
          onNewProjectMigration={(projectId) => {
            setProjectIdForNewMigration(projectId);
            setShowAddMigrationDialog(true);
          }}
          onDeleteMigration={(migrationId) => {
            const migration = [...migrations, ...standaloneMigrations].find(
              (m) => m.id === migrationId
            );
            if (migration) {
              setMigrationToDelete({ id: migration.id, name: migration.name });
              setShowDeleteDialog(true);
            }
          }}
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
            <div>
              <h1 className="text-xl font-semibold text-foreground">Migrationen</h1>
              <p className="text-sm text-muted-foreground">Verwalte deine Migrationsprojekte und erstelle neue.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => {
                  setProjectIdForNewMigration(null);
                  setShowAddMigrationDialog(true);
                }}
                className="gap-2 rounded-full px-5 py-2 text-sm font-medium"
              >
                <Plus className="h-4 w-4" />
                Neue Migration
              </Button>
              <UserMenu
                onSettingsClick={() => setShowAccountDialog(true)}
                onLogout={handleLogout}
              />
            </div>
          </header>

          <div className="flex-1 overflow-hidden">
            <div className="app-surface flex h-full flex-col overflow-hidden rounded-3xl">
              <div className="flex items-center justify-between border-b border-border/60 px-6 py-5">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Alle Migrationen</h2>
                  <p className="text-sm text-muted-foreground">
                    Eine Übersicht über alle deine Migrationsprojekte.
                  </p>
                </div>
              </div>

              <div className="flex-1 overflow-auto px-6 py-6">
                {[...migrations, ...standaloneMigrations].length === 0 ? (
                  <div className="app-subtle flex h-full flex-col items-center justify-center gap-4 text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-foreground/5">
                      <FolderKanban className="h-7 w-7 text-muted-foreground" />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-lg font-semibold text-foreground">Keine Migrationen vorhanden</h3>
                      <p className="text-sm text-muted-foreground">
                        Lege deine erste Migration an um zu starten.
                      </p>
                    </div>
                    <Button
                      onClick={() => {
                        setProjectIdForNewMigration(null);
                        setShowAddMigrationDialog(true);
                      }}
                      variant="outline"
                      className="rounded-full px-5"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Migration erstellen
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {[...migrations, ...standaloneMigrations]
                      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
                      .map((migration) => (
                      <Card
                        key={migration.id}
                        className="group relative cursor-pointer overflow-hidden border-border/60 bg-gradient-to-br from-background/95 to-background/80 transition-all duration-200 hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_24px_48px_-28px_rgba(15,23,42,0.45)]"
                        onClick={() => handleSelectMigration(migration.id)}
                      >
                        <CardHeader className="space-y-3 pb-6">
                          <div className="absolute right-4 top-4 flex items-center gap-2">
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                handleEditMigration(migration.id);
                              }}
                              className="rounded-full bg-background/80 p-2 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                              aria-label="Migration bearbeiten"
                            >
                              <Settings2 className="h-4 w-4" />
                            </button>
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleDuplicateMigration(migration.id);
                              }}
                              className="rounded-full bg-background/80 p-2 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                              aria-label="Migration duplizieren"
                            >
                              <Copy className="h-4 w-4" />
                            </button>
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                setMigrationToDelete({ id: migration.id, name: migration.name });
                                setShowDeleteDialog(true);
                              }}
                              className="rounded-full bg-background/80 p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                              aria-label="Migration löschen"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="flex items-start gap-3 pr-10">
                            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-foreground/5 text-foreground transition-all duration-300 group-hover:bg-primary/10 group-hover:text-primary">
                              <ArrowRight className="h-5 w-5" />
                            </div>
                            <div>
                              <CardTitle className="text-lg font-semibold text-foreground group-hover:text-primary">
                                {migration.name}
                              </CardTitle>
                              <CardDescription className="text-xs uppercase tracking-wide text-muted-foreground">
                                {migration.createdAt
                                  ? new Date(migration.createdAt).toLocaleDateString("de-DE")
                                  : "Kein Datum verfügbar"}
                              </CardDescription>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-4 pb-6">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            {migration.sourceSystem && (
                              <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
                                {migration.sourceSystem}
                              </Badge>
                            )}
                            {migration.sourceSystem && migration.targetSystem && (
                              <ArrowRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                            )}
                            {migration.targetSystem && (
                              <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/5 text-emerald-600 dark:text-emerald-300">
                                {migration.targetSystem}
                              </Badge>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <AccountDialog open={showAccountDialog} onOpenChange={setShowAccountDialog} />

      <AddMigrationDialog
        open={showAddMigrationDialog}
        onOpenChange={setShowAddMigrationDialog}
        onSubmit={handleAddMigration}
      />

      <EditMigrationDialog
        open={showEditMigrationDialog}
        onOpenChange={setShowEditMigrationDialog}
        currentName={editingMigration?.name || ""}
        onUpdate={handleUpdateMigration}
      />

      <AlertDialog
        open={showDeleteDialog}
        onOpenChange={(open) => {
          setShowDeleteDialog(open);
          if (!open) {
            setMigrationToDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Migration löschen</AlertDialogTitle>
            <AlertDialogDescription>
              Möchtest du die Migration "{migrationToDelete?.name}" wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (migrationToDelete) {
                void handleDeleteMigration(migrationToDelete.id);
                setShowDeleteDialog(false);
                setMigrationToDelete(null);
              }
            }}>Löschen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Migrations;
