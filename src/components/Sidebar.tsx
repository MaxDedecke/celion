import { Plus, Trash2, Pencil, PanelLeftClose, PanelLeft, Plug, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import Logo from "./Logo";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

interface SidebarProps {
  projects: Array<{ id: string; name: string }>;
  migrations?: Array<{ id: string; name: string }>;
  selectedMigration?: string | null;
  onSelectMigration?: (id: string) => void;
  onNewMigration: () => void;
  onDeleteMigration?: (id: string) => void;
  onEditMigration?: (id: string) => void;
  onLogoClick: () => void;
}

const Sidebar = ({ 
  projects, 
  migrations = [],
  selectedMigration, 
  onSelectMigration, 
  onNewMigration, 
  onDeleteMigration, 
  onEditMigration, 
  onLogoClick 
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
        <button 
          onClick={onLogoClick} 
          className={cn("cursor-pointer transition-opacity", isCollapsed && "opacity-0 w-0 overflow-hidden")}
        >
          <Logo />
        </button>
        <div className="flex items-center gap-1">
          {!isCollapsed && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/data-sources")}
              className="flex-shrink-0"
            >
              <Plug className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="flex-shrink-0"
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
        <nav className="flex-1 space-y-2 overflow-auto">
          <Button
            onClick={onNewMigration}
            variant="outline"
            className="w-full justify-start gap-2 mb-4"
          >
            <Plus className="h-4 w-4" />
            Migration
          </Button>
          {projects.map((project) => (
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
                  onClick={onNewMigration}
                  className="p-1 hover:bg-sidebar-accent rounded transition-colors"
                  aria-label="Neue Migration"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              {expandedProjects.has(project.id) && migrations.length > 0 && (
                <div className="ml-6 space-y-1">
                  {migrations.map((migration) => (
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
                        onClick={() => onSelectMigration?.(migration.id)}
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
          ))}
        </nav>
      )}
    </div>
  );
};

export default Sidebar;
