/* eslint-env node */
// A small closed-model load runner (virtual users with think time, like k6's
// ramping-vus executor) with no dependencies beyond Node 20's fetch.
//
//   const summary = await runLoad({
//     name: 'baseline',
//     stages: [{ duration: 15, target: 5 }, { duration: 30, target: 5 }], // seconds, VUs
//     thinkMs: [500, 1500],          // pause between one VU's requests (random in range)
//     timeoutMs: 10000,
//     baseUrls: ['http://127.0.0.1:8500', ...], // round robin (one per PHP worker)
//     scenarios: [{ name, weight, request: (ctx) => ({ path, method, headers, body }), check: (res, text) => true | 'reason' }],
//   });
//
// Each VU picks a scenario by weight, sends it, records the latency and the
// check result, then sleeps. Latencies are kept in full (runs here are short),
// so percentiles are exact, not estimated.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => min + Math.random() * (max - min);

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarize(samples, wallSeconds) {
  const lat = samples.map((s) => s.ms).sort((a, b) => a - b);
  const failed = samples.filter((s) => !s.ok);
  const reasons = {};
  for (const s of failed) reasons[s.reason] = (reasons[s.reason] || 0) + 1;
  const statuses = {};
  for (const s of samples) statuses[s.status] = (statuses[s.status] || 0) + 1;
  const round = (v) => (v == null ? null : Math.round(v * 10) / 10);
  return {
    requests: samples.length,
    rps: round(samples.length / wallSeconds),
    avgMs: round(lat.reduce((a, b) => a + b, 0) / (lat.length || 1)),
    minMs: round(lat[0]),
    p50Ms: round(percentile(lat, 50)),
    p90Ms: round(percentile(lat, 90)),
    p95Ms: round(percentile(lat, 95)),
    p99Ms: round(percentile(lat, 99)),
    maxMs: round(lat[lat.length - 1]),
    failed: failed.length,
    failRate: samples.length ? Math.round((failed.length / samples.length) * 10000) / 100 : 0, // %
    timeouts: samples.filter((s) => s.reason === 'timeout').length,
    rateLimited: samples.filter((s) => s.status === 429).length,
    statuses,
    failReasons: reasons,
  };
}

/** VU count wanted at `t` seconds into a stage list (linear ramps, like k6). */
function targetAt(stages, t) {
  let start = 0;
  let from = 0;
  for (const st of stages) {
    if (t < start + st.duration) return Math.round(from + ((st.target - from) * (t - start)) / st.duration);
    start += st.duration;
    from = st.target;
  }
  return -1; // finished
}

export async function runLoad({ name, stages, thinkMs = [500, 1500], timeoutMs = 10000, baseUrls, scenarios, onProgress }) {
  const totalWeight = scenarios.reduce((a, s) => a + (s.weight || 1), 0);
  const pick = () => {
    let r = Math.random() * totalWeight;
    for (const s of scenarios) { r -= s.weight || 1; if (r <= 0) return s; }
    return scenarios[scenarios.length - 1];
  };
  const samples = [];
  let rr = 0;
  let wanted = 0;
  let maxVus = 0;
  let running = 0;
  let stopped = false;
  let lastReport = -1;
  const started = Date.now();

  async function once(vuId, iter) {
    const sc = pick();
    const req = sc.request({ vu: vuId, iter });
    const base = baseUrls[rr++ % baseUrls.length];
    const t0 = performance.now();
    let status = 0;
    let ok = false;
    let reason = '';
    try {
      const res = await fetch(base + req.path, {
        method: req.method || 'GET',
        headers: req.headers,
        body: req.body == null ? undefined : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)),
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = res.status;
      const text = await res.text();
      const verdict = sc.check ? sc.check(res, text, req) : res.ok;
      ok = verdict === true;
      if (!ok) reason = typeof verdict === 'string' ? verdict : `http_${status}`;
    } catch (e) {
      reason = e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : `network:${e?.cause?.code || e?.message || 'error'}`;
    }
    samples.push({ scenario: sc.name, ms: performance.now() - t0, status, ok, reason, at: Date.now() - started });
  }

  async function vu(id) {
    running++;
    let iter = 0;
    try {
      while (!stopped && id < wanted) {
        await once(id, iter++);
        if (stopped || id >= wanted) break;
        await sleep(rand(thinkMs[0], thinkMs[1]));
      }
    } finally { running--; }
  }

  const vus = new Map();
  const tick = setInterval(() => {
    const t = (Date.now() - started) / 1000;
    const target = targetAt(stages, t);
    if (target < 0) { stopped = true; return; }
    wanted = target;
    maxVus = Math.max(maxVus, target);
    for (let id = 0; id < target; id++) {
      if (!vus.has(id)) vus.set(id, vu(id).finally(() => vus.delete(id)));
    }
    const sec = Math.floor(t);
    if (onProgress && sec % 10 === 0 && sec !== lastReport) { lastReport = sec; onProgress({ t: sec, vus: running, requests: samples.length }); }
  }, 200);

  while (!stopped) await sleep(200);
  clearInterval(tick);
  await Promise.all([...vus.values()]); // let in-flight requests finish (they count)
  const wallSeconds = (Date.now() - started) / 1000;

  const byScenario = {};
  for (const sc of scenarios) byScenario[sc.name] = summarize(samples.filter((s) => s.scenario === sc.name), wallSeconds);
  return {
    name,
    startedAt: new Date(started).toISOString(),
    durationSeconds: Math.round(wallSeconds * 10) / 10,
    maxVus,
    stages,
    thinkMs,
    timeoutMs,
    workers: baseUrls.length,
    overall: summarize(samples, wallSeconds),
    byScenario,
  };
}

/** Fires `n` requests at the same moment (no think time): for race / duplicate-action checks. */
export async function burst(n, fn) {
  let release;
  const gate = new Promise((r) => { release = r; });
  const all = Array.from({ length: n }, (_, i) => gate.then(() => fn(i)));
  release();
  return Promise.allSettled(all);
}
