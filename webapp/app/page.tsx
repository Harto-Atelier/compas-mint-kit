"use client";

import Link from "next/link";
import { useState } from "react";

const featureCards = [
  {
    title: "Multi-chain mint ops",
    body: "Ethereum, Base, and Robinhood Chain planning with explicit SeaDrop/RPC checks before execution.",
    art: "chains",
  },
  {
    title: "Nothing to install first",
    body: "Plan, vault, simulate, and review runs from the browser. Local CLI stays available for high-value launches.",
    art: "browser",
  },
  {
    title: "Launchpad-aware stages",
    body: "Discover collection stages, quantities, eligibility, gas assumptions, and wallet readiness before signing.",
    art: "launchpad",
  },
  {
    title: "Encrypted launch vault",
    body: "Keys are sealed per launch with browser-side encryption, passphrases are never stored, and rotation is built in.",
    art: "vault",
  },
  {
    title: "Simulation before send",
    body: "Prepare transactions locally, dry-run first, then require a broadcast modal with explicit operator review.",
    art: "speed",
  },
  {
    title: "Full operator kit",
    body: "Wallet staging, funding drafts, mint queues, encrypted backups, CLI reports, and post-run analytics in one shell.",
    art: "tools",
  },
];

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2" aria-label="Compas Mint Kit home">
      <span className="grid h-6 w-6 place-items-center rounded-lg bg-[#635bff] text-xs font-black text-white shadow-sm">C</span>
      <span className="text-xl font-black tracking-tight text-neutral-950">compas</span>
    </Link>
  );
}

function LoginModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/20 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="login-title">
      <div className="w-full max-w-md rounded-[1.75rem] border border-neutral-200 bg-white p-5 shadow-2xl shadow-neutral-950/20">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#635bff]">Operator login</p>
            <h2 id="login-title" className="mt-1 text-2xl font-black text-neutral-950">Enter the mint console</h2>
            <p className="mt-2 text-sm font-medium leading-6 text-neutral-600">
              This preview uses local browser state. No password leaves the browser; production auth can be wired later to your preferred provider.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-neutral-200 px-3 py-1 text-sm font-black text-neutral-500 hover:bg-neutral-50">×</button>
        </div>
        <div className="mt-5 grid gap-3">
          <label className="grid gap-2 text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
            Workspace
            <input defaultValue="Harto / Compas" className="h-11 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 text-sm font-bold text-neutral-950 outline-none focus:border-[#635bff] focus:bg-white" />
          </label>
          <label className="grid gap-2 text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
            Access phrase
            <input type="password" placeholder="Browser-local preview" className="h-11 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 text-sm font-bold text-neutral-950 outline-none focus:border-[#635bff] focus:bg-white" />
          </label>
          <Link href="/app" className="mt-2 inline-flex h-12 items-center justify-center rounded-2xl bg-[#635bff] px-5 text-sm font-black text-white shadow-lg shadow-[#635bff]/25 transition hover:bg-[#5148ee]">
            Launch App →
          </Link>
          <p className="text-xs font-semibold leading-5 text-neutral-500">
            For funded launches, use burner wallets and rotate the encrypted vault per drop.
          </p>
        </div>
      </div>
    </div>
  );
}

