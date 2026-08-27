/* Serve the built site. Node's own http module, because a site for a
   dependency-free tool should not need one to look at. */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, extname, normalize, resolve, sep } from "node:path";

const ROOT = resolve("site/dist");
const PORT = Number(process.env.PORT ?? 4181);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
};

createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const target = normalize(join(ROOT, decodeURIComponent(requested)));

  if (target !== ROOT && !target.startsWith(ROOT + sep)) {
    response.writeHead(403).end("outside the site");
    return;
  }
  try {
    /* Read first, then write headers: a missing file otherwise throws with the
       200 already sent, and the catch cannot put a 404 on top of it. */
    const body = readFileSync(target);
    response.writeHead(200, {
      "content-type": TYPES[extname(target)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404).end("not here");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`quoin.dev on http://127.0.0.1:${PORT}`));
