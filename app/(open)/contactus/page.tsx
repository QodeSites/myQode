

export default async function Page() {

    return (
        <main className="space-y-2">
            <h1 className="text-pretty text-xl font-bold text-foreground flex items-center gap-2">
                Contact Us
            </h1>
            <div className="flex flex-col md:flex-row gap-8">
                <div className="md:w-1/2">
                    <div className="">
                        <div className="text-left">
                            <div className="mb-4">
                                <div className="text-pretty text-lg font-bold text-foreground flex items-center gap-2">
                                    Address
                                </div>
                                <div className="text-md">
                                    2nd Floor, Tree Building, Raghuvanshi Mills Compound, Gandhi
                                    Nagar, Upper Worli, Lower Parel, Mumbai, Maharashtra 400013
                                </div>
                                <div>India</div>
                            </div>



                            {/* Investor Relations */}
                            <div className="mb-4">
                                <div className="text-pretty text-lg font-bold text-foreground flex items-center gap-2">
                                    Investor Relations
                                </div>
                                <div className="text-md">
                                    Phone:&nbsp;
                                    <a
                                        href="tel:+919820300028"
                                        className="text-gray-900 hover:text-gray-600 transition duration-300"
                                    >
                                        +91 98203 00028
                                    </a>
                                </div>
                                <div className="text-md">
                                    Email:&nbsp;
                                    <a
                                        href="mailto:investor.relations@qodeinvest.com"
                                        className="text-gray-900 hover:text-gray-600 transition duration-300"
                                    >
                                        investor.relations@qodeinvest.com
                                    </a>
                                </div>
                            </div>

                            {/* HR Queries */}
                            <div>
                                <div className="text-pretty text-lg font-bold text-foreground flex items-center gap-2">
                                    HR Queries
                                </div>
                                <div className="text-md">
                                    Phone:&nbsp;
                                    <a
                                        href="tel:+919820300032"
                                        className="text-gray-900 hover:text-gray-600 transition duration-300"
                                    >
                                        +91 98203 00032
                                    </a>
                                </div>
                                <div className="text-md">
                                    Email:&nbsp;
                                    <a
                                        href="mailto:hr@qodeinvest.com"
                                        className="text-gray-900 hover:text-gray-600 transition duration-300"
                                    >
                                        hr@qodeinvest.com
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="md:w-1/2">
                    <iframe
                        src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3772.6322147006836!2d72.82033437580478!3d18.991843454607952!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3be7cec445995555%3A0x198651c83d7c4bd5!2sQode%20Advisors%20LLP!5e0!3m2!1sen!2sin!4v1723199089828!5m2!1sen!2sin"
                        width="100%"
                        height="100%"
                        style={{ border: 0, minHeight: "300px" }}
                        loading="lazy"
                        title="Qode Location"
                    ></iframe>
                </div>
            </div>
        </main>
    )
}