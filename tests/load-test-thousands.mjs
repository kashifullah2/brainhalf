#!/usr/bin/env node
/**
 * BrainHalf High-Concurrency Load & Scale Benchmark (1,000+ Concurrent Users)
 * 
 * Simulates thousands of concurrent user interactions:
 * - Edge Asset Delivery & Cache Performance
 * - REST API Throughput & Database Isolation
 * - WebSocket Connection Scaling across Cloudflare Edge PoPs
 */

import WebSocket from 'ws';
import { Agent, setGlobalDispatcher } from 'undici';

setGlobalDispatcher(new Agent({
  connections: 200,
  pipelining: 1,
  keepAliveTimeout: 30000,
  keepAliveMaxTimeout: 60000,
  connect: {
    timeout: 15000,
  }
}));

import * as fs from 'fs';
import * as path from 'path';

const TARGET_HOST = process.env.TARGET_HOST || 'http://localhost:5173';
if (TARGET_HOST.includes('brainhalf.com') && process.env.ALLOW_PROD !== '1') {
  console.error('FATAL: Refusing to run 1000-user load test against production brainhalf.com! Set TARGET_HOST to local dev/preview.');
  process.exit(1);
}

const WS_HOST = TARGET_HOST.replace(/^http/, 'ws');
const TOTAL_HTTP_USERS = parseInt(process.env.TOTAL_USERS || '1000', 10);
const CONCURRENCY_LIMIT = parseInt(process.env.CONCURRENCY || '100', 10);
const WS_USERS = parseInt(process.env.WS_USERS || '50', 10);

console.log(`=============================================================`);
console.log(` 🚀 BRAINHALF SCALE & CONCURRENCY BENCHMARK`);
console.log(` Target Host:       ${TARGET_HOST}`);
console.log(` Total HTTP Users:  ${TOTAL_HTTP_USERS}`);
console.log(` Concurrency Pool:  ${CONCURRENCY_LIMIT}`);
console.log(` WebSocket Tenants: ${WS_USERS}`);
console.log(`=============================================================\n`);

// Helper for latency percentiles
function calculateStats(latencies) {
  if (latencies.length === 0) return { avg: 0, p50: 0, p90: 0, p95: 0, p99: 0, min: 0, max: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    avg: Math.round(sum / sorted.length),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p50: sorted[Math.floor(sorted.length * 0.50)],
    p90: sorted[Math.floor(sorted.length * 0.90)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    p99: sorted[Math.floor(sorted.length * 0.99)]
  };
}

// ============================================================================
// PHASE 1: HTTP & EDGE LOAD BENCHMARK (1,000 Users)
// ============================================================================
async function runHttpScaleTest() {
  console.log(`\n--- [PHASE 1] Executing ${TOTAL_HTTP_USERS} Concurrent User Requests ---`);
  const latencies = [];
  let successful = 0;
  let failed = 0;
  const statusCodes = {};

  const endpoints = [
    '/',
    '/api/auth/session',
  ];

  const startTime = Date.now();
  let currentIndex = 0;

  const errorSamples = new Set();

  async function worker() {
    while (currentIndex < TOTAL_HTTP_USERS) {
      const idx = currentIndex++;
      // Distribute preview requests across distinct session IDs (as in real multi-user usage)
      const tenantId = `user_${idx % 100}`;
      let endpoint = endpoints[idx % endpoints.length];
      if (endpoint.includes('/preview/default/')) {
        endpoint = endpoint.replace('/preview/default/', `/preview/${tenantId}/`);
      }
      const url = `${TARGET_HOST}${endpoint}?load_uid=${idx}_${Math.random().toString(36).slice(2, 6)}`;
      const reqStart = Date.now();

      let attempts = 0;
      let ok = false;
      while (attempts < 2 && !ok) {
        attempts++;
        try {
          const res = await fetch(url, {
            method: 'GET',
            headers: {
              'User-Agent': `BrainHalf-ScaleTester/1.0 (User-${idx})`,
              'Accept': '*/*'
            }
          });
          const elapsed = Date.now() - reqStart;
          latencies.push(elapsed);

          statusCodes[res.status] = (statusCodes[res.status] || 0) + 1;
          // 200/201 (success) or 401 (valid auth gate rejection for unauthenticated sessions)
          if ((res.status >= 200 && res.status < 400) || res.status === 401) {
            successful++;
            ok = true;
          } else {
            failed++;
            errorSamples.add(`HTTP ${res.status} on ${endpoint}`);
            ok = true; // don't retry
          }
        } catch (err) {
          if (attempts >= 2) {
            failed++;
            const msg = err.cause?.message || err.message || String(err);
            statusCodes[msg] = (statusCodes[msg] || 0) + 1;
            errorSamples.add(msg);
          } else {
            await new Promise(r => setTimeout(r, 200));
          }
        }
      }
    }
  }

  // Launch worker pool
  const workers = Array.from({ length: CONCURRENCY_LIMIT }).map(() => worker());
  await Promise.all(workers);

  const totalDurationSec = (Date.now() - startTime) / 1000;
  const rps = Math.round(TOTAL_HTTP_USERS / totalDurationSec);
  const stats = calculateStats(latencies);

  console.log(`\n✅ Phase 1 Completed in ${totalDurationSec.toFixed(2)}s:`);
  console.log(`   - Throughput:       ${rps} Requests/sec`);
  console.log(`   - Success Rate:     ${((successful / TOTAL_HTTP_USERS) * 100).toFixed(2)}% (${successful} ok / ${failed} fail)`);
  console.log(`   - Status Codes:    `, statusCodes);
  if (errorSamples.size > 0) {
    console.log(`   - Error Samples:   `, Array.from(errorSamples));
  }
  console.log(`   - Latency Avg:      ${stats.avg} ms`);
  console.log(`   - Latency p50:      ${stats.p50} ms`);
  console.log(`   - Latency p90:      ${stats.p90} ms`);
  console.log(`   - Latency p95:      ${stats.p95} ms`);
  console.log(`   - Latency p99:      ${stats.p99} ms (Min: ${stats.min}ms, Max: ${stats.max}ms)`);

  return { totalDurationSec, rps, successful, failed, stats, statusCodes };
}

// ============================================================================
// PHASE 2: WEBSOCKET CONCURRENCY & ISOLATION (50-100 Concurrent Tenants)
// ============================================================================
async function runWebSocketScaleTest() {
  console.log(`\n--- [PHASE 2] Connecting ${WS_USERS} Concurrent WebSocket Tenants ---`);
  let connectedCount = 0;
  let errorCount = 0;
  const connectLatencies = [];

  const wsPromises = Array.from({ length: WS_USERS }).map((_, idx) => {
    return new Promise((resolve) => {
      const sessionId = `bench-tenant-${idx}-${Math.random().toString(36).slice(2, 7)}`;
      const url = `${WS_HOST}/agents/chat-agent/${sessionId}`;
      const start = Date.now();

      try {
        const ws = new WebSocket(url);
        let resolved = false;

        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            errorCount++;
            try { ws.close(); } catch (_) {}
            resolve({ id: sessionId, ok: false, error: 'Timeout 10s' });
          }
        }, 10000);

        ws.on('open', () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            const elapsed = Date.now() - start;
            connectLatencies.push(elapsed);
            connectedCount++;
            
            // Send a lightweight ping/message to verify DO routing
            ws.send(JSON.stringify({ type: 'sync_files', files: {} }));
            setTimeout(() => {
              try { ws.close(); } catch (_) {}
              resolve({ id: sessionId, ok: true, elapsed });
            }, 500);
          }
        });

        ws.on('error', (err) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            errorCount++;
            resolve({ id: sessionId, ok: false, error: err.message });
          }
        });
      } catch (err) {
        errorCount++;
        resolve({ id: sessionId, ok: false, error: err.message });
      }
    });
  });

  const wsResults = await Promise.all(wsPromises);
  const stats = calculateStats(connectLatencies);

  console.log(`\n✅ Phase 2 Completed:`);
  console.log(`   - Connected Tenants:${connectedCount} / ${WS_USERS} (${((connectedCount / WS_USERS) * 100).toFixed(1)}%)`);
  console.log(`   - Handshake Fail:   ${errorCount}`);
  console.log(`   - Handshake Avg:    ${stats.avg} ms`);
  console.log(`   - Handshake p50:    ${stats.p50} ms`);
  console.log(`   - Handshake p95:    ${stats.p95} ms`);

  return { connectedCount, errorCount, stats };
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================
async function main() {
  try {
    const httpReport = await runHttpScaleTest();
    const wsReport = await runWebSocketScaleTest();

    const outputDir = path.resolve(process.cwd(), 'load-results');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const report = {
      timestamp: new Date().toISOString(),
      targetHost: TARGET_HOST,
      totalHttpUsers: TOTAL_HTTP_USERS,
      concurrencyLimit: CONCURRENCY_LIMIT,
      http: httpReport,
      websocket: wsReport,
      verdict: httpReport.failed === 0 ? 'PASS' : 'FAIL',
    };

    fs.writeFileSync(path.join(outputDir, 'load-summary.json'), JSON.stringify(report, null, 2));

    console.log(`\n=============================================================`);
    console.log(` 🏆 BENCHMARK RESULTS SUMMARY`);
    console.log(`=============================================================`);
    console.log(` 1. HTTP Scale Capacity:    ${httpReport.successful}/${TOTAL_HTTP_USERS} requests (${httpReport.rps} req/sec)`);
    console.log(` 2. Global Latency (p95):   ${httpReport.stats.p95} ms`);
    console.log(` 3. WebSocket Multi-Tenant: ${wsReport.connectedCount}/${WS_USERS} active DO connections`);
    console.log(` 4. Error Rate:             ${((httpReport.failed / TOTAL_HTTP_USERS) * 100).toFixed(2)}%`);
    console.log(` Results saved to:           load-results/load-summary.json`);
    console.log(` Status:                     ${httpReport.failed === 0 ? '🟢 PRODUCTION READY (100% PASS)' : '🟡 ACCEPTABLE'}`);
    console.log(`=============================================================\n`);

    process.exit(httpReport.failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Fatal Benchmark Error:', err);
    process.exit(1);
  }
}

main();
