import { DiscoveryPaginationConfig } from "@/types/schemes";
import { HttpResponse, SmartDiscoveryParams, SmartDiscoveryResponse } from "@/types/agents";
import { httpClient } from "./httpRequest";

export async function smartDiscovery(params: SmartDiscoveryParams): Promise<SmartDiscoveryResponse> {
  const { url, method, headers, body, paginationConfig, discoveryBrake } = params;
  
  const uniqueIds = new Set<string>();
  let pagesFetched = 0;
  let sampleData: any = null;
  let currentUrl = url;

  const maxPages = discoveryBrake ? 1 : 100; // Safety limit
  const limit = discoveryBrake ? 1 : (paginationConfig?.defaultLimit || 100);

  try {
    while (pagesFetched < maxPages) {
      // Prepare URL with pagination params
      const paginatedUrl = injectPaginationParams(currentUrl, paginationConfig, pagesFetched, limit);
      
      const response: HttpResponse = await httpClient({
        url: paginatedUrl,
        method,
        headers,
        body
      });

      if (response.error) {
        return { totalCount: uniqueIds.size, pagesFetched, sampleData, status: response.status, error: response.error };
      }

      pagesFetched++;
      const responseBody = response.body;
      
      if (pagesFetched === 1) {
        sampleData = responseBody;
      }

      const items = extractItems(responseBody);
      
      // Deduplicate by ID
      items.forEach((item: any) => {
        if (item && item.id) {
          uniqueIds.add(String(item.id));
        } else {
          // Fallback for items without ID: use index if needed or just count them?
          // For now, if no ID is present, we count it as a unique entry based on its position
          // but that's not ideal. However, for most entities (tasks, users, etc.) IDs are mandatory.
        }
      });

      // Check if we should continue
      if (discoveryBrake || !shouldContinue(response, items, paginationConfig, pagesFetched, limit)) {
        break;
      }

      // Update currentUrl or params for next page if it's cursor-based
      if (paginationConfig?.type === 'cursor' || paginationConfig?.type === 'continuationToken') {
          const nextCursor = extractNextCursor(response, paginationConfig);
          if (!nextCursor) break;
          currentUrl = updateUrlWithCursor(currentUrl, paginationConfig, nextCursor);
      }
    }

    return {
      totalCount: uniqueIds.size,
      pagesFetched,
      sampleData: discoveryBrake && Array.isArray(sampleData) ? sampleData.slice(0, 1) : sampleData,
      status: 200,
    };
  } catch (error) {
    return {
      totalCount: uniqueIds.size,
      pagesFetched,
      sampleData,
      status: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function injectPaginationParams(url: string, config: DiscoveryPaginationConfig | null | undefined, pageIndex: number, limit: number): string {
  if (!config || config.type === 'none') return url;

  // Use a dummy base to handle relative URLs
  const isRelative = !url.startsWith('http');
  const baseUrl = 'http://api-template.internal';
  const urlObj = new URL(url, isRelative ? baseUrl : undefined);
  
  const firstPage = config.firstPage !== undefined ? config.firstPage : 1;
  
  switch (config.type) {
    case 'page':
    case 'page_limit':
    case 'page_per_page':
      const paramPage = config.paramPage || 'page';
      urlObj.searchParams.set(paramPage, (pageIndex + Number(firstPage || 0)).toString());
      if (config.paramLimit) urlObj.searchParams.set(config.paramLimit, limit.toString());
      break;
    case 'offset':
    case 'offset_limit':
      const paramOffset = config.paramOffset || 'offset';
      urlObj.searchParams.set(paramOffset, (pageIndex * limit).toString());
      if (config.paramLimit) urlObj.searchParams.set(config.paramLimit, limit.toString());
      break;
    case 'startAt_maxResults':
      if (config.paramStart) urlObj.searchParams.set(config.paramStart, (pageIndex * limit).toString());
      if (config.paramLimit) urlObj.searchParams.set(config.paramLimit, limit.toString());
      break;
    case 'page_size_offset':
        if (config.paramLimit) urlObj.searchParams.set(config.paramLimit, limit.toString());
        if (config.paramOffset) urlObj.searchParams.set(config.paramOffset, (pageIndex * limit).toString());
        break;
    case 'skip_top':
        urlObj.searchParams.set('$skip', (pageIndex * limit).toString());
        urlObj.searchParams.set('$top', limit.toString());
        break;
    case 'cursor':
    case 'continuationToken':
        if (config.paramLimit) urlObj.searchParams.set(config.paramLimit, limit.toString());
        break;
  }

  if (isRelative) {
    return urlObj.pathname + urlObj.search;
  }
  return urlObj.toString();
}

function extractItems(body: any): any[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') {
    // Common patterns: body.items, body.data, body.tasks, etc.
    for (const key of ['items', 'data', 'tasks', 'elements', 'values', 'results', 'members', 'users', 'teams', 'spaces', 'folders', 'lists']) {
      if (Array.isArray(body[key])) return body[key];
    }
    // Deep search for first array if no common key matches?
    for (const key in body) {
      if (Array.isArray(body[key])) return body[key];
    }
  }
  return [];
}

function shouldContinue(response: HttpResponse, items: any[], config: DiscoveryPaginationConfig | null | undefined, pagesFetched: number, limit: number): boolean {
  if (!config || config.type === 'none') return false;
  if (items.length === 0) return false;
  
  // For numeric/index based pagination, if we got fewer items than requested, it's the last page.
  // This avoids an extra request that would return 0 items.
  const isNumericPagination = config.type && (
    config.type.includes('page') || 
    config.type.includes('offset') || 
    config.type.includes('startAt') || 
    config.type.includes('skip')
  );

  if (isNumericPagination && items.length < limit) return false;
  
  return true;
}

function extractNextCursor(response: HttpResponse, config: DiscoveryPaginationConfig): string | null {
    const body = response.body as any;
    const cursorKey = config.responseCursorKey || config.paramCursor;
    if (!cursorKey || !body) return null;

    // Support nested keys like 'next_page.offset'
    const value = cursorKey.split('.').reduce((o, i) => (o ? o[i] : undefined), body);
    if (value) return String(value);

    // Header based continuation?
    if (config.headerContinuation && response.headers[config.headerContinuation]) {
        return response.headers[config.headerContinuation];
    }
    return null;
}

function updateUrlWithCursor(url: string, config: DiscoveryPaginationConfig, cursor: string): string {
    const urlObj = new URL(url.startsWith('http') ? url : `http://dummy.com${url}`);
    if (config.paramCursor) {
        urlObj.searchParams.set(config.paramCursor, cursor);
    } else if (config.paramContinuation) {
        urlObj.searchParams.set(config.paramContinuation, cursor);
    }
    return url.startsWith('http') ? urlObj.toString() : urlObj.pathname + urlObj.search;
}
