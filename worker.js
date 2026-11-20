export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Forward API and WebSocket / Socket.IO requests to the Render backend
    if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) {
      const renderOrigin = env.RENDER_ORIGIN || 'https://mhc-dispatch-system.fly.dev';
      const targetUrl = new URL(request.url);
      const targetBase = new URL(renderOrigin);
      targetUrl.protocol = targetBase.protocol;
      targetUrl.host = targetBase.host;

      try {
        const resp = await fetch(targetUrl.toString(), {
          method: request.method,
          headers: request.headers,
          body: request.body,
          redirect: 'manual'
        });
        return resp;
      } catch (err) {
        return new Response(JSON.stringify({
          error: 'Backend proxy failed',
          message: err.message
        }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Default: Serve frontend static files (HTML, CSS, JS, sound files, images) directly from Cloudflare Edge
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  }
};
