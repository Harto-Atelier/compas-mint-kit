import type { Metadata } from "next";
import WalletConsole from "../WalletConsole";

export const metadata: Metadata = {
  title: "Compas Mint Kit · Wallets",
  description: "Safety-first wallet management console for Compas mint operations.",
};

export default function WalletsPage() {
  return <WalletConsole />;
}
