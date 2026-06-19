// Live backend (DigitalOcean droplet + Caddy auto-HTTPS via nip.io). The live-input mode
// POSTs here; the four bundled scenarios stay fully client-side. Override at build time with
// VITE_BACKEND_URL if the host changes.
export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "https://159.65.120.201.nip.io";
