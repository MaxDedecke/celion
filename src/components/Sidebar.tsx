import {
  Plus,
  Trash2,
  Pencil,
  PanelLeftClose,
  PanelLeft,
  Plug,
  ChevronDown,
  ChevronRight,
  Copy,
  Loader2,
  MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Logo from "./Logo";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

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
  onDuplicateMigration?: (id: string) => void;
  // Lazy loading props
  onLoadMoreMigrations?: () => Promise<void>;
  hasMoreMigrations?: boolean;
  isLoadingMoreMigrations?: boolean;
  totalMigrationsCount?: number;
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
  onEditMigration,
  onDuplicateMigration,
  onLoadMoreMigrations,
  hasMoreMigrations = false,
  isLoadingMoreMigrations = false,
  totalMigrationsCount = 0,
}: SidebarProps) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [collapsedSize, setCollapsedSize] = useState<number>();
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const migrationsScrollRef = useRef<HTMLDivElement | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set(projects.map(p => p.id)));
  const [projectsCollapsed, setProjectsCollapsed] = useState(false);
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

  // Infinite scroll detection
  useEffect(() => {
    const scrollElement = migrationsScrollRef.current;
    if (!scrollElement || !onLoadMoreMigrations) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollElement;
      const nearBottom = scrollHeight - scrollTop - clientHeight < 100;

      if (nearBottom && hasMoreMigrations && !isLoadingMoreMigrations) {
        onLoadMoreMigrations();
      }
    };

    scrollElement.addEventListener('scroll', handleScroll);
    return () => scrollElement.removeEventListener('scroll', handleScroll);
  }, [hasMoreMigrations, isLoadingMoreMigrations, onLoadMoreMigrations]);

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
          : "flex h-full min-h-0 w-80 flex-col overflow-hidden p-4"
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
          {/* Header - Fixed */}
          <div className="mb-6 flex w-full items-center justify-between gap-2 flex-shrink-0">
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

          <nav className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Projects Section - Sticky & Collapsible */}
            <div className="flex-shrink-0">
              <Collapsible open={!projectsCollapsed} onOpenChange={(open) => setProjectsCollapsed(!open)}>
                <div className="flex items-center justify-between px-2 py-2">
                  <h3 
                    className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider cursor-pointer hover:text-foreground transition-colors"
                    onClick={() => navigate("/projects")}
                  >
                    Projekte
                  </h3>
                  <CollapsibleTrigger asChild>
                    <button
                      className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-foreground/3 hover:text-foreground"
                      aria-label={projectsCollapsed ? "Projekte ausklappen" : "Projekte einklappen"}
                    >
                      {projectsCollapsed ? (
                        <ChevronRight className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </button>
                  </CollapsibleTrigger>
                </div>

                <CollapsibleContent className="animate-accordion-down data-[state=closed]:animate-accordion-up">
                  <div className="space-y-1">
                    {projects.map((project) => {
                      const projectMigs = projectMigrations.filter(m => m.projectId === project.id);
                      const hasProjectMigrations = projectMigs.length > 0;
                      return (
                        <div key={project.id} className="space-y-1">
                          <div className="flex w-full items-center justify-between rounded-xl px-2 py-1.5 text-sm transition-colors">
                            <div className="flex flex-1 items-center gap-2">
                              {hasProjectMigrations && (
                                <button
                                  type="button"
                                  onClick={() => toggleProject(project.id)}
                                  className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-foreground/3 hover:text-foreground"
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
                                className="flex-1 text-left font-normal text-muted-foreground transition-colors hover:text-foreground"
                              >
                                {project.name}
                              </button>
                            </div>
                            <button
                              onClick={() => onNewProjectMigration?.(project.id)}
                              className="rounded p-1 transition-colors hover:bg-foreground/3"
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
                                      ? "border-l-2 border-primary bg-primary/5 text-foreground font-medium"
                                      : "text-muted-foreground/80 hover:bg-foreground/3 hover:text-foreground",
                                  )}
                                >
                                  <button
                                    onClick={() => navigate(`/projects/${project.id}/migration/${migration.id}`)}
                                    className="flex-1 text-left"
                                  >
                                    {migration.name}
                                  </button>
                                  <div className="opacity-0 transition-opacity group-hover:opacity-100">
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => e.stopPropagation()}>
                                          <MoreHorizontal className="h-4 w-4" />
                                          <span className="sr-only">Migrationsmenü</span>
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                                        <DropdownMenuItem onSelect={() => onEditMigration?.(migration.id)}>
                                          <Pencil className="mr-2 h-4 w-4" />
                                          <span>Bearbeiten</span>
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onSelect={() => onDuplicateMigration?.(migration.id)}>
                                          <Copy className="mr-2 h-4 w-4" />
                                          <span>Duplizieren</span>
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          onSelect={() => onDeleteMigration?.(migration.id)}
                                          className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                                        >
                                          <Trash2 className="mr-2 h-4 w-4" />
                                          <span>Löschen</span>
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>

            {/* Divider */}
            <div className="border-t border-border/30 my-2 flex-shrink-0" />

            {/* Migrations Section - Scrollable with Infinite Scroll */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="flex-shrink-0 flex items-center justify-between px-2 py-2">
                <h3 className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider">
                  Migrationen {totalMigrationsCount > 0 && `(${totalMigrationsCount})`}
                </h3>
                <Button
                  onClick={onNewMigration}
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              {/* Scrollable Migrations Container */}
              <div 
                ref={migrationsScrollRef}
                className="flex-1 overflow-y-auto min-h-0 space-y-1 pr-1"
              >
                {standaloneMigrations.length > 0 ? (
                  <>
                    {standaloneMigrations.map((migration) => (
                      <div
                        key={migration.id}
                        className={cn(
                          "group flex items-center justify-between w-full rounded-xl px-4 py-2 text-sm transition-colors",
                          selectedMigration === migration.id
                            ? "border-l-2 border-primary bg-primary/5 text-foreground font-medium"
                            : "text-muted-foreground/80 hover:bg-foreground/3 hover:text-foreground",
                        )}
                      >
                        <button
                          onClick={() => navigate(`/migration/${migration.id}`)}
                          className="flex-1 text-left"
                        >
                          {migration.name}
                        </button>
                        <div className="opacity-0 transition-opacity group-hover:opacity-100">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => e.stopPropagation()}>
                                <MoreHorizontal className="h-4 w-4" />
                                <span className="sr-only">Migrationsmenü</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                              <DropdownMenuItem onSelect={() => onEditMigration?.(migration.id)}>
                                <Pencil className="mr-2 h-4 w-4" />
                                <span>Bearbeiten</span>
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => onDuplicateMigration?.(migration.id)}>
                                <Copy className="mr-2 h-4 w-4" />
                                <span>Duplizieren</span>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => onDeleteMigration?.(migration.id)}
                                className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                <span>Löschen</span>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    ))}

                    {/* Loading Indicator */}
                    {isLoadingMoreMigrations && (
                      <div className="flex items-center justify-center py-4 animate-fade-in">
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50">
                          <Loader2 className="h-3 w-3 animate-spin text-primary" />
                          <span className="text-xs text-muted-foreground">
                            Lade weitere...
                          </span>
                        </div>
                      </div>
                    )}

                    {/* End of List Indicator */}
                    {!hasMoreMigrations && standaloneMigrations.length > 0 && totalMigrationsCount > 20 && (
                      <p className="text-center text-xs text-muted-foreground/50 py-2">
                        Alle {totalMigrationsCount} Migrationen geladen
                      </p>
                    )}
                  </>
                ) : (
                  <p className="px-4 py-2 text-xs text-muted-foreground">Keine Migrationen</p>
                )}
              </div>
            </div>
          </nav>
        </>
      )}
    </div>
  );
};

export default Sidebar;