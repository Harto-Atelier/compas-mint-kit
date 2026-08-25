import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BurnerGenerationPanel, ImportWalletPanel } from "../app/LaunchVaultConsole";

const noop = () => undefined;

test("Vault renders bounded burner generation as the primary local key path", () => {
  const markup = renderToStaticMarkup(
    BurnerGenerationPanel({
      count: "5",
      chain: "ETH",
      sealPassphrase: "",
      onCount: noop,
      onChain: noop,
      onSealPassphrase: noop,
      onSubmit: noop,
    }),
  );

  assert.match(markup, /Generate encrypted burners/);
  assert.match(markup, /Browser-local only/);
  assert.match(markup, /type="number"/);
  assert.match(markup, /min="1"/);
  assert.match(markup, /max="50"/);
  assert.match(markup, /Generate \+ encrypt burners/);
  assert.doesNotMatch(markup, /Private keys \(one per line\)/);
});

test("existing private-key import remains inside Advanced", () => {
  const markup = renderToStaticMarkup(
    ImportWalletPanel({
      bulkMode: false,
      chain: "ETH",
      label: "Launch wallet",
      privateKeyInput: "",
      sealPassphrase: "",
      onBulkMode: noop,
      onChain: noop,
      onLabel: noop,
      onPrivateKeyInput: noop,
      onSealPassphrase: noop,
      onSubmit: noop,
    }),
  );

  assert.match(markup, /^<details/);
  assert.match(markup, /Advanced · import private keys/);
  assert.match(markup, /Private key/);
});
