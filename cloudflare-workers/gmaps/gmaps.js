// Cloudflare Worker: Google Routes API Proxy
// Set GMAPS_API_KEY as an environment variable
// Supported paths:
//   POST /computeRoutes       → routes.googleapis.com/directions/v2:computeRoutes
//   POST /computeRouteMatrix  → routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix
//   POST /                    → defaults to computeRoutes

const ENDPOINTS = {
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
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Goog-FieldMask",
};

export default {
  async fetch(request, env) {
    // --- CORS preflight ---
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // --- Determine endpoint from path ---
    const action = new URL(request.url).pathname.replace(/^\/+|\/+$/g, "");
    const endpoint = ENDPOINTS[action] ?? ENDPOINTS.computeRoutes;

    // --- FieldMask ---
    const fieldMask =
      request.headers.get("X-Goog-FieldMask") || endpoint.defaultFieldMask;

    // --- Parse JSON body ---
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        }
      );
    }

    // --- API Key ---
    const apiKey = env.GMAPS_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "GMAPS_API_KEY not configured" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        }
      );
    }

    // --- Proxy to Google Routes API ---
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
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  },
};
