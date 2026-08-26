/* A static server for the browser fixtures. Node's own http module, because a
   test suite for a zero-dependency library should not need a dependency to
   run. */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

const ROOT = resolve("test/browser/fixtures");
const PORT = Number(process.env.FIXTURE_PORT ?? 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
};

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;

  /* Contain the served path inside the fixture directory. This is a test
     server on loopback and still: a path-traversal hole is a path-traversal
     hole, and the fix is four lines. */
  const target = normalize(join(ROOT, decodeURIComponent(requested)));
  if (target !== ROOT && !target.startsWith(ROOT + sep)) {
    response.writeHead(403).end("outside the fixture directory");
    return;
  }

  try {
    const body = await readFile(target);
    response.writeHead(200, {
      "content-type": TYPES[extname(target)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404).end("no such fixture");
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`fixtures on http://127.0.0.1:${PORT}`);
});
