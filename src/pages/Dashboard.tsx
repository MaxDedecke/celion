import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Sidebar from "@/components/Sidebar";
import UserMenu from "@/components/UserMenu";
import AccountDialog from "@/components/dialogs/AccountDialog";
import AddMigrationDialog from "@/components/dialogs/AddMigrationDialog";
import MigrationDetails from "@/components/MigrationDetails";
import { Button } from "@/components/ui/button";
import { Database } from "lucide-react";
import { toast } from "sonner";

const mockProjects = [
  {
    id: "1",
    name: "Project Docta",
    progress: 60,
    sourceSystem: "Jira Atlassian (Cloud)",
    targetSystem: "Asana",
    inConnector: "Jira Atlassian (Cloud)",
    inConnectorDetail: "Jira Atlassian (Cloud)",
    outConnector: "Asana",
    outConnectorDetail: "Asana",
    objectsTransferred: "13490/13490",
    mappedObjects: "8855/13490",
    activities: [
      { id: "1", type: "success" as const, title: "Migration finished", timestamp: "24.04.2025" },
      { id: "2", type: "info" as const, title: "Transferred data to Asana", timestamp: "24.04.2025" },
      { id: "3", type: "error" as const, title: "Failed testing Outconnector", timestamp: "24.04.2025" },
      { id: "4", type: "warning" as const, title: "Edited meta model", timestamp: "24.04.2025" },
      { id: "5", type: "success" as const, title: "Created new meta model", timestamp: "23.04.2025" },
      { id: "6", type: "info" as const, title: "Data loaded from Jira", timestamp: "23.04.2025" },
      { id: "7", type: "success" as const, title: "Configured Outconnector", timestamp: "24.04.2025" },
      { id: "8", type: "success" as const, title: "Successfully tested Inconnector", timestamp: "23.04.2025" },
      { id: "9", type: "warning" as const, title: "Configured Inconnector", timestamp: "23.04.2025" },
      { id: "10", type: "info" as const, title: "New project created", timestamp: "23.04.2025" },
    ],
  },
  {
    id: "2",
    name: "Agil Scrum Nexis",
    progress: 100,
    sourceSystem: "Jira Atlassian (Cloud)",
    targetSystem: "Asana",
    inConnector: "Jira Atlassian (Cloud)",
    inConnectorDetail: "Jira Atlassian (Cloud)",
    outConnector: "Asana",
    outConnectorDetail: "Asana",
    objectsTransferred: "13490/13490",
    mappedObjects: "13490/13490",
    activities: [
      { id: "1", type: "success" as const, title: "Migration finished", timestamp: "24.04.2025" },
      { id: "2", type: "info" as const, title: "Transferred data to Asana", timestamp: "24.04.2025" },
      { id: "3", type: "success" as const, title: "Edited meta model", timestamp: "24.04.2025" },
      { id: "4", type: "success" as const, title: "Created new meta model", timestamp: "23.04.2025" },
      { id: "5", type: "info" as const, title: "Data loaded from Jira", timestamp: "23.04.2025" },
      { id: "6", type: "success" as const, title: "Configured Outconnector", timestamp: "24.04.2025" },
      { id: "7", type: "success" as const, title: "Successfully tested Inconnector", timestamp: "23.04.2025" },
      { id: "8", type: "success" as const, title: "Configured Inconnector", timestamp: "23.04.2025" },
      { id: "9", type: "info" as const, title: "New project created", timestamp: "23.04.2025" },
    ],
  },
  {
    id: "3",
    name: "Fujitsu Migration",
    progress: 0,
    sourceSystem: "Jira Atlassian (Cloud)",
    targetSystem: "Asana",
    inConnector: "Jira Atlassian (Cloud)",
    inConnectorDetail: "Jira Atlassian (Cloud)",
    outConnector: "Asana",
    outConnectorDetail: "Asana",
    objectsTransferred: "0/0",
    mappedObjects: "0/0",
    activities: [
      { id: "1", type: "info" as const, title: "New project created", timestamp: "25.04.2025" },
    ],
  },
];

const Dashboard = () => {
  const navigate = useNavigate();
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [showAccountDialog, setShowAccountDialog] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [activeDialogTab, setActiveDialogTab] = useState<"account" | "settings">("account");
  const [activeProjectTab, setActiveProjectTab] = useState<"general" | "mapping">("general");
  const [projects, setProjects] = useState(mockProjects);

  const handleLogout = () => {
    toast.success("Logged out successfully");
    navigate("/");
  };

  const handleAddMigration = (name: string, sourceSystem: string, targetSystem: string) => {
    const newProject = {
      id: String(projects.length + 1),
      name,
      progress: 0,
      sourceSystem,
      targetSystem,
      inConnector: sourceSystem,
      inConnectorDetail: sourceSystem,
      outConnector: targetSystem,
      outConnectorDetail: targetSystem,
      objectsTransferred: "0/0",
      mappedObjects: "0/0",
      activities: [
        { id: "1", type: "info" as const, title: "New project created", timestamp: new Date().toLocaleDateString() },
      ],
    };
    setProjects([...projects, newProject]);
    toast.success(`Migration "${name}" created`);
  };

  const currentProject = projects.find((p) => p.id === selectedProject);

  return (
    <div className="flex h-screen bg-background">
      <Sidebar
        projects={projects}
        selectedProject={selectedProject}
        onSelectProject={setSelectedProject}
        onNewMigration={() => setShowAddDialog(true)}
      />

      <div className="flex-1 flex flex-col min-h-0">
        <header className="h-16 border-b border-sidebar-border flex items-center justify-between px-6 flex-shrink-0">
          {currentProject && (
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
            <MigrationDetails project={currentProject} activeTab={activeProjectTab} />
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center space-y-6">
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
                <p className="text-muted-foreground text-lg">Nothing selected</p>
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
    </div>
  );
};

export default Dashboard;
