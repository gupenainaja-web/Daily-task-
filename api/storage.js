// Vercel Serverless Function: /api/storage
// Proxies get/set/list/del requests to an Upstash Redis database using its REST API.
//
// Setup required on Vercel (one-time):
// 1. In your Vercel project -> Storage tab -> Create Database -> choose a Redis
//    provider (Upstash). Connect it to this project.
// 2. Vercel will automatically add environment variables to the project.
//    This code expects KV_REST_API_URL and KV_REST_API_TOKEN. If the
//    integration gives different variable names (e.g. REDIS_URL / prefixed
//    names), open Project Settings -> Environment Variables and either
//    rename them or update the two constants below to match.
// 3. Redeploy the project after connecting the database so the env vars
//    are available to this function.

module.exports = async function handler(req, res) {
  const base = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!base || !token) {
    res.status(500).json({
      error: 'Missing KV_REST_API_URL / KV_REST_API_TOKEN environment variables. Connect a Redis database to this project in the Vercel Storage tab, then redeploy.'
    });
    return;
  }

  const authHeaders = { Authorization: 'Bearer ' + token };

  try {
    if (req.method === 'GET') {
      const { action, key, prefix } = req.query;

      if (action === 'get') {
        if (!key) {
          res.status(400).json({ error: 'missing key' });
          return;
        }
        const r = await fetch(base + '/get/' + encodeURIComponent(key), { headers: authHeaders });
        if (!r.ok) {
          res.status(502).json({ error: 'upstream get failed with status ' + r.status });
          return;
        }
        const data = await r.json();
        res.status(200).json({ value: data.result === undefined ? null : data.result });
        return;
      }

      if (action === 'list') {
        // Returns all keys starting with `prefix`. Uses Upstash's generic
        // command endpoint to run KEYS prefix* — fine for small datasets
        // like this app's; avoid for very large databases.
        const pattern = (prefix || '') + '*';
        const r = await fetch(base, {
          method: 'POST',
          headers: Object.assign({}, authHeaders, { 'Content-Type': 'application/json' }),
          body: JSON.stringify(['KEYS', pattern])
        });
        if (!r.ok) {
          res.status(502).json({ error: 'upstream list failed with status ' + r.status });
          return;
        }
        const data = await r.json();
        res.status(200).json({ keys: data.result || [] });
        return;
      }

      res.status(400).json({ error: 'unknown action' });
      return;
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const { action, key, value, keys } = body;

      if (action === 'set') {
        if (!key) {
          res.status(400).json({ error: 'missing key' });
          return;
        }
        const payload = typeof value === 'string' ? value : JSON.stringify(value);
        const r = await fetch(base + '/set/' + encodeURIComponent(key), {
          method: 'POST',
          headers: Object.assign({}, authHeaders, { 'Content-Type': 'text/plain' }),
          body: payload
        });
        if (!r.ok) {
          res.status(502).json({ error: 'upstream set failed with status ' + r.status });
          return;
        }
        res.status(200).json({ ok: true });
        return;
      }

      if (action === 'del') {
        const targetKeys = Array.isArray(keys) ? keys : (key ? [key] : []);
        if (!targetKeys.length) {
          res.status(400).json({ error: 'missing key(s)' });
          return;
        }
        let deleted = 0;
        for (const k of targetKeys) {
          const r = await fetch(base + '/del/' + encodeURIComponent(k), {
            method: 'POST',
            headers: authHeaders
          });
          if (r.ok) deleted++;
        }
        res.status(200).json({ ok: true, deleted, total: targetKeys.length });
        return;
      }

      res.status(400).json({ error: 'unknown action' });
      return;
    }

    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message || 'unexpected server error' });
  }
};
