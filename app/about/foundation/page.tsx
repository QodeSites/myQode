import React from "react";

function PageHeader() {
  return (
    <header className="bg-primary text-primary-foreground">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-center tracking-tight">
          Note from Fund Managers
        </h1>
      </div>
    </header>
  );
}

function Portrait({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="relative w-full max-w-[300px] aspect-square rounded-2xl overflow-hidden shadow bg-muted">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="absolute inset-0 w-full h-full object-cover" />
    </div>
  );
}

function FundManagerDisplay({
  name,
  role,
  img,
  paragraphs,
  reverse = false,
}: {
  name: string;
  role: string;
  img: string;
  paragraphs: string[];
  reverse?: boolean;
}) {
  return (
    <section
      className={`grid items-center md:gap-4 gap-4 ${
        reverse ? "md:grid-cols-[1.1fr_0.9fr]" : "md:grid-cols-[0.9fr_1.1fr]"
      }`}
    >
      {!reverse ? (
        <div className="md:order-1 flex justify-center md:justify-center">
          <Portrait src={img} alt={name} />
        </div>
      ) : (
        <div className="md:order-2 flex justify-center md:justify-center">
          <Portrait src={img} alt={name} />
        </div>
      )}

      <div className={reverse ? "md:order-1" : "md:order-2"}>
        <div className="space-y-2">
          <h2 className="text-xl sm:text-2xl font-serif font-bold text-foreground">{name}</h2>
          <p className="text-sm sm:text-base text-primary font-semibold">{role}</p>
        </div>
        <div className="mt-3 space-y-2 text-sm sm:text-base leading-snug text-muted-foreground font-sans">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </div>
    </section>
  );
}

function PillHeader({ title }: { title: string }) {
  return (
    <div className="w-full bg-primary text-primary-foreground py-3 px-6">
      <h3 className="text-base sm:text-lg font-serif font-bold text-center">{title}</h3>
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card text-card-foreground rounded-2xl overflow-hidden shadow-sm border border-border">
      <PillHeader title={title} />
      <div className="p-5 sm:p-6">
        <div className="text-sm sm:text-base text-muted-foreground font-sans">{children}</div>
      </div>
    </div>
  );
}

function MissionVision() {
  return (
    <section className="grid md:grid-cols-2 gap-6">
      <InfoCard title="Mission">
        To support investors with data-driven, high-quality investment solutions that deliver superior
        risk-adjusted returns.
      </InfoCard>
      <InfoCard title="Vision">
        To transform investment management with innovation and discipline, creating lasting value for our
        investors.
      </InfoCard>
    </section>
  );
}

export default function Page() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <PageHeader />

      <div className="mx-auto px-4 sm:px-6 py-10 space-y-12">
        <FundManagerDisplay
          name="Rishabh Nahar"
          role="Fund Manager"
          img="/fund-manager/Rishabh.jpg"
          paragraphs={[
            "Investing, to me, has always been about process. Markets are unpredictable in the short run, but data, when studied carefully, reveals patterns that can guide us with discipline.",
            "At Qode, our approach is rooted in systematic models that help us identify opportunities objectively, free from bias or noise.",
            "But models alone are not enough — they must be applied with judgment, constant review, and a deep respect for risk. That's why we combine quantitative insights with robust portfolio construction, always seeking to maximize outcomes while protecting against drawdowns.",
            "My goal is simple: to give investors confidence that every decision we take is grounded in evidence, tested rigorously, and aligned with the long-term compounding of their wealth.",
          ]}
        />

        <hr className="border-border" />

        <FundManagerDisplay
          reverse
          name="Gaurav Didwania"
          role="Fund Manager"
          img="/fund-manager/Gaurav.jpg"
          paragraphs={[
            "Over the last 15+ years in Indian markets, I've seen cycles of euphoria and panic, trends that come and go, and businesses that either endure or fade.",
            "What I've learned is that wealth creation doesn't come from chasing momentum alone — it comes from conviction in the right businesses and the patience to stay invested through volatility.",
            "At Qode, I focus on marrying deep fundamental research with a long-term mindset. We look beyond stock prices to understand management quality, competitive advantage, financial strength, and industry dynamics.",
            "For me, Qode is about trust and transparency — ensuring our investors not only achieve returns, but also understand the rationale behind every decision. That understanding builds confidence, and confidence is what allows compounding to work its magic.",
          ]}
        />

        <MissionVision />
      </div>
    </main>
  );
}
