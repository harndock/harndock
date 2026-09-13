import assert from "node:assert/strict";
import test from "node:test";
import { comparePluginVersions, pluginVersionState } from "../src/plugin-version.ts";

test("compares stable semantic versions", () => {
  assert.equal(comparePluginVersions("1.2.0", "1.1.9"), 1);
  assert.equal(comparePluginVersions("1.2.0", "1.2.0"), 0);
  assert.equal(comparePluginVersions("1.1.9", "1.2.0"), -1);
  assert.equal(comparePluginVersions("9007199254740993.0.0", "9007199254740992.0.0"), 1);
});

test("orders prerelease identifiers according to SemVer", () => {
  assert.equal(comparePluginVersions("1.0.0-alpha", "1.0.0-alpha.1"), -1);
  assert.equal(comparePluginVersions("1.0.0-alpha.1", "1.0.0-beta"), -1);
  assert.equal(comparePluginVersions("1.0.0-rc.1", "1.0.0"), -1);
  assert.equal(comparePluginVersions("1.0.0+build.2", "1.0.0+build.1"), 0);
});

test("rejects invalid semantic versions", () => {
  assert.equal(comparePluginVersions("v1.0.0", "1.0.0"), null);
  assert.equal(comparePluginVersions("1.0", "1.0.0"), null);
  assert.equal(comparePluginVersions("1.0.0-01", "1.0.0"), null);
  assert.equal(comparePluginVersions("01.0.0", "1.0.0"), null);
});

test("calculates client update states without allowing downgrade", () => {
  assert.equal(pluginVersionState("1.0.0", null), "not-installed");
  assert.equal(pluginVersionState("1.1.0", "1.0.0"), "update-available");
  assert.equal(pluginVersionState("1.0.0", "1.0.0"), "latest");
  assert.equal(pluginVersionState("1.0.0", "1.1.0"), "local-newer");
  assert.equal(pluginVersionState(null, "1.0.0"), "unavailable");
  assert.equal(pluginVersionState("invalid", "1.0.0"), "unavailable");
});
