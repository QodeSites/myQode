"use client"
import type React from "react"
import { useState, useRef } from "react"
import { Users, Mail, Calendar, MessageCircle, Phone, User, TrendingUp, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { useClient } from "@/contexts/ClientContext"

function Modal({ isOpen, onClose, title, children }: {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-background/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-card rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-muted rounded-md"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">
          {children}
        </div>
      </div>
    </div>
  )
}

function Banner() {
  return (
    <div className="mb-6 rounded-sm bg-primary px-4 py-2 text-center text-sm font-semibold text-white flex items-center justify-center gap-2">
      We believe investing is a partnership. Here are the people and channels dedicated to supporting you.
    </div>
  )
}

function Section({
  title,
  children,
  icon,
}: {
  title: string
  children: React.ReactNode
  icon?: React.ReactNode
}) {
  return (
    <section aria-labelledby={title.replace(/\s+/g, "-").toLowerCase()}>
      <h2
        id={title.replace(/\s+/g, "-").toLowerCase()}
        className="mb-2 border-b border-border pb-1 text-base font-bold text-foreground flex items-center gap-2"
      >
        {icon}
        {title}
      </h2>
      <div className="text-sm leading-relaxed text-card-foreground">{children}</div>
    </section>
  )
}

async function sendEmail(emailData: {
  to: string;
  subject: string;
  html: string;
  from?: string;
  fromName?: string;
  // Inquiry-specific fields (optional)
  inquiry_type?: string;
  nuvama_code?: string;
  client_id?: string;
  user_email?: string;
  priority?: string;
  [key: string]: any; // Allow other inquiry-specific fields like question, topic, etc.
}) {
  try {
    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailData), // Send the entire emailData object
    });

    const contentType = response.headers.get('content-type');
    if (!response.ok) {
      const errorText = await response.text();
      console.error('API response not OK:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText
      });
      throw new Error(`Failed to send email: ${response.status} ${response.statusText}`);
    }

    if (contentType && contentType.includes('application/json')) {
      const data = await response.json();
      console.log('API response data:', data);
      return data;
    } else {
      console.warn('API response is not JSON:', await response.text());
      return { success: true };
    }
  } catch (error) {
    console.error('Email sending failed:', error);
    throw error;
  }
}

