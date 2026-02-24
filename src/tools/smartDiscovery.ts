import { DiscoveryPaginationConfig } from "@/types/schemes";
import { HttpResponse, SmartDiscoveryParams, SmartDiscoveryResponse } from "@/types/agents";
import { httpClient } from "./httpRequest";

export async function smartDiscovery(params: SmartDiscoveryParams): Promise<SmartDiscoveryResponse> {
  const { url, method, headers, body, paginationConfig } = params;
  
  const uniqueIds = new Set<string>();
  let pagesFetched = 0;
  let sampleData: any = null;
  let currentUrl = url;
  let currentBody = body;

  const maxPages = 100; // Safety limit
  const limit = paginationConfig?.defaultLimit || 100;

  try {
    while (pagesFetched < maxPages) {
      // Prepare URL and Body with pagination params
      const { url: paginatedUrl, body: paginatedBody } = injectPaginationParams(
        currentUrl, 
        method || 'GET', 
        currentBody, 
        paginationConfig, 
        pagesFetched, 
        limit
      );
      
      const response: HttpResponse = await httpClient({
        url: paginatedUrl,
        method,
        headers,
        body: paginatedBody
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
        const id = item?.gid || item?.id || item?.key || item?.uuid;
        if (id !== undefined && id !== null) {
          uniqueIds.add(String(id));
        }
      });

      // Check if we should continue
      if (!shouldContinue(response, items, paginationConfig, pagesFetched, limit)) {
        break;
      }

      // Update currentUrl/Body for next page if it's cursor-based
      if (paginationConfig?.type === 'cursor' || paginationConfig?.type === 'continuationToken') {
          const nextCursor = extractNextCursor(response, paginationConfig);
          if (!nextCursor) break;
          const updated = updateWithCursor(currentUrl, method || 'GET', currentBody, paginationConfig, nextCursor);
          currentUrl = updated.url;
          currentBody = updated.body;
      }
    }

    return {
      totalCount: uniqueIds.size,
      pagesFetched,
      sampleData: Array.isArray(sampleData) ? sampleData.slice(0, 3) : sampleData,
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

function injectPaginationParams(
  url: string, 
  method: string, 
  body: any, 
  config: DiscoveryPaginationConfig | null | undefined, 
  pageIndex: number, 
  limit: number
): { url: string, body: any } {
  if (!config || config.type === 'none') return { url, body };

  const isPost = method.toUpperCase() === 'POST';
  let updatedBody = body;
  
  // Use a dummy base to handle relative URLs
  const isRelative = !url.startsWith('http');
  const baseUrl = 'http://api-template.internal';
  const urlObj = new URL(url, isRelative ? baseUrl : undefined);
  
  const firstPage = config.firstPage !== undefined ? config.firstPage : 1;

  const setParam = (key: string, value: string | number) => {
    if (isPost) {
        if (typeof updatedBody !== 'object' || updatedBody === null) updatedBody = {};
        updatedBody[key] = value;
    } else {
        urlObj.searchParams.set(key, String(value));
    }
  };
  
  switch (config.type) {
    case 'page':
    case 'page_limit':
    case 'page_per_page':
      const paramPage = config.paramPage || 'page';
      setParam(paramPage, (pageIndex + Number(firstPage || 0)));
      if (config.paramLimit) setParam(config.paramLimit, limit);
      break;
    case 'offset':
    case 'offset_limit':
      const paramOffset = config.paramOffset || 'offset';
      setParam(paramOffset, (pageIndex * limit));
      if (config.paramLimit) setParam(config.paramLimit, limit);
      break;
    case 'startAt_maxResults':
      if (config.paramStart) setParam(config.paramStart, (pageIndex * limit));
      if (config.paramLimit) setParam(config.paramLimit, limit);
      break;
    case 'page_size_offset':
        if (config.paramLimit) setParam(config.paramLimit, limit);
        if (config.paramOffset) setParam(config.paramOffset, (pageIndex * limit));
        break;
    case 'skip_top':
        setParam('$skip', (pageIndex * limit));
        setParam('$top', limit);
        break;
    case 'cursor':
    case 'continuationToken':
        if (config.paramLimit) setParam(config.paramLimit, limit);
        break;
  }

  const finalUrl = isRelative ? urlObj.pathname + urlObj.search : urlObj.toString();
  return { url: finalUrl, body: updatedBody };
}

function extractItems(body: any): any[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') {
    // Common patterns: body.items, body.data, body.tasks, etc.
    for (const key of ['items', 'results', 'data', 'tasks', 'elements', 'values', 'members', 'users', 'teams', 'spaces', 'folders', 'lists']) {
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

function updateWithCursor(url: string, method: string, body: any, config: DiscoveryPaginationConfig, cursor: string): { url: string, body: any } {
    const isPost = method.toUpperCase() === 'POST';
    let updatedBody = body;
    const urlObj = new URL(url.startsWith('http') ? url : `http://dummy.com${url}`);
    
    const setCursor = (key: string, value: string) => {
        if (isPost) {
            if (typeof updatedBody !== 'object' || updatedBody === null) updatedBody = {};
            updatedBody[key] = value;
        } else {
            urlObj.searchParams.set(key, value);
        }
    };

    if (config.paramCursor) {
        setCursor(config.paramCursor, cursor);
    } else if (config.paramContinuation) {
        setCursor(config.paramContinuation, cursor);
    }
    
    const finalUrl = url.startsWith('http') ? urlObj.toString() : urlObj.pathname + urlObj.search;
    return { url: finalUrl, body: updatedBody };
}

