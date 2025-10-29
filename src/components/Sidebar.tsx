import { Plus, Trash2, Pencil, PanelLeftClose, PanelLeft, Plug, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import Logo from "./Logo";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
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
  const [collapsedSize, setCollapsedSize] = useState<number>();
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set(projects.map(p => p.id)));
  const navigate = useNavigate();

  useEffect(() => {
    const sidebarElement = sidebarRef.current;
    if (!sidebarElement) return;

    const container = sidebarElement.parentElement;
    if (!container) return;

    const anchorElement = container.querySelector<HTMLElement>("[data-sidebar-anchor]");
    if (!anchorElement) {
      setCollapsedSize(undefined);
      return;
    }

    const updateSize = () => {
      const nextSize = anchorElement.getBoundingClientRect().height;
      if (!Number.isNaN(nextSize) && nextSize > 0) {
        setCollapsedSize(nextSize);
      }
    };

    updateSize();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(() => updateSize());
    resizeObserver.observe(anchorElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [isCollapsed]);

  const collapsedDimension = collapsedSize ?? 80;
  const collapsedStyle = isCollapsed
    ? {
        width: `${collapsedDimension}px`,
        height: `${collapsedDimension}px`,
        minWidth: `${collapsedDimension}px`,
        minHeight: `${collapsedDimension}px`
      }
    : undefined;

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
    <div
      ref={sidebarRef}
      style={collapsedStyle}
      className={cn(
        "app-surface transition-all duration-300",
        isCollapsed
          ? "flex items-center justify-center self-start p-2"
          : "flex h-full min-h-0 w-80 flex-col overflow-hidden p-6"
      )}
    >
      {isCollapsed ? (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsCollapsed(false)}
          className="hover:bg-foreground/5"
        >
          <PanelLeft className="h-4 w-4" />
        </Button>
      ) : (
        <>
          <div className="mb-8 flex w-full items-center justify-between gap-2">
            <Logo
              onClick={() => navigate("/dashboard")}
              className="cursor-pointer transition-all"
            />
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate("/data-sources")}
                className="flex-shrink-0 hover:bg-foreground/5"
              >
                <Plug className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsCollapsed(true)}
                className="flex-shrink-0 hover:bg-foreground/5"
              >
                <PanelLeftClose className="h-4 w-4" />
              </Button>
            </div>
          </div>

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
              const hasProjectMigrations = projectMigs.length > 0;
              return (
                <div key={project.id} className="space-y-1">
                  <div className="flex w-full items-center justify-between rounded-xl px-2 py-2 text-sm transition-colors">
                    <div className="flex flex-1 items-center gap-2">
                      {hasProjectMigrations && (
                        <button
                          type="button"
                          onClick={() => toggleProject(project.id)}
                          className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                          aria-label={expandedProjects.has(project.id) ? "Projekt einklappen" : "Projekt ausklappen"}
                          aria-expanded={expandedProjects.has(project.id)}
                        >
                          {expandedProjects.has(project.id) ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => navigate(`/project/${encodeURIComponent(project.name)}`)}
                        className="flex-1 text-left font-medium text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {project.name}
                      </button>
                    </div>
                    <button
                      onClick={() => onNewProjectMigration?.(project.id)}
                      className="rounded p-1 transition-colors hover:bg-foreground/5"
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
                            "group flex items-center justify-between w-full rounded-xl px-4 py-2 text-sm transition-colors",
                            selectedMigration === migration.id
                              ? "bg-sidebar-accent text-sidebar-accent-foreground"
                              : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                          )}
                        >
                          <button
                            onClick={() => navigate(`/projects/${project.id}/migration/${migration.id}`)}
                            className="flex-1 text-left"
                          >
                            {migration.name}
                          </button>
                          <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onEditMigration?.(migration.id);
                              }}
                              className="rounded p-1 transition-colors hover:bg-foreground/5 hover:text-foreground"
                              aria-label="Migration bearbeiten"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteMigration?.(migration.id);
                              }}
                              className="rounded p-1 text-destructive transition-colors hover:bg-destructive/10"
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

          <div className="space-y-2 border-t border-border/60 pt-4">
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
                      "group flex items-center justify-between w-full rounded-xl px-4 py-2 text-sm transition-colors",
                      selectedMigration === migration.id
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                    )}
                  >
                    <button
                      onClick={() => navigate(`/migration/${migration.id}`)}
                      className="flex-1 text-left"
                    >
                      {migration.name}
                    </button>
                    <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditMigration?.(migration.id);
                        }}
                        className="rounded p-1 transition-colors hover:bg-foreground/5 hover:text-foreground"
                        aria-label="Migration bearbeiten"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteMigration?.(migration.id);
                        }}
                        className="rounded p-1 text-destructive transition-colors hover:bg-destructive/10"
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
        </>
      )}
    </div>
  );
};

export default Sidebar;
