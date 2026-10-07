import { extname, join, sep } from "node:path";

const SITE_DIR = join(import.meta.dir, "site");
const PORT = Number(process.env.PORT ?? 8780);
const HOSTS = (process.env.HOST ?? "127.0.0.1")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

const NO_STORE = "no-store";

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": NO_STORE },
  });
}

async function serve(req: Request): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  let path: string;
  try {
    path = decodeURIComponent(new URL(req.url).pathname);
  } catch {
    return notFound();
  }
  if (path.includes("..") || path.includes("\\") || path.includes("\0")) return notFound();

  const abs = join(SITE_DIR, path === "/" ? "index.html" : path.slice(1));
  if (!abs.startsWith(SITE_DIR + sep)) return notFound();

  const type = CONTENT_TYPES[extname(abs).toLowerCase()];
  if (!type) return notFound();

  const file = Bun.file(abs);
  if (!(await file.exists())) return notFound();

  return new Response(req.method === "HEAD" ? null : file, {
    headers: { "Content-Type": type, "Cache-Control": NO_STORE },
  });
}

for (const hostname of HOSTS) {
  Bun.serve({ port: PORT, hostname, fetch: serve });
}

console.log(`Stardust Breaker: ${HOSTS.map((h) => `http://${h}:${PORT}`).join(", ")}`);
