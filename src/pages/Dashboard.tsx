import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Sidebar from "@/components/Sidebar";
import UserMenu from "@/components/UserMenu";
import AccountDialog from "@/components/dialogs/AccountDialog";
import AddMigrationDialog from "@/components/dialogs/AddMigrationDialog";
import EditMigrationDialog from "@/components/dialogs/EditMigrationDialog";
import MigrationDetails from "@/components/MigrationDetails";
import { Button } from "@/components/ui/button";
import { Database, Plus } from "lucide-react";
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

const Dashboard = () => {
  const navigate = useNavigate();
  const { migrationId, projectId } = useParams<{ migrationId?: string; projectId?: string }>();
  const [selectedMigration, setSelectedMigration] = useState<string | null>(migrationId || null);
  const [showAccountDialog, setShowAccountDialog] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [activeDialogTab, setActiveDialogTab] = useState<"account" | "settings">("account");
  const [activeMigrationTab, setActiveMigrationTab] = useState<"general" | "mapping">("general");
  const [migrations, setMigrations] = useState<any[]>([]);
  const [standaloneMigrations, setStandaloneMigrations] = useState<any[]>([]);
  const [allProjects, setAllProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingMigration, setEditingMigration] = useState<any>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [migrationToDelete, setMigrationToDelete] = useState<string | null>(null);
  const [projectIdForNewMigration, setProjectIdForNewMigration] = useState<string | null>(null);

  // Check auth and load project data
  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    loadAllData();
  }, []);

  useEffect(() => {
    setSelectedMigration(migrationId ?? null);
    setActiveMigrationTab("general"); // Reset tab to general when switching migrations
  }, [migrationId]);

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
      setAllProjects(projectsData || []);

      // Load all migrations with project_id
      const allMigrationsWithProjects: any[] = [];
      for (const project of projectsData || []) {
        const { data: migrationsData, error: migrationsError } = await supabase
          .from('migrations')
          .select('*')
          .eq('project_id', project.id)
          .order('created_at', { ascending: false });

        if (migrationsError) throw migrationsError;
        const migrationsWithDetails = await loadMigrationDetails(migrationsData || [], project.id);
        allMigrationsWithProjects.push(...migrationsWithDetails);
      }
      setMigrations(allMigrationsWithProjects);

      // Load standalone migrations
      const { data: standaloneData, error: standaloneError } = await supabase
        .from('migrations')
        .select('*')
        .is('project_id', null)
        .order('created_at', { ascending: false });

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
          const { data: activitiesData } = await supabase
            .from('migration_activities')
            .select('*')
            .eq('migration_id', migration.id)
            .order('created_at', { ascending: false });

          const { data: connectorsData } = await supabase
            .from('connectors')
            .select('*')
            .eq('migration_id', migration.id);

          const inConnector = connectorsData?.find(c => c.connector_type === 'in');
          const outConnector = connectorsData?.find(c => c.connector_type === 'out');

          return {
            id: migration.id,
            name: migration.name,
            progress: migration.progress,
            sourceSystem: migration.source_system,
            targetSystem: migration.target_system,
            inConnector: migration.in_connector,
            inConnectorDetail: migration.in_connector_detail,
            outConnector: migration.out_connector,
            outConnectorDetail: migration.out_connector_detail,
            objectsTransferred: migration.objects_transferred,
            mappedObjects: migration.mapped_objects,
            projectId: projectId,
            activities: activitiesData || [],
            connectors: {
              in: inConnector,
              out: outConnector,
            },
          };
        })
      );
  };

  // Optimized refresh for only the current migration
  const refreshCurrentMigration = async () => {
    if (!selectedMigration) return;
    
    try {
      // Load only the selected migration
      const { data: migrationData, error: migrationError } = await supabase
        .from('migrations')
        .select('*')
        .eq('id', selectedMigration)
        .single();

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
    await supabase.auth.signOut();
    toast.success("Erfolgreich abgemeldet");
    navigate("/");
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

  const handleDeleteMigration = (migrationId: string) => {
    setMigrationToDelete(migrationId);
    setShowDeleteDialog(true);
  };

  const confirmDeleteMigration = async () => {
    if (!migrationToDelete) return;

    try {
      const migrationToDeleteData = migrations.find((m) => m.id === migrationToDelete);
      
      const { error } = await supabase
        .from('migrations')
        .delete()
        .eq('id', migrationToDelete);

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

  const handleEditMigration = (migrationId: string) => {
    const migration = migrations.find((m) => m.id === migrationId);
    if (migration) {
      setEditingMigration(migration);
      setShowEditDialog(true);
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
      setShowEditDialog(false);
      setEditingMigration(null);
      await refreshCurrentMigration();
    } catch (error: any) {
      toast.error("Fehler beim Aktualisieren der Migration");
      console.error(error);
    }
  };

  const currentMigration = selectedMigration 
    ? [...migrations, ...standaloneMigrations].find((m) => m.id === selectedMigration)
    : null;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <p className="text-muted-foreground">Lädt...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-muted/30">
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
      />

      <div className="flex flex-1 flex-col min-h-0">
        <header className="flex h-20 flex-shrink-0 items-center justify-between border-b border-border/60 bg-card/80 px-8 backdrop-blur supports-[backdrop-filter]:bg-card/70">
          {currentMigration ? (
            <div className="flex items-center gap-6">
              <div className="flex gap-2">
                <Button
                  variant={activeMigrationTab === "general" ? "secondary" : "ghost"}
                  onClick={() => setActiveMigrationTab("general")}
                  size="sm"
                >
                  General
                </Button>
                <Button
                  variant={activeMigrationTab === "mapping" ? "secondary" : "ghost"}
                  onClick={() => setActiveMigrationTab("mapping")}
                  size="sm"
                >
                  Mapping UI
                </Button>
              </div>
              <div className="text-lg font-semibold text-foreground">
                {currentMigration.sourceSystem} → {currentMigration.targetSystem}
              </div>
            </div>
          ) : (
            <h1 className="text-2xl font-semibold">Dashboard</h1>
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

        <div className="flex-1 overflow-auto px-8 py-10">
          {currentMigration ? (
            <div className="mx-auto w-full max-w-6xl">
              <MigrationDetails
                project={currentMigration}
                activeTab={activeMigrationTab}
                onRefresh={refreshCurrentMigration}
              />
            </div>
          ) : (
            <div className="mx-auto flex max-w-6xl flex-col gap-8">
              {/* Welcome Section */}
              <div>
                <h2 className="text-3xl font-semibold text-foreground">Willkommen zurück!</h2>
                <p className="mt-2 text-muted-foreground">Hier ist eine Übersicht deiner Migrationen.</p>
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl border border-border/60 bg-card/80 p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Projekte</p>
                      <p className="mt-2 text-3xl font-semibold text-foreground">{allProjects.length}</p>
                    </div>
                    <Database className="h-10 w-10 text-primary" />
                  </div>
                </div>

                <div className="rounded-2xl border border-border/60 bg-card/80 p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Migrationen</p>
                      <p className="mt-2 text-3xl font-semibold text-foreground">
                        {migrations.length + standaloneMigrations.length}
                      </p>
                    </div>
                    <Database className="h-10 w-10 text-secondary" />
                  </div>
                </div>

                <div className="rounded-2xl border border-border/60 bg-card/80 p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Abgeschlossen</p>
                      <p className="mt-2 text-3xl font-semibold text-foreground">
                        {[...migrations, ...standaloneMigrations].filter(m => m.progress === 100).length}
                      </p>
                    </div>
                    <Database className="h-10 w-10 text-success" />
                  </div>
                </div>

                <div className="rounded-2xl border border-border/60 bg-card/80 p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">In Arbeit</p>
                      <p className="mt-2 text-3xl font-semibold text-foreground">
                        {[...migrations, ...standaloneMigrations].filter(m => m.progress > 0 && m.progress < 100).length}
                      </p>
                    </div>
                    <Database className="h-10 w-10 text-warning" />
                  </div>
                </div>
              </div>

              {/* Recent Migrations */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="rounded-2xl border border-border/60 bg-card/80 p-6 shadow-sm">
                  <h3 className="mb-4 text-xl font-semibold">Aktuelle Migrationen</h3>
                  <div className="space-y-4">
                    {[...migrations, ...standaloneMigrations]
                      .sort((a, b) => b.progress - a.progress)
                      .slice(0, 5)
                      .map((migration) => (
                        <div
                          key={migration.id}
                          className="flex cursor-pointer items-center justify-between rounded-xl border border-border/60 bg-card/60 p-4 transition-colors hover:border-primary/30"
                          onClick={() => {
                            if (migration.projectId) {
                              navigate(`/projects/${migration.projectId}/migration/${migration.id}`);
                            } else {
                              navigate(`/migration/${migration.id}`);
                            }
                          }}
                        >
                          <div className="flex-1">
                            <p className="font-medium text-foreground">{migration.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {migration.sourceSystem} → {migration.targetSystem}
                            </p>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <p className="text-sm font-medium text-foreground">{migration.progress}%</p>
                              <div className="mt-1 h-2 w-24 overflow-hidden rounded-full bg-muted">
                                <div
                                  className="h-full bg-primary transition-all"
                                  style={{ width: `${migration.progress}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    {[...migrations, ...standaloneMigrations].length === 0 && (
                      <div className="rounded-xl border border-dashed border-border/60 bg-card/60 py-8 text-center text-muted-foreground">
                        <p>Noch keine Migrationen vorhanden</p>
                        <Button onClick={() => setShowAddDialog(true)} className="mt-4 gap-2" variant="outline">
                          <Plus className="h-4 w-4" />
                          Migration erstellen
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-border/60 bg-card/80 p-6 shadow-sm">
                  <h3 className="mb-4 text-xl font-semibold">Fortschrittsübersicht</h3>
                  <div className="space-y-4">
                    {allProjects.slice(0, 5).map((project) => {
                      const projectMigrations = migrations.filter(m => m.projectId === project.id);
                      const avgProgress = projectMigrations.length > 0
                        ? Math.round(projectMigrations.reduce((sum, m) => sum + m.progress, 0) / projectMigrations.length)
                        : 0;

                      return (
                        <div key={project.id} className="rounded-xl border border-border/60 bg-card/60 p-4">
                          <div className="mb-2 flex items-center justify-between">
                            <p className="font-medium text-foreground">{project.name}</p>
                            <p className="text-sm font-medium text-foreground">{avgProgress}%</p>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full bg-secondary transition-all"
                              style={{ width: `${avgProgress}%` }}
                            />
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {projectMigrations.length} Migration{projectMigrations.length !== 1 ? 'en' : ''}
                          </p>
                        </div>
                      );
                    })}
                    {allProjects.length === 0 && (
                      <div className="text-center py-8 text-muted-foreground">
                        <p>Noch keine Projekte vorhanden</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="rounded-2xl border border-border/60 bg-card/80 p-8 text-center shadow-sm">
                <h3 className="mb-2 text-2xl font-semibold">Bereit für eine neue Migration?</h3>
                <p className="mb-6 text-muted-foreground">Starte jetzt und migriere deine Daten nahtlos.</p>
                <Button onClick={() => setShowAddDialog(true)} size="lg" className="gap-2">
                  <Plus className="h-5 w-5" />
                  Neue Migration erstellen
                </Button>
              </div>
            </div>
          )}
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
        onAdd={handleAddMigration}
      />
      <EditMigrationDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        onUpdate={handleUpdateMigration}
        currentName={editingMigration?.name || ""}
      />
      
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
