import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
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
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [showAccountDialog, setShowAccountDialog] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [activeDialogTab, setActiveDialogTab] = useState<"account" | "settings">("account");
  const [activeProjectTab, setActiveProjectTab] = useState<"general" | "mapping">("general");
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingProject, setEditingProject] = useState<any>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);

  // Check auth and load projects
  useEffect(() => {
    checkAuth();
    loadProjects();
  }, []);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate("/");
    }
  };

  const loadProjects = async () => {
    try {
      const { data: migrationsData, error: migrationsError } = await supabase
        .from('migrations')
        .select('*')
        .order('created_at', { ascending: false });

      if (migrationsError) throw migrationsError;

      // Load activities and connectors for each migration
      const projectsWithActivities = await Promise.all(
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

      setProjects(projectsWithActivities);
    } catch (error: any) {
      toast.error("Failed to load migrations");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Logged out successfully");
    navigate("/");
  };

  const handleAddMigration = async (name: string, sourceSystem: string, targetSystem: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: migration, error: migrationError } = await supabase
        .from('migrations')
        .insert({
          user_id: user.id,
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
      const { error: activityError } = await supabase
        .from('migration_activities')
        .insert({
          migration_id: migration.id,
          type: 'info',
          title: 'New project created',
          timestamp: new Date().toLocaleDateString(),
        });

      if (activityError) throw activityError;

      toast.success(`Migration "${name}" created`);
      loadProjects();
    } catch (error: any) {
      toast.error(error.message || "Failed to create migration");
      console.error(error);
    }
  };

  const handleDeleteProject = (projectId: string) => {
    setProjectToDelete(projectId);
    setShowDeleteDialog(true);
  };

  const confirmDeleteProject = async () => {
    if (!projectToDelete) return;

    try {
      const projectToDeleteData = projects.find((p) => p.id === projectToDelete);
      
      const { error } = await supabase
        .from('migrations')
        .delete()
        .eq('id', projectToDelete);

      if (error) throw error;

      if (selectedProject === projectToDelete) {
        setSelectedProject(null);
      }
      
      toast.success(`Migration "${projectToDeleteData?.name}" deleted`);
      loadProjects();
    } catch (error: any) {
      toast.error("Failed to delete migration");
      console.error(error);
    } finally {
      setShowDeleteDialog(false);
      setProjectToDelete(null);
    }
  };

  const handleEditProject = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    if (project) {
      setEditingProject(project);
      setShowEditDialog(true);
    }
  };

  const handleUpdateMigration = async (name: string) => {
    try {
      const { error } = await supabase
        .from('migrations')
        .update({ name })
        .eq('id', editingProject.id);

      if (error) throw error;

      toast.success(`Migration updated to "${name}"`);
      setShowEditDialog(false);
      setEditingProject(null);
      loadProjects();
    } catch (error: any) {
      toast.error("Failed to update migration");
      console.error(error);
    }
  };

  const currentProject = projects.find((p) => p.id === selectedProject);

  if (loading) {
    return (
      <div className="flex h-screen bg-background items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      <Sidebar
        projects={projects}
        selectedProject={selectedProject}
        onSelectProject={setSelectedProject}
        onNewMigration={() => setShowAddDialog(true)}
        onDeleteProject={handleDeleteProject}
        onEditProject={handleEditProject}
        onLogoClick={() => setSelectedProject(null)}
      />

      <div className="flex-1 flex flex-col min-h-0">
        <header className="h-16 flex items-center justify-between px-6 flex-shrink-0">
          {currentProject ? (
            <div className="flex items-center gap-6">
              <div className="flex gap-2">
                <Button
                  variant={activeProjectTab === "general" ? "secondary" : "ghost"}
                  onClick={() => setActiveProjectTab("general")}
                  size="sm"
                >
                  General
                </Button>
                <Button
                  variant={activeProjectTab === "mapping" ? "secondary" : "ghost"}
                  onClick={() => setActiveProjectTab("mapping")}
                  size="sm"
                >
                  Mapping UI
                </Button>
              </div>
              <div className="text-lg font-semibold text-foreground">
                {currentProject.sourceSystem} → {currentProject.targetSystem}
              </div>
            </div>
          ) : (
            <div />
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
          {currentProject ? (
            <MigrationDetails 
              project={currentProject} 
              activeTab={activeProjectTab} 
              onRefresh={loadProjects}
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
        currentName={editingProject?.name || ""}
      />
      
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sind Sie sicher?</AlertDialogTitle>
            <AlertDialogDescription>
              Diese Aktion kann nicht rückgängig gemacht werden. Die Migration "{projects.find(p => p.id === projectToDelete)?.name}" wird permanent gelöscht.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteProject} className="bg-destructive hover:bg-destructive/90">
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Dashboard;
