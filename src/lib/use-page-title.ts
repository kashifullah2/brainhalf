import { useEffect } from "react";

export interface SeoOptions {
  title: string;
  description?: string;
  canonicalPath?: string;
  noindex?: boolean;
}

/**
 * Manages SEO metadata dynamically on SPA route changes, including page title,
 * canonical URL, meta description, OpenGraph URL, and robots indexation tags.
 */
export function usePageSeo({ title, description, canonicalPath, noindex = false }: SeoOptions) {
  useEffect(() => {
    // 1. Title
    if (title) {
      document.title = title;
    }

    // 2. Meta Description
    if (description) {
      let metaDesc = document.querySelector<HTMLMetaElement>('meta[name="description"]');
      if (!metaDesc) {
        metaDesc = document.createElement("meta");
        metaDesc.name = "description";
        document.head.appendChild(metaDesc);
      }
      metaDesc.content = description;
    }

    // 3. Canonical Tag
    const baseUrl = "https://brainhalf.com";
    let canonicalUrl = baseUrl;
    if (canonicalPath !== undefined) {
      const cleanPath = canonicalPath.startsWith("/") ? canonicalPath : `/${canonicalPath}`;
      canonicalUrl = `${baseUrl}${cleanPath === "/" ? "" : cleanPath}`;
    } else {
      // Default to current location pathname if not specified
      const currentPath = window.location.pathname;
      canonicalUrl = `${baseUrl}${currentPath === "/" ? "" : currentPath}`;
    }

    let linkCanonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!linkCanonical) {
      linkCanonical = document.createElement("link");
      linkCanonical.rel = "canonical";
      document.head.appendChild(linkCanonical);
    }
    linkCanonical.href = canonicalUrl;

    // 4. OpenGraph URL
    const ogUrl = document.querySelector<HTMLMetaElement>('meta[property="og:url"]');
    if (ogUrl) {
      ogUrl.content = canonicalUrl;
    }

    // 5. Meta Robots (index vs noindex)
    let metaRobots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!metaRobots) {
      metaRobots = document.createElement("meta");
      metaRobots.name = "robots";
      document.head.appendChild(metaRobots);
    }

    if (noindex) {
      metaRobots.content = "noindex, nofollow";
    } else {
      metaRobots.content = "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";
    }
  }, [title, description, canonicalPath, noindex]);
}

/**
 * Convenience wrapper for setting the browser tab title and SEO attributes for a page.
 */
export function usePageTitle(title: string, options?: Partial<Omit<SeoOptions, "title">>) {
  usePageSeo({
    title,
    ...options,
  });
}

