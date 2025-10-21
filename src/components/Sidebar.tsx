import { Plus, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import Logo from "./Logo";
import { cn } from "@/lib/utils";

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
  return (
    <div className="w-80 bg-background border-r border-sidebar-border h-screen flex flex-col p-6">
      <button onClick={onLogoClick} className="mb-8 cursor-pointer">
        <Logo />
      </button>

      <Button
        onClick={onNewMigration}
        className="mb-6 rounded-full bg-secondary hover:bg-secondary/90 text-secondary-foreground justify-start gap-2"
      >
        <Plus className="h-4 w-4" />
        Migration
      </Button>

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
    </div>
  );
};

export default Sidebar;
