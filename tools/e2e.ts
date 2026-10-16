/**
 * Orkestrator E2E Apoteku: menjalankan lapisan API lalu lapisan browser,
 * merangkum hasil, dan menulis berkas bukti ke docs/e2e-result.json.
 *
 *   bun run tools/e2e.ts
 */
import { runApiE2E } from "./e2e-api";
import { runBrowserE2E } from "./e2e-browser";

const startedAt = Date.now();

const api = await runApiE2E();
api.print();

const browser = await runBrowserE2E();
browser.print();

const total = api.checks.length + browser.checks.length;
const failed = api.failed.length + browser.failed.length;
const passed = total - failed;
const durationMs = Date.now() - startedAt;

console.log("=".repeat(96));
console.log(`RINGKASAN E2E · total ${total} · lolos ${passed} · gagal ${failed} · ${(durationMs / 1000).toFixed(1)}s`);
console.log("=".repeat(96));
if (failed) {
  console.log("\nPemeriksaan yang gagal:");
  for (const f of [...api.failed, ...browser.failed]) {
    console.log(`  ${f.code}  ${f.name}\n      └─ ${f.detail}`);
  }
}
console.log("");

await Bun.write(
  `${import.meta.dir}/../docs/e2e-result.json`,
  JSON.stringify(
    {
      at: new Date().toISOString(),
      durationMs,
      totals: { total, passed, failed },
      suites: [api.toResult(), browser.toResult()],
    },
    null,
    2,
  ),
);

process.exit(failed ? 1 : 0);
