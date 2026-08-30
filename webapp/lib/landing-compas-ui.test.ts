import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("landing puts Compas identity and procedural 3D art in the hero", () => {
  assert.match(source, /function Compas3DHero/);
  assert.match(source, /aria-label="Compas 3D artwork"/);
  assert.match(source, /src="\/compas-logo\.png"/);
  assert.match(source, /Compas holder mint tools/);
  assert.match(source, /Mint with your Compas in control\./);
  assert.match(source, /compas-orbit-dot/);
  assert.match(source, /@keyframes compasFloat/);
});

test("landing adds a lower Compas collection layer without replacing the product preview", () => {
  assert.match(source, /function CompasTotemStrip/);
  assert.match(source, /Compas collection layer/);
  assert.match(source, /Built around your Compas\./);
  assert.match(source, /\/compas\/compas-\$\{tokenId\}\.svg/);
  assert.match(source, /1516/);
  assert.match(source, /<ProductPreview \/>/);
  assert.match(source, /<CompasTotemStrip \/>/);
  assert.ok(source.indexOf("<ProductPreview />") < source.indexOf("<CompasTotemStrip />"));
});
