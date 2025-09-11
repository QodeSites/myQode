import React from 'react';

const TermsnConditions: React.FC = () => {
  return (

    <main className="flex-1 overflow-y-auto">
      <div className="w-full h-fit rounded-lg bg-card px-10 py-20 card-shadow flex flex-col content-center text-center">
        <div>
          <title>Terms & Conditions - Qode</title>
          <meta
            name="description"
            content="Read the Terms & Conditions for accessing and using Qode's website, including intellectual property rights, exclusions of liability, and more."
          />
          <meta
            name="keywords"
            content="Terms & Conditions, Qode, intellectual property, legal agreements, website terms, liabilities"
          />
          <meta name="author" content="Qode" />
          <link rel="canonical" href="https://www.qodeinvest.com/terms-and-conditions" />
        </div>
        <h1 className="text-brown mb-4 italic text-3xl font-bold">
          Terms & Conditions
        </h1>
        <p className="text-base">
          By accessing & using the website of Qode (hereinafter referred to as
          "Qode"), including any of its web pages, you signify your agreement to
          these Terms & Conditions. It is important that you read these terms
          each time you access our website, as they may be amended from time to
          time at Qode's sole discretion
          <a
            href="https://qodeinvest.com"
            className="text-brown hover:text-black"
          >
            {' '}
            qodeinvest.com
          </a>
          , & it reflects our dedication to protecting your privacy.
        </p>

        <div className="flex flex-col mt-1 items-center justify-start">
          <div className="text-start">
            <p className="mb-4 text-xl font-semibold sm:text-2xl">
              Use of Information & Materials:
            </p>
            <p className="mb-4 text-base md:text-lg">
              The content provided on Qode's website is for general
              informational purposes only & should not be considered as
              financial advice or a recommendation to invest. The website
              content is not intended to be an offer or solicitation for
              investment in any financial products mentioned. Investments are
              subject to market risks, including the potential loss of
              principal. Past performance is not indicative of future results.
              Users are advised to seek independent financial advice before
              making any investment decisions.
            </p>

            <p className="mt-1 mb-4 text-xl font-semibold sm:text-2xl">
              Copyright & Intellectual Property:
            </p>
            <p className="mb-4 text-base md:text-lg">
              All content on Qode's website, including text, graphics, logos, &
              images, is the property of Qode or its content suppliers & is
              protected by copyright & other intellectual property laws.
              Unauthorized use, reproduction, or distribution of any material
              from this website is strictly prohibited.
            </p>

            <p className="mt-1 mb-4 text-xl font-semibold sm:text-2xl">
              No Warranties:
            </p>
            <p className="mb-4 text-base md:text-lg">
              Qode makes no warranties or representations about the accuracy,
              completeness, or suitability of the information on its website.
              All content is provided "as is" without any warranty of any kind.
              Qode, its affiliates, & their respective officers, directors,
              employees, or agents will not be liable for any damages arising
              from the use of this website.
            </p>

            <p className="mt-1 mb-4 text-xl font-semibold sm:text-2xl">
              Exclusion of Liability:
            </p>
            <p className="mb-4 text-base md:text-lg">
              Qode will not be liable for any damages or losses arising from the
              use of this website, including but not limited to direct,
              indirect, incidental, punitive, & consequential damages. This
              exclusion applies to damages from the use of or reliance on any
              information provided, any transactions conducted through the
              website, & unauthorized access or alteration of your transmissions
              or data.
            </p>

            <p className="mt-1 mb-4 text-xl font-semibold sm:text-2xl">
              Governing Law:
            </p>
            <p className="mb-4 text-base md:text-lg">
              These Terms & Conditions are governed by the laws of India. Any
              disputes arising out of or in connection with this website are to
              be submitted to the exclusive jurisdiction of the courts in
              Mumbai, India.
            </p>

            <p className="mt-1 mb-4 text-xl font-semibold sm:text-2xl">
              Privacy & Security:
            </p>
            <p className="mb-4 text-base md:text-lg">
              Qode takes the privacy & security of its users seriously. Please
              review our Privacy Policy to understand how we protect your
              information.
            </p>

            <p className="mt-1 mb-4 text-xl font-semibold sm:text-2xl">
              Hyperlinks:
            </p>
            <p className="mb-4 text-base md:text-lg">
              This website may contain links to other websites. Qode is not
              responsible for the content or privacy practices of these external
              sites. Users are advised to read the privacy policy of external
              sites before disclosing any personal information on
              <a
                href="https://qodeinvest.com"
                className="text-brown hover:text-black"
              >
                {' '}
                qodeinvest.com
              </a>
              . Qode reserves the right to amend these Terms & Conditions at any
              time. Any such changes will be posted on this page. Your continued
              use of the website following the posting of changes to these terms
              will mean you accept those changes.
            </p>

            <p className="mt-1 mb-4 text-xl font-semibold sm:text-2xl">
              Amendments:
            </p>
            <p className="mb-4 text-base md:text-lg">
              Qode reserves the right to amend these Terms & Conditions at any
              time. Any such changes will be posted on this page. Your continued
              use of the website following the posting of changes to these terms
              will mean you accept those changes.
            </p>

            <p className="mt-1 mb-4 text-xl font-semibold sm:text-2xl">
              Contact Information:
            </p>
            <p className="text-base md:text-lg">
              If you have any questions or concerns about these Terms &
              Conditions, please contact us at{' '}
              <a href="mailto:investor.relations@qodeinvest.com">
                <strong className="text-beige">
                  investor.relations@qodeinvest.com
                </strong>
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    </main>

  );
};

export default TermsnConditions;