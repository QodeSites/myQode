"use client"
import { FeedbackDialog } from "@/components/feedback-dialog"
import { TestimonialDialog } from "@/components/testimonial-dialog"

export default function FeedbackPage() {
  return (
    <div className="space-y-10">
      {/* Top section: Feedback */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Why Your Feedback Matters</h2>
          <p>
            Every portfolio at Qode is built with discipline, but the way we serve you is shaped by listening. Your
            input tells us what we’re doing right, what we can refine, and how we can make your experience smoother.
          </p>
          <p>
            Whether it’s the clarity of our reports, the ease of a top-up, or the value of review calls, your
            perspective helps us get better—step by step.
          </p>

          <div className="py-2">
            <FeedbackDialog triggerLabel="Feedback Form" />
          </div>
        </div>

        {/* <div className="rounded-md border p-6">
          <h3 className="mb-4 font-semibold">Feedback Form Includes:</h3>
          <ul className="list-disc space-y-2 pl-6">
            <li>How likely are you to recommend Qode to a friend or colleague? (1 = Very unlikely, 5 = Very likely)</li>
            <li>Overall satisfaction with your experience so far (1 = Very dissatisfied, 5 = Very satisfied)</li>
            <li>Clarity and usefulness of portfolio updates and review calls (1 = Not useful, 5 = Extremely useful)</li>
            <li>Ease of key processes (onboarding, top-ups, withdrawals) (1 = Very difficult, 5 = Very easy)</li>
            <li>One thing we could do to improve your experience (open text)</li>
          </ul>
        </div> */}

      {/* Divider */}
      <div className="h-px bg-border" />

      {/* Testimonials section */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Why Your Experience Matters</h2>
        <p>
          Numbers tell part of the story. The other part is how you feel as an investor—your confidence, your peace of
          mind, and your trust in our process. When you share your journey with Qode, it not only guides us but also
          inspires future investors to invest with conviction.
        </p>
        <p>
          If you’ve had a positive journey with Qode, we’d love to hear your story. Testimonials may highlight: your
          onboarding experience, clarity of communication, and confidence in Qode’s investment philosophy.
        </p>
        <p>
          With your consent, selected testimonials may be anonymized and featured in our website, decks, and newsletters
          to inspire other investors.
        </p>

        <div className="py-2">
          <TestimonialDialog triggerLabel="Testimonial" />
        </div>
      </section>
    </div>
  )
}
