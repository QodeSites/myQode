'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/use-toast'
import { CheckCircle, AlertCircle, Mail, Loader2 as Loader, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface PaymentDetails {
  success: boolean
  payment: {
    order_id: string
    nuvama_code: string
    amount: number
    payment_type: string
    client_id: string
    is_new_strategy?: boolean
    frequency?: string
    start_date?: string
    end_date?: string
    cf_subscription_id?: string
    requested_strategy?: string
  }
  error?: string
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
    console.log("🚀 sendEmail function called with data:", {
      to: emailData.to,
      subject: emailData.subject,
      inquiry_type: emailData.inquiry_type,
      nuvama_code: emailData.nuvama_code,
      htmlLength: emailData.html?.length,
      timestamp: new Date().toISOString()
    })

    const response = await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(emailData),
    })

    const contentType = response.headers.get("content-type")
    if (!response.ok) {
      const errorText = await response.text()
      console.error("API response not OK:", {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
      })
      throw new Error(`Failed to send email: ${response.status} ${response.statusText}`)
    }

    if (contentType && contentType.includes("application/json")) {
      const data = await response.json()
      return data
    } else {
      console.warn("API response is not JSON:", await response.text())
      return { success: true }
    }
  } catch (error) {
    console.error("Email sending failed:", error)
    throw error
  }
}

