import { readSchemeFile } from "./readSchemeFile";

export type ReadJsonFileParams = { path: string };

/**
 * Generic JSON reader that leverages the deterministic scheme loader.
 */
export const readJsonFile = async <T = unknown>({ path }: ReadJsonFileParams): Promise<T> => {
  return readSchemeFile<T>({ path });
};