export default function YourTeamAtQodePage() {
  const [isStrategyModalOpen, setIsStrategyModalOpen] = useState(false)
  const [isDiscussionModalOpen, setIsDiscussionModalOpen] = useState(false)
  const [strategyQuestion, setStrategyQuestion] = useState('')
  const [discussionTopic, setDiscussionTopic] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const { toast } = useToast()
  const strategyFormRef = useRef<HTMLFormElement>(null)
  const discussionFormRef = useRef<HTMLFormElement>(null)

  // Get selected client data from context
  const { selectedClientCode, selectedClientId, clients, loading, refresh, selectedEmailClient } = useClient()

  // Updated handleStrategySubmit function
  const handleStrategySubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const formData = {
      nuvamaCode: form.get("nuvama-code")?.toString() || selectedClientCode,
      question: strategyQuestion,
    };

    // Validate required fields
    if (!formData.question || !formData.nuvamaCode) {
      toast({
        title: "Error",
        description: "Please provide a Account ID and your question.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus('idle');

    const userEmail = selectedEmailClient;

    try {
      const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Lato, Arial, sans-serif; line-height: 1.6; color: #002017; background-color: #EFECD3; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #02422B; padding: 20px; border-radius: 8px; margin-bottom: 20px; text-align: center; }
          .content { background: #FFFFFF; padding: 20px; border: 1px solid #37584F; border-radius: 8px; }
          .question-box { background: #EFECD3; padding: 15px; border-left: 4px solid #DABD38; margin: 15px 0; }
          h1 { font-family: 'Playfair Display', Georgia, serif; color: #DABD38; }
          h3 { font-family: 'Playfair Display', Georgia, serif; color: #37584F; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">Strategy Question from Investor</h1>
          </div>
          <div class="content">
            <p><strong>Question Type:</strong> Strategy Inquiry</p>
            <p><strong>Submitted via:</strong> myQode Portal</p>
            <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
            <div class="question-box">
              <h3 style="margin-top: 0;">Investor Question:</h3>
              <p><strong>Account ID:</strong> ${formData.nuvamaCode}</p>
              <p><strong>Client ID:</strong> ${selectedClientId}</p>
              <p><strong>User Email:</strong> ${userEmail}</p>
              <p><strong>Question:</strong> ${formData.question.replace(/\n/g, '<br>')}</p>
            </div>
            <p style="margin-top: 20px; font-size: 14px; color: #37584F;">
              This message was sent from the myQode Portal. Please respond directly to the investor.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

      // FIXED: Properly structure the API call
      await sendEmail({
        to: 'investor.relations@qodeinvest.com',
        subject: `New Strategy Question from ${formData.nuvamaCode}`,
        html: emailHtml,
        from: 'investor.relations@qodeinvest.com',
        fromName: 'Qode Investor Relations',
        // Required fields for database storage
        inquiry_type: 'strategy',
        nuvama_code: formData.nuvamaCode,
        client_id: selectedClientId,
        user_email: userEmail,
        // Inquiry-specific data
        question: formData.question,
        priority: 'normal'
      });

      setSubmitStatus('success');
      toast({
        title: "Thank you!",
        description: "Your strategy question has been submitted successfully. We will get back to you soon.",
      });
      setStrategyQuestion('');
      if (strategyFormRef.current) {
        strategyFormRef.current.reset();
      }
      // Auto-close modal after 2 seconds
      setTimeout(() => {
        setIsStrategyModalOpen(false);
        setSubmitStatus('idle');
      }, 2000);
    } catch (error) {
      console.error('Strategy submission error:', error);
      setSubmitStatus('error');
      toast({
        title: "Error",
        description: "Failed to send your question. Please try again or contact us directly.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Updated handleDiscussionSubmit function
  const handleDiscussionSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const formData = {
      nuvamaCode: form.get("nuvama-code")?.toString() || selectedClientCode,
      topic: discussionTopic,
    };

    // Validate required fields
    if (!formData.topic || !formData.nuvamaCode) {
      toast({
        title: "Error",
        description: "Please provide a Account ID and your discussion topic.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus('idle');

    const userEmail = selectedEmailClient;

    try {
      const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Lato, Arial, sans-serif; line-height: 1.6; color: #002017; background-color: #EFECD3; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #02422B; padding: 20px; border-radius: 8px; margin-bottom: 20px; text-align: center; }
          .content { background: #FFFFFF; padding: 20px; border: 1px solid #37584F; border-radius: 8px; }
          .topic-box { background: #EFECD3; padding: 15px; border-left: 4px solid #DABD38; margin: 15px 0; }
          h1 { font-family: 'Playfair Display', Georgia, serif; color: #DABD38; }
          h3 { font-family: 'Playfair Display', Georgia, serif; color: #37584F; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">Call Discussion Topic from Investor</h1>
          </div>
          <div class="content">
            <p><strong>Request Type:</strong> Call Discussion Topic</p>
            <p><strong>Submitted via:</strong> myQode Portal</p>
            <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
            <div class="topic-box">
              <h3 style="margin-top: 0;">Discussion Topic:</h3>
              <p><strong>Account ID:</strong> ${formData.nuvamaCode}</p>
              <p><strong>Client ID:</strong> ${selectedClientId}</p>
              <p><strong>User Email:</strong> ${userEmail}</p>
              <p><strong>Topic:</strong> ${formData.topic.replace(/\n/g, '<br>')}</p>
            </div>
            <p style="margin-top: 20px; font-size: 14px; color: #37584F;">
              This investor has indicated they would like to discuss this topic during their next call. Please prepare accordingly and reach out to schedule if needed.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

      // FIXED: Properly structure the API call
      await sendEmail({
        to: 'investor.relations@qodeinvest.com',
        subject: `New Call Discussion Topic from ${formData.nuvamaCode}`,
        html: emailHtml,
        from: 'investor.relations@qodeinvest.com',
        fromName: 'Qode Investor Relations',
        // Required fields for database storage
        inquiry_type: 'discussion',
        nuvama_code: formData.nuvamaCode,
        client_id: selectedClientId,
        user_email: userEmail,
        // Inquiry-specific data
        topic: formData.topic,
        priority: 'normal'
      });

      setSubmitStatus('success');
      toast({
        title: "Thank you!",
        description: "Your discussion topic has been submitted successfully. We will get back to you soon",
      });
      setDiscussionTopic('');
      if (discussionFormRef.current) {
        discussionFormRef.current.reset();
      }
      // Auto-close modal after 2 seconds
      setTimeout(() => {
        setIsDiscussionModalOpen(false);
        setSubmitStatus('idle');
      }, 2000);
    } catch (error) {
      console.error('Discussion submission error:', error);
      setSubmitStatus('error');
      toast({
        title: "Error",
        description: "Failed to send your topic. Please try again or contact us directly.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Show loading state if context is still loading
  if (loading) {
    return (
      <main className="space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-300 rounded w-64 mb-2"></div>
          <div className="h-4 bg-gray-300 rounded w-96"></div>
        </div>
      </main>
    )
  }

  // Show message if no accounts available
  if (clients.length === 0) {
    return (
      <main className="space-y-6">
        <header className="mb-2">
          <h1 className="text-pretty text-xl font-bold text-foreground flex items-center gap-2">
            Your Team at Qode
          </h1>
          <p className="text-sm text-muted-foreground">
            No client accounts found. Please contact support.
          </p>
        </header>
      </main>
    )
  }

  return (
    <main className="space-y-6">
      <header className="mb-2">
        <h1 className="text-pretty text-xl font-bold text-foreground flex items-center gap-2">
          Your Team at Qode
        </h1>
        <p className="text-sm text-muted-foreground">
          Reach the right person quickly, and choose the channel that suits your query.
          {selectedClientCode && (
            <span className="ml-2 text-primary font-medium">
              Current Account: {selectedClientCode}
            </span>
          )}
        </p>
      </header>

      <Banner />

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        {/* Fund Manager */}
        <div>
          <Section title="Fund Manager" icon={<TrendingUp className="h-5 w-5 text-primary" />}>
            <p className="mb-2">
              <strong>Role:</strong> Oversees your portfolio strategy and ensures alignment with Qode's philosophy.
            </p>
            <p>
              <strong>When to Contact:</strong> Strategy‑specific queries, high‑level portfolio discussions, or during
              quarterly/annual reviews.
            </p>
            <Button
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-border bg-primary text-white px-4 py-4 text-center font-semibold md:w-auto cursor-pointer"
              onClick={() => setIsStrategyModalOpen(true)}
            >
              Ask a Question on Strategy
              <span className="sr-only"> — Opens a short form</span>
            </Button>
          </Section>
        </div>

        {/* Investor Relations */}
        <div>
          <Section title="Investor Relations" icon={<User className="h-5 w-5 text-primary" />}>
            <p className="mb-2">
              <strong>Role:</strong> Your regular point of contact. Shares monthly updates, schedules review calls, and
              addresses queries. Also helps with operations: onboarding, top‑ups, withdrawals, portal access.
            </p>
            <p className="mb-0">
              <strong>When to Contact:</strong> For reports, account queries, or operational clarifications.
            </p>
            <div className="flex gap-2 items-center">
            <Button
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-border bg-primary text-white px-4 py-4 text-center font-semibold md:w-auto cursor-pointer"
              onClick={() => window.location.href = `mailto:investor.relations@qodeinvest.com?subject=IR%20Support%20Request%20-%20${selectedClientCode || 'Account'}`}
            >
              <Mail className="h-4 w-4" />
              Contact IR Team
            </Button>
            <Button
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-border bg-primary text-white px-4 py-4 text-center font-semibold md:w-auto cursor-pointer"
              onClick={() => setIsDiscussionModalOpen(true)}
            >
              <MessageCircle className="h-4 w-4" />
              Raise Any Query
            </Button>
            </div>

            <p className="mt-1 text-xs text-muted-foreground">
              We will get back to you promptly.
            </p>
          </Section>
        </div>

        {/* Book a Call */}
        <div>
          <Section title="Book A Call" icon={<Calendar className="h-5 w-5 text-primary" />}>
            <p className="mb-2">
              <strong>Purpose:</strong> Quick, hassle‑free scheduling of calls with your IR team.
            </p>
            <Button
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-border bg-primary text-white px-4 py-4 text-center font-semibold md:w-auto cursor-pointer"
              onClick={() => window.location.href = "https://crm.zoho.in/bookings/30minutesmeeting?rid=5ec313c47c4d600297f76c4db5ed16b9ec7023047ad9adae51cf7233a95aed39b78a114a405bd5ecb516bbd5c82eb973gid34d89af86b644a5bbc06e671dae756f5663840a52f688352fdf9715c33a97bcd"}
            >
              <Calendar className="h-4 w-4" />
              Book a Call
            </Button>
            <p className="mt-1 text-xs text-muted-foreground"></p>


          </Section>
        </div>

        {/* WhatsApp / Email */}
        <div>
          <Section title="WhatsApp/Email" icon={<MessageCircle className="h-5 w-5 text-primary" />}>
            <p className="mb-2 flex flex-col gap-1">
              <span className="flex items-center gap-[2px] md:gap-2">
                <Phone className="h-4 w-4 text-primary " />
                <strong className="sm:text-sm text-xs">WhatsApp (IR Desk):</strong>
                <a className="underline decoration-dotted" href={`https://wa.me/+919820300028?text=Hi!%20I%20am%20${selectedClientCode || 'a client'}%20and%20would%20like%20to%20discuss%20my%20account`}>+91 98203 00028</a>
                <span className="sm:text-sm text-xs">(9 AM – 5 PM)</span>
              </span>
              <span className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-primary" />
                <strong >Email:</strong>{" "}
                <a
                  href={`mailto:investor.relations@qodeinvest.com?subject=Account%20Query%20-%20${selectedClientCode || 'Client'}`}
                  className="underline decoration-dotted underline-offset-4"
                >
                  investor.relations@qodeinvest.com
                </a>
              </span>
            </p>
            <p className="mb-2">
              <strong>Purpose:</strong> Instant, informal, and quick communication.
            </p>
          </Section>
        </div>
      </div>

      {/* Strategy Question Modal */}
      <Modal
        isOpen={isStrategyModalOpen}
        onClose={() => {
          setIsStrategyModalOpen(false)
          setStrategyQuestion('')
          setSubmitStatus('idle')
        }}
        title="Ask a Strategy Question"
      >
        <form ref={strategyFormRef} onSubmit={handleStrategySubmit} className="space-y-4">
          <div>
            <label htmlFor="nuvama-code" className="block text-sm font-medium text-foreground mb-2">
              Account ID
            </label>
            <select
              id="nuvama-code"
              name="nuvama-code"
              className="w-full p-3 border border-border rounded-md bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-primary"
              defaultValue={selectedClientCode}
              required
            >
              {clients.map((client) => (
                <option key={client.clientid} value={client.clientcode}>
                  {client.clientname} - ({client.clientcode})
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              Currently selected: {selectedClientCode}
            </p>
          </div>
          <div>
            <label htmlFor="strategy-question" className="block text-sm font-medium text-foreground mb-2">
              Your Question
            </label>
            <textarea
              id="strategy-question"
              name="strategy-question"
              rows={4}
              value={strategyQuestion}
              onChange={(e) => setStrategyQuestion(e.target.value)}
              className="w-full p-3 border border-border rounded-md bg-background text-foreground resize-none focus:ring-2 focus:ring-primary focus:border-primary"
              placeholder="Please describe your strategy-related question or concern..."
              required
            />
          </div>

          {/* Success Message */}
          {submitStatus === 'success' && (
            <div className="p-3 bg-green-100 border border-green-400 text-green-700 rounded text-sm">
              Your strategy question has been sent successfully! Thank you for your input. We Will get back to you soon.
            </div>
          )}

          {/* Error Message */}
          {submitStatus === 'error' && (
            <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded text-sm">
              Failed to send your question. Please try again or contact us directly.
            </div>
          )}

          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={() => {
                setIsStrategyModalOpen(false)
                setStrategyQuestion('')
                setSubmitStatus('idle')
              }}
              className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !strategyQuestion.trim()}
              className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Sending...' : 'Submit Question'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Discussion Topic Modal */}
      <Modal
        isOpen={isDiscussionModalOpen}
        onClose={() => {
          setIsDiscussionModalOpen(false)
          setDiscussionTopic('')
          setSubmitStatus('idle')
        }}
        title="What Would You Like to Discuss?"
      >
        <form ref={discussionFormRef} onSubmit={handleDiscussionSubmit} className="space-y-4">
          <div>
            <label htmlFor="nuvama-code" className="block text-sm font-medium text-foreground mb-2">
              Account ID
            </label>
            <select
              id="nuvama-code"
              name="nuvama-code"
              className="w-full p-3 border border-border rounded-md bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-primary"
              defaultValue={selectedClientCode}
              required
            >
              {clients.map((client) => (
                <option key={client.clientid} value={client.clientcode}>
                  {client.clientname} - ({client.clientcode})
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              Currently selected: {selectedClientCode}
            </p>
          </div>
          <div>
            <label htmlFor="discussion-topic" className="block text-sm font-medium text-foreground mb-2">
              Discussion Topic
            </label>
            <textarea
              id="discussion-topic"
              name="discussion-topic"
              rows={4}
              value={discussionTopic}
              onChange={(e) => setDiscussionTopic(e.target.value)}
              className="w-full p-3 border border-border rounded-md bg-background text-foreground resize-none focus:ring-2 focus:ring-primary focus:border-primary"
              placeholder="Please describe what you'd like to discuss during the call..."
              required
            />
          </div>

          {/* Success Message */}
          {submitStatus === 'success' && (
            <div className="p-3 bg-green-100 border border-green-400 text-green-700 rounded text-sm">
              Your discussion topic has been sent successfully! Thank you for your input. We Will get back to you soon.
            </div>
          )}

          {/* Error Message */}
          {submitStatus === 'error' && (
            <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded text-sm">
              Failed to send your topic. Please try again or contact us directly.
            </div>
          )}

          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={() => {
                setIsDiscussionModalOpen(false)
                setDiscussionTopic('')
                setSubmitStatus('idle')
              }}
              className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !discussionTopic.trim()}
              className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Sending...' : 'Submit Topic'}
            </button>
          </div>
        </form>
      </Modal>
    </main>
  )
}