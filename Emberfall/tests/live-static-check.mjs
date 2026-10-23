// Read-only integration check: only GET requests for already-public static assets.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Cloudflare injects precisely this challenge code into HTML at the edge. Match
// its entire fixed body, allowing ONLY the request-id and timestamp to differ.
const cloudflareTemplate = String.raw`<script>(function(){function c(){var b=a.contentDocument||(a.contentWindow&&a.contentWindow.document);if(b){var d=b.createElement('script');d.innerHTML="window.__CF$cv$params={r:'__R__',t:'__T__'};var a=document.createElement('script');a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';document.getElementsByTagName('head')[0].appendChild(a);";b.getElementsByTagName('head')[0].appendChild(d)}}if(document.body){var a=document.createElement('iframe');a.height=1;a.width=1;a.style.position='absolute';a.style.top=0;a.style.left=0;a.style.border='none';a.style.visibility='hidden';document.body.appendChild(a);if('loading'!==document.readyState)c();else if(window.addEventListener)document.addEventListener('DOMContentLoaded',c);else{var e=document.onreadystatechange||function(){};document.onreadystatechange=function(b){e(b);'loading'!==document.readyState&&(document.onreadystatechange=e,c())}}}})();</script>`;

function verifyApplicationBytes(actual, expected, route) {
  if (actual.equals(expected)) return { exactSourceMatch: true, applicationSourceMatch: true };
  const text = actual.toString('utf8'), source = expected.toString('utf8');
  const beforeBody = source.lastIndexOf('</body>'), actualBody = text.lastIndexOf('</body>');
  assert.ok(beforeBody >= 0 && actualBody >= beforeBody, route + ': unexpected bytes in a non-HTML asset');
  assert.equal(text.slice(0, beforeBody), source.slice(0, beforeBody), route + ': application HTML prefix differs');
  assert.equal(text.slice(actualBody), source.slice(beforeBody), route + ': application HTML suffix differs');
  const edgeCode = text.slice(beforeBody, actualBody);
  const normalized = edgeCode.replace(/r:'[a-f0-9]{16}',t:'[A-Za-z0-9+/=]+'/g, "r:'__R__',t:'__T__'");
  assert.equal(normalized, cloudflareTemplate, route + ': unexpected injected content');
  return { exactSourceMatch: false, applicationSourceMatch: true, edgeInjection: 'Exact recognized Cloudflare browser challenge; only request id and timestamp vary', edgeInjectionBytes: Buffer.byteLength(edgeCode) };
}

async function main() {
  const args = process.argv.slice(2).filter(value => value !== '--live-static');
  const base = new URL(args[0] || 'https://emberfall-battle-for-origin.quietchub17.chatgpt.site');
  assert.equal(base.protocol, 'https:');
  const output = resolve(args[1] || '../../outputs/Emberfall/online-verification.json');
  const summary = {
    publicUrl: base.origin, checkedAt: new Date().toISOString(),
    transport: 'actual unauthenticated HTTPS GET to public deployment',
    passed: false, remoteMatch: 'not_executed_approval_required',
    remoteMatchReason: 'Automatic approval review requires separate human approval to create a disposable online test room. No create/join/start/action request was sent.',
    staticChecks: [], cleanup: []
  };
  try {
    const assets = [
      ['/', '../public/index.html', 'text/html'],
      ['/styles.css', '../public/styles.css', 'text/css'],
      ['/game-core.js', '../public/game-core.js', 'text/javascript'],
      ['/renderer.js', '../public/renderer.js', 'text/javascript'],
      ['/app.js', '../public/app.js', 'text/javascript'],
      ['/Emberfall.html', '../Emberfall.html', 'text/html']
    ];
    for (const [route, file, type] of assets) {
      const response = await fetch(new URL(route, base), { signal: AbortSignal.timeout(15000), cache: 'no-store', redirect: 'error' });
      assert.equal(response.status, 200, route + ' must be publicly accessible');
      assert.ok(response.headers.get('content-type')?.startsWith(type), route + ' content type');
      const actual = Buffer.from(await response.arrayBuffer()), expected = await readFile(new URL(file, import.meta.url));
      const hash = bytes => createHash('sha256').update(bytes).digest('hex');
      const match = verifyApplicationBytes(actual, expected, route);
      if (route === '/Emberfall.html') {
        assert.equal(response.headers.get('content-disposition'), 'attachment; filename="Emberfall.html"');
        assert.ok(!/<script\b[^>]*\bsrc\s*=/i.test(actual.toString()));
        assert.ok(!/<link\b[^>]*rel=["']stylesheet["']/i.test(actual.toString()));
      }
      summary.staticChecks.push({ route, status: response.status, bytes: actual.length, sha256: hash(actual), sourceSha256: hash(expected), ...match });
      console.log('PASS public static GET ' + route);
    }
    summary.publicStaticPassed = true;
  } catch (error) {
    summary.error = error.message;
    summary.publicStaticPassed = false;
    process.exitCode = 1;
    console.error('FAIL ' + error.message);
  }
  summary.completedAt = new Date().toISOString();
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify({ publicStaticPassed: summary.publicStaticPassed, staticChecks: summary.staticChecks.length, remoteMatch: summary.remoteMatch, output }));
}

if (process.argv.includes('--live-static')) await main();