function Art({ kind }: { kind: string }) {
  if (kind === "chains") {
    return <div className="grid grid-cols-6 gap-2">{["Ξ", "B", "R", "◎", "◆", "●", "M", "S", "◌", "A", "◈", "E"].map((x, i) => <span key={`${x}-${i}`} className="grid h-9 w-9 place-items-center rounded-xl border border-neutral-200 bg-white text-xs font-black text-[#635bff] shadow-sm">{x}</span>)}</div>;
  }
  if (kind === "browser") {
    return <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm"><div className="flex gap-1 border-b border-neutral-200 bg-neutral-50 p-3"><span className="h-2.5 w-2.5 rounded-full bg-red-400"/><span className="h-2.5 w-2.5 rounded-full bg-amber-400"/><span className="h-2.5 w-2.5 rounded-full bg-emerald-400"/></div><div className="p-4"><div className="h-8 rounded-xl border border-neutral-200 bg-neutral-50"/><div className="mt-3 h-3 w-32 rounded bg-[#635bff]/20"/></div></div>;
  }
  if (kind === "launchpad") {
    return <div className="grid gap-2">{["OpenSea", "SeaDrop", "Allowlist", "Public"].map((x) => <div key={x} className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-black text-neutral-700"><span className="h-2 w-2 rounded-full bg-[#635bff]" />{x}</div>)}</div>;
  }
  if (kind === "vault") {
    return <div className="grid h-28 place-items-center rounded-3xl border border-neutral-200 bg-gradient-to-br from-neutral-50 to-violet-50"><div className="grid h-16 w-16 place-items-center rounded-2xl bg-[#635bff] text-2xl text-white shadow-lg">⌁</div></div>;
  }
  if (kind === "speed") {
    return <div className="space-y-1.5 pt-3">{[96, 82, 76, 68, 55, 48, 36].map((w, i) => <div key={w} className="h-1.5 rounded-full bg-gradient-to-r from-[#635bff] to-orange-300" style={{ width: `${w}%`, opacity: 1 - i * 0.07 }} />)}</div>;
  }
  return <div className="mx-auto w-36 rotate-[-3deg] rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm"><div className="grid gap-2 text-sm font-black text-neutral-700"><span>🌿 Mints <b className="float-right text-xs">3</b></span><span>▣ Wallets <b className="float-right text-xs">34</b></span><span>⇄ Disperse</span><span>◇ Reports</span></div></div>;
}

export default function LandingPage() {
  const [loginOpen, setLoginOpen] = useState(false);

  return (
    <main className="min-h-dvh bg-[#f7f7f6] text-neutral-950">
      <header className="mx-auto flex max-w-[520px] items-center justify-between px-5 py-10">
        <Brand />
        <nav className="flex items-center gap-2">
          <a href="#pricing" className="rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold shadow-sm hover:border-neutral-300">Pricing</a>
          <a href="#faq" className="rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold shadow-sm hover:border-neutral-300">FAQ</a>
          <button type="button" onClick={() => setLoginOpen(true)} className="rounded-full bg-[#635bff] px-5 py-2 text-sm font-bold text-white shadow-sm hover:bg-[#5148ee]">Launch App →</button>
        </nav>
      </header>

      <section className="mx-auto max-w-[520px] px-5 pb-6 text-center">
        <p className="inline-flex rounded-full border border-violet-100 bg-white px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-[#635bff] shadow-sm">NFT mint command center</p>
        <h1 className="mt-5 text-balance text-5xl font-black tracking-[-0.07em] text-neutral-950 sm:text-6xl">Mint faster without giving up control.</h1>
        <p className="mx-auto mt-4 max-w-md text-pretty text-base font-medium leading-7 text-neutral-600">Compas Mint Kit turns the morsyxbt mint flow into a polished operator console: encrypted launch vaults, wallet staging, simulation-first execution, and real reports.</p>
        <div className="mt-5 flex justify-center gap-2">
          <button type="button" onClick={() => setLoginOpen(true)} className="rounded-full bg-[#635bff] px-6 py-3 text-sm font-black text-white shadow-lg shadow-[#635bff]/20 hover:bg-[#5148ee]">Login / Launch App</button>
          <a href="https://github.com/Harto-Atelier/compas-mint-kit#readme" target="_blank" rel="noreferrer" className="rounded-full border border-neutral-200 bg-white px-6 py-3 text-sm font-black text-neutral-700 shadow-sm hover:border-neutral-300">Docs</a>
        </div>
      </section>

      <div className="mx-auto flex max-w-[520px] items-center justify-between px-5 pb-4 text-xs font-black">
        <span className="rounded-md bg-[#5865f2] px-2 py-1 text-white">Encrypted vault</span>
        <span className="rounded-md bg-sky-500 px-2 py-1 text-white">ETH / Base / Robinhood</span>
        <button type="button" onClick={() => setLoginOpen(true)} className="rounded-md border border-neutral-200 bg-white px-2 py-1 shadow-sm">Operator access</button>
      </div>

      <section className="mx-auto grid max-w-[520px] grid-cols-1 gap-4 px-5 pb-12 sm:grid-cols-2">
        {featureCards.map((card) => (
          <article key={card.title} className="min-h-56 overflow-hidden rounded-[0.35rem] border border-neutral-200 bg-white p-4 shadow-[0_1px_8px_rgba(0,0,0,0.06)]">
            <div className="h-32"><Art kind={card.art} /></div>
            <h2 className="text-xl font-black tracking-tight text-neutral-800">{card.title}</h2>
            <p className="mt-2 text-sm font-medium leading-5 text-neutral-600">{card.body}</p>
          </article>
        ))}
      </section>

      <section id="pricing" className="mx-auto max-w-[520px] px-5 pb-6">
        <div className="rounded-[0.35rem] border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-2xl font-black tracking-tight">Access model</h2>
          <p className="mt-2 text-sm font-medium leading-6 text-neutral-600">Preview is open for Harto operators. Production can add wallet-gated access, team seats, or a private deployment when you choose.</p>
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-[520px] px-5 pb-12">
        <div className="rounded-[0.35rem] border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-2xl font-black tracking-tight">FAQ</h2>
          <dl className="mt-4 grid gap-4 text-sm">
            <div><dt className="font-black">Does the server store keys?</dt><dd className="mt-1 font-medium leading-6 text-neutral-600">No. Vault encryption/decryption happens in the browser. Use burner wallets and rotate per launch.</dd></div>
            <div><dt className="font-black">Can it broadcast?</dt><dd className="mt-1 font-medium leading-6 text-neutral-600">Only after vault unlock, transaction preparation, dry-run simulation, and an explicit broadcast modal.</dd></div>
          </dl>
        </div>
      </section>

      <footer className="mx-auto flex max-w-[520px] items-center justify-between px-5 pb-10 text-xs font-semibold text-neutral-500">
        <span>© 2026 Compas Mint Kit</span>
        <span>Built for Harto operators</span>
      </footer>

      {loginOpen ? <LoginModal onClose={() => setLoginOpen(false)} /> : null}
    </main>
  );
}
