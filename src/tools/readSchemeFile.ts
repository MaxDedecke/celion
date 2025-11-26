export type ReadSchemeFileParams = {
  path: string;
};

/**
 * Utility tool to load deterministic API scheme files from /schemes.
 */
export const readSchemeFile = async <T = unknown>({ path }: ReadSchemeFileParams): Promise<T> => {
  if (!path || typeof path !== "string") {
    throw new Error("Es wurde kein gültiger Schemapfad übergeben.");
  }

  const normalizedPath = path.trim();
  if (!normalizedPath) {
    throw new Error("Der Schemapfad darf nicht leer sein.");
  }

  const response = await fetch(normalizedPath, { method: "GET" });

  if (!response.ok) {
    throw new Error(`Konnte Schema-Datei nicht laden: ${response.status} ${response.statusText}`);
  }

  try {
    const payload = (await response.json()) as T;
    return payload;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler beim Parsen der Schema-Datei.";
    throw new Error(message);
  }
};
