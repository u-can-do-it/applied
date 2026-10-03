// The Settings forms' schemas (the actions' own), loaded when a form is first checked rather than with
// the page: zod would add ~20 kB gzipped to it. Focusing a form starts the download.
export const loadSettingsSchemas = () => import('@/lib/shared/schemas/settings');
