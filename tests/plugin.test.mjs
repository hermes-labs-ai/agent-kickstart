import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = path.join(ROOT, "plugin.json");

const SCHEMA_URL = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const REQUIRED_KEYS = ["$schema", "name", "description", "version", "author", "homepage", "repository", "license", "keywords"];
const ALLOWED_KEYS = new Set(REQUIRED_KEYS);
const ALLOWED_AUTHOR_KEYS = new Set(["name", "url"]);

function loadJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8"));
}

test("repository root exposes plugin.json (Agent Plugins v1 canonical location)", () => {
  assert.ok(fs.existsSync(MANIFEST_PATH), "plugin.json must exist at the repository root");
});

test("root plugin.json is valid JSON matching the Agent Plugins v1 shape", () => {
  const raw = fs.readFileSync(MANIFEST_PATH, "utf8");
  let manifest;
  assert.doesNotThrow(() => {
    manifest = JSON.parse(raw);
  }, "plugin.json must contain valid JSON");

  for (const key of REQUIRED_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(manifest, key), `plugin.json is missing required key "${key}"`);
  }

  assert.equal(manifest.$schema, SCHEMA_URL, "$schema must be the exact Agent Plugins v1 schema URL");
  assert.equal(typeof manifest.name, "string");
  assert.equal(typeof manifest.description, "string");
  assert.equal(typeof manifest.version, "string");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/, "version must be a semantic version string");
  assert.equal(typeof manifest.homepage, "string");
  assert.equal(typeof manifest.repository, "string");
  assert.equal(typeof manifest.license, "string");
  assert.ok(Array.isArray(manifest.keywords), "keywords must be an array");
  assert.ok(manifest.keywords.every((keyword) => typeof keyword === "string"), "keywords must all be strings");

  assert.equal(typeof manifest.author, "object");
  assert.ok(manifest.author !== null, "author must be an object");
  assert.equal(typeof manifest.author.name, "string");
  for (const key of Object.keys(manifest.author)) {
    assert.ok(ALLOWED_AUTHOR_KEYS.has(key), `plugin.json author has unexpected key "${key}"`);
  }
});

test("root plugin.json only declares recognized Agent Plugins v1 keys", () => {
  const manifest = loadJson("plugin.json");
  for (const key of Object.keys(manifest)) {
    assert.ok(ALLOWED_KEYS.has(key), `plugin.json has unexpected key "${key}"`);
  }
});

test("root plugin.json rejects the nonstandard displayName key", () => {
  const manifest = loadJson("plugin.json");
  assert.ok(
    !Object.prototype.hasOwnProperty.call(manifest, "displayName"),
    "plugin.json must not declare displayName; it is not part of the Agent Plugins v1 schema"
  );
});

test("root plugin.json name and version match the Claude Code plugin manifest", () => {
  const manifest = loadJson("plugin.json");
  const claudePlugin = loadJson(".claude-plugin/plugin.json");
  assert.equal(manifest.name, "agent-kickstart");
  assert.equal(manifest.version, "0.3.0");
  assert.equal(manifest.name, claudePlugin.name, "name must match .claude-plugin/plugin.json");
  assert.equal(manifest.version, claudePlugin.version, "version must match .claude-plugin/plugin.json");
});
