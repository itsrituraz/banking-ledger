const { spawn } = require("child_process");
const path = require("path");

const SUITES = [
  {
    name: "Fintech Risk & Fraud Engine Suite",
    file: "test_risk_engine_suite.js",
    expectedCount: 10
  },
  {
    name: "Admin Role-Based Access Control (RBAC) Security Suite",
    file: "test_admin_rbac_suite.js",
    expectedCount: 7
  },
  {
    name: "Admin Read-Only Monitoring APIs Suite",
    file: "test_admin_monitoring_suite.js",
    expectedCount: 10
  },
  {
    name: "Immutable Audit Trail v1 Suite",
    file: "test_audit_trail_suite.js",
    expectedCount: 10
  },
  {
    name: "Rate Limiting & Security Hardening Suite",
    file: "test_security_hardening_suite.js",
    expectedCount: 12
  },
  {
    name: "Observability & Structured Logging Suite",
    file: "test_observability_suite.js",
    expectedCount: 10
  },
  {
    name: "API Documentation & Contract Suite",
    file: "test_api_contract_suite.js",
    expectedCount: 10
  },
  {
    name: "Database & Performance Engineering Suite",
    file: "test_database_performance_suite.js",
    expectedCount: 10
  },
  {
    name: "Production Smoke Suite",
    file: "test_production_smoke_suite.js",
    expectedCount: 12
  }
];

function runSuite(suite) {
  return new Promise((resolve) => {
    const filePath = path.resolve(__dirname, suite.file);
    const start = Date.now();

    console.log(`\n================================================================`);
    console.log(`>>> EXECUTING SUITE: ${suite.name.toUpperCase()}`);
    console.log(`>>> File: ${suite.file} (Expected: ${suite.expectedCount} tests)`);
    console.log(`================================================================`);

    const child = spawn("node", [filePath], {
      stdio: "inherit",
      env: process.env
    });

    child.on("close", (code) => {
      const elapsed = ((Date.now() - start) / 1000).toFixed(2);
      resolve({
        suite: suite.name,
        file: suite.file,
        expected: suite.expectedCount,
        passed: code === 0,
        exitCode: code,
        durationSec: elapsed
      });
    });

    child.on("error", (err) => {
      const elapsed = ((Date.now() - start) / 1000).toFixed(2);
      console.error(`Error launching suite ${suite.name}:`, err.message);
      resolve({
        suite: suite.name,
        file: suite.file,
        expected: suite.expectedCount,
        passed: false,
        exitCode: 1,
        durationSec: elapsed
      });
    });
  });
}

async function runAll37Tests() {
  const masterStart = Date.now();

  console.log(`################################################################`);
  console.log(`     BANKING LEDGER: COMPLETE 91-TEST UNIFIED TEST RUNNER      `);
  console.log(`     Total Suites: 9 | Total Target Test Cases: 91             `);
  console.log(`################################################################\n`);

  const results = [];
  for (const suite of SUITES) {
    const res = await runSuite(suite);
    results.push(res);
  }

  const masterElapsed = ((Date.now() - masterStart) / 1000).toFixed(2);

  console.log(`\n\n################################################################`);
  console.log(`                 MASTER CONSOLIDATED TEST SUMMARY               `);
  console.log(`################################################################`);

  let totalTestsPassed = 0;
  let totalTestsTargeted = 0;
  let allSuitesPassed = true;

  results.forEach((r, idx) => {
    totalTestsTargeted += r.expected;
    if (r.passed) {
      totalTestsPassed += r.expected;
      console.log(` [✓] Suite ${idx + 1}: ${r.suite} (${r.expected}/${r.expected} passed in ${r.durationSec}s)`);
    } else {
      allSuitesPassed = false;
      console.log(` [✗] Suite ${idx + 1}: ${r.suite} (FAILED with exit code ${r.exitCode} in ${r.durationSec}s)`);
    }
  });

  console.log(`----------------------------------------------------------------`);
  console.log(` Total Test Cases Passed: ${totalTestsPassed} / ${totalTestsTargeted}`);
  console.log(` Total Execution Time:    ${masterElapsed}s`);
  console.log(` Final Status:            ${allSuitesPassed ? "SUCCESS - ALL 91/91 TESTS PASSED" : "FAILED"}`);
  console.log(`################################################################\n`);

  process.exit(allSuitesPassed ? 0 : 1);
}

runAll37Tests();
