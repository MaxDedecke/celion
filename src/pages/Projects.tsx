import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Sidebar from "@/components/Sidebar";
import UserMenu from "@/components/UserMenu";
import AccountDialog from "@/components/dialogs/AccountDialog";
import AddProjectDialog from "@/components/dialogs/AddProjectDialog";
import AddMigrationDialog from "@/components/dialogs/AddMigrationDialog";
import EditProjectDialog from "@/components/dialogs/EditProjectDialog";
import EditMigrationDialog from "@/components/dialogs/EditMigrationDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FolderOpen, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
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

const Projects = () => {
  const navigate = useNavigate();
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [showAccountDialog, setShowAccountDialog] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showAddMigrationDialog, setShowAddMigrationDialog] = useState(false);
  const [activeDialogTab, setActiveDialogTab] = useState<"account" | "settings">("account");
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

  useEffect(() => {
    checkAuth();
    loadAllData();
  }, []);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate("/");
    }
  };

  const loadAllData = async () => {
    try {
      setLoading(true);
      
      // Load all projects
      const { data: projectsData, error: projectsError } = await supabase
        .from('projects')
        .select('*')
        .order('created_at', { ascending: false });

      if (projectsError) throw projectsError;

      // Load migrations count for each project
      const projectsWithCounts = await Promise.all(
        (projectsData || []).map(async (project) => {
          const { count } = await supabase
            .from('migrations')
            .select('*', { count: 'exact', head: true })
            .eq('project_id', project.id);

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
        const { data: migrationsData, error: migrationsError } = await supabase
          .from('migrations')
          .select('*')
          .eq('project_id', project.id)
          .order('created_at', { ascending: false });

        if (migrationsError) throw migrationsError;
        
        const migrationsFormatted = (migrationsData || []).map(m => ({
          id: m.id,
          name: m.name,
          projectId: m.project_id
        }));
        allMigrationsWithProjects.push(...migrationsFormatted);
      }
      setMigrations(allMigrationsWithProjects);

      // Load standalone migrations
      const { data: standaloneData, error: standaloneError } = await supabase
        .from('migrations')
        .select('*')
        .is('project_id', null)
        .order('created_at', { ascending: false });

      if (standaloneError) throw standaloneError;

      const standaloneFormatted = (standaloneData || []).map(m => ({
        id: m.id,
        name: m.name
      }));
      setStandaloneMigrations(standaloneFormatted);
    } catch (error: any) {
      toast.error("Fehler beim Laden der Daten");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  const handleAddProject = async (data: { name: string; description: string }) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase
        .from('projects')
        .insert({
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
      const { error } = await supabase
        .from('projects')
        .update({
          name: data.name,
          description: data.description,
        })
        .eq('id', editingProject.id);

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
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', projectToDelete);

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
    const project = projects.find(p => p.id === projectId);
    if (project) {
      // Find first migration in this project and navigate to it
      const projectMigration = migrations.find(m => m.projectId === projectId);
      if (projectMigration) {
        navigate(`/projects/${projectId}/migration/${projectMigration.id}`);
      } else {
        navigate('/dashboard');
      }
    }
  };

  const handleAddMigration = async (name: string, sourceSystem: string, targetSystem: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Nicht authentifiziert");

      const { data: migration, error: migrationError } = await supabase
        .from('migrations')
        .insert({
          user_id: user.id,
          project_id: projectIdForNewMigration,
          name,
          source_system: sourceSystem,
          target_system: targetSystem,
          in_connector: sourceSystem,
          in_connector_detail: sourceSystem,
          out_connector: targetSystem,
          out_connector_detail: targetSystem,
        })
        .select()
        .single();

      if (migrationError) throw migrationError;

      // Create initial activity
      await supabase
        .from('migration_activities')
        .insert({
          migration_id: migration.id,
          type: 'info',
          title: 'Neues Migrationsprojekt erstellt',
          timestamp: new Date().toLocaleString('de-DE'),
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
      const { error } = await supabase
        .from('migrations')
        .delete()
        .eq('id', migrationId);

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
      const { error } = await supabase
        .from('migrations')
        .update({ name })
        .eq('id', editingMigration.id);

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

  return (
    <div className="app-shell flex min-h-screen flex-col p-6">
      <div className="flex flex-1 gap-6">
        <Sidebar
          projects={projects}
          projectMigrations={migrations}
          standaloneMigrations={standaloneMigrations}
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
          onEditMigration={handleEditMigration}
        />

        <div className="flex flex-1 flex-col gap-6">
          <header className="app-surface flex items-center justify-between rounded-3xl px-6 py-5">
            <div>
              <h1 className="text-xl font-semibold text-foreground">Projekte</h1>
              <p className="text-sm text-muted-foreground">Behalte den Überblick über deine Migrationsvorhaben.</p>
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
                        className="app-subtle relative cursor-pointer transition-colors hover:border-border/70"
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
                          <CardTitle className="text-xl text-foreground">{project.name}</CardTitle>
                          <CardDescription className="text-sm text-muted-foreground">
                            {project.description || "Keine Beschreibung"}
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-muted-foreground">
                            {project.migrationsCount} {project.migrationsCount === 1 ? "Migration" : "Migrationen"}
                          </p>
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
        activeTab={activeDialogTab}
      />

      <AddProjectDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onSave={handleAddProject}
      />

      <AddMigrationDialog
        open={showAddMigrationDialog}
        onOpenChange={setShowAddMigrationDialog}
        onAdd={handleAddMigration}
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
        onUpdate={handleUpdateMigration}
        currentName={editingMigration?.name || ""}
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
