/**
 * SEO & Document Metadata Manager for AutoDirector Single Page Application.
 * Safely updates document title, canonical link, and robots meta tags during client-side transitions.
 */

export interface SeoMetadataOptions {
  title?: string;
  description?: string;
  canonicalUrl?: string;
  isPrivate?: boolean;
}

const DEFAULT_TITLE = 'AutoDirector • AI Video Editor & Conversational Cutting Room';
const DEFAULT_DESCRIPTION =
  'AutoDirector is an AI-native video editing suite and conversational cutting room. Edit video with natural language, 5-pass deterministic rendering, kinetic word-pop subtitles, silence removal, and cinematic color grading.';
const PRIMARY_CANONICAL = 'https://ai-video-frontend-57bk.onrender.com/';

export function updateDocumentSeo(options: SeoMetadataOptions = {}): void {
  if (typeof document === 'undefined') return;

  const {
    title = DEFAULT_TITLE,
    description = DEFAULT_DESCRIPTION,
    canonicalUrl = PRIMARY_CANONICAL,
    isPrivate = false,
  } = options;

  // 1. Update Title
  document.title = title;

  // 2. Update or Create Meta Description
  let metaDescription = document.querySelector('meta[name="description"]');
  if (!metaDescription) {
    metaDescription = document.createElement('meta');
    metaDescription.setAttribute('name', 'description');
    document.head.appendChild(metaDescription);
  }
  metaDescription.setAttribute('content', description);

  // 3. Update or Create Robots Directive (Enforces noindex on private dashboard and sequence editor)
  let metaRobots = document.querySelector('meta[name="robots"]');
  if (!metaRobots) {
    metaRobots = document.createElement('meta');
    metaRobots.setAttribute('name', 'robots');
    document.head.appendChild(metaRobots);
  }
  if (isPrivate) {
    metaRobots.setAttribute('content', 'noindex, nofollow');
  } else {
    metaRobots.setAttribute(
      'content',
      'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'
    );
  }

  // 4. Update Canonical URL
  let linkCanonical = document.querySelector('link[rel="canonical"]');
  if (!linkCanonical) {
    linkCanonical = document.createElement('link');
    linkCanonical.setAttribute('rel', 'canonical');
    document.head.appendChild(linkCanonical);
  }
  linkCanonical.setAttribute('href', canonicalUrl);
}
