"use client"

import * as React from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useToast } from "@/hooks/use-toast"
import { useClient } from "@/contexts/ClientContext"

type FeedbackDialogProps = {
  triggerLabel?: string
  nuvamaCode?: string
  selectedClientId?: string
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

export function FeedbackDialog({ 
  triggerLabel = "Open Feedback Form"
}: FeedbackDialogProps) {
  const [open, setOpen] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [submitStatus, setSubmitStatus] = React.useState<'idle' | 'success' | 'error'>('idle')
  const { toast } = useToast()
  const formRef = React.useRef<HTMLFormElement>(null)
  const { selectedClientCode, selectedClientId, clients, loading ,selectedEmailClient} = useClient()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const formData = {
      nps: form.get("nps")?.toString() || "",
      satisfaction: form.get("satisfaction")?.toString() || "",
      clarity: form.get("clarity")?.toString() || "",
      ease: form.get("ease")?.toString() || "",
      improve: form.get("improve")?.toString().trim() || "", // Trim to remove trailing spaces
      nuvamaCode: selectedClientCode,
    }

    // Validate required fields
    if (!formData.nps || !formData.satisfaction || !formData.clarity || !formData.ease || !formData.nuvamaCode) {
      toast({
        title: "Error",
        description: "Please fill in all required fields including Account ID.",
        variant: "destructive",
      })
      return
    }

    setIsSubmitting(true)
    setSubmitStatus('idle')

    const userEmail = selectedEmailClient;

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
            <h1 style="margin: 0;">Investor Feedback</h1>
          </div>
          <div class="content">
            <p><strong>Request Type:</strong> Feedback Submission</p>
            <p><strong>Submitted via:</strong> myQode Portal</p>
            <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
            <div class="info-box">
              <h3 style="margin-top: 0;">Feedback Details:</h3>
              <p><strong>Account ID:</strong> ${formData.nuvamaCode}</p>
              <p><strong>Client ID:</strong> ${selectedClientId}</p>
              <p><strong>User Email:</strong> ${userEmail}</p>
              <p><strong>How likely are you to recommend Qode? (1-5):</strong> ${formData.nps}</p>
              <p><strong>Overall satisfaction with Qode? (1-5):</strong> ${formData.satisfaction}</p>
              <p><strong>Clarity/usefulness of portfolio updates & review calls? (1-5):</strong> ${formData.clarity}</p>
              <p><strong>Ease of key processes (onboarding, top-ups, withdrawals)? (1-5):</strong> ${formData.ease}</p>
              ${formData.improve ? `<p><strong>One thing we could do to improve your experience:</strong> ${formData.improve.replace(/\n/g, '<br>')}</p>` : ''}
            </div>
            <p style="margin-top: 20px; font-size: 14px; color: #37584F;">
              This message was sent from the myQode Portal. Please review the feedback.
            </p>
          </div>
        </div>
      </body>
      </html>
    `

    sendEmail({
      to: 'sanket.shinde@qodeinvest.com',
      subject: `New Feedback Submission from ${formData.nuvamaCode}`,
      html: emailHtml,
      from: 'investor.relations@qodeinvest.com',
      fromName: 'Qode Investor Relations',
      inquiry_type: 'feedback',
      nuvama_code: formData.nuvamaCode,
      client_id: selectedClientId,
      user_email: userEmail,
      priority: 'normal',
      inquirySpecificData: {
        "How likely are you to recommend Qode? (1-5)": formData.nps,
        "Overall satisfaction with Qode? (1-5)": formData.satisfaction,
        "Clarity/usefulness of portfolio updates & review calls? (1-5)": formData.clarity,
        "Ease of key processes (onboarding, top-ups, withdrawals)? (1-5)": formData.ease,
        "One thing we could do to improve your experience": formData.improve,
      },
    })
      .then(() => {
        setSubmitStatus('success')
        toast({
          title: "Thank you!",
          description: "Your feedback has been recorded.",
        })
        if (formRef.current) {
          formRef.current.reset()
        }
        setTimeout(() => {
          setSubmitStatus('idle')
          setOpen(false)
        }, 2000)
      })
      .catch((error) => {
        console.error('Feedback submission error:', error)
        setSubmitStatus('error')
        toast({
          title: "Error",
          description: "Failed to send feedback. Please try again or contact us directly.",
          variant: "destructive",
        })
      })
      .finally(() => {
        setIsSubmitting(false)
      })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="bg-primary text-white hover:opacity-90">
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Share Your Feedback</DialogTitle>
        </DialogHeader>

        <form ref={formRef} className="space-y-4" onSubmit={onSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="nps">How likely are you to recommend Qode? (1-5)</Label>
            <RadioGroup id="nps" name="nps" className="flex gap-4" required>
              {[1, 2, 3, 4, 5].map((n) => (
                <div key={n} className="flex items-center gap-2">
                  <RadioGroupItem value={String(n)} id={`nps-${n}`} />
                  <Label htmlFor={`nps-${n}`}>{n}</Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="satisfaction">Overall satisfaction with Qode? (1-5)</Label>
            <RadioGroup id="satisfaction" name="satisfaction" className="flex gap-4" required>
              {[1, 2, 3, 4, 5].map((n) => (
                <div key={n} className="flex items-center gap-2">
                  <RadioGroupItem value={String(n)} id={`sat-${n}`} />
                  <Label htmlFor={`sat-${n}`}>{n}</Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="clarity">Clarity/usefulness of portfolio updates & review calls? (1-5)</Label>
            <RadioGroup id="clarity" name="clarity" className="flex gap-4" required>
              {[1, 2, 3, 4, 5].map((n) => (
                <div key={n} className="flex items-center gap-2">
                  <RadioGroupItem value={String(n)} id={`clar-${n}`} />
                  <Label htmlFor={`clar-${n}`}>{n}</Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ease">Ease of key processes (onboarding, top-ups, withdrawals)? (1-5)</Label>
            <RadioGroup id="ease" name="ease" className="flex gap-4" required>
              {[1, 2, 3, 4, 5].map((n) => (
                <div key={n} className="flex items-center gap-2">
                  <RadioGroupItem value={String(n)} id={`ease-${n}`} />
                  <Label htmlFor={`ease-${n}`}>{n}</Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="improve">One thing we could do to improve your experience</Label>
            <Textarea id="improve" name="improve" rows={4} placeholder="Your suggestions..." className="resize-y" />
          </div>

          {submitStatus === 'success' && (
            <div className="p-3 bg-green-100 border border-green-400 text-green-700 rounded text-sm">
              Your feedback has been sent successfully! Thank you for your input.
            </div>
          )}
          {submitStatus === 'error' && (
            <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded text-sm">
              Failed to send feedback. Please try again or contact us directly.
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (formRef.current) {
                  formRef.current.reset()
                }
                setSubmitStatus('idle')
                setOpen(false)
              }}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-primary text-white hover:opacity-90"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Submitting...' : 'Submit Feedback'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}