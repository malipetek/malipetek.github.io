// Wrangler is configured (see [[rules]] in wrangler.toml) to import `.md` files
// as Text modules, so the persona ships inside the bundle as a plain string.
declare module '*.md' {
  const content: string;
  export default content;
}

declare module '*.md?raw' {
  const content: string;
  export default content;
}
