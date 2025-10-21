import { Plus, Trash2, Pencil, PanelLeftClose, PanelLeft, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import Logo from "./Logo";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

interface SidebarProps {
  projects: Array<{ id: string; name: string }>;
  selectedProject: string | null;
  onSelectProject: (id: string) => void;
  onNewMigration: () => void;
  onDeleteProject: (id: string) => void;
  onEditProject: (id: string) => void;
  onLogoClick: () => void;
}

const Sidebar = ({ projects, selectedProject, onSelectProject, onNewMigration, onDeleteProject, onEditProject, onLogoClick }: SidebarProps) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const navigate = useNavigate();

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
        <Button
          onClick={onNewMigration}
          className="mb-6 rounded-full bg-secondary hover:bg-secondary/90 text-secondary-foreground justify-start gap-2"
        >
          <Plus className="h-4 w-4" />
          Migration
        </Button>
      )}

      {!isCollapsed && (
        <nav className="flex-1 space-y-2">
          {projects.map((project) => (
            <div
              key={project.id}
              className={cn(
                "group flex items-center justify-between w-full px-4 py-2 rounded-lg transition-colors text-sm",
                selectedProject === project.id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
              )}
            >
              <button
                onClick={() => onSelectProject(project.id)}
                className="flex-1 text-left"
              >
                {project.name}
              </button>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditProject(project.id);
                  }}
                  className="p-1 hover:text-primary"
                  aria-label="Edit migration"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteProject(project.id);
                  }}
                  className="p-1 hover:text-destructive"
                  aria-label="Delete migration"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </nav>
      )}
    </div>
  );
};

export default Sidebar;
