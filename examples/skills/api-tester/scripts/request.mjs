#!/usr/bin/env node

const [method = 'GET', url, headersJson, bodyStr] = process.argv.slice(2);

if (!url) {
  console.error('Usage: request.mjs <method> <url> [headers_json] [body]');
  process.exit(1);
}

const options = {
  method: method.toUpperCase(),
  headers: { 'User-Agent': 'brmonk-api-tester/1.0' },
};

// Parse headers
if (headersJson && headersJson !== 'undefined' && headersJson !== '') {
  try {
    const parsed = JSON.parse(headersJson);
    Object.assign(options.headers, parsed);
  } catch {
    // Ignore invalid headers
  }
}

// Add body for methods that support it
if (bodyStr && bodyStr !== 'undefined' && bodyStr !== '' && ['POST', 'PUT', 'PATCH'].includes(options.method)) {
  options.body = bodyStr;
  if (!options.headers['Content-Type']) {
    options.headers['Content-Type'] = 'application/json';
  }
}

const start = Date.now();

try {
  const resp = await fetch(url, options);
  const elapsed = Date.now() - start;
  const contentType = resp.headers.get('content-type') || '';
  let body;

  if (contentType.includes('json')) {
    try {
      body = JSON.stringify(await resp.json(), null, 2);
    } catch {
      body = await resp.text();
    }
  } else {
    body = await resp.text();
  }

  // Truncate very long responses
  if (body.length > 5000) {
    body = body.slice(0, 5000) + '\n... (truncated)';
  }

  console.log(JSON.stringify({
    status: resp.status,
    statusText: resp.statusText,
    elapsed_ms: elapsed,
    headers: Object.fromEntries(resp.headers),
    body,
  }, null, 2));
} catch (err) {
  console.log(JSON.stringify({
    error: err.message,
    elapsed_ms: Date.now() - start,
  }, null, 2));
  process.exit(1);
}
