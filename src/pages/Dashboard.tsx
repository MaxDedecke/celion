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
  const { projectName } = useParams<{ projectName: string }>();
  const [currentProject, setCurrentProject] = useState<any>(null);
  const [selectedMigration, setSelectedMigration] = useState<string | null>(null);
  const [showAccountDialog, setShowAccountDialog] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [activeDialogTab, setActiveDialogTab] = useState<"account" | "settings">("account");
  const [activeMigrationTab, setActiveMigrationTab] = useState<"general" | "mapping">("general");
  const [migrations, setMigrations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingMigration, setEditingMigration] = useState<any>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [migrationToDelete, setMigrationToDelete] = useState<string | null>(null);

  // Check auth and load project data
  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (projectName) {
      loadProjectAndMigrations();
    }
  }, [projectName]);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate("/");
    }
  };

  const loadProjectAndMigrations = async () => {
    try {
      setLoading(true);
      
      // Find project by name
      const { data: projectData, error: projectError } = await supabase
        .from('projects')
        .select('*')
        .eq('name', decodeURIComponent(projectName || ''))
        .maybeSingle();

      if (projectError) throw projectError;
      if (!projectData) {
        toast.error("Projekt nicht gefunden");
        navigate("/projects");
        return;
      }

      setCurrentProject(projectData);

      // Load migrations for this project
      const { data: migrationsData, error: migrationsError } = await supabase
        .from('migrations')
        .select('*')
        .eq('project_id', projectData.id)
        .order('created_at', { ascending: false });

      if (migrationsError) throw migrationsError;

      // Load activities and connectors for each migration
      const migrationsWithDetails = await Promise.all(
        (migrationsData || []).map(async (migration) => {
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
            activities: activitiesData || [],
            connectors: {
              in: inConnector,
              out: outConnector,
            },
          };
        })
      );

      setMigrations(migrationsWithDetails);
    } catch (error: any) {
      toast.error("Fehler beim Laden der Migrationen");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Erfolgreich abgemeldet");
    navigate("/");
  };

  const handleAddMigration = async (name: string, sourceSystem: string, targetSystem: string) => {
    try {
      if (!currentProject) {
        toast.error("Kein Projekt ausgewählt");
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Nicht authentifiziert");

      const { data: migration, error: migrationError } = await supabase
        .from('migrations')
        .insert({
          user_id: user.id,
          project_id: currentProject.id,
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
      loadProjectAndMigrations();
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
      loadProjectAndMigrations();
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
      loadProjectAndMigrations();
    } catch (error: any) {
      toast.error("Fehler beim Aktualisieren der Migration");
      console.error(error);
    }
  };

  const currentMigration = migrations.find((m) => m.id === selectedMigration);

  if (loading) {
    return (
      <div className="flex h-screen bg-background items-center justify-center">
        <p className="text-muted-foreground">Lädt...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      <Sidebar
        projects={[{ id: currentProject?.id || '', name: currentProject?.name || '' }]}
        migrations={migrations}
        selectedMigration={selectedMigration}
        onSelectMigration={setSelectedMigration}
        onNewMigration={() => setShowAddDialog(true)}
        onDeleteMigration={handleDeleteMigration}
        onEditMigration={handleEditMigration}
        onLogoClick={() => navigate("/projects")}
      />

      <div className="flex-1 flex flex-col min-h-0">
        <header className="h-20 flex items-center justify-between px-6 flex-shrink-0">
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
            <h1 className="text-2xl font-semibold">{currentProject?.name}</h1>
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

        <div className="flex-1 overflow-auto">
          {currentMigration ? (
            <MigrationDetails 
              project={currentMigration} 
              activeTab={activeMigrationTab} 
              onRefresh={loadProjectAndMigrations}
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center space-y-8">
                <div className="flex justify-center">
                  <div className="relative">
                    <Database className="h-32 w-32 text-primary" strokeWidth={1.5} />
                    <Database className="h-24 w-24 text-secondary absolute top-8 left-8" strokeWidth={1.5} />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="flex flex-col items-center gap-2">
                        <div className="h-8 w-1 bg-primary" />
                        <div className="h-8 w-1 bg-secondary" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  <p className="text-foreground text-2xl font-semibold">Starte noch heute deine Migration</p>
                  <Button
                    onClick={() => setShowAddDialog(true)}
                    className="rounded-full bg-secondary hover:bg-secondary/90 text-secondary-foreground gap-2"
                    size="lg"
                  >
                    <Plus className="h-5 w-5" />
                    Migration
                  </Button>
                </div>
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
