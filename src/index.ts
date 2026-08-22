#!/usr/bin/env node

import path from "path";
import dotenv from "dotenv";
import chalk from "chalk";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { runWizard } from "./wizard";
import { closePrompts } from "./prompt";
import { parseCliArgs, runConfigPreviewFromFile } from "./run-config";

const HELP = `
NFT Public Mint Sniper

  Mints public SeaDrop stages. Calldata is built from on-chain state, so no
  OpenSea account or access token is required.

Usage
  npm start                                      run the interactive wizard
  npm start -- --help                            show this message
  npm run dev -- --config run.json --dry-run     print a no-secret preview execution plan

Interactive mode asks for keys, chain, quantity, NFT link, RPC, gas and timing.
Optional defaults can be set in .env (see .env.example).

Config mode reads the no-secret run JSON produced by the webapp and is dry-run
only for now: it validates the plan, prints costs/timing/warnings, and never
loads private keys, signs transactions, or broadcasts.
`;

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  try {
    if (args.configPath) {
      await runConfigPreviewFromFile(args.configPath, { dryRun: args.dryRun });
    } else {
      await runWizard();
    }
    closePrompts();
    process.exit(0);
  } catch (err: any) {
    closePrompts();
    console.error(chalk.red(`\n❌ ${err.message}\n`));
    process.exit(1);
  }
}

void main();
