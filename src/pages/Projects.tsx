import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Sidebar from "@/components/Sidebar";
import UserMenu from "@/components/UserMenu";
import AccountDialog from "@/components/dialogs/AccountDialog";
import AddProjectDialog from "@/components/dialogs/AddProjectDialog";
import AddMigrationDialog from "@/components/dialogs/AddMigrationDialog";
import EditProjectDialog from "@/components/dialogs/EditProjectDialog";
import EditMigrationDialog from "@/components/dialogs/EditMigrationDialog";
import DataFlowLoader from "@/components/DataFlowLoader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Folder, FolderOpen, Plus, Trash2, ClipboardList, Users } from "lucide-react";
import { toast } from "sonner";
import { databaseClient } from "@/api/databaseClient";
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
import type { NewMigrationInput } from "@/types/migration";
import {
  AUTH_DETAIL_CREDENTIALS,
  AUTH_DETAIL_TOKEN,
  CONNECTOR_AUTH_LABEL,
  CONNECTOR_ENDPOINT_LABEL,
} from "@/constants/migrations";

const MIGRATIONS_PAGE_SIZE = 20;

const Projects = () => {
  const navigate = useNavigate();
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [showAccountDialog, setShowAccountDialog] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showAddMigrationDialog, setShowAddMigrationDialog] = useState(false);
  
  const [projects, setProjects] = useState<any[]>([]);
  const [migrations, setMigrations] = useState<any[]>([]);
  const [standaloneMigrations, setStandaloneMigrations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingProject, setEditingProject] = useState<any>(null);
  const [editingMigration, setEditingMigration] = useState<any>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showEditMigrationDialog, setShowEditMigrationDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  const [migrationToDelete, setMigrationToDelete] = useState<string | null>(null);
  const [projectIdForNewMigration, setProjectIdForNewMigration] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const loaderVisible = useMinimumLoader(loading || transitioning, 1000);
  
  // Lazy loading state for standalone migrations
  const [hasMoreMigrations, setHasMoreMigrations] = useState(true);
  const [isLoadingMoreMigrations, setIsLoadingMoreMigrations] = useState(false);
  const [totalMigrationsCount, setTotalMigrationsCount] = useState(0);
  const migrationsPageRef = useRef(0);

  useEffect(() => {
    checkAuth();
    loadAllData();
  }, []);

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

      if (projectsError) throw projectsError;

      // Load migrations count for each project
      const projectsWithCounts = await Promise.all(
        (projectsData || []).map(async (project) => {
          const { count } = await databaseClient.countMigrationsByProject(project.id);

          return {
            id: project.id,
            name: project.name,
            description: project.description,
            migrationsCount: count || 0,
            created_at: project.created_at,
          };
        })
      );

      setProjects(projectsWithCounts);

      // Load all migrations with project_id
      const allMigrationsWithProjects: any[] = [];
      for (const project of projectsData || []) {
        const { data: migrationsData, error: migrationsError } = await databaseClient.fetchMigrationsByProject(project.id);

        if (migrationsError) throw migrationsError;
        
        const migrationsFormatted = (migrationsData || []).map(m => ({
          id: m.id,
          name: m.name,
          projectId: m.project_id
        }));
        allMigrationsWithProjects.push(...migrationsFormatted);
      }
      setMigrations(allMigrationsWithProjects);

      // Load standalone migrations with pagination (initial load)
      migrationsPageRef.current = 0;
      const { data: standaloneData, error: standaloneError, count } = await databaseClient.fetchStandaloneMigrationsPaginated(MIGRATIONS_PAGE_SIZE, 0);

      if (standaloneError) throw standaloneError;

      setTotalMigrationsCount(count || 0);
      setHasMoreMigrations((standaloneData?.length || 0) === MIGRATIONS_PAGE_SIZE);

      const standaloneFormatted = (standaloneData || []).map(m => ({
        id: m.id,
        name: m.name
      }));
      setStandaloneMigrations(standaloneFormatted);
      migrationsPageRef.current = 1;
    } catch (error: any) {
      toast.error("Fehler beim Laden der Daten");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // Load more migrations (infinite scroll)
  const handleLoadMoreMigrations = async () => {
    if (isLoadingMoreMigrations || !hasMoreMigrations) return;

    setIsLoadingMoreMigrations(true);
    try {
      const offset = migrationsPageRef.current * MIGRATIONS_PAGE_SIZE;
      const { data: standaloneData, error: standaloneError } = await databaseClient.fetchStandaloneMigrationsPaginated(MIGRATIONS_PAGE_SIZE, offset);

      if (standaloneError) throw standaloneError;

      const newMigrations = (standaloneData || []).map(m => ({
        id: m.id,
        name: m.name
      }));
      setStandaloneMigrations(prev => [...prev, ...newMigrations]);
      setHasMoreMigrations((standaloneData?.length || 0) === MIGRATIONS_PAGE_SIZE);
      migrationsPageRef.current++;
    } catch (error: any) {
      console.error("Fehler beim Laden weiterer Migrationen:", error);
    } finally {
      setIsLoadingMoreMigrations(false);
    }
  };

  const handleLogout = async () => {
    try {
      setTransitioning(true);
      await databaseClient.signOut();
      navigate("/");
    } catch (error) {
      toast.error("Abmeldung fehlgeschlagen");
      console.error(error);
    } finally {
      setTransitioning(false);
    }
  };

  const handleAddProject = async (data: { name: string; description: string }) => {
    try {
      const { data: { user } } = await databaseClient.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await databaseClient.insertProject({
        user_id: user.id,
        name: data.name,
        description: data.description,
      });

      if (error) throw error;

      toast.success("Projekt erfolgreich erstellt");
      await loadAllData();
    } catch (error: any) {
      toast.error(error.message || "Fehler beim Erstellen des Projekts");
      console.error(error);
    }
  };

  const handleEditProject = async (data: { name: string; description: string }) => {
    if (!editingProject) return;

    try {
      const { error } = await databaseClient.updateProject(editingProject.id, {
        name: data.name,
        description: data.description,
      });

      if (error) throw error;

      toast.success("Projekt aktualisiert");
      await loadAllData();
      setEditingProject(null);
    } catch (error: any) {
      toast.error(error.message || "Fehler beim Aktualisieren");
      console.error(error);
    }
  };

  const handleDeleteProject = async () => {
    if (!projectToDelete) return;

    try {
      const { error } = await databaseClient.deleteProject(projectToDelete);

      if (error) throw error;

      toast.success("Projekt gelöscht");
      setShowDeleteDialog(false);
      setProjectToDelete(null);
      await loadAllData();
    } catch (error: any) {
      toast.error("Fehler beim Löschen");
      console.error(error);
    }
  };

  const handleProjectClick = (projectId: string) => {
    navigate(`/projects/${projectId}`);
  };

  const handleAddMigration = async (migrationData: Partial<NewMigrationInput>) => {
    try {
      const { data: { user } } = await databaseClient.getUser();
      if (!user) throw new Error("Nicht authentifiziert");

      const name = migrationData.name || "Neue Migration";
      const sourceUrl = migrationData.sourceUrl || "";
      const targetUrl = migrationData.targetUrl || "";
      const sourceSystem = migrationData.sourceSystem || "TBD";
      const targetSystem = migrationData.targetSystem || "TBD";

      const targetAuthDetail = AUTH_DETAIL_TOKEN;
      const sourceConnectorAuthType = "api_key";
      const targetConnectorAuthType = "api_key";

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
      });

      if (migrationError) throw migrationError;

      if (migrationData.sourceAuth && migrationData.targetAuth) {
        const sourceConnectorPayload = {
          migration_id: migration.id,
          api_url: sourceUrl,
          auth_type: sourceConnectorAuthType,
          api_key: migrationData.sourceAuth.apiToken ?? null,
          username: migrationData.sourceAuth.email ?? null,
        };

        const targetConnectorPayload = {
          migration_id: migration.id,
          api_url: targetUrl,
          auth_type: targetConnectorAuthType,
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

      toast.success(`Migration aktualisiert auf "${name}"`);
      setShowEditMigrationDialog(false);
      setEditingMigration(null);
      loadAllData();
    } catch (error: any) {
      toast.error("Fehler beim Aktualisieren der Migration");
      console.error(error);
    }
  };

  const migrationsMemo = useMemo(() => migrations, [migrations]);
  const standaloneMigrationsMemo = useMemo(() => standaloneMigrations, [standaloneMigrations]);
  const projectsMemo = useMemo(() => projects, [projects]);

  if (loaderVisible) {
    return (
      <div className="app-shell flex h-screen items-center justify-center p-6 overflow-hidden">
        <DataFlowLoader size="lg" />
      </div>
    );
  }

  return (
    <div className="app-shell flex h-screen flex-col px-6 pt-6 pb-6 overflow-hidden">
      <div className="flex flex-1 gap-6 min-h-0">
        <Sidebar
          projects={projectsMemo}
          projectMigrations={migrationsMemo}
          standaloneMigrations={standaloneMigrationsMemo}
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
            setShowAddMigrationDialog(true);
          }}
          onNewProjectMigration={(projectId) => {
            setProjectIdForNewMigration(projectId);
            setShowAddMigrationDialog(true);
          }}
          onDeleteMigration={handleDeleteMigration}
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
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-foreground/5">
                <Folder className="h-6 w-6 text-foreground" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-foreground">Projekte</h1>
                <p className="text-sm text-muted-foreground">Behalte den Überblick über deine Migrationsvorhaben.</p>
              </div>
            </div>
            <UserMenu
              onSettingsClick={() => setShowAccountDialog(true)}
              onLogout={handleLogout}
            />
          </header>

          <div className="flex-1 overflow-hidden">
            <div className="app-surface flex h-full flex-col overflow-hidden rounded-3xl">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 px-6 py-5">
                <div>
                  <p className="text-sm text-muted-foreground">
                    Lege neue Projekte an oder öffne bestehende Migrationen.
                  </p>
                </div>
                <Button
                  onClick={() => setShowAddDialog(true)}
                  className="gap-2 rounded-full px-5 py-2 text-sm font-medium"
                >
                  <Plus className="h-4 w-4" />
                  Neues Projekt
                </Button>
              </div>

              <div className="flex-1 overflow-auto px-6 py-6">
                {loading ? (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    Projekte werden geladen...
                  </div>
                ) : projects.length === 0 ? (
                  <div className="app-subtle flex h-full flex-col items-center justify-center gap-4 px-10 py-12 text-center">
                    <FolderOpen className="h-12 w-12 text-muted-foreground" />
                    <div className="space-y-2">
                      <h3 className="text-lg font-semibold text-foreground">Noch keine Projekte</h3>
                      <p className="text-sm text-muted-foreground">
                        Erstelle dein erstes Projekt, um Migrationen zu verwalten.
                      </p>
                    </div>
                    <Button
                      onClick={() => setShowAddDialog(true)}
                      variant="outline"
                      className="rounded-full px-5"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Projekt erstellen
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {projects.map((project) => (
                      <Card
                        key={project.id}
                        className="group relative cursor-pointer overflow-hidden border-border/60 bg-gradient-to-br from-background/95 to-background/80 transition-all duration-200 hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_24px_48px_-28px_rgba(15,23,42,0.45)]"
                        onClick={() => handleProjectClick(project.id)}
                      >
                        <CardHeader>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute right-4 top-4 h-8 w-8 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              setProjectToDelete(project.id);
                              setShowDeleteDialog(true);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          <div className="flex items-start gap-3 pr-10">
                            <div className="mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-foreground/5 text-foreground transition-all duration-300 group-hover:bg-primary/10 group-hover:text-primary">
                              <ClipboardList className="h-4 w-4" />
                            </div>
                            <div>
                              <CardTitle className="text-xl text-foreground group-hover:text-primary">{project.name}</CardTitle>
                              <CardDescription className="text-sm text-muted-foreground">
                                {project.description || "Keine Beschreibung"}
                              </CardDescription>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Users className="h-4 w-4 text-foreground/80" />
                            <span>
                              {project.migrationsCount} {project.migrationsCount === 1 ? "Migration" : "Migrationen"}
                            </span>
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

      <AccountDialog
        open={showAccountDialog}
        onOpenChange={setShowAccountDialog}
      />

      <AddProjectDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onSave={handleAddProject}
      />

      <AddMigrationDialog
        open={showAddMigrationDialog}
        onOpenChange={setShowAddMigrationDialog}
        onSubmit={handleAddMigration}
      />

      <EditProjectDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        project={editingProject}
        onSave={handleEditProject}
      />

      <EditMigrationDialog
        open={showEditMigrationDialog}
        onOpenChange={setShowEditMigrationDialog}
        currentName={editingMigration?.name || ""}
        onUpdate={handleUpdateMigration}
      />

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Projekt löschen</AlertDialogTitle>
            <AlertDialogDescription>
              Sind Sie sicher, dass Sie dieses Projekt löschen möchten? Alle zugehörigen Migrationen werden ebenfalls gelöscht.
              Diese Aktion kann nicht rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteProject}>
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Projects;


