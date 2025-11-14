import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { NewMigrationInput } from "@/types/migration";
import {
  AUTH_DETAIL_CREDENTIALS,
  AUTH_DETAIL_TOKEN,
  CONNECTOR_AUTH_LABEL,
  CONNECTOR_ENDPOINT_LABEL,
} from "@/constants/migrations";
import { ArrowLeft, ArrowRight, Plus, Trash2, FolderKanban } from "lucide-react";

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
}

interface ProjectDetails {
  id: string;
  name: string;
  description: string | null;
}

const ProjectDetail = () => {
  const navigate = useNavigate();
  const { projectName: rawProjectName } = useParams<{ projectName?: string }>();
  const projectName = useMemo(
    () => (rawProjectName ? decodeURIComponent(rawProjectName) : ""),
    [rawProjectName]
  );

  const [projects, setProjects] = useState<ProjectDetails[]>([]);
  const [sidebarMigrations, setSidebarMigrations] = useState<SidebarMigration[]>([]);
  const [standaloneMigrations, setStandaloneMigrations] = useState<SidebarMigration[]>([]);
  const [project, setProject] = useState<ProjectDetails | null>(null);
  const [projectMigrations, setProjectMigrations] = useState<ProjectMigrationCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [transitioning, setTransitioning] = useState(false);
  const loaderVisible = useMinimumLoader(loading || transitioning, 900);

  const [showAccountDialog, setShowAccountDialog] = useState(false);
  const [activeDialogTab, setActiveDialogTab] = useState<"account" | "settings">("account");
  const [showAddMigrationDialog, setShowAddMigrationDialog] = useState(false);
  const [showEditMigrationDialog, setShowEditMigrationDialog] = useState(false);
  const [editingMigration, setEditingMigration] = useState<SidebarMigration | null>(null);
  const [projectIdForNewMigration, setProjectIdForNewMigration] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [migrationToDelete, setMigrationToDelete] = useState<string | null>(null);

  const checkAuth = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      navigate("/");
    }
  }, [navigate]);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  const loadSidebarData = useCallback(async () => {
    try {
      const { data: projectsData, error: projectsError } = await supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false });

      if (projectsError) throw projectsError;

      setProjects(
        (projectsData || []).map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
        }))
      );

      const projectMigrationEntries: SidebarMigration[] = [];

      for (const project of projectsData || []) {
        const { data: projectMigrationsData, error: projectMigrationsError } = await supabase
          .from("migrations")
          .select("id, name, project_id")
          .eq("project_id", project.id)
          .order("created_at", { ascending: false });

        if (projectMigrationsError) throw projectMigrationsError;

        projectMigrationEntries.push(
          ...(projectMigrationsData || []).map((migration) => ({
            id: migration.id,
            name: migration.name,
            projectId: migration.project_id,
          }))
        );
      }

      setSidebarMigrations(projectMigrationEntries);

      const { data: standaloneData, error: standaloneError } = await supabase
        .from("migrations")
        .select("id, name")
        .is("project_id", null)
        .order("created_at", { ascending: false });

      if (standaloneError) throw standaloneError;

      setStandaloneMigrations(
        (standaloneData || []).map((migration) => ({
          id: migration.id,
          name: migration.name,
          projectId: null,
        }))
      );
    } catch (error) {
      console.error(error);
      toast.error("Fehler beim Laden der Projekte");
    }
  }, []);

  const loadProjectData = useCallback(
    async (name: string) => {
      try {
        const { data: projectData, error: projectError } = await supabase
          .from("projects")
          .select("*")
          .eq("name", name)
          .maybeSingle();

        if (projectError) throw projectError;

        if (!projectData) {
          toast.error("Projekt nicht gefunden");
          navigate("/projects");
          return;
        }

        const details: ProjectDetails = {
          id: projectData.id,
          name: projectData.name,
          description: projectData.description,
        };

        setProject(details);
        setProjectIdForNewMigration(projectData.id);

        const { data: migrationsData, error: migrationsError } = await supabase
          .from("migrations")
          .select("*")
          .eq("project_id", projectData.id)
          .order("created_at", { ascending: false });

        if (migrationsError) throw migrationsError;

        setProjectMigrations(
          (migrationsData || []).map((migration) => ({
            id: migration.id,
            name: migration.name,
            createdAt: migration.created_at,
            sourceSystem: migration.source_system,
            targetSystem: migration.target_system,
          }))
        );
      } catch (error) {
        console.error(error);
        toast.error("Projekt konnte nicht geladen werden");
      }
    },
    [navigate]
  );

  useEffect(() => {
    if (!projectName) {
      navigate("/projects");
      return;
    }

    const fetchData = async () => {
      try {
        setLoading(true);
        await Promise.all([loadSidebarData(), loadProjectData(projectName)]);
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
  }, [projectName, loadSidebarData, loadProjectData, navigate]);
  const handleLogout = async () => {
    try {
      setTransitioning(true);
      await supabase.auth.signOut();
      navigate("/");
    } catch (error) {
      console.error(error);
      toast.error("Abmeldung fehlgeschlagen");
    } finally {
      setTransitioning(false);
    }
  };

  const handleSelectMigration = (id: string) => {
    const migration = [...sidebarMigrations, ...standaloneMigrations].find((m) => m.id === id);
    if (migration) {
      if (migration.projectId) {
        navigate(`/projects/${migration.projectId}/migration/${migration.id}`);
      } else {
        navigate(`/migration/${migration.id}`);
      }
    }
  };

  const handleAddMigration = async (migrationData: NewMigrationInput) => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Nicht authentifiziert");

      const {
        name,
        sourceUrl,
        targetUrl,
        sourceSystem,
        targetSystem,
        authType,
        apiToken,
        username,
        password,
      } = migrationData;
      const authDetail = authType === "token" ? AUTH_DETAIL_TOKEN : AUTH_DETAIL_CREDENTIALS;
      const connectorAuthType = authType === "token" ? "api_key" : "basic";

      const { data: migration, error: migrationError } = await supabase
        .from("migrations")
        .insert({
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
          out_connector_detail: authDetail,
        })
        .select()
        .single();

      if (migrationError) throw migrationError;

      const sourceConnectorPayload = {
        migration_id: migration.id,
        api_url: sourceUrl,
        auth_type: connectorAuthType,
        api_key: authType === "token" ? apiToken ?? null : null,
        username: authType === "credentials" ? username ?? null : null,
        password: authType === "credentials" ? password ?? null : null,
      };

      const targetConnectorPayload = {
        migration_id: migration.id,
        api_url: targetUrl,
        auth_type: connectorAuthType,
        api_key: authType === "token" ? apiToken ?? null : null,
        username: authType === "credentials" ? username ?? null : null,
        password: authType === "credentials" ? password ?? null : null,
      };

      const { error: connectorError } = await supabase
        .from("connectors")
        .insert([
          { ...sourceConnectorPayload, connector_type: "in" },
          { ...targetConnectorPayload, connector_type: "out" },
        ]);

      if (connectorError) throw connectorError;

      await supabase
        .from("migration_activities")
        .insert({
          migration_id: migration.id,
          type: "info",
          title: "Neues Migrationsprojekt erstellt",
          timestamp: new Date().toISOString(),
        });

      toast.success(`Migration "${name}" erstellt`);
      setShowAddMigrationDialog(false);

      await Promise.all([loadSidebarData(), loadProjectData(projectName)]);

      if (projectIdForNewMigration) {
        navigate(`/projects/${projectIdForNewMigration}/migration/${migration.id}`);
      } else {
        navigate(`/migration/${migration.id}`);
      }
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Fehler beim Erstellen der Migration"
      );
    }
  };

  const handleDeleteMigration = async () => {
    if (!migrationToDelete) return;

    try {
      const { error } = await supabase
        .from("migrations")
        .delete()
        .eq("id", migrationToDelete);

      if (error) throw error;

      toast.success("Migration gelöscht");
      setShowDeleteDialog(false);
      setMigrationToDelete(null);
      await Promise.all([loadSidebarData(), loadProjectData(projectName)]);
    } catch (error) {
      console.error(error);
      toast.error("Fehler beim Löschen der Migration");
    }
  };

  const handleEditMigration = (migrationId: string) => {
    const migration = [...sidebarMigrations, ...standaloneMigrations].find((m) => m.id === migrationId);
    if (migration) {
      setEditingMigration(migration);
      setShowEditMigrationDialog(true);
    }
  };

  const handleUpdateMigration = async (name: string) => {
    if (!editingMigration) return;

    try {
      const { error } = await supabase
        .from("migrations")
        .update({ name })
        .eq("id", editingMigration.id);

      if (error) throw error;

      toast.success(`Migration aktualisiert auf "${name}"`);
      setShowEditMigrationDialog(false);
      setEditingMigration(null);
      await Promise.all([loadSidebarData(), loadProjectData(projectName)]);
    } catch (error) {
      console.error(error);
      toast.error("Fehler beim Aktualisieren der Migration");
    }
  };

  if (loaderVisible) {
    return (
      <div className="app-shell flex min-h-screen items-center justify-center p-6">
        <DataFlowLoader size="lg" />
      </div>
    );
  }

  if (!project) {
    return null;
  }

  return (
    <div className="app-shell flex min-h-screen flex-col p-6">
      <div className="flex flex-1 gap-6">
        <Sidebar
          projects={projects}
          projectMigrations={sidebarMigrations}
          standaloneMigrations={standaloneMigrations}
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
            setMigrationToDelete(migrationId);
            setShowDeleteDialog(true);
          }}
          onEditMigration={handleEditMigration}
        />

        <div className="flex flex-1 flex-col gap-6">
          <header
            data-sidebar-anchor
            className="app-surface flex items-center justify-between rounded-3xl px-6 py-5"
          >
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate("/projects")}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-foreground/5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                aria-label="Zurück zu den Projekten"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Projektübersicht</p>
                <h1 className="text-xl font-semibold text-foreground">{project.name}</h1>
                <p className="text-sm text-muted-foreground">
                  {project.description || "Keine Beschreibung vorhanden."}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => {
                  setProjectIdForNewMigration(project.id);
                  setShowAddMigrationDialog(true);
                }}
                className="gap-2 rounded-full px-5 py-2 text-sm font-medium"
              >
                <Plus className="h-4 w-4" />
                Neue Migration
              </Button>
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
          </header>

          <div className="flex-1 overflow-hidden">
            <div className="app-surface flex h-full flex-col overflow-hidden rounded-3xl">
              <div className="flex items-center justify-between border-b border-border/60 px-6 py-5">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Migrationen in diesem Projekt</h2>
                  <p className="text-sm text-muted-foreground">
                    Öffne eine Migration um die Details zu sehen oder lösche sie direkt über das Menü.
                  </p>
                </div>
              </div>

              <div className="flex-1 overflow-auto px-6 py-6">
                {projectMigrations.length === 0 ? (
                  <div className="app-subtle flex h-full flex-col items-center justify-center gap-4 text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-foreground/5">
                      <FolderKanban className="h-7 w-7 text-muted-foreground" />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-lg font-semibold text-foreground">Keine Migrationen vorhanden</h3>
                      <p className="text-sm text-muted-foreground">
                        Lege deine erste Migration für dieses Projekt an.
                      </p>
                    </div>
                    <Button
                      onClick={() => {
                        setProjectIdForNewMigration(project.id);
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
                    {projectMigrations.map((migration) => (
                      <Card
                        key={migration.id}
                        className="group relative cursor-pointer overflow-hidden border-border/60 bg-gradient-to-br from-background/95 to-background/80 transition-all duration-200 hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_24px_48px_-28px_rgba(15,23,42,0.45)]"
                        onClick={() => navigate(`/projects/${project.id}/migration/${migration.id}`)}
                      >
                        <CardHeader className="space-y-3 pb-6">
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              setMigrationToDelete(migration.id);
                              setShowDeleteDialog(true);
                            }}
                            className="absolute right-4 top-4 rounded-full bg-background/80 p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                            aria-label="Migration löschen"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
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

      <AccountDialog open={showAccountDialog} onOpenChange={setShowAccountDialog} activeTab={activeDialogTab} />

      <AddMigrationDialog
        open={showAddMigrationDialog}
        onOpenChange={setShowAddMigrationDialog}
        onSubmit={handleAddMigration}
      />

      <EditMigrationDialog
        open={showEditMigrationDialog}
        onOpenChange={(open) => {
          setShowEditMigrationDialog(open);
          if (!open) {
            setEditingMigration(null);
          }
        }}
        onUpdate={handleUpdateMigration}
        currentName={editingMigration?.name || ""}
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
              Möchtest du diese Migration wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteMigration}>Löschen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ProjectDetail;