export default function PaymentSuccessPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { toast } = useToast()
  const [emailStatus, setEmailStatus] = useState('sending')
  const [paymentDetails, setPaymentDetails] = useState<PaymentDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const orderIdFromUrl = searchParams.get('order_id')
  const statusFromUrl = searchParams.get('status')

  useEffect(() => {
    handlePaymentSuccess()
  }, [])

  const handlePaymentSuccess = async () => {
    try {
      let orderId = orderIdFromUrl
      
      if (!orderId) {
        orderId = sessionStorage.getItem('qode_payment_order_id')
        console.log('Order ID from session storage:', orderId)
      }

      if (!orderId) {
        console.error('No order ID found in URL or session storage')
        setError('No order ID found')
        setEmailStatus('failed')
        setLoading(false)
        toast({
          title: 'Error',
          description: 'No order ID provided. Please try again.',
          variant: 'destructive',
        })
        return
      }

      console.log('Processing payment success for order ID:', orderId)

      const response = await fetch(`/api/cashfree/payment-details?order_id=${orderId}`)
      const data = await response.json()

      console.log('Payment details API response:', data)

      if (!data.success) {
        throw new Error('Failed to fetch payment details: ' + (data.error || 'Unknown error'))
      }

      setPaymentDetails(data)
      await sendPaymentSuccessEmail(data.payment)
      setEmailStatus('sent')
      setLoading(false)

      toast({
        title: 'Payment Successful',
        description: data.payment.payment_type === 'sip' || data.payment.frequency 
          ? 'Your Systematic Investment Plan has been successfully authorized.'
          : data.payment.is_new_strategy 
          ? 'Your new strategy investment request has been submitted successfully.'
          : 'Your payment has been processed successfully.',
      })

      sessionStorage.removeItem('qode_payment_order_id')
      sessionStorage.removeItem('qode_payment_cf_order_id')
      sessionStorage.removeItem('qode_payment_type')
      sessionStorage.removeItem('qode_payment_amount')
      sessionStorage.removeItem('qode_payment_nuvama_code')

    } catch (error) {
      console.error('Error handling payment success:', error)
      setError(error instanceof Error ? error.message : 'An unexpected error occurred')
      setEmailStatus('failed')
      setLoading(false)
      toast({
        title: 'Error',
        description: 'Failed to process payment. Please try again or contact support.',
        variant: 'destructive',
      })
    }
  }

 const sendPaymentSuccessEmail = async (details) => {
  try {
    const strategy = {
      'QFH': 'Qode Future Horizons',
      'QAW': 'Qode All Weather', 
      'QTF': 'Qode Tactical Fund',
      'QGF': 'Qode Growth Fund'
    }

    const getStrategyName = (strategyCode) => {
      if (strategyCode) {
        const prefix = strategyCode.substring(0, 3).toUpperCase()
        return strategy[prefix] || strategyCode
      }
      // For new strategies, try to get from strategy_type, requested_strategy, or account code
      if (details.strategy_type) {
        return strategy[details.strategy_type] || details.strategy_type
      }
      if (details.requested_strategy) {
        return strategy[details.requested_strategy] || details.requested_strategy
      }
      const prefix = details.nuvama_code.substring(0, 3).toUpperCase()
      return strategy[prefix] || 'Unknown Strategy'
    }

    // FIXED: Check payment_type first, then fallback to is_new_strategy
    const isNewStrategy = details.payment_type === 'NEW_STRATEGY' || 
                          details.payment_type === 'new_strategy' ||
                          details.is_new_strategy === true
    
    const isSip = details.payment_type === 'sip' || details.frequency

    let emailHtml = ''

    if (isNewStrategy) {
      // NEW STRATEGY EMAIL TEMPLATE
      const requestedStrategyName = getStrategyName(details.strategy_type || details.requested_strategy)
      
      emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
          <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #8B4513; margin: 0; font-size: 28px;">New Strategy Investment</h1>
              <div style="width: 50px; height: 3px; background-color: #D4AF37; margin: 10px auto;"></div>
            </div>
            
            <div style="background-color: #e8f5e8; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h2 style="color: #2e7d32; margin: 0 0 15px 0; font-size: 20px;">
                🎉 New Strategy Investment Request Received!
              </h2>
              <p style="color: #2e7d32; margin: 0; font-size: 16px;">
                A client has successfully submitted a payment for a new strategy investment. Account setup required.
              </p>
            </div>

            <div style="background-color: #F5F5DC; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h3 style="color: #8B4513; margin: 0 0 15px 0; font-size: 18px;">Investment Request Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Requesting Client Account:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd; text-align: right;">${details.nuvama_code}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Client ID:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd; text-align: right;">${details.client_id}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Requested Strategy:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd; text-align: right;">${requestedStrategyName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Investment Amount:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd; text-align: right; color: #4CAF50; font-size: 18px;"><strong>₹${details.amount}</strong></td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Payment ID:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd; text-align: right;">${details.order_id}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><strong>Request Date:</strong></td>
                  <td style="padding: 8px 0; text-align: right;">${new Date().toLocaleDateString()}</td>
                </tr>
              </table>
            </div>

            <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; margin-bottom: 25px; border-left: 4px solid #ffc107;">
              <h3 style="color: #856404; margin: 0 0 10px 0; font-size: 16px;">⚠️ Action Required</h3>
              <ul style="color: #856404; margin: 0; padding-left: 20px; font-size: 14px;">
                <li>Create new account ID for this client and strategy</li>
                <li>Process the investment allocation</li>
                <li>Send account confirmation to client</li>
                <li>Update client records with new strategy details</li>
              </ul>
            </div>

            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
              <p style="color: #666; margin: 0 0 10px 0; font-size: 14px;">
                Payment confirmed and funds received. Please process account setup.
              </p>
              <p style="color: #8B4513; margin: 0; font-size: 16px;">
                📧 <a href="mailto:support@qodeinvest.com" style="color: #8B4513; text-decoration: none;">support@qodeinvest.com</a>
              </p>
            </div>
          </div>
        </div>
      `
    } else {
      // EXISTING ACCOUNT EMAIL TEMPLATE (ONE-TIME PAYMENT)
      const strategyName = getStrategyName(details.nuvama_code)
      
      emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
          <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #8B4513; margin: 0; font-size: 28px;">Payment Successful</h1>
              <div style="width: 50px; height: 3px; background-color: #D4AF37; margin: 10px auto;"></div>
            </div>
            
            <div style="background-color: #e8f5e8; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h2 style="color: #2e7d32; margin: 0 0 15px 0; font-size: 20px;">
                ✅ Payment Completed!
              </h2>
              <p style="color: #2e7d32; margin: 0; font-size: 16px;">
                Your payment has been processed successfully.
              </p>
            </div>

            <div style="background-color: #F5F5DC; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h3 style="color: #8B4513; margin: 0 0 15px 0; font-size: 18px;">Payment Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Account ID:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd; text-align: right;">${details.nuvama_code}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Strategy:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd; text-align: right;">${strategyName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Amount:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd; text-align: right; color: #4CAF50; font-size: 18px;"><strong>₹${details.amount}</strong></td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Investment Type:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd; text-align: right;">One-time Payment</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Transaction ID:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd; text-align: right;">${details.order_id}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><strong>Date:</strong></td>
                  <td style="padding: 8px 0; text-align: right;">${new Date().toLocaleDateString()}</td>
                </tr>
              </table>
            </div>

            <div style="background-color: #e3f2fd; padding: 15px; border-radius: 8px; margin-bottom: 25px; border: 1px solid #2196F3;">
              <p style="color: #1976d2; margin: 0; font-size: 14px;">
                <strong>✅ Confirmation:</strong> This payment has been successfully processed and confirmed by our payment gateway.
              </p>
            </div>

            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
              <p style="color: #666; margin: 0 0 10px 0; font-size: 14px;">
                Questions about your investment? Contact our team:
              </p>
              <p style="color: #8B4513; margin: 0; font-size: 16px;">
                📧 <a href="mailto:support@qodeinvest.com" style="color: #8B4513; text-decoration: none;">support@qodeinvest.com</a>
              </p>
            </div>
          </div>
        </div>
      `
    }

    const emailSubject = isNewStrategy 
      ? `New Strategy Investment Request - ₹${details.amount} | Client: ${details.client_id}`
      : `Payment Completed - ₹${details.amount} | Account: ${details.nuvama_code}`

    console.log('Sending payment notification to Qode Investor Relations:', {
      to: 'investor.relations@qodeinvest.com',
      subject: emailSubject,
      inquiry_type: isNewStrategy ? "new_strategy_payment_success" : "payment_success",
      nuvama_code: details.nuvama_code,
      client_id: details.client_id,
    })

    const emailPayload = {
      to: 'investor.relations@qodeinvest.com',
      subject: emailSubject,
      html: emailHtml,
      inquiry_type: isNewStrategy ? "new_strategy_payment_success" : "payment_success",
      client_id: details.client_id,
      user_email: "investor.relations@qodeinvest.com",
      priority: "high",
      from: "investor.relations@qodeinvest.com",
      fromName: "Qode Investor Relations",
      payment_amount: details.amount,
      investment_type: isNewStrategy ? "new_strategy" : "one_time",
      transaction_id: details.order_id,
      payment_status: "success",
      nuvama_code: details.nuvama_code
    }

    // Add strategy-specific fields for new strategies
    if (isNewStrategy) {
      emailPayload.requested_strategy = details.strategy_type || details.requested_strategy
      emailPayload.requesting_client_id = details.client_id
      emailPayload.action_required = "account_setup"
    }

    const result = await sendEmail(emailPayload)

    console.log('Payment notification sent successfully:', result)
    return result
  } catch (error) {
    console.error('Error sending payment notification:', error)
    throw error
  }
}

  const renderStatusIcon = (status: string) => {
    switch (status) {
      case 'SUCCESS':
        return <CheckCircle className="w-6 h-6 text-primary" />
      case 'PENDING':
        return <AlertCircle className="w-6 h-6 text-yellow-500" />
      default:
        return <XCircle className="w-6 h-6 text-red-500" />
    }
  }

  const getStrategyName = (accountCode: string) => {
    const strategy = {
      'QFH': 'Qode Future Horizons',
      'QAW': 'Qode All Weather',
      'QTF': 'Qode Tactical Fund',
      'QGF': 'Qode Growth Fund'
    }
    const prefix = accountCode?.substring(0, 3).toUpperCase()
    return strategy[prefix] || 'Unknown Strategy'
  }

  const isNewStrategy = paymentDetails?.payment.is_new_strategy === true || 
                       paymentDetails?.payment.payment_type === 'new_strategy'

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-background space-y-6 p-4 sm:p-6">
      <header className="mb-2">
        <div className="flex flex-col items-center sm:flex-row sm:justify-between sm:items-end">
          <div>
            <h1 className="text-pretty text-xl font-bold text-foreground flex items-center gap-2">
              {statusFromUrl && renderStatusIcon(statusFromUrl)}
              {paymentDetails?.payment.payment_type === 'sip' || paymentDetails?.payment.frequency 
                ? 'Systematic Investment Plan Status' 
                : isNewStrategy
                ? 'New Strategy Investment Status'
                : 'Payment Status'}
            </h1>
            <p className="text-sm text-muted-foreground max-w-md">
              Review the details of your {paymentDetails?.payment.payment_type === 'sip' || paymentDetails?.payment.frequency 
                ? 'SIP setup' 
                : isNewStrategy
                ? 'new strategy investment request'
                : 'payment'}. For any issues, contact{' '}
              <a href="mailto:investor.relations@qodeinvest.com" className="text-primary hover:underline">
                investor.relations@qodeinvest.com
              </a>.
              {orderIdFromUrl && (
                <span className="ml-2 font-medium text-primary">Transaction ID: {orderIdFromUrl}</span>
              )}
            </p>
          </div>
        </div>
      </header>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-8">
          <Loader className="h-8 w-8 animate-spin text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">Verifying payment status...</p>
        </div>
      ) : error || (statusFromUrl && statusFromUrl !== 'SUCCESS') ? (
        <div className="flex flex-col items-center justify-center py-8">
          <XCircle className="h-12 w-12 text-red-500" />
          <h2 className="mt-4 text-lg font-bold text-foreground">Payment Error</h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-md text-center">
            {error || 'Your payment could not be processed. Please try again.'}
          </p>
          <Button
            onClick={() => router.push('/dashboard')}
            className="mt-6 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
          >
            Back to Dashboard
          </Button>
        </div>
      ) : paymentDetails ? (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-md border border-border bg-card p-6">
            <div className="flex items-center gap-2 mb-4">
              {renderStatusIcon('SUCCESS')}
              <h2 className="text-lg font-bold text-foreground">
                {paymentDetails.payment.payment_type === 'sip' || paymentDetails.payment.frequency 
                  ? 'SIP Overview' 
                  : isNewStrategy
                  ? 'Investment Request Overview'
                  : 'Payment Overview'}
              </h2>
            </div>
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <span className="mt-1 text-primary" aria-hidden="true">•</span>
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold">Status:</span> {statusFromUrl || 'SUCCESS'}
                </p>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-1 text-primary" aria-hidden="true">•</span>
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold">Transaction ID:</span> {paymentDetails.payment.order_id}
                </p>
              </div>
              {!isNewStrategy && (
                <div className="flex items-start gap-2">
                  <span className="mt-1 text-primary" aria-hidden="true">•</span>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-semibold">Account ID:</span> {paymentDetails.payment.nuvama_code}
                  </p>
                </div>
              )}
              {isNewStrategy && (
                <div className="flex items-start gap-2">
                  <span className="mt-1 text-primary" aria-hidden="true">•</span>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-semibold">Client ID:</span> {paymentDetails.payment.client_id}
                  </p>
                </div>
              )}
              <div className="flex items-start gap-2">
                <span className="mt-1 text-primary" aria-hidden="true">•</span>
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold">Amount:</span> ₹{paymentDetails.payment.amount}
                </p>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-1 text-primary" aria-hidden="true">•</span>
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold">{isNewStrategy ? 'Requested Strategy' : 'Strategy'}:</span> {
                    isNewStrategy 
                      ? getStrategyName(paymentDetails.payment.requested_strategy || paymentDetails.payment.nuvama_code)
                      : getStrategyName(paymentDetails.payment.nuvama_code)
                  }
                </p>
              </div>
              {isNewStrategy && (
                <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mt-3">
                  <p className="text-sm text-yellow-800">
                    <span className="font-semibold">Note:</span> Your account ID will be generated and shared with you once the setup is complete.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-md border border-border bg-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <Mail className="w-6 h-6 text-primary" />
              <h2 className="text-lg font-bold text-foreground">Confirmation Status</h2>
            </div>
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <span className="mt-1 text-primary" aria-hidden="true">•</span>
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold">Email Status:</span>{' '}
                  {emailStatus === 'sending' && 'Sending confirmation email...'}
                  {emailStatus === 'sent' && 'Confirmation email sent successfully!'}
                  {emailStatus === 'failed' && 'Email sending failed, but payment was successful.'}
                </p>
              </div>
              {(paymentDetails.payment.payment_type === 'sip' || paymentDetails.payment.frequency) && (
                <>
                  <div className="flex items-start gap-2">
                    <span className="mt-1 text-primary" aria-hidden="true">•</span>
                    <p className="text-sm text-muted-foreground">
                      <span className="font-semibold">SIP Type:</span> SIP - {paymentDetails.payment.frequency}
                    </p>
                  </div>
                  {paymentDetails.payment.start_date && (
                    <div className="flex items-start gap-2">
                      <span className="mt-1 text-primary" aria-hidden="true">•</span>
                      <p className="text-sm text-muted-foreground">
                        <span className="font-semibold">Start Date:</span>{' '}
                        {new Date(paymentDetails.payment.start_date).toLocaleDateString()}
                      </p>
                    </div>
                  )}
                  {paymentDetails.payment.end_date && (
                    <div className="flex items-start gap-2">
                      <span className="mt-1 text-primary" aria-hidden="true">•</span>
                      <p className="text-sm text-muted-foreground">
                        <span className="font-semibold">End Date:</span>{' '}
                        {new Date(paymentDetails.payment.end_date).toLocaleDateString()}
                      </p>
                    </div>
                  )}
                  {paymentDetails.payment.cf_subscription_id && (
                    <div className="flex items-start gap-2">
                      <span className="mt-1 text-primary" aria-hidden="true">•</span>
                      <p className="text-sm text-muted-foreground">
                        <span className="font-semibold">Subscription ID:</span>{' '}
                        {paymentDetails.payment.cf_subscription_id}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex justify-center mt-6">
            <Button
              onClick={() => router.push('/dashboard')}
              className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
            >
              Back to Dashboard
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-8">
          <AlertCircle className="h-12 w-12 text-yellow-500" />
          <h2 className="mt-4 text-lg font-bold text-foreground">No Payment Details</h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-md text-center">
            No payment details available. Please try again or contact{' '}
            <a href="mailto:support@qodeinvest.com" className="text-primary hover:underline">
              support@qodeinvest.com
            </a>.
          </p>
          <Button
            onClick={() => router.push('/dashboard')}
            className="mt-6 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
          >
            Back to Dashboard
          </Button>
        </div>
      )}
    </main>
  )
}