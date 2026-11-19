// Server-side bindings, declared here rather than with the full worker types so the
// browser code keeps the standard DOM types.
declare module "cloudflare:workers" {
  export const env: { DB: import("@blessedshoh/kit/hub-data").Database };
}

declare namespace App {
  interface Locals {
    cfContext?: { waitUntil(promise: Promise<unknown>): void };
  }
}
