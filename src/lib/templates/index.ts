import { reactTemplate } from './react';
import { nextjsTemplate } from './nextjs';
import { vueTemplate } from './vue';
import { svelteTemplate } from './svelte';
import { vanillaTemplate } from './vanilla';

export interface FrameworkTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  files: Record<string, string>;
}

export const FRAMEWORK_TEMPLATES: FrameworkTemplate[] = [
  reactTemplate,
  nextjsTemplate,
  vueTemplate,
  svelteTemplate,
  vanillaTemplate,
];

export function getFrameworkTemplate(id: string): FrameworkTemplate | undefined {
  return FRAMEWORK_TEMPLATES.find(t => t.id === id);
}

export function detectFramework(files: Record<string, string>): string {
  if (files['/next.config.mjs'] || files['/next.config.js'] || files['next.config.mjs']) return 'nextjs';
  if (files['/svelte.config.js'] || files['svelte.config.js']) return 'svelte';
  for (const path of Object.keys(files)) {
    if (path.endsWith('.vue')) return 'vue';
  }
  for (const path of Object.keys(files)) {
    if (path.endsWith('.jsx') || path.endsWith('.tsx')) return 'react';
  }
  return 'vanilla';
}
