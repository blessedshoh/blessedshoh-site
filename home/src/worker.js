// blessedshoh.dev until the portfolio exists.
//   /                 the holding page (public/index.html)
//   www.<anything>    folds into blessedshoh.dev
//   any other path    forwards to the same path on prep.blessedshoh.dev, so old
//                     links to the CFA site (it used to live here) keep working.
// The forwards are temporary (302) on purpose: this address becomes the portfolio.

const PREP = "https://prep.blessedshoh.dev";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname.startsWith("www.")) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }

    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404) return asset;

    return Response.redirect(PREP + url.pathname + url.search, 302);
  },
};
