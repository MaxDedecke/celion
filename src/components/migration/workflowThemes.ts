const WORKFLOW_COLOR_THEME = {
  sky: {
    gradient: "from-sky-500/40 via-sky-500/10 to-transparent",
    accentText: "text-sky-600 dark:text-sky-300",
    accentBadge: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
    progressBar: "bg-sky-500",
    activeCard: "border-sky-500/50 bg-sky-500/10",
  },
  violet: {
    gradient: "from-violet-500/40 via-violet-500/10 to-transparent",
    accentText: "text-violet-600 dark:text-violet-300",
    accentBadge: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
    progressBar: "bg-violet-500",
    activeCard: "border-violet-500/50 bg-violet-500/10",
  },
  emerald: {
    gradient: "from-emerald-500/40 via-emerald-500/10 to-transparent",
    accentText: "text-emerald-600 dark:text-emerald-300",
    accentBadge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    progressBar: "bg-emerald-500",
    activeCard: "border-emerald-500/50 bg-emerald-500/10",
  },
  amber: {
    gradient: "from-amber-500/40 via-amber-500/10 to-transparent",
    accentText: "text-amber-600 dark:text-amber-300",
    accentBadge: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    progressBar: "bg-amber-500",
    activeCard: "border-amber-500/50 bg-amber-500/10",
  },
  rose: {
    gradient: "from-rose-500/40 via-rose-500/10 to-transparent",
    accentText: "text-rose-600 dark:text-rose-300",
    accentBadge: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
    progressBar: "bg-rose-500",
    activeCard: "border-rose-500/50 bg-rose-500/10",
  },
} as const;

export type WorkflowThemeKey = keyof typeof WORKFLOW_COLOR_THEME;
export type WorkflowTheme = (typeof WORKFLOW_COLOR_THEME)[WorkflowThemeKey];

export const getWorkflowTheme = (color?: string): WorkflowTheme => {
  if (!color) {
    return WORKFLOW_COLOR_THEME.sky;
  }

  return WORKFLOW_COLOR_THEME[(color as WorkflowThemeKey) ?? "sky"] ?? WORKFLOW_COLOR_THEME.sky;
};

export { WORKFLOW_COLOR_THEME };
