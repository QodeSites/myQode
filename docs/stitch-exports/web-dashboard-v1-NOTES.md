# Web Dashboard v1 — audit notes (10 Jul 2026)

First Web Pass screen ("inspired" desktop dashboard, per user direction — not a replica of
the D: prototype). Full HTML in chat; archive the locked version when fixes land.

## Structure verdict: KEEP — no layout changes requested
- Dark-green gradient sidebar, gold-active nav with left border, grouped items
- Hero "Total Portfolio Value" dark card with gold underline strip; 3 white stat cards
  (Invested / Absolute Gain +46.4% pill / XIRR with "vs Nifty 50: 14.1%" chip)
- Portfolio vs Benchmark chart (green line + gradient vs dashed gold "Nifty 50 TRI"),
  Strategy Allocation donut (52/31/17, correct identity colors, "3 Strategies" center)
- Strategy cards with identity left borders + allocation bars; Recent Activity table with
  signed colored amounts and status chips; SEBI footer with Terms/Privacy/Disclosures

## Fixes requested (v2)
1. FONT DRIFT: Source Sans 3 → must be Lato (recurring Stitch failure)
2. Lemon gold #ffe264 (tertiary-fixed) used on active nav + hero underline → #DABD38
3. Page background #fff8f1 → cream #FDF2E0 (cards are white; need the warm contrast)
4. Sidebar missing "Profile"; has Settings — add Profile above Settings
5. User chip: invented "Premium Client" label → replace with "PMS Client"; add chevron
   (chip is the scope switcher trigger)
6. Demo date says 2023 → use 2026 dates consistent with mobile screens

## Standing accepted items
- primary token #002a1a vs #02422B (visually identical; enforced at implementation)
