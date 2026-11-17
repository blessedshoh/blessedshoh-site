declare namespace App {
  interface Locals {
    /** The signed-in admin's email address, set by the middleware on /admin pages. */
    admin?: string;
    /** Set by the Cloudflare adapter: lets work such as counting finish after the response. */
    cfContext?: ExecutionContext;
  }
}
