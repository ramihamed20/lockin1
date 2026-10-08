declare module "*.css";
declare module "*.mjs?url" {
  const url: string;
  export default url;
}
declare module "*.pdf?url&no-inline" {
  const url: string;
  export default url;
}
