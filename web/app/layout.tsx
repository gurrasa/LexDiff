import type { Metadata } from 'next'
import { Geist, Geist_Mono, Newsreader } from 'next/font/google'
import Link from 'next/link'
import { Logo } from '@/components/ui'
import ThemeToggle from '@/components/ThemeToggle'
import WalletButton from '@/components/WalletButton'
import './globals.css'

// Applies a saved light/dark choice before first paint (see ThemeToggle).
const THEME_SCRIPT = `try{var t=localStorage.getItem('lexdiff:theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`

const sans = Geist({ variable: '--font-sans', subsets: ['latin'] })
const mono = Geist_Mono({ variable: '--font-mono', subsets: ['latin'] })
const serif = Newsreader({ variable: '--font-serif', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'LexDiff — responsible smart contracts',
  description: 'Compare a legal agreement with the smart contract that enforces it, and keep an on-chain record of every mismatch until it is verifiably resolved.',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // The theme script sets data-theme before React hydrates, so the attribute may differ from the server HTML.
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="brand">
              <Logo />
              <span style={{ color: 'inherit' }}>
                Lex<span>Diff</span>
              </span>
            </Link>
            <nav aria-label="Main">
              <Link href="/">My agreements</Link>
              <Link href="/new" className="button">New agreement</Link>
              <WalletButton />
              <ThemeToggle />
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <footer className="footer">
          LexDiff preserves evidence; it does not decide liability or give legal advice. Sepolia testnet only.
        </footer>
      </body>
    </html>
  )
}
