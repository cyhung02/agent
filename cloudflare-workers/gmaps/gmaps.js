// Cloudflare Worker: Google Maps Platform Proxy
// Set GMAPS_API_KEY as an environment variable (wrangler secret put GMAPS_API_KEY)
//
// Routes API (POST):
//   /computeRoutes       → routes.googleapis.com/directions/v2:computeRoutes
//   /computeRouteMatrix  → routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix
//   /                    → defaults to computeRoutes
//
// Maps API (GET):
//   /maps/*              → maps.googleapis.com/maps/*  (injects key query param)
//
// Places API (GET/POST):
//   /v1/*                → places.googleapis.com/v1/*  (injects X-Goog-Api-Key header)

const ROUTES_ENDPOINTS = {
  computeRoutes: {
    upstream: "https://routes.googleapis.com/directions/v2:computeRoutes",
    defaultFieldMask: "routes.duration,routes.distanceMeters,routes.legs",
  },
  computeRouteMatrix: {
    upstream: "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
    defaultFieldMask: "originIndex,destinationIndex,duration,distanceMeters,status,condition",
  },
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Goog-FieldMask",
};

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const apiKey = env.GMAPS_API_KEY;
    if (!apiKey) return jsonError("GMAPS_API_KEY not configured", 500);

    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+|\/+$/g, "");

    // --- Routes API ---
    if (path === "" || path === "computeRoutes" || path === "computeRouteMatrix") {
      if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

      const endpoint = ROUTES_ENDPOINTS[path] ?? ROUTES_ENDPOINTS.computeRoutes;
      const fieldMask = request.headers.get("X-Goog-FieldMask") || endpoint.defaultFieldMask;

      let body;
      try { body = await request.json(); }
      catch { return jsonError("Invalid JSON body", 400); }

      const upstream = await fetch(endpoint.upstream, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": fieldMask,
        },
        body: JSON.stringify(body),
      });

      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    // --- Maps API (Geocoding, etc.) ---
    if (path.startsWith("maps/")) {
      if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

      const upstreamUrl = new URL("https://maps.googleapis.com/" + path);
      for (const [k, v] of url.searchParams) {
        if (k !== "key") upstreamUrl.searchParams.set(k, v);
      }
      upstreamUrl.searchParams.set("key", apiKey);

      const upstream = await fetch(upstreamUrl.toString());
      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    // --- Places API (v1) ---
    if (path.startsWith("v1/")) {
      const upstreamUrl = new URL("https://places.googleapis.com/" + path);
      for (const [k, v] of url.searchParams) {
        upstreamUrl.searchParams.set(k, v);
      }

      const upstreamHeaders = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
      };
      const fieldMask = request.headers.get("X-Goog-FieldMask");
      if (fieldMask) upstreamHeaders["X-Goog-FieldMask"] = fieldMask;

      const upstreamInit = { method: request.method, headers: upstreamHeaders };
      if (request.method === "POST") upstreamInit.body = await request.text();

      const upstream = await fetch(upstreamUrl.toString(), upstreamInit);
      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
};
