"use client"
import { Button } from "@/components/ui/button"
import type React from "react"
import { useState, useRef, useEffect } from "react"
import { X } from "lucide-react"
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

function CTA({
  children,
  href = "#",
  ariaLabel = "Refer an Investor",
}: {
  children: React.ReactNode
  href?: string
  ariaLabel?: string
}) {
  return (
    <div className="flex justify-center">
      <a
        href={href}
        aria-label={ariaLabel}
        className="inline-flex min-w-64 items-center justify-center rounded-md border border-border bg-secondary px-8 py-6 text-center text-base font-semibold text-primary"
      >
        {children}
      </a>
    </div>
  )
}

async function sendEmail(emailData: {
  to: string
  subject: string
  html: string
  from?: string
  fromName?: string
  inquiry_type?: string
  nuvama_code?: string
  client_id?: string
  user_email?: string
  priority?: string
  [key: string]: any
}) {
  try {
    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailData),
    })

    const contentType = response.headers.get('content-type')
    if (!response.ok) {
      const errorText = await response.text()
      console.error('API response not OK:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
      })
      throw new Error(`Failed to send email: ${response.status} ${response.statusText}`)
    }

    if (contentType && contentType.includes('application/json')) {
      const data = await response.json()
      console.log('API response data:', data)
      return data
    } else {
      console.warn('API response is not JSON:', await response.text())
      return { success: true }
    }
  } catch (error) {
    console.error('Email sending failed:', error)
    throw error
  }
}

