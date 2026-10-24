import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseClientConfigJson } from "../shared/client-config";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "../..");
const repoRoot = path.resolve(appRoot, "../..");

test("electron-builder ships 小旭连接 as a Windows installer and a portable exe", () => {
  const yml = fs.readFileSync(path.join(appRoot, "electron-builder.yml"), "utf8");
  const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8")) as {
    version: string;
    scripts: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  assert.match(yml, /productName: 小旭连接/);
  assert.match(yml, /appId: app\.xiaoxu\.connect/);
  assert.match(yml, /executableName: XiaoxuConnect/);
  assert.match(yml, /target: nsis/);
  assert.match(yml, /target: portable/);
  assert.match(yml, /xiaoxu\.config\.example\.json/);
  assert.match(yml, /\*\*\/\*\.node/);
  assert.match(yml, /forceCodeSigning: false/);
  assert.match(yml, /electronVersion: 45\.0\.0/);
  assert.equal(pkg.version, "0.1.0");
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies["@screen-sharing/protocol"], "0.0.1");
  assert.match(yml, /!node_modules/);
  assert.match(pkg.scripts["dist:win"] ?? "", /nsis/);
  assert.match(pkg.scripts["dist:win"] ?? "", /portable/);
  assert.match(pkg.scripts["dist:mac"] ?? "", /--mac zip/);
});

test("the shipped config example has the network keys and no credentials", () => {
  const text = fs.readFileSync(path.join(appRoot, "config", "xiaoxu.config.example.json"), "utf8");
  const parsed = parseClientConfigJson(text);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.value, {});
  const raw = JSON.parse(text) as Record<string, string>;
  for (const key of ["SIGNALING_URL", "STUN_URLS", "TURN_URLS", "TURN_USERNAME", "TURN_CREDENTIAL", "ICE_TRANSPORT_POLICY"]) {
    assert.equal(raw[key], "");
  }
  assert.equal(text.includes("replace-with"), false);
});

test("GitHub Actions builds the Windows packages and attaches them to a release", () => {
  const ci = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
  const release = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "release.yml"), "utf8");
  assert.match(ci, /npm test/);
  assert.match(ci, /npm run typecheck/);
  assert.match(ci, /windows-2022/);
  assert.match(ci, /npm run dist:win/);
  assert.match(release, /windows-2022/);
  assert.match(release, /macos-latest/);
  assert.match(release, /npm run dist:win/);
  assert.match(release, /npm run dist:mac/);
  assert.match(release, /contents: write/);
  assert.match(release, /docs\/download\.md/);
  assert.match(release, /CSC_IDENTITY_AUTO_DISCOVERY: "false"/);
});
