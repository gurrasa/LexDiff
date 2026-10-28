import type { Metadata } from 'next'
import { Geist, Geist_Mono, Newsreader } from 'next/font/google'
import Link from 'next/link'
import './globals.css'

const sans = Geist({ variable: '--font-sans', subsets: ['latin'] })
const mono = Geist_Mono({ variable: '--font-mono', subsets: ['latin'] })
const serif = Newsreader({ variable: '--font-serif', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'LexDiff — responsible smart contracts',
  description: 'Compare a legal agreement with the smart contract that enforces it, and keep an on-chain record of every mismatch until it is verifiably resolved.',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            Lex<span>Diff</span>
          </Link>
          <nav>
            <Link href="/">Agreements</Link>
            <Link href="/new" className="button small">New agreement</Link>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="footer">
          LexDiff preserves evidence; it does not decide liability or give legal advice. Sepolia testnet only.
        </footer>
      </body>
    </html>
  )
}
