// src/lib/server-helpers.ts

const PYTHON_BACKEND_URL = process.env.INTERNAL_BACKEND_URL || "http://127.0.0.1:8000";

export function resolveApiUrl(path: string): string {
  if (typeof window === 'undefined') {
    // We are in a server environment (Node.js)
    return `${PYTHON_BACKEND_URL}${path}`;
  }
  // We are in a browser environment
  return path;
}
