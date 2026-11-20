export interface RouteState {
  view: 'landing' | 'dashboard' | 'editor';
  projectId: string | null;
}

/**
 * Parses current window location pathname and hash to determine view and route parameters.
 * Supports HTML5 pushState (/projects/:id, /dashboard, /) and hash-based fallback (#/projects/:id).
 */
export function parseRoute(pathname: string, hash: string = ''): RouteState {
  const cleanHash = (hash || '').replace(/^#/, '');
  const target = cleanHash.startsWith('/') ? cleanHash : pathname || '/';

  const projectMatch = target.match(/^\/(?:projects|editor)\/([^/?#]+)/i);
  if (projectMatch && projectMatch[1]) {
    return { view: 'editor', projectId: decodeURIComponent(projectMatch[1]) };
  }

  if (target.startsWith('/dashboard')) {
    return { view: 'dashboard', projectId: null };
  }

  return { view: 'landing', projectId: null };
}
