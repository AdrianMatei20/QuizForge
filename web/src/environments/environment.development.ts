// Development build (ng serve). proxy.conf.json forwards /api to the Nest API on :3000,
// so the browser sees one origin and no CORS setup is needed.
export const environment = {
  apiBaseUrl: '/api',
};
