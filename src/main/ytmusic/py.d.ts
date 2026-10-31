// Python helpers are bundled as text (esbuild `.py` loader) and written to disk at runtime.
declare module '*.py' {
  const source: string;
  export default source;
}
