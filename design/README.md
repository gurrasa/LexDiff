# LexDiff UI reference

Static design mockups for the LexDiff web app. Open the HTML files in a browser.

- `dashboard.html` – home page: summary cards (total, waiting for you, verification issues, active), "Needs your attention" and "Waiting for others" agreement cards, recent activity.
- `agreement-detail.html` – agreement page: header, 7-step progress, four counters (Pass, Fail, Inconclusive, Not checked), filters, finding cards (agreement vs code side by side, plain-language explanation, verification method, expandable "View technical details", decision actions), "What happened" timeline, sidebar (parties, money, contracts, verifier).
- `components.html` – logo, kind badges, verification results with icons, buttons incl. focus state, filters, empty state, loading state, type and colors.

## Rules
- A property that was not executed is **Inconclusive**, never Pass.
- Every status has an icon and a word; color is a secondary cue.
- Keep all wallet, signing and verification logic unchanged. This is presentation only.

## Tokens
| Token | Value |
|---|---|
| Background | `#F6F4EF` |
| Panel | `#FFFFFF` |
| Subtle | `#EFECE5` |
| Ink | `#17191E` |
| Muted text | `#646873` |
| Line | `#E2DED5` |
| Accent | `#2F4BD8` (soft `#E8ECFD`) |
| Brand "Diff" orange | `#E8622C` |
| Match | `#1F7A4D` on `#E3F3EA` |
| Mismatch | `#8F5B00` on `#FCEFD6` |
| Missing | `#B3261E` on `#FBE5E2` |
| Hidden power | `#7A2E8E` on `#F4E6F7` |

Fonts: Newsreader (headings), Geist (UI), Geist Mono (addresses, hashes, code). Radius 12px for panels, 8px for buttons, 999px for badges. Buttons at least 44px tall.

Names, addresses and timestamps in the mockups are placeholders.