export default function ReferAnInvestorPage() {
  const [isReferralModalOpen, setIsReferralModalOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const { toast } = useToast()
  const { selectedClientCode, selectedClientId, clients, loading } = useClient()
  const formRef = useRef<HTMLFormElement>(null)
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    nuvamaCode: selectedClientCode || 'QAW0001',
  })

  // Update formData when selectedClientCode changes
  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      nuvamaCode: selectedClientCode || 'QAW0001',
    }))
  }, [selectedClientCode])

  // Show loading state if context is still loading
  if (loading) {
    return (
      <main className="w-full max-w-4xl space-y-6 p-4 md:p-6">
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
      <main className="w-full max-w-4xl space-y-6 p-4 md:p-6">
        <header className="space-y-2">
          <h1 className="text-pretty text-xl font-bold text-foreground">
            Refer an Investor
          </h1>
          <p className="text-sm text-muted-foreground">
            No client accounts found. Please contact support.
          </p>
        </header>
      </main>
    )
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const formDataSubmit = {
      name: (form.get("referral-name")?.toString() || formData.name).trim(),
      email: (form.get("referral-email")?.toString() || formData.email).trim(),
      phone: (form.get("referral-phone")?.toString() || formData.phone).trim(),
      nuvamaCode: (form.get("nuvama-code")?.toString() || formData.nuvamaCode).trim(),
    }

    // Validate required fields
    if (!formDataSubmit.name || !formDataSubmit.email || !formDataSubmit.phone || !formDataSubmit.nuvamaCode) {
      toast({
        title: "Error",
        description: "Please fill in all required fields, including Name, Email, Phone, and Account ID.",
        variant: "destructive",
      })
      return
    }

    setIsSubmitting(true)
    setSubmitStatus('idle')

    const userEmail = "user@example.com" // Placeholder: Replace with session-based email retrieval

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
          .info-box { background: #EFECD3; padding: 15px; border-left: 4px solid #DABD38; margin: 15px 0; }
          h1 { font-family: 'Playfair Display', Georgia, serif; color: #DABD38; }
          h3 { font-family: 'Playfair Display', Georgia, serif; color: #37584F; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">Investor Referral</h1>
          </div>
          <div class="content">
            <p><strong>Request Type:</strong> Referral Submission</p>
            <p><strong>Submitted via:</strong> Qode Investor Portal</p>
            <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
            <div class="info-box">
              <h3 style="margin-top: 0;">Referral Details:</h3>
              <p><strong>Account ID:</strong> ${formDataSubmit.nuvamaCode}</p>
              <p><strong>Client ID:</strong> ${selectedClientId}</p>
              <p><strong>Referring User Email:</strong> ${userEmail}</p>
              <p><strong>Referred investor name:</strong> ${formDataSubmit.name}</p>
              <p><strong>Referred investor email:</strong> ${formDataSubmit.email}</p>
              <p><strong>Referred investor phone:</strong> ${formDataSubmit.phone}</p>
            </div>
            <p style="margin-top: 20px; font-size: 14px; color: #37584F;">
              This message was sent from the Qode investor portal. Please follow up with the referred investor.
            </p>
          </div>
        </div>
      </body>
      </html>
    `

    // Fixed: Use 'feedback' as inquiry_type (valid type) and properly structure the data
    const emailData = {
      to: 'sanket.shinde@qodeinvest.com',
      subject: `New Investor Referral from ${formDataSubmit.nuvamaCode}`,
      html: emailHtml,
      from: 'investor.relations@qodeinvest.com',
      fromName: 'Qode Investor Relations',
      inquiry_type: 'feedback', // Changed from 'referral' to 'feedback' (valid type)
      nuvama_code: formDataSubmit.nuvamaCode,
      client_id: selectedClientId,
      user_email: userEmail,
      priority: 'normal',
      // Fixed: Flatten the inquirySpecificData structure
      referral_type: 'investor_referral',
      referred_investor_name: formDataSubmit.name,
      referred_investor_email: formDataSubmit.email,
      referred_investor_phone: formDataSubmit.phone,
    }

    // Log request body for debugging
    console.log('Sending email with body:', JSON.stringify(emailData, null, 2))

    sendEmail(emailData)
      .then(() => {
        setSubmitStatus('success')
        toast({
          title: "Thank you!",
          description: "Your referral has been submitted successfully.",
        })
        setFormData({
          name: '',
          email: '',
          phone: '',
          nuvamaCode: selectedClientCode || 'QAW0001',
        })
        if (formRef.current) {
          formRef.current.reset()
        } else {
          console.warn('Referral form ref is null')
        }
        setTimeout(() => {
          setSubmitStatus('idle')
          setIsReferralModalOpen(false)
        }, 2000)
      })
      .catch((error) => {
        console.error('Referral submission error:', error)
        setSubmitStatus('error')
        toast({
          title: "Error",
          description: "Failed to send referral. Please try again or contact us directly.",
          variant: "destructive",
        })
      })
      .finally(() => {
        setIsSubmitting(false)
      })
  }

  return (
    <main className="space-y-10">
      <header className="space-y-2">
        <h1 className="text-pretty text-xl font-bold text-foreground flex items-center gap-2">
          Refer an Investor
        </h1>
        <p className="text-sm text-muted-foreground">
          Share the Qode experience. Earn rewards for helping us grow together. At Qode, we value the trust you place in
          us. If you know someone who would benefit from disciplined, evidence‑based investing, you can refer them to us
          and earn rewards once their investment begins.
          {selectedClientCode && (
            <span className="ml-2 text-primary font-medium">
              Current Account: {selectedClientCode}
            </span>
          )}
        </p>
      </header>

      <section className="rounded-md border border-border bg-card p-4">
        <h2 className="mb-3 text-center text-sm font-bold text-foreground">Program Details</h2>
        <div className="text-sm leading-relaxed text-card-foreground space-y-2">
          <p>
            <strong>Reward:</strong> ₹15,000 for every ₹50 lakh of fresh investments referred.
          </p>
          <p>
            <strong>Example:</strong> Referral of ₹1 Cr = ₹30,000 reward.
          </p>
          <p>
            <strong>Eligibility:</strong> Reward applicable once the referred investor's funds are deployed.
          </p>
          <p>
            <strong>Payout Timeline:</strong> Processed within <strong>30 days</strong> of investment confirmation.
          </p>
          <p>
            <strong>Tax:</strong> Subject to TDS as per applicable law.
          </p>
        </div>

        <div className="mt-3 flex justify-center">
          <Button
            variant="outline"
            className="bg-primary text-white hover:opacity-90"
            onClick={() => setIsReferralModalOpen(true)}
          >
            Submit Referral
          </Button>
        </div>
      </section>

      <Modal
        isOpen={isReferralModalOpen}
        onClose={() => {
          setIsReferralModalOpen(false)
          setFormData({
            name: '',
            email: '',
            phone: '',
            nuvamaCode: selectedClientCode || 'QAW0001',
          })
          setSubmitStatus('idle')
        }}
        title="Refer an Investor"
      >
        <form ref={formRef} className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="nuvama-code" className="block text-sm font-medium text-foreground mb-2">
              Account ID *
            </label>
            <select
              id="nuvama-code"
              name="nuvama-code"
              value={formData.nuvamaCode}
              onChange={(e) => setFormData({ ...formData, nuvamaCode: e.target.value })}
              className="w-full p-3 border border-border rounded-md bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-primary"
              required
            >
              {clients.map((client) => (
                <option key={client.clientid} value={client.clientcode}>
                  {client.clientcode} ({client.clientid})
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              Currently selected: {formData.nuvamaCode}
            </p>
          </div>
          <div>
            <label htmlFor="referral-name" className="block text-sm font-medium text-foreground mb-2">
              Referred investor name *
            </label>
            <input
              id="referral-name"
              name="referral-name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full p-3 border border-border rounded-md bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-primary"
              placeholder="Enter full name..."
              required
            />
          </div>
          <div>
            <label htmlFor="referral-email" className="block text-sm font-medium text-foreground mb-2">
              Referred investor email *
            </label>
            <input
              id="referral-email"
              name="referral-email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full p-3 border border-border rounded-md bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-primary"
              placeholder="Enter email address..."
              required
            />
          </div>
          <div>
            <label htmlFor="referral-phone" className="block text-sm font-medium text-foreground mb-2">
              Referred investor phone *
            </label>
            <input
              id="referral-phone"
              name="referral-phone"
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full p-3 border border-border rounded-md bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-primary"
              placeholder="Enter phone number..."
              required
            />
          </div>
          {submitStatus === 'success' && (
            <div className="p-3 bg-green-100 border border-green-400 text-green-700 rounded text-sm">
              Your referral has been sent successfully! Thank you for your input.
            </div>
          )}
          {submitStatus === 'error' && (
            <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded text-sm">
              Failed to send referral. Please try again or contact us directly.
            </div>
          )}
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={() => {
                setIsReferralModalOpen(false)
                setFormData({
                  name: '',
                  email: '',
                  phone: '',
                  nuvamaCode: selectedClientCode || 'QAW0001',
                })
                setSubmitStatus('idle')
                if (formRef.current) {
                  formRef.current.reset()
                }
              }}
              className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isSubmitting || !formData.name || !formData.email || !formData.phone || !formData.nuvamaCode}
            >
              {isSubmitting ? 'Submitting...' : 'Submit Referral'}
            </button>
          </div>
        </form>
      </Modal>
    </main>
  )
}