import { DATA_SOURCE_TYPE_OPTIONS } from "@/constants/sourceTypes";

export type StepKey = 
  | "name"
  | "sourceSystem"
  | "sourceUrl"
  | "sourceApiToken"
  | "sourceEmail"
  | "sourceScope"
  | "targetSystem"
  | "targetUrl"
  | "targetApiToken"
  | "targetEmail"
  | "targetScope"
  | "confirmation";

export interface ChatConfig {
  name?: string;
  sourceSystem?: string;
  sourceUrl?: string;
  sourceApiToken?: string;
  sourceEmail?: string;
  sourceScope?: string;
  targetSystem?: string;
  targetUrl?: string;
  targetApiToken?: string;
  targetEmail?: string;
  targetScope?: string;
}

export interface StepConfig {
  key: StepKey;
  question: string;
  validate?: (value: string) => string | null; // Returns error message or null
  process?: (value: string) => any;
  options?: readonly string[];
}

export const steps: StepConfig[] = [
  {
    key: "name",
    question: "Hallo! Ich bin dein Konfigurations-Assistent. Lass uns deine Migration einrichten. Wie soll sie heißen?",
    validate: (val) => val.trim().length > 0 ? null : "Der Name darf nicht leer sein.",
  },
  {
    key: "sourceSystem",
    question: `Welches ist das Quellsystem? (z.B. ${DATA_SOURCE_TYPE_OPTIONS.slice(0, 3).join(", ")}...)`,
    validate: (val) => DATA_SOURCE_TYPE_OPTIONS.includes(val as any) ? null : "Bitte wähle ein gültiges System aus der Liste.",
    options: DATA_SOURCE_TYPE_OPTIONS,
  },
  {
    key: "sourceUrl",
    question: "Wie lautet die URL des Quellsystems?",
    validate: (val) => {
      try {
        new URL(val);
        return null;
      } catch {
        return "Bitte gib eine gültige URL ein (inkl. https://).";
      }
    },
  },
  {
    key: "sourceApiToken",
    question: "Bitte gib den API Token für das Quellsystem ein.",
    validate: (val) => val.trim().length > 0 ? null : "Der Token darf nicht leer sein.",
  },
  {
    key: "sourceEmail",
    question: "Welche E-Mail-Adresse gehört zu diesem Token?",
    validate: (val) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val) ? null : "Bitte gib eine gültige E-Mail-Adresse ein.",
  },
  {
    key: "sourceScope",
    question: "Möchtest du die Migration auf ein bestimmtes Projekt beschränken? Gib die ID oder den Namen ein (oder 'skip' für alles).",
    process: (val) => val.toLowerCase() === "skip" ? undefined : val,
  },
  {
    key: "targetSystem",
    question: "Nun zum Zielsystem. Welches System ist das Ziel?",
    validate: (val) => DATA_SOURCE_TYPE_OPTIONS.includes(val as any) ? null : "Bitte wähle ein gültiges System aus der Liste.",
    options: DATA_SOURCE_TYPE_OPTIONS,
  },
  {
    key: "targetUrl",
    question: "Wie lautet die URL des Zielsystems?",
    validate: (val) => {
      try {
        new URL(val);
        return null;
      } catch {
        return "Bitte gib eine gültige URL ein (inkl. https://).";
      }
    },
  },
  {
    key: "targetApiToken",
    question: "Bitte gib den API Token für das Zielsystem ein.",
    validate: (val) => val.trim().length > 0 ? null : "Der Token darf nicht leer sein.",
  },
  {
    key: "targetEmail",
    question: "Und die E-Mail-Adresse für das Zielsystem?",
    validate: (val) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val) ? null : "Bitte gib eine gültige E-Mail-Adresse ein.",
  },
  {
    key: "targetScope",
    question: "Wie soll das Projekt im Zielsystem heißen? (Optional, 'skip' um den Quellnamen zu behalten).",
    process: (val) => val.toLowerCase() === "skip" ? undefined : val,
  },
  {
    key: "confirmation",
    question: "Ich habe alle Daten. Möchtest du die Migration jetzt anlegen? (ja/nein)",
    validate: (val) => ["ja", "nein", "yes", "no"].includes(val.toLowerCase()) ? null : "Bitte antworte mit 'ja' oder 'nein'.",
  }
];