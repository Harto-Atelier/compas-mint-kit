import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { PlannerStoreProvider } from "@/app/components/PlannerStoreProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Compas Mint Kit",
  description: "A Harto-branded mint operator console shell for Compas launches.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <PlannerStoreProvider>{children}</PlannerStoreProvider>
      </body>
    </html>
  );
}
