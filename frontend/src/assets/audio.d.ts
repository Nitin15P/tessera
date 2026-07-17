// Vite turns an imported audio file into a URL string. Declared explicitly so
// the import type-checks regardless of the vite/client version in use.
declare module "*.mp3" {
  const src: string;
  export default src;
}
