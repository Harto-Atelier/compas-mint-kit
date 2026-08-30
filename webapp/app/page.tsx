"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties } from "react";

import { COMPAS_CONTRACT, isEthAddress, writeGateSession } from "@/lib/compas-gate";

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
    title: "Watchlist signals",
    body: "Add drops, run preview scans, and rank candidates before deciding what deserves attention.",
    art: "signals",
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

const faqs = [
  { q: "Who can enter?", a: "Wallets holding at least one Compas. Login requires a wallet signature plus an onchain holder check." },
  { q: "Does the server store keys?", a: "No. Launch vault encryption and unlock happen in the browser. Use burner wallets and rotate keys per launch." },
  { q: "Can it mint from the browser?", a: "Yes, only after vault unlock, transaction preparation, simulation, spend caps, and an explicit broadcast confirmation." },
  { q: "What chains are supported?", a: "Ethereum, Base, and Robinhood Chain. Robinhood is wired against the public sequencer RPC with a low-latency signing path; every chain still gets the same simulate-first, chain-id-checked flow." },
  { q: "Is this custody?", a: "No custody. The app never asks for seed phrases and never sends plaintext keys to a server. Keys stay local while unlocked." },
  { q: "What if I close my browser mid-mint?", a: "Your progress is saved without secrets. Come back, resume from the same step, and funding checks re-verify onchain automatically." },
  { q: "What about leftover ETH in temporary wallets?", a: "The Recover funds panel scans every known temporary wallet, shows residual balances, and guides a sweep back to your holder — you sign every transaction. Finish is blocked while funds remain." },
  { q: "What if I lose this device?", a: "Download your encrypted .compas-vault recovery file and keep it outside the browser. Restore it anywhere with your passphrase; without it there is no recovery." },
  { q: "What should I use it for now?", a: "Prepare a drop, stage wallets, seal launch burners, simulate execution, and review reports. Real mainnet canary still needs explicit approval." },
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
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "connecting" | "signing" | "checking">("idle");
  const [error, setError] = useState<string | null>(null);

  async function connectAndVerify() {
    setError(null);
    const ethereum = (window as unknown as { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
    if (!ethereum) {
      setError("No wallet detected. Open this page in a wallet browser or install MetaMask/Rabby.");
      return;
    }
    try {
      setStatus("connecting");
      const accounts = (await ethereum.request({ method: "eth_requestAccounts" })) as string[];
      const address = Array.isArray(accounts) ? accounts[0] : "";
      if (!address || !isEthAddress(address)) {
        setError("Wallet did not return a valid Ethereum address.");
        setStatus("idle");
        return;
      }

      const challengeResponse = await fetch("/api/auth/challenge", { method: "POST", credentials: "same-origin" });
      if (!challengeResponse.ok) throw new Error("Could not create login challenge.");
      const challenge = (await challengeResponse.json()) as { nonce?: unknown };
      if (typeof challenge.nonce !== "string") throw new Error("Invalid login challenge.");
      const message = [
        "Compas Mint Kit holder login",
        "",
        "Sign this message to prove wallet ownership. No transaction will be sent.",
        `Address: ${address.toLowerCase()}`,
        `Nonce: ${challenge.nonce}`,
      ].join("\n");

      setStatus("signing");
      const signature = (await ethereum.request({ method: "personal_sign", params: [message, address] })) as string;
      setStatus("checking");
      const verifyResponse = await fetch("/api/auth/verify", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, signature }),
      });
      const verified = (await verifyResponse.json().catch(() => null)) as { address?: string; compasCount?: number; verifiedAt?: number; error?: string } | null;
      if (!verifyResponse.ok || !verified || typeof verified.address !== "string" || typeof verified.compasCount !== "number" || typeof verified.verifiedAt !== "number") {
        throw new Error(verified?.error || "Wallet verification failed.");
      }
      writeGateSession({ address: verified.address, compasCount: verified.compasCount, verifiedAt: verified.verifiedAt });
      router.push("/app");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Wallet connection failed.");
      setStatus("idle");
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/20 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="login-title">
      <div className="w-full max-w-md rounded-[1.75rem] border border-neutral-200 bg-white p-5 shadow-2xl shadow-neutral-950/20">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#635bff]">Compas holder access</p>
            <h2 id="login-title" className="mt-1 text-2xl font-black text-neutral-950">Enter the mint console</h2>
            <p className="mt-2 text-sm font-medium leading-6 text-neutral-600">
              Connect the wallet that holds your Compas, then sign a server-issued challenge. The server verifies the signature and checks Compas ownership onchain before opening the console.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-neutral-200 px-3 py-1 text-sm font-black text-neutral-500 hover:bg-neutral-50">×</button>
        </div>
        <div className="mt-5 grid gap-3">
          <button
            type="button"
            onClick={connectAndVerify}
            disabled={status !== "idle"}
            className="inline-flex h-12 items-center justify-center rounded-2xl bg-[#635bff] px-5 text-sm font-black text-white shadow-lg shadow-[#635bff]/25 transition hover:bg-[#5148ee] disabled:cursor-wait disabled:opacity-70"
          >
            {status === "connecting" ? "Connecting wallet…" : status === "signing" ? "Requesting signature…" : status === "checking" ? "Verifying signature + Compas…" : "Connect wallet →"}
          </button>
          {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold leading-5 text-red-700">{error}</p> : null}
          <p className="text-xs font-semibold leading-5 text-neutral-500">
            Gate contract: <span className="font-black text-neutral-700">{`${COMPAS_CONTRACT.slice(0, 6)}…${COMPAS_CONTRACT.slice(-4)}`}</span> (Compas, ETH mainnet). Signature proves wallet ownership; server session lasts 24h.
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
    return <div className="grid gap-1.5">{["OpenSea", "SeaDrop", "Allowlist"].map((x) => <div key={x} className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-sm font-black text-neutral-700"><span className="h-2 w-2 rounded-full bg-[#635bff]" />{x}</div>)}</div>;
  }
  if (kind === "vault") {
    return <div className="grid h-28 place-items-center rounded-3xl border border-neutral-200 bg-gradient-to-br from-neutral-50 to-violet-50"><div className="grid h-16 w-16 place-items-center rounded-2xl bg-[#635bff] text-2xl text-white shadow-lg">⌁</div></div>;
  }
  if (kind === "speed") {
    return <div className="space-y-1.5 pt-3">{[96, 82, 76, 68, 55, 48, 36].map((w, i) => <div key={w} className="h-1.5 rounded-full bg-gradient-to-r from-[#635bff] to-orange-300" style={{ width: `${w}%`, opacity: 1 - i * 0.07 }} />)}</div>;
  }
  return <div className="mx-auto w-36 rotate-[-3deg] rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm"><div className="grid gap-2 text-sm font-black text-neutral-700"><span>🌿 Mints</span><span>▣ Wallets</span><span>⇄ Disperse</span><span>◇ Reports</span></div></div>;
}

function Compas3DHero() {
  return (
    <div className="relative mx-auto mt-8 grid min-h-[420px] w-full max-w-lg place-items-center lg:mt-0" aria-label="Compas 3D artwork">
      <div className="absolute inset-0 rounded-full bg-[#635bff]/15 blur-3xl" />
      <div className="absolute bottom-8 h-20 w-72 rounded-full bg-neutral-950/20 blur-2xl" />
      <div className="relative h-80 w-80 [perspective:1000px] sm:h-96 sm:w-96">
        <div className="absolute inset-0 rounded-[3rem] border border-white/70 bg-white/55 shadow-2xl shadow-[#635bff]/20 backdrop-blur-xl [transform:rotateX(62deg)_rotateZ(-18deg)]" />
        <div className="absolute inset-7 rounded-[2.5rem] border border-violet-100 bg-gradient-to-br from-white via-violet-50 to-neutral-100 shadow-2xl [transform:rotateX(58deg)_rotateZ(-18deg)_translateZ(38px)]" />
        <div className="absolute inset-14 grid place-items-center rounded-[2rem] border border-neutral-200 bg-neutral-950 shadow-2xl shadow-neutral-950/30 [transform:rotateX(54deg)_rotateZ(-18deg)_translateZ(82px)]">
          <Image src="/compas-logo.png" alt="Compas" width={512} height={512} priority className="h-40 w-40 rounded-3xl object-cover shadow-[0_0_45px_rgba(99,91,255,0.45)] sm:h-48 sm:w-48" />
        </div>
        {Array.from({ length: 14 }).map((_, index) => {
          const angle = (index / 14) * Math.PI * 2;
          const x = Math.cos(angle) * 145;
          const y = Math.sin(angle) * 88;
          return (
            <span
              key={index}
              className="compas-orbit-dot absolute left-1/2 top-1/2 h-3 w-3 rounded-full border border-white bg-[#635bff] shadow-lg shadow-[#635bff]/40"
              style={{ "--x": `${x}px`, "--y": `${y}px`, "--z": `${20 + (index % 4) * 12}px`, "--delay": `${index * 0.08}s`, opacity: 0.35 + (index % 5) * 0.1 } as CSSProperties}
            />
          );
        })}
      </div>
      <div className="relative -mt-8 rounded-full border border-neutral-200 bg-white/85 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-neutral-700 shadow-sm backdrop-blur">
        Compas holder tools · local keys · fast mint
      </div>
    </div>
  );
}

function ProductPreview() {
  return (
    <div className="relative mx-auto mt-8 w-full max-w-5xl lg:mt-0">
      <div className="absolute -inset-6 rounded-[3rem] bg-[#635bff]/10 blur-3xl" />
      <div className="relative overflow-hidden rounded-[2rem] border border-neutral-200 bg-neutral-950 p-3 text-left shadow-2xl shadow-neutral-950/20 sm:rounded-[2.5rem] sm:p-4">
        <div className="flex items-center justify-between border-b border-white/10 px-2 pb-3 text-xs font-black text-white/60">
          <span>Compas Mint Kit</span>
          <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-emerald-200">Read-only until broadcast</span>
        </div>
        <div className="grid gap-3 pt-3 lg:grid-cols-[150px_minmax(0,1fr)]">
          <div className="grid grid-cols-4 gap-2 lg:grid-cols-1">
            {["Mints", "Wallets", "Vault", "Reports"].map((tab, index) => (
              <div key={tab} className={`rounded-2xl px-3 py-3 text-xs font-black ${index === 0 ? "bg-[#635bff] text-white" : "bg-white/8 text-white/65"}`}>
                {tab}
              </div>
            ))}
          </div>
          <div className="rounded-[1.5rem] bg-white p-4 text-neutral-950">
            <div className="flex flex-col gap-3 border-b border-neutral-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#635bff]">Mint flow</p>
                <h2 className="mt-1 text-2xl font-black tracking-tight">Drop → Wallets → Simulate → Send</h2>
              </div>
              <span className="rounded-full bg-neutral-950 px-4 py-2 text-xs font-black text-white">Sim first</span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              {["Collection", "Vault", "Gas cap", "Review"].map((item, index) => (
                <div key={item} className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-neutral-400">0{index + 1}</p>
                  <p className="mt-2 text-sm font-black text-neutral-900">{item}</p>
                  <div className="mt-3 h-1.5 rounded-full bg-[#635bff]/25" />
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-2xl border border-violet-100 bg-violet-50 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-700">Operator check</p>
                  <p className="mt-1 text-sm font-semibold text-neutral-600">Keys stay local. User signs. Server never receives secrets.</p>
                </div>
                <span className="hidden rounded-full bg-white px-3 py-2 text-xs font-black text-violet-700 shadow-sm sm:inline">No custody</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CompasTotemStrip() {
  return (
    <section className="mx-auto w-full max-w-[100vw] px-4 pb-12 sm:px-5 lg:max-w-6xl" aria-label="Compas collection layer">
      <div className="overflow-hidden rounded-[2rem] border border-neutral-200 bg-neutral-950 p-4 text-white shadow-2xl shadow-neutral-950/15 sm:p-6">
        <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-300">Compas layer</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Built around your Compas.</h2>
            <p className="mt-3 max-w-md text-sm font-semibold leading-6 text-white/60">The holder wallet stays the destination. Temporary wallets only do the mint work.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {[1516, 1, 2, 7, 33, 77, 111, 420, 999, 4663].map((tokenId, index) => (
              <div key={tokenId} style={{ "--stagger": index } as CSSProperties} className="compas-tile group relative aspect-square overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-inner shadow-white/10">
                <Image src={`/compas/compas-${tokenId}.svg`} alt={`Compas #${tokenId}`} width={160} height={160} unoptimized className="h-full w-full rounded-2xl object-cover [image-rendering:pixelated] transition duration-500 group-hover:scale-110" />
                <span className="absolute bottom-2 right-2 rounded-full bg-neutral-950/80 px-2 py-0.5 font-mono text-[10px] font-black text-white">#{tokenId}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    // Fallback for browsers without CSS scroll-driven animations (Safari, Firefox):
    // IntersectionObserver toggles .in-view to run the same reveal keyframes.
    if (typeof CSS !== "undefined" && CSS.supports("animation-timeline: view()")) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const targets = document.querySelectorAll(".scroll-reveal, .scroll-reveal-scale, .compas-tile");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15 },
    );
    targets.forEach((el) => {
      el.classList.add("needs-reveal");
      observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <main className="min-h-dvh overflow-x-hidden bg-[#f7f7f6] text-neutral-950">
      <header className="mx-auto flex w-full max-w-[100vw] flex-col gap-4 px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-10 lg:max-w-6xl">
        <div className="flex items-center justify-between">
          <Brand />
          <button type="button" onClick={() => setLoginOpen(true)} className="rounded-full bg-[#635bff] px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-[#5148ee] sm:hidden">Launch →</button>
        </div>
        <nav className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center">
          <a href="#access" className="rounded-full border border-neutral-200 bg-white px-4 py-2 text-center text-sm font-semibold shadow-sm hover:border-neutral-300">Access</a>
          <a href="#faq" className="rounded-full border border-neutral-200 bg-white px-4 py-2 text-center text-sm font-semibold shadow-sm hover:border-neutral-300">FAQ</a>
          <button type="button" onClick={() => setLoginOpen(true)} className="col-span-2 hidden rounded-full bg-[#635bff] px-5 py-2 text-sm font-bold text-white shadow-sm hover:bg-[#5148ee] sm:block">Launch App →</button>
        </nav>
      </header>

      <section className="mx-auto grid w-full max-w-[100vw] gap-8 px-4 pb-8 sm:px-5 lg:max-w-6xl lg:grid-cols-[0.78fr_1fr] lg:items-center lg:pb-14">
        <div className="text-center lg:text-left">
          <p className="inline-flex rounded-full border border-violet-100 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] shadow-sm sm:text-xs sm:tracking-[0.16em]"><span className="hero-badge-shimmer">Compas holder mint tools</span></p>
          <h1 className="mt-5 max-w-full text-balance break-words text-[2.35rem] font-black leading-[0.9] tracking-[-0.075em] text-neutral-950 [overflow-wrap:anywhere] min-[390px]:text-5xl sm:text-6xl lg:text-7xl">Mint with your Compas in control.</h1>
          <p className="mt-4 max-w-md text-pretty text-sm font-medium leading-6 text-neutral-600 sm:text-base sm:leading-7 lg:mx-0">A calm mint console for Compas holders: encrypted temporary wallets, recovery files, fast signing, and receipts.</p>
          <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:max-w-md">
            <button type="button" onClick={() => setLoginOpen(true)} className="min-h-11 rounded-full bg-[#635bff] px-6 py-3 text-sm font-black text-white shadow-lg shadow-[#635bff]/20 hover:bg-[#5148ee]">Login / Launch App</button>
            <a href="https://github.com/Harto-Atelier/compas-mint-kit#readme" target="_blank" rel="noreferrer" className="min-h-11 rounded-full border border-neutral-200 bg-white px-6 py-3 text-center text-sm font-black text-neutral-700 shadow-sm hover:border-neutral-300">Docs</a>
          </div>
        </div>
        <Compas3DHero />
      </section>

      <div className="mx-auto grid w-full max-w-[100vw] grid-cols-1 gap-2 px-4 pb-4 text-center text-xs font-black min-[390px]:grid-cols-3 sm:px-5 lg:max-w-4xl">
        <span className="rounded-md bg-[#5865f2] px-2 py-1 text-white">Encrypted vault</span>
        <span className="rounded-md bg-sky-500 px-2 py-1 text-white">ETH / Base / Robinhood</span>
        <button type="button" onClick={() => setLoginOpen(true)} className="rounded-md border border-neutral-200 bg-white px-2 py-1 shadow-sm">Operator access</button>
      </div>

      <section className="mx-auto grid w-full max-w-[100vw] grid-cols-1 gap-4 px-4 pb-12 sm:grid-cols-2 sm:px-5 lg:max-w-6xl lg:grid-cols-3">
        {featureCards.map((card) => (
          <article key={card.title} className="scroll-reveal min-h-56 overflow-hidden rounded-[0.35rem] border border-neutral-200 bg-white p-4 shadow-[0_1px_8px_rgba(0,0,0,0.06)]">
            <div className="h-32"><Art kind={card.art} /></div>
            <h2 className="text-xl font-black tracking-tight text-neutral-800">{card.title}</h2>
            <p className="mt-2 text-sm font-medium leading-5 text-neutral-600">{card.body}</p>
          </article>
        ))}
      </section>

      <ProductPreview />

      <div className="scroll-reveal-scale">
        <CompasTotemStrip />
      </div>

      <div className="scroll-reveal">
        <section id="access" className="mx-auto w-full max-w-[100vw] px-4 pb-6 sm:px-5 lg:max-w-6xl">
        <div className="grid overflow-hidden rounded-[2rem] border border-neutral-200 bg-white shadow-sm lg:grid-cols-[0.8fr_1.2fr]">
          <div className="border-b border-neutral-200 p-6 lg:border-b-0 lg:border-r">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#635bff]">Access model</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-neutral-950">Holder-gated operator console.</h2>
            <p className="mt-3 text-sm font-medium leading-6 text-neutral-600">The public landing is open. The app shell is protected by wallet proof and Compas ownership. No wallet signature, no entry.</p>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-3 sm:p-6">
            {[
              ["Proof", "Sign a fresh login challenge."],
              ["Ownership", "Server reads Compas balance onchain."],
              ["Session", "24h httpOnly access cookie."],
            ].map(([title, body]) => (
              <div key={title} className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                <p className="text-sm font-black text-neutral-950">{title}</p>
                <p className="mt-2 text-xs font-semibold leading-5 text-neutral-600">{body}</p>
              </div>
            ))}
          </div>
        </div>
        </section>
      </div>

      <section id="faq" className="mx-auto w-full max-w-[100vw] px-4 pb-12 sm:px-5 lg:max-w-6xl">
        <div className="mb-5 flex flex-col gap-2 text-center lg:text-left">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#635bff]">FAQ</p>
          <h2 className="text-3xl font-black tracking-tight text-neutral-950">Straight answers before funds move.</h2>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {faqs.map((item) => (
            <div key={item.q} className="scroll-reveal rounded-[1.5rem] border border-neutral-200 bg-white p-5 shadow-sm">
              <dt className="text-base font-black text-neutral-950">{item.q}</dt>
              <dd className="mt-2 text-sm font-medium leading-6 text-neutral-600">{item.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <footer className="mx-auto flex w-full max-w-[100vw] flex-col gap-2 px-4 pb-10 text-xs font-semibold text-neutral-500 sm:flex-row sm:items-center sm:justify-between sm:px-5 lg:max-w-6xl">
        <span>© 2026 Compas Mint Kit</span>
        <span>Built for Harto operators</span>
      </footer>

      {loginOpen ? <LoginModal onClose={() => setLoginOpen(false)} /> : null}
      <style jsx global>{`
        .compas-orbit-dot {
          animation: compasFloat 3.8s ease-in-out var(--delay) infinite alternate;
          transform: translate3d(var(--x), var(--y), var(--z)) scale(0.92);
        }
        @keyframes compasFloat {
          from { transform: translate3d(var(--x), var(--y), var(--z)) scale(0.92); }
          to { transform: translate3d(var(--x), calc(var(--y) - 10px), calc(var(--z) + 26px)) scale(1.08); }
        }
        /* 2026 scroll-driven reveals — pure CSS, no JS, no layout shift */
        @supports (animation-timeline: view()) {
          .scroll-reveal {
            animation: revealUp linear both;
            animation-timeline: view();
            animation-range: entry 0% entry 42%;
          }
          .scroll-reveal-scale {
            animation: revealScale linear both;
            animation-timeline: view();
            animation-range: entry 0% entry 55%;
          }
          .compas-tile {
            animation: tilePop linear both;
            animation-timeline: view();
            animation-range: entry 0% entry 60%;
            animation-delay: calc(var(--stagger, 0) * 30ms);
          }
        }
        @keyframes revealUp {
          from { opacity: 0; transform: translateY(26px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes revealScale {
          from { opacity: 0; transform: scale(0.96) translateY(18px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes tilePop {
          from { opacity: 0; transform: scale(0.7) rotate(-4deg); }
          to { opacity: 1; transform: scale(1) rotate(0deg); }
        }
        /* IntersectionObserver fallback (Safari/Firefox): same keyframes, time-based */
        .needs-reveal { opacity: 0; }
        .needs-reveal.in-view.scroll-reveal { animation: revealUp 0.6s ease-out both; }
        .needs-reveal.in-view.scroll-reveal-scale { animation: revealScale 0.7s ease-out both; }
        .needs-reveal.in-view.compas-tile { animation: tilePop 0.5s ease-out both; animation-delay: calc(var(--stagger, 0) * 60ms); }
        .hero-badge-shimmer {
          background: linear-gradient(110deg, #635bff 20%, #b7b2ff 40%, #635bff 60%);
          background-size: 200% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: shimmerSlide 3.2s linear infinite;
        }
        @keyframes shimmerSlide {
          to { background-position: -200% 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .compas-orbit-dot, .scroll-reveal, .scroll-reveal-scale, .compas-tile, .hero-badge-shimmer {
            animation: none !important;
            opacity: 1 !important;
            transform: none !important;
          }
        }
      `}</style>
    </main>
  );
}
