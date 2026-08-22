#!/usr/bin/env node

import path from "path";
import dotenv from "dotenv";
import chalk from "chalk";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { runWizard } from "./wizard";
import { closePrompts } from "./prompt";
import { parseCliArgs, runConfigPreviewFromFile } from "./run-config";
import { runFundedCanary } from "./funded-canary";
import { runMultiWalletPlanner } from "./multi-wallet-planner";

const HELP = `
NFT Public Mint Sniper

  Mints public SeaDrop stages. Calldata is built from on-chain state, so no
  OpenSea account or access token is required.

Usage
  npm start                                      run the interactive wizard
  npm start -- --help                            show this message
  npm run dev -- plan --contract 0x... --wallet hot=HOT_KEY
                                                 print a multi-wallet dry-run plan
  npm run dev -- canary --contract 0x... --wallet hot=HOT_KEY --max-total-eth 0.06
                                                 validate a one-wallet funded canary; no broadcast by default
  npm run dev -- --config run.json --dry-run     print a no-secret preview execution plan

Interactive mode asks for keys, chain, quantity, NFT link, RPC, gas and timing.
Optional defaults can be set in .env (see .env.example).

Config mode reads the no-secret run JSON produced by the webapp and is dry-run
only for now: it validates the plan, prints costs/timing/warnings, and never
loads private keys, signs transactions, or broadcasts.
`;

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  if (rawArgs[0] === "plan") {
    try {
      await runMultiWalletPlanner(rawArgs.slice(1));
      closePrompts();
      process.exit(0);
    } catch (err: any) {
      closePrompts();
      console.error(chalk.red(`\n❌ ${err.message}\n`));
      process.exit(1);
    }
  }

  if (rawArgs[0] === "canary") {
    try {
      await runFundedCanary(rawArgs.slice(1));
      closePrompts();
      process.exit(0);
    } catch (err: any) {
      closePrompts();
      console.error(chalk.red(`\n❌ ${err.message}\n`));
      process.exit(1);
    }
  }

  const args = parseCliArgs(rawArgs);
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
