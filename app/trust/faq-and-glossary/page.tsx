type QA = { q: string; a: string }
type Section = { title: string; items: QA[] }

const sections: Section[] = [
  {
    title: "Top-ups",
    items: [
      {
        q: "Q1. How do I add more funds to my account?",
        a: "You can top-up anytime via Cashfree. Execution happens once funds reflect (T+1).",
      },
      {
        q: "Q2. Can I set up a SIP?",
        a: "Yes, we offer a Systematic Investment Plan option where fixed amounts are invested at set intervals.",
      },
      {
        q: "Q3. Can I set up a Systematic Transfer Plan (STP)?",
        a: "Yes. We offer a Systematic Transfer Plan, where funds can be parked in the Qode Liquid Fund (QLF) and periodically transferred into core strategy portfolios.",
      },
      {
        q: "Q4. How much amount of top-up can an investor do?",
        a: "Top-ups can be made in multiples of ₹5 lakhs, provided the total portfolio value remains above the SEBI-mandated minimum of ₹50 lakhs.",
      },
    ],
  },
  {
    title: "Withdrawals",
    items: [
      {
        q: "Q5. How do I withdraw money from my PMS account?",
        a: "Submit a withdrawal request through our portal. Proceeds are credited to your bank account, typically within T+10 days.",
      },
      {
        q: "Q6. Is there any lock-in period for withdrawals?",
        a: "No lock-in. Withdrawals are processed as per SEBI PMS guidelines. Partial withdrawals must maintain required minimums.",
      },
    ],
  },
  {
    title: "Fees",
    items: [
      {
        q: "Q7. How are fees charged?",
        a: "Management fees are billed quarterly. Performance fees apply annually on the High Watermark principle.",
      },
      {
        q: "Q8. Do fees include GST?",
        a: "Yes, all fees are subject to GST at prevailing rates.",
      },
    ],
  },
  {
    title: "Taxes",
    items: [
      {
        q: "Q9. Will Qode deduct taxes from my account?",
        a: "Qode does not deduct capital gains tax. Investors are responsible for filing taxes; we provide tax packs annually.",
      },
      {
        q: "Q10. What about TDS on referral rewards or other payments?",
        a: "Yes, referral rewards are subject to TDS as per law. Investment returns are not.",
      },
      {
        q: "Q11. Do you do Tax Loss Harvesting?",
        a: "No. We do not undertake tax-loss harvesting within PMS portfolios, as our focus remains on evidence-based, long-term investing.",
      },
      {
        q: "Q12. Will I receive tax statements?",
        a: "Yes. Investors receive annual tax packs, including realized and unrealized gains, dividend records, and other relevant documentation to assist with tax filing.",
      },
    ],
  },
  {
    title: "Minimums & Customization",
    items: [
      {
        q: "Q13. What is the minimum investment required?",
        a: "As per SEBI regulations, the minimum investment for Portfolio Management Services is ₹50 lakhs.",
      },
      {
        q: "Q14. Can I customize my portfolio?",
        a: "No. All clients within a strategy hold the same model portfolio to maintain fairness, transparency, and evidence-driven execution.",
      },
    ],
  },
  {
    title: "Portal Access",
    items: [
      {
        q: "Q15. How do I log in to see my portfolio?",
        a: "Log in via WealthSpectrum using the credentials shared at onboarding.",
      },
      {
        q: "Q16. What if I forget my login password?",
        a: "Use the 'Forgot Password' option on WealthSpectrum or contact our IR team for assistance.",
      },
    ],
  },
  {
    title: "Risk & Operations",
    items: [
      {
        q: "Q17. Can my portfolio lose value?",
        a: "All investments carry risk, though Qode's strategies use discipline, diversification, and hedging to manage downside.",
      },
      {
        q: "Q18. How do you manage risk in extreme markets?",
        a: "We follow defined risk controls — hedging policy, drawdown protocols, liquidity rules, and concentration discipline.",
      },
      {
        q: "Q19. Who holds custody of my assets?",
        a: "Assets are held in your demat account with SEBI-registered custodians. Qode manages investments via POA only.",
      },
      {
        q: "Q20. What happens if Qode's systems go down?",
        a: "We follow Business Continuity & Disaster Recovery (BCP/DR) protocols to ensure uninterrupted operations and client access.",
      },
      {
        q: "Q21. Can I switch between strategies?",
        a: "Yes. Clients can request a strategy switch during the monthly rebalance cycle, subject to reallocation guidelines.",
      },
    ],
  },
]

const glossary: { term: string; def: string }[] = [
  {
    term: "XIRR",
    def: "Extended Internal Rate of Return that accounts for cash flows at different times.",
  },
  {
    term: "HWM (High Watermark)",
    def: "The highest NAV reached; ensures performance fees are charged only on gains above that level.",
  },
  { term: "Benchmark", def: "A reference index used to measure portfolio performance." },
  {
    term: "Drawdown",
    def: "The peak-to-trough decline in portfolio value, usually expressed as a percentage.",
  },
  {
    term: "STP (Systematic Transfer Plan)",
    def: "Allows phased transfer of funds from a liquid portfolio into equity strategies.",
  },
  {
    term: "Custodian",
    def: "A SEBI-registered entity that safeguards client funds and securities.",
  },
  {
    term: "Protective Put",
    def: "An options contract used to limit downside risk by providing insurance against large market declines.",
  },
  {
    term: "Rebalancing",
    def: "The process of aligning client portfolios back to the model portfolio to maintain uniformity and discipline.",
  },
  {
    term: "SEBI",
    def: "The Securities and Exchange Board of India — the regulator for securities markets.",
  },
]

export default function FAQsGlossaryPage() {
  return (
    <main className="p-4 md:p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-balance">FAQs & Glossary</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Answers to common questions and definitions of terms used in our updates and reports.
        </p>
      </header>

      <div className="space-y-6">
        {sections.map((section) => (
          <section key={section.title} className="rounded-md border bg-card">
            <div className="p-4 border-b">
              <h2 className="font-semibold">{section.title}</h2>
            </div>
            <div className="divide-y">
              {section.items.map((item, i) => (
                <div key={i} className="p-4">
                  <dt className="font-semibold">{item.q}</dt>
                  <dd className="mt-1 text-sm text-muted-foreground">{item.a}</dd>
                </div>
              ))}
            </div>
          </section>
        ))}

        <section className="rounded-md border bg-card">
          <div className="p-4 border-b">
            <h2 className="font-semibold">Glossary</h2>
          </div>
          <div className="divide-y">
            {glossary.map((g) => (
              <div key={g.term} className="p-4">
                <dt className="font-semibold">{g.term}</dt>
                <dd className="mt-1 text-sm text-muted-foreground">{g.def}</dd>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
