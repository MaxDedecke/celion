import { readFile } from 'fs/promises';
import { join } from 'path';

export const loadScheme = async (systemName: string): Promise<any | null> => {
  if (!systemName) return null;

  // Normalize system name to filename (e.g. "Jira Cloud" -> "jiracloud.json")
  const normalized = systemName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const filename = `${normalized}.json`;
  
  // Assuming schemes are at /app/schemes in the docker container (and project root locally)
  const schemePath = join(process.cwd(), 'schemes', filename);

  try {
    const content = await readFile(schemePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.warn(`Could not load scheme for system '${systemName}' at path '${schemePath}':`, error);
    return null;
  }
};
