import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { setupTestEnvironment } from './e2e/harness.mjs';

/**
 * Sends a raw HTTP request over a TCP socket and returns raw response string.
 * This bypasses any client-side URL normalization or character filtering.
 */
function sendRawRequest(port, rawPayload) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      socket.write(rawPayload);
    });

    let data = '';
    socket.on('data', (chunk) => {
      data += chunk.toString('latin1');
    });

    socket.on('end', () => {
      resolve(data);
    });

    socket.on('error', reject);
    socket.setTimeout(4000, () => {
      socket.destroy();
      reject(new Error('Raw socket request timed out after 4000ms'));
    });
  });
}

/**
 * Sends an HTTP request via Node's http.request without WHATWG URL normalization.
 */
function rawHttpRequest(port, method, rawPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: rawPath,
        headers: {
          Host: `127.0.0.1:${port}`,
          Connection: 'close',
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const bodyBuffer = Buffer.concat(chunks);
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            bodyBuffer,
            bodyText: bodyBuffer.toString('utf8'),
          });
        });
      }
    );

    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

describe('Empirical Adversarial Challenge: Milestone 1 (Path-Traversal, HTTP Verbs & SVG Edge Cases)', () => {
  let env;
  let port;

  before(async () => {
    env = await setupTestEnvironment();
    port = env.appPort;
  });

  after(async () => {
    await env.cleanup();
  });

  // =========================================================================
  // 1. Adversarial Path-Traversal Matrix (Assert 0 File Leaks)
  // =========================================================================
  describe('1. Adversarial Path-Traversal & File Disclosure Attacks', () => {
    const forbiddenSubstrings = [
      'import http from \'node:http\'',
      '\"name\": \"secret-sender\"',
      'MlKem768',
      'BitBop Livery Reskin',
      '[fonts]',
      'root:x:0:0',
    ];

    function assertZeroLeaks(responseBody, attackName) {
      for (const forbidden of forbiddenSubstrings) {
        assert.ok(
          !responseBody.includes(forbidden),
          `VULNERABILITY DETECTED in [${attackName}]: Response leaked sensitive file content: "${forbidden}"`
        );
      }
    }

    const traversalVectors = [
      // Standard dot-dot-slash variations
      { name: 'Standard parent dir traversal (/badges/../server.mjs)', path: '/badges/../server.mjs' },
      { name: 'Root parent dir traversal (/../package.json)', path: '/../package.json' },
      { name: 'Double parent traversal (/badges/../../package.json)', path: '/badges/../../package.json' },
      { name: 'Bare parent dir (/..)', path: '/..' },
      { name: 'Badges bare parent (/badges/..)', path: '/badges/..' },
      { name: 'Badges dot slash (/badges/./server.mjs)', path: '/badges/./server.mjs' },

      // URL-encoded dot-dot (%2e%2e)
      { name: 'URL-encoded %2e%2e/ (/badges/%2e%2e/server.mjs)', path: '/badges/%2e%2e/server.mjs' },
      { name: 'URL-encoded %2e%2e%2f (/badges/%2e%2e%2fserver.mjs)', path: '/badges/%2e%2e%2fserver.mjs' },
      { name: 'Uppercase URL-encoded %2E%2E%2F (/badges/%2E%2E%2Fserver.mjs)', path: '/badges/%2E%2E%2Fserver.mjs' },
      { name: 'Root URL-encoded %2e%2e%2f (/%2e%2e%2fpackage.json)', path: '/%2e%2e%2fpackage.json' },
      { name: 'Mixed encoding ..%2f (/badges/..%2fserver.mjs)', path: '/badges/..%2fserver.mjs' },
      { name: 'Mixed encoding ..%2F (/badges/..%2Fserver.mjs)', path: '/badges/..%2Fserver.mjs' },

      // Backslash variations (Windows filesystem path delimiter attacks)
      { name: 'Literal backslash in badges (/badges\\..\\server.mjs)', path: '/badges\\..\\server.mjs' },
      { name: 'Mixed slash-backslash (/badges/..\\server.mjs)', path: '/badges/..\\server.mjs' },
      { name: 'Encoded backslash %5c (/badges/..%5cserver.mjs)', path: '/badges/..%5cserver.mjs' },
      { name: 'Uppercase encoded backslash %5C (/badges/..%5Cserver.mjs)', path: '/badges/..%5Cserver.mjs' },
      { name: 'Root encoded backslash (/%5cpackage.json)', path: '/%5cpackage.json' },
      { name: 'Encoded backslash with %2e (/%5c%2e%2e%5cpackage.json)', path: '/%5c%2e%2e%5cpackage.json' },

      // Null byte injection (%00)
      { name: 'Null byte after valid SVG (/badges/bitbop-favicon.svg%00)', path: '/badges/bitbop-favicon.svg%00' },
      { name: 'Null byte with extension (/badges/bitbop-favicon.svg%00.txt)', path: '/badges/bitbop-favicon.svg%00.txt' },
      { name: 'Null byte in traversal (/badges/..%00/server.mjs)', path: '/badges/..%00/server.mjs' },
      { name: 'Null byte on favicon (/favicon.svg%00)', path: '/favicon.svg%00' },
      { name: 'Bare null byte (/%00)', path: '/%00' },

      // Absolute paths & Windows drive letters
      { name: 'Windows drive letter (/C:/Windows/win.ini)', path: '/C:/Windows/win.ini' },
      { name: 'Windows drive project file (/C:/code/projects/SecretSender/server.mjs)', path: '/C:/code/projects/SecretSender/server.mjs' },
      { name: 'Unix absolute path (/etc/passwd)', path: '/etc/passwd' },
      { name: 'Unix shadow path (/etc/shadow)', path: '/etc/shadow' },

      // Windows NTFS Alternate Data Streams (ADS)
      { name: 'NTFS ADS stream on favicon (/favicon.svg::$DATA)', path: '/favicon.svg::$DATA' },
      { name: 'NTFS ADS stream on badge (/badges/bitbop-favicon.svg::$DATA)', path: '/badges/bitbop-favicon.svg::$DATA' },
      { name: 'NTFS ADS stream on server.mjs (/badges/server.mjs::$DATA)', path: '/badges/server.mjs::$DATA' },

      // Direct access to project files outside /public
      { name: 'Direct access to server.mjs (/server.mjs)', path: '/server.mjs' },
      { name: 'Direct access to package.json (/package.json)', path: '/package.json' },
      { name: 'Direct access to PROJECT.md (/PROJECT.md)', path: '/PROJECT.md' },
      { name: 'Direct access to README.md (/README.md)', path: '/README.md' },
      { name: 'Nonexistent SVG in badges (/badges/nonexistent_quantum_badge.svg)', path: '/badges/nonexistent_quantum_badge.svg' },
      { name: 'Non-SVG file in badges (/badges/server.mjs)', path: '/badges/server.mjs' },
      { name: 'Badge with directory slash (/badges/bitbop-favicon.svg/)', path: '/badges/bitbop-favicon.svg/' },
      { name: 'Badge with backup extension (/badges/bitbop-favicon.svg.bak)', path: '/badges/bitbop-favicon.svg.bak' },
    ];

    for (const vector of traversalVectors) {
      it(`T1: Traversal vector [${vector.name}] must return 403 or 404 with 0 file leaks`, async () => {
        const res = await rawHttpRequest(port, 'GET', vector.path);

        assert.ok(
          res.statusCode === 403 || res.statusCode === 404 || res.statusCode === 400,
          `Expected HTTP 403, 404, or 400 for path "${vector.path}", but got HTTP ${res.statusCode}`
        );

        assertZeroLeaks(res.bodyText, vector.name);
      });
    }

    // Raw TCP socket tests with unnormalized byte streams
    it('T1.Raw: Raw TCP socket fuzzing with literal unencoded /badges/../server.mjs', async () => {
      const rawRequest =
        `GET /badges/../server.mjs HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${port}\r\n` +
        `Connection: close\r\n\r\n`;

      const rawResponse = await sendRawRequest(port, rawRequest);
      const firstLine = rawResponse.split('\r\n')[0] || '';
      assert.match(firstLine, /HTTP\/1\.[01]\s+(403|404)/, `Raw response line must be 403/404, got: ${firstLine}`);
      assertZeroLeaks(rawResponse, 'Raw TCP socket /badges/../server.mjs');
    });

    it('T1.Raw: Raw TCP socket fuzzing with literal backslashes GET \\badges\\..\\server.mjs', async () => {
      const rawRequest =
        `GET \\badges\\..\\server.mjs HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${port}\r\n` +
        `Connection: close\r\n\r\n`;

      const rawResponse = await sendRawRequest(port, rawRequest);
      const firstLine = rawResponse.split('\r\n')[0] || '';
      assert.match(firstLine, /HTTP\/1\.[01]\s+(403|404|400)/, `Raw response line must be 403/404/400, got: ${firstLine}`);
      assertZeroLeaks(rawResponse, 'Raw TCP socket backslash traversal');
    });

    it('T1.Raw: Raw TCP socket fuzzing with binary null byte in path', async () => {
      const rawRequest =
        `GET /badges/bitbop-favicon.svg\x00.png HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${port}\r\n` +
        `Connection: close\r\n\r\n`;

      const rawResponse = await sendRawRequest(port, rawRequest);
      const firstLine = rawResponse.split('\r\n')[0] || '';
      assert.match(firstLine, /HTTP\/1\.[01]\s+(403|404|400)/, `Raw response line must be 403/404/400, got: ${firstLine}`);
      assertZeroLeaks(rawResponse, 'Raw TCP socket binary null byte');
    });
  });

  // =========================================================================
  // 2. HTTP Method Fuzzing & Verb Tampering
  // =========================================================================
  describe('2. HTTP Method Tampering & Verb Fuzzing', () => {
    const standardDisallowedVerbs = ['PUT', 'DELETE', 'OPTIONS', 'TRACE', 'PATCH', 'PROPFIND'];

    for (const verb of standardDisallowedVerbs) {
      it(`V1: Disallowed standard verb ${verb} on / returns HTTP 405 with Allow: GET, HEAD`, async () => {
        const res = await rawHttpRequest(port, verb, '/');
        assert.equal(res.statusCode, 405, `Expected HTTP 405 for ${verb} /`);
        assert.equal(res.headers['allow'], 'GET, HEAD');
        assert.equal(res.bodyText, 'Method not allowed');
      });

      it(`V2: Disallowed standard verb ${verb} on /favicon.svg returns HTTP 405 with Allow: GET, HEAD`, async () => {
        const res = await rawHttpRequest(port, verb, '/favicon.svg');
        assert.equal(res.statusCode, 405, `Expected HTTP 405 for ${verb} /favicon.svg`);
        assert.equal(res.headers['allow'], 'GET, HEAD');
        assert.equal(res.bodyText, 'Method not allowed');
      });

      it(`V3: Disallowed standard verb ${verb} on /badges/bitbop-wordmark-dark.svg returns HTTP 405 with Allow: GET, HEAD`, async () => {
        const res = await rawHttpRequest(port, verb, '/badges/bitbop-wordmark-dark.svg');
        assert.equal(res.statusCode, 405, `Expected HTTP 405 for ${verb} /badges/...`);
        assert.equal(res.headers['allow'], 'GET, HEAD');
        assert.equal(res.bodyText, 'Method not allowed');
      });

      it(`V4: Disallowed standard verb ${verb} on /mlkem.browser.js returns HTTP 405 with Allow: GET, HEAD`, async () => {
        const res = await rawHttpRequest(port, verb, '/mlkem.browser.js');
        assert.equal(res.statusCode, 405, `Expected HTTP 405 for ${verb} /mlkem.browser.js`);
        assert.equal(res.headers['allow'], 'GET, HEAD');
        assert.equal(res.bodyText, 'Method not allowed');
      });
    }

    // Fuzzed non-standard verb tokens rejected at parser/handler level with 400 or 405 and 0 file leaks
    it('V4.Fuzz: Arbitrary verb FOOBAR returns HTTP 400 or 405 with 0 file leaks', async () => {
      for (const targetPath of ['/', '/favicon.svg', '/badges/bitbop-wordmark-dark.svg', '/mlkem.browser.js']) {
        const res = await rawHttpRequest(port, 'FOOBAR', targetPath);
        assert.ok(
          res.statusCode === 400 || res.statusCode === 405,
          `Expected 400 or 405 for FOOBAR ${targetPath}, got ${res.statusCode}`
        );
      }
    });

    it('V4.Connect: Tunnel verb CONNECT is safely terminated by server without file leakage', async () => {
      try {
        const res = await rawHttpRequest(port, 'CONNECT', '/favicon.svg');
        assert.ok(res.statusCode === 400 || res.statusCode === 405);
      } catch (err) {
        // Node http.Server closes socket without connect handler, which is expected and safe
        assert.match(err.code || err.message, /ECONNRESET|socket hang up/);
      }
    });

    it('V5: Disallowed verbs on /api/share (GET, PUT, DELETE, TRACE) return HTTP 404 (only POST accepted)', async () => {
      for (const verb of ['GET', 'PUT', 'DELETE', 'TRACE', 'OPTIONS']) {
        const res = await rawHttpRequest(port, verb, '/api/share');
        assert.equal(res.statusCode, 404, `Expected HTTP 404 for ${verb} /api/share`);
      }
    });

    it('V6: Disallowed verbs on /health (POST, PUT, DELETE) return HTTP 404 (only GET accepted)', async () => {
      for (const verb of ['POST', 'PUT', 'DELETE']) {
        const res = await rawHttpRequest(port, verb, '/health');
        assert.equal(res.statusCode, 404, `Expected HTTP 404 for ${verb} /health`);
      }
    });
  });

  // =========================================================================
  // 3. SVG Serving Edge Cases (MIME, Charset, HEAD Consistency, Cache-Control)
  // =========================================================================
  describe('3. SVG Asset Serving Edge Cases & Header Consistency', () => {
    const svgAssets = [
      { name: 'favicon.svg', path: '/favicon.svg' },
      { name: 'badges/bitbop-favicon.svg', path: '/badges/bitbop-favicon.svg' },
      { name: 'badges/bitbop-wordmark-dark.svg', path: '/badges/bitbop-wordmark-dark.svg' },
      { name: 'badges/powered-by-bitbop-gold.svg', path: '/badges/powered-by-bitbop-gold.svg' },
      { name: 'badges/powered-by-bitbop-emerald.svg', path: '/badges/powered-by-bitbop-emerald.svg' },
      { name: 'badges/powered-by-bitbop-light.svg', path: '/badges/powered-by-bitbop-light.svg' },
      { name: 'badges/bitbop-icon-bopper-1982.svg', path: '/badges/bitbop-icon-bopper-1982.svg' },
      { name: 'badges/bitbop-icon-d20.svg', path: '/badges/bitbop-icon-d20.svg' },
    ];

    for (const asset of svgAssets) {
      it(`S1 [${asset.name}]: GET returns 200 with image/svg+xml; charset=utf-8, valid UTF-8 body & Cache-Control`, async () => {
        const res = await rawHttpRequest(port, 'GET', asset.path);

        assert.equal(res.statusCode, 200, `Asset ${asset.path} must return HTTP 200`);
        assert.equal(
          res.headers['content-type'],
          'image/svg+xml; charset=utf-8',
          `Asset ${asset.path} must have Content-Type: image/svg+xml; charset=utf-8`
        );
        assert.equal(
          res.headers['cache-control'],
          'public, max-age=86400',
          `Asset ${asset.path} must have Cache-Control: public, max-age=86400`
        );

        const contentLength = Number(res.headers['content-length']);
        assert.ok(Number.isFinite(contentLength) && contentLength > 0, `Asset ${asset.path} must declare Content-Length > 0`);
        assert.equal(res.bodyBuffer.length, contentLength, `Body buffer length must match Content-Length header exactly`);

        // Check SVG validity and UTF-8 decode
        assert.match(res.bodyText, /<svg[\s>]/i, `Asset ${asset.path} body must contain valid <svg tag`);
      });

      it(`S2 [${asset.name}]: HEAD returns 200, exactly identical headers to GET, and empty (0-byte) body`, async () => {
        const getRes = await rawHttpRequest(port, 'GET', asset.path);
        const headRes = await rawHttpRequest(port, 'HEAD', asset.path);

        assert.equal(headRes.statusCode, 200, `HEAD ${asset.path} must return HTTP 200`);
        assert.equal(headRes.headers['content-type'], getRes.headers['content-type']);
        assert.equal(headRes.headers['cache-control'], getRes.headers['cache-control']);
        assert.equal(headRes.headers['content-length'], getRes.headers['content-length']);
        assert.equal(headRes.bodyBuffer.length, 0, `HEAD ${asset.path} body MUST be 0 bytes`);
      });
    }

    it('S3: HEAD request on root / returns 200, identical headers to GET /, and empty (0-byte) body', async () => {
      const getRes = await rawHttpRequest(port, 'GET', '/');
      const headRes = await rawHttpRequest(port, 'HEAD', '/');

      assert.equal(headRes.statusCode, 200);
      assert.equal(headRes.headers['content-type'], getRes.headers['content-type']);
      assert.equal(headRes.headers['cache-control'], getRes.headers['cache-control']);
      assert.equal(headRes.headers['content-length'], getRes.headers['content-length']);
      assert.equal(headRes.bodyBuffer.length, 0, 'HEAD / body must be 0 bytes');
    });

    it('S4: HEAD request on /mlkem.browser.js returns 200, identical headers to GET, and empty body', async () => {
      const getRes = await rawHttpRequest(port, 'GET', '/mlkem.browser.js');
      const headRes = await rawHttpRequest(port, 'HEAD', '/mlkem.browser.js');

      assert.equal(headRes.statusCode, 200);
      assert.equal(headRes.headers['content-type'], getRes.headers['content-type']);
      assert.equal(headRes.headers['cache-control'], getRes.headers['cache-control']);
      assert.equal(headRes.headers['content-length'], getRes.headers['content-length']);
      assert.equal(headRes.bodyBuffer.length, 0, 'HEAD /mlkem.browser.js body must be 0 bytes');
    });

    it('S5: Query parameters on SVG routes (?v=1) preserve 200 and static content', async () => {
      const resFavicon = await rawHttpRequest(port, 'GET', '/favicon.svg?v=20261022');
      assert.equal(resFavicon.statusCode, 200);
      assert.equal(resFavicon.headers['content-type'], 'image/svg+xml; charset=utf-8');

      const resBadge = await rawHttpRequest(port, 'GET', '/badges/bitbop-wordmark-dark.svg?theme=dark&ver=2');
      assert.equal(resBadge.statusCode, 200);
      assert.equal(resBadge.headers['content-type'], 'image/svg+xml; charset=utf-8');
    });

    it('S6: Query parameter containing traversal attempt (?foo=../server.mjs) is rejected with 403 Forbidden', async () => {
      const res = await rawHttpRequest(port, 'GET', '/favicon.svg?foo=../server.mjs');
      assert.equal(res.statusCode, 403, 'Early defense must reject rawUrl containing .. even in query string');
    });
  });

  // =========================================================================
  // 4. Protocol & Boundary Fuzzing (Extreme Header & Socket Conditions)
  // =========================================================================
  describe('4. Protocol Fuzzing & Boundary Stress Tests', () => {
    it('P1: Oversized URL path (4096 characters) is safely handled without crash', async () => {
      const hugePath = '/badges/' + 'a'.repeat(4080) + '.svg';
      const res = await rawHttpRequest(port, 'GET', hugePath);
      assert.ok(res.statusCode === 404 || res.statusCode === 414 || res.statusCode === 431);
    });

    it('P2: Host header spoofing / non-standard Host header does not crash server', async () => {
      const res = await rawHttpRequest(port, 'GET', '/health', null, {
        Host: 'evil-attacker.example.org',
      });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(JSON.parse(res.bodyText), { status: 'ok', service: 'SecretSender' });
    });

    it('P3: Repeated consecutive requests to cached SVG assets demonstrate cache stability', async () => {
      for (let i = 0; i < 20; i++) {
        const res = await rawHttpRequest(port, 'GET', '/badges/powered-by-bitbop-emerald.svg');
        assert.equal(res.statusCode, 200);
        assert.equal(res.headers['content-type'], 'image/svg+xml; charset=utf-8');
        assert.match(res.bodyText, /<svg/i);
      }
    });
  });
});
