import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `base` defaults to "/", which is correct for local dev and for a
// root-domain deploy (Vercel, Netlify, a custom domain, etc). The GitHub
// Pages workflow (.github/workflows/deploy.yml) overrides this at build
// time with `--base=/<repo-name>/`, since a GitHub Pages *project* site is
// served under a subpath rather than the domain root.
export default defineConfig({
  plugins: [react()],
  base: "/",
});
