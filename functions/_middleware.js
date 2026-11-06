// Send visitors on the *.pages.dev address or www. to the same page on localvibecheck.site.
const CANONICAL = "localvibecheck.site";

export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  if (url.hostname.endsWith(".pages.dev") || url.hostname === "www." + CANONICAL) {
    url.hostname = CANONICAL;
    url.protocol = "https:";
    url.port = "";
    return Response.redirect(url.toString(), 301);
  }
  return next();
}
