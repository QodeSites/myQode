import React from 'react'

const page = () => {
    return (
        <div className="min-h-screen">
            {/* Header */}
            <div className="bg-primary text-white py-3 px-6">
                <div className="max-w-4xl mx-auto text-center">
                    <h1 className="text-lg font-serif font-bold">Note from Fund Managers</h1>
                </div>
            </div>

            {/* Content Section */}
            <div className="py-8">
                {/* Rishabh Nahar Section */}
                <div className="grid md:grid-cols-3 mb-14 items-center ">
                    {/* Image */}
                    <div className="md:col-span-1">
                        <div className="aspect-square bg-muted rounded-lg overflow-hidden max-w-[250px] ">
                            <img
                                src="/fund-manager/Rishabh.jpg"
                                alt="Rishabh Nahar"
                                className="w-full h-full object-cover"
                            />
                        </div>
                    </div>

                    {/* Text Content */}
                    <div className="md:col-span-2 space-y-4">
                        <div>
                            <h2 className="text-xl font-serif font-bold text-foreground mb-1">Rishabh Nahar</h2>
                            <p className="text-sm text-primary font-medium mb-3">Fund Manager</p>
                        </div>

                        <div className="text-muted-foreground leading-relaxed text-sm space-y-3">
                            <p>
                                Investing, to me, has always been about process. Markets are unpredictable in the short run,
                                but data, when studied carefully, reveals patterns that can guide us with discipline. At Qode,
                                our approach is rooted in systematic models that help us identify opportunities objectively,
                                free from bias or noise.
                            </p>

                            <p>
                                But models alone are not enough — they must be applied with judgment, constant review, and a
                                deep respect for risk. That's why we combine quantitative insights with robust portfolio
                                construction, always seeking to maximize outcomes while protecting against drawdowns.
                            </p>

                            <p>
                                My goal is simple: to give investors confidence that every decision we take is grounded in
                                evidence, tested rigorously, and aligned with the long-term compounding of their wealth.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Gaurav Didwania Section */}
                <div className="grid md:grid-cols-3 mb-14  items-center">
                    {/* Text Content */}
                    <div className="md:col-span-2 space-y-4 md:order-1">
                        <div>
                            <h2 className="text-xl font-serif font-bold text-foreground mb-1">Gaurav Didwania</h2>
                            <p className="text-sm text-primary font-medium mb-3">Fund Manager</p>
                        </div>

                        <div className="text-muted-foreground leading-relaxed text-sm space-y-3">
                            <p>
                                Over the last 15+ years in Indian markets, I've seen cycles of euphoria and panic, trends
                                that come and go, and businesses that either endure or fade. What I've learned is that wealth
                                creation doesn't come from chasing momentum alone — it comes from conviction in the right
                                businesses and the patience to stay invested through volatility.
                            </p>

                            <p>
                                At Qode, I focus on marrying deep fundamental research with a long-term mindset. We look
                                beyond stock prices to understand management quality, competitive advantage, financial
                                strength, and industry dynamics. When we invest, we do so with clarity on why the company
                                can grow stronger over time.
                            </p>

                            <p>
                                For me, Qode is about trust and transparency — ensuring our investors not only achieve
                                returns, but also understand the rationale behind every decision. That understanding builds
                                confidence, and confidence is what allows compounding to work its magic.
                            </p>
                        </div>
                    </div>

                    {/* Image */}
                    <div className="md:col-span-1 justify-self-end md:order-2">
                        <div className="aspect-square bg-muted rounded-lg overflow-hidden max-w-[250px] ">
                            <img
                                src="/fund-manager/Gaurav.jpg"
                                alt="Gaurav Didwania"
                                className="w-full h-full object-cover"
                            />
                        </div>
                    </div>
                </div>

                {/* Mission and Vision Section */}
                <div className="grid md:grid-cols-2 gap-4">
                    {/* Mission */}
                    <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                        <div className="bg-primary text-white py-3 px-6">
                            <h2 className="text-md font-serif font-bold text-center">Mission</h2>
                        </div>
                        <div className="p-4">
                            <p className="text-sm text-muted-foreground leading-relaxed">
                                To support investors with data-driven, high-quality investment solutions that deliver superior returns.
                            </p>
                        </div>
                    </div>

                    {/* Vision */}
                    <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                        <div className="bg-primary text-white py-3 px-6">
                            <h2 className="text-md font-serif font-bold text-center">Vision</h2>
                        </div>
                        <div className="p-4">
                            <p className="text-sm text-muted-foreground leading-relaxed">
                                To transform investment management with innovation, creating lasting value for our investors.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default page