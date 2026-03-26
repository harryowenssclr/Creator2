/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Production: full origin of the Node API (no trailing slash), e.g. https://creator-api.example.com */
  readonly VITE_API_BASE_URL?: string
}
