"use client"

import * as React from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { useClient } from "@/contexts/ClientContext"

type Props = {
  triggerLabel?: string
  nuvamaCode?: string
  selectedClientId?: string // Added to align with other modals
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

export function TestimonialDialog({ 
  triggerLabel = "Open Testimonial Form", 
}: Props) {
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
      story: form.get("story")?.toString().trim() || "", // Trim to remove trailing spaces
      nuvamaCode: selectedClientCode,
    }

    // Validate required fields
    if (!formData.story || !formData.nuvamaCode) {
      toast({
        title: "Error",
        description: "Please provide your testimonial story and Account ID.",
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
            <h1 style="margin: 0;">Investor Testimonial</h1>
          </div>
          <div class="content">
            <p><strong>Request Type:</strong> Testimonial Submission</p>
            <p><strong>Submitted via:</strong> myQode Portal</p>
            <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
            <div class="info-box">
              <h3 style="margin-top: 0;">Testimonial Details:</h3>
              <p><strong>Account ID:</strong> ${formData.nuvamaCode}</p>
              <p><strong>Client ID:</strong> ${selectedClientId}</p>
              <p><strong>User Email:</strong> ${userEmail}</p>
              <p><strong>Your testimonial story:</strong> ${formData.story.replace(/\n/g, '<br>')}</p>
            </div>
            <p style="margin-top: 20px; font-size: 14px; color: #37584F;">
              This message was sent from the myQode Portal. Please review the testimonial.
            </p>
          </div>
        </div>
      </body>
      </html>
    `

    sendEmail({
      to: 'investor.relations@qodeinvest.com',
      subject: `New Testimonial Submission from ${formData.nuvamaCode}`,
      html: emailHtml,
      from: 'investor.relations@qodeinvest.com',
      fromName: 'Qode Investor Relations',
      inquiry_type: 'testimonial',
      nuvama_code: formData.nuvamaCode,
      client_id: selectedClientId,
      user_email: userEmail,
      priority: 'normal',
      inquirySpecificData: {
        "Your testimonial story": formData.story,
      },
    })
      .then(() => {
        setSubmitStatus('success')
        toast({
          title: "Thank you!",
          description: "Your testimonial has been received.",
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
        console.error('Testimonial submission error:', error)
        setSubmitStatus('error')
        toast({
          title: "Error",
          description: "Failed to send testimonial. Please try again or contact us directly.",
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
          <DialogTitle className="text-lg font-semibold">Share Your Qode Experience</DialogTitle>
        </DialogHeader>
        <form ref={formRef} className="space-y-4" onSubmit={onSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="story">Your testimonial story</Label>
            <Textarea id="story" name="story" rows={14} placeholder="Tell us about your journey with Qode..." required />
          </div>
          {submitStatus === 'success' && (
            <div className="p-3 bg-green-100 border border-green-400 text-green-700 rounded text-sm">
              Your testimonial has been sent successfully! Thank you for your input.
            </div>
          )}
          {submitStatus === 'error' && (
            <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded text-sm">
              Failed to send testimonial. Please try again or contact us directly.
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
              {isSubmitting ? 'Submitting...' : 'Submit Testimonial'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}