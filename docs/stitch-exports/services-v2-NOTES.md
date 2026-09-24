# Services v2 — audit results (10 Jul 2026)

Frames received: Hub, Add Funds Steps 1 & 3 (full), Step 2 (truncated again at chat limit —
visible portion confirms: Select Strategy header, back/close buttons, stepper with Amount
checked → Strategy active, strategy-card-selected styling).

## Verified fixed (vs v1)
1. ✅ COMPLIANCE: "Expected Yield 14.2% - 16.5% p.a." row REMOVED — Step 3 summary shows only
   Amount + Strategy
2. ✅ Step 1 copy: "Funds will be added to your selected Qode strategy." (wallet language gone);
   stepper renamed Amount → Strategy → Confirm
3. ✅ Hub top bar: account-switcher pill "Aditya V." + chevron, sparkle + bell with red dot,
   "Private Client" label removed
4. ✅ Hub bottom nav: room_service icon restored, gold #DABD38 indicator bar, labels not
   uppercase
5. ✅ Step 3 strategy dot: All Weather #008455

## Accepted as-is (not worth more Stitch rounds)
- Dimmed background chrome inside the Step 1/3 modal frames still shows old nav styling —
  decorative context at 10–20% opacity behind the sheet, invisible in practice
- Hub "Completed" timeline dot border uses olive tertiary token — recolor to #DABD38 in Figma
- primary token still #002a1a (standing item; corrected at implementation)

## Outstanding
- My Requests EMPTY STATE still not generated (asked twice). One-line prompt below, or design
  directly in Figma — trivial either way.

## Status: Services hub + Add Funds flow LOCKED pending empty state.
