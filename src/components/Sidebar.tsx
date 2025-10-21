import { Plus, Trash2, Pencil, PanelLeftClose, PanelLeft, Plug, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import Logo from "./Logo";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

interface SidebarProps {
  projects: Array<{ id: string; name: string }>;
  projectMigrations?: Array<{ id: string; name: string; projectId: string | null }>;
  standaloneMigrations?: Array<{ id: string; name: string }>;
  selectedMigration?: string | null;
  onSelectMigration?: (id: string) => void;
  onNewMigration: () => void;
  onNewProjectMigration?: (projectId: string) => void;
  onDeleteMigration?: (id: string) => void;
  onEditMigration?: (id: string) => void;
}

const Sidebar = ({ 
  projects, 
  projectMigrations = [],
  standaloneMigrations = [],
  selectedMigration, 
  onSelectMigration, 
  onNewMigration,
  onNewProjectMigration,
  onDeleteMigration, 
  onEditMigration
}: SidebarProps) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set(projects.map(p => p.id)));
  const navigate = useNavigate();

  const toggleProject = (projectId: string) => {
    const newExpanded = new Set(expandedProjects);
    if (newExpanded.has(projectId)) {
      newExpanded.delete(projectId);
    } else {
      newExpanded.add(projectId);
    }
    setExpandedProjects(newExpanded);
  };

  return (
    <div className={cn(
      "bg-background border-r border-sidebar-border h-screen flex flex-col p-6 transition-all duration-300",
      isCollapsed ? "w-20" : "w-80"
    )}>
      <div className="mb-8 flex items-center justify-between gap-2">
        <Logo 
          onClick={() => navigate("/dashboard")} 
          className={cn("cursor-pointer transition-opacity", isCollapsed && "opacity-0 w-0 overflow-hidden")}
        />
        <div className="flex items-center gap-1">
          {!isCollapsed && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/data-sources")}
              className="flex-shrink-0 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <Plug className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="flex-shrink-0 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            {isCollapsed ? (
              <PanelLeft className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {!isCollapsed && (
        <nav className="flex-1 space-y-4 overflow-auto">
          <div className="space-y-2">
            <div className="flex items-center justify-between px-2">
              <h3 
                className="text-xs font-semibold text-muted-foreground uppercase cursor-pointer hover:text-foreground transition-colors"
                onClick={() => navigate("/projects")}
              >
                Projekte
              </h3>
            </div>
            {projects.map((project) => {
              const projectMigs = projectMigrations.filter(m => m.projectId === project.id);
              return (
                <div key={project.id} className="space-y-1">
                  <div className="flex items-center justify-between w-full px-2 py-2 rounded-lg transition-colors text-sm">
                    <button
                      onClick={() => toggleProject(project.id)}
                      className="flex items-center gap-2 flex-1 text-left font-medium"
                    >
                      {expandedProjects.has(project.id) ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                      {project.name}
                    </button>
                    <button
                      onClick={() => onNewProjectMigration?.(project.id)}
                      className="p-1 hover:bg-sidebar-accent rounded transition-colors"
                      aria-label="Neue Migration"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>

                  {expandedProjects.has(project.id) && projectMigs.length > 0 && (
                    <div className="ml-6 space-y-1">
                      {projectMigs.map((migration) => (
                    <div
                      key={migration.id}
                      className={cn(
                        "group flex items-center justify-between w-full px-4 py-2 rounded-lg transition-colors text-sm",
                        selectedMigration === migration.id
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
                      )}
                    >
                      <button
                        onClick={() => navigate(`/projects/${project.id}/migration/${migration.id}`)}
                        className="flex-1 text-left"
                      >
                        {migration.name}
                      </button>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditMigration?.(migration.id);
                          }}
                          className="p-1 hover:text-primary"
                          aria-label="Migration bearbeiten"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteMigration?.(migration.id);
                          }}
                          className="p-1 hover:text-destructive"
                          aria-label="Migration löschen"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          </div>

          <div className="space-y-2 pt-4 border-t border-sidebar-border">
            <div className="flex items-center justify-between px-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase">Migrationen</h3>
              <Button
                onClick={onNewMigration}
                variant="ghost"
                size="icon"
                className="h-6 w-6"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {standaloneMigrations.length > 0 ? (
              <div className="space-y-1">
                {standaloneMigrations.map((migration) => (
                  <div
                    key={migration.id}
                    className={cn(
                      "group flex items-center justify-between w-full px-4 py-2 rounded-lg transition-colors text-sm",
                      selectedMigration === migration.id
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
                    )}
                  >
                    <button
                      onClick={() => navigate(`/migration/${migration.id}`)}
                      className="flex-1 text-left"
                    >
                      {migration.name}
                    </button>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditMigration?.(migration.id);
                        }}
                        className="p-1 hover:text-primary"
                        aria-label="Migration bearbeiten"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteMigration?.(migration.id);
                        }}
                        className="p-1 hover:text-destructive"
                        aria-label="Migration löschen"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-4 py-2 text-xs text-muted-foreground">Keine Migrationen</p>
            )}
          </div>
        </nav>
      )}
    </div>
  );
};

export default Sidebar;
