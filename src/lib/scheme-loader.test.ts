import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadScheme, loadObjectScheme } from './scheme-loader';
import { readFile } from 'node:fs/promises';

vi.mock('node:fs/promises');

describe('scheme-loader', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('loadScheme', () => {
    it('should return null if systemName is empty', async () => {
      const result = await loadScheme('');
      expect(result).toBeNull();
    });

    it('should normalize system name and load the correct file', async () => {
      const mockScheme = { name: 'Notion' };
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockScheme));

      const result = await loadScheme('Notion');

      expect(result).toEqual(mockScheme);
      expect(readFile).toHaveBeenCalledWith(expect.stringContaining('notion.json'), 'utf-8');
    });

    it('should return null if file reading fails', async () => {
      vi.mocked(readFile).mockRejectedValue(new Error('File not found'));
      
      const result = await loadScheme('NonExistent');
      expect(result).toBeNull();
    });
  });

  describe('loadObjectScheme', () => {
    it('should load the correct object scheme file', async () => {
      const mockObjects = { objects: [] };
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockObjects));

      const result = await loadObjectScheme('Jira Cloud');

      expect(result).toEqual(mockObjects);
      expect(readFile).toHaveBeenCalledWith(expect.stringContaining('jiracloud_objects.json'), 'utf-8');
    });
  });
});
