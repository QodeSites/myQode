"use client";
import type React from "react";
import { useState, useRef, useEffect } from 'react';
import { X, IndianRupee, Lock, CreditCard, TrendingUp, CheckCircle, Calendar, Loader, Info } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useClient } from "@/contexts/ClientContext";

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-5 rounded-sm bg-primary px-4 py-2 text-center text-sm font-bold tracking-wide text-white">
      {children}
    </div>
  )
}

function InfoCard({
  title,
  children,
  action,
}: {
  title: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <h3 className="mb-2 text-center text-sm font-bold text-foreground whitespace-pre-line">
        {title}
      </h3>
      <div className="text-sm leading-relaxed text-card-foreground space-y-2 text-center">
        {children}
      </div>
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </section>
  )
}

async function sendEmail(emailData: {
  to: string;
  subject: string;
  html: string;
  from?: string;
  fromName?: string;
  inquiry_type?: string;
  nuvama_code?: string;
  client_id?: string;
  user_email?: string;
  priority?: string;
  [key: string]: any;
}) {
  try {
    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailData),
    });

    const contentType = response.headers.get('content-type');
    if (!response.ok) {
      const errorText = await response.text();
      console.error('API response not OK:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
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

function AddFundsModal({
  isOpen,
  onClose,
  selectedClientCode,
  selectedClientId,
  clients,
}: {
  isOpen: boolean
  onClose: () => void
  selectedClientCode: string
  selectedClientId: string
  clients: { clientid: string; clientcode: string }[]
}) {
  const [activeTab, setActiveTab] = useState<'oneTime' | 'sip'>('oneTime');
  const [showTooltip, setShowTooltip] = useState(false);
  const [loading, setLoading] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState('');
  const [accountDetails, setAccountDetails] = useState<{
    client_name: string;
    account_number_masked: string;
    ifsc_code: string;
  } | null>(null);
  const [formData, setFormData] = useState({
    nuvamaCode: selectedClientCode || 'QAW0001',
    amount: '',
  });
  const [sipData, setSipData] = useState({
    frequency: 'monthly',
    startDate: '',
    endDate: '',
    totalInstallments: '',
  });
  const [errors, setErrors] = useState({
    nuvamaCode: '',
    amount: '',
    startDate: '',
    endDate: '',
    totalInstallments: '',
  });
  const { toast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const SIP_ENABLED = false;

  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      nuvamaCode: selectedClientCode || 'QAW0001',
    }));
  }, [selectedClientCode]);

  useEffect(() => {
    if (formData.nuvamaCode) {
      setTimeout(() => {
        setAccountDetails({
          client_name: 'John Doe',
          account_number_masked: 'XXXX-XXXX-1234',
          ifsc_code: 'ABCD0001234',
        });
      }, 500);
    }
  }, [formData.nuvamaCode]);

  const getCurrentData = () => formData;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (['frequency', 'startDate', 'endDate', 'totalInstallments'].includes(name)) {
      setSipData((prev) => ({ ...prev, [name]: value }));
      validateField(name, value);
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
      validateField(name, value);
    }
  };

  const validateField = (name: string, value: string) => {
    setErrors((prev) => {
      const newErrors = { ...prev };
      if (name === 'nuvamaCode') {
        newErrors.nuvamaCode = value ? '' : 'Nuvama Code is required';
      } else if (name === 'amount') {
        newErrors.amount = !value
          ? 'Amount is required'
          : Number(value) < 100
            ? 'Amount must be at least ₹100'
            : '';
      } else if (name === 'startDate' && value) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        newErrors.startDate = new Date(value) < tomorrow ? 'Start date must be tomorrow or later' : '';
      } else if (name === 'endDate' && value && sipData.startDate) {
        newErrors.endDate = new Date(value) < new Date(sipData.startDate) ? 'End date must be after start date' : '';
      } else if (name === 'totalInstallments' && value) {
        newErrors.totalInstallments = Number(value) < 1 ? 'Total installments must be at least 1' : '';
      }
      return newErrors;
    });
  };

  const renderPaymentDetail = (label: string, value: string, color: string) => (
    <div>
      <p className={`text-[14px] font-semibold font-body text-${color}`}>{label}</p>
      <p className="text-[14px] font-body">{value}</p>
    </div>
  );

  const getTomorrowDate = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  };

  const handlePayment = async () => {
    if (!formData.nuvamaCode || !formData.amount) {
      toast({
        title: "Error",
        description: "Please fill in all required fields.",
        variant: "destructive",
      });
      return;
    }
    if (activeTab === 'sip' && (!sipData.startDate || (sipData.frequency === 'custom' && !sipData.totalInstallments))) {
      toast({
        title: "Error",
        description: "Please fill in all required SIP fields.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    setPaymentStatus('');

    // Simulate email notification for payment/SIP setup
    const userEmail = "user@example.com";
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
            <h1 style="margin: 0;">${activeTab === 'sip' ? 'SIP Setup Request' : 'Payment Request'}</h1>
          </div>
          <div class="content">
            <p><strong>Request Type:</strong> ${activeTab === 'sip' ? 'SIP Setup' : 'One-Time Payment'}</p>
            <p><strong>Submitted via:</strong> Qode Investor Portal</p>
            <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
            <div class="info-box">
              <h3 style="margin-top: 0;">Request Details:</h3>
              <p><strong>Nuvama Code:</strong> ${formData.nuvamaCode}</p>
              <p><strong>Client ID:</strong> ${selectedClientId}</p>
              <p><strong>User Email:</strong> ${userEmail}</p>
              <p><strong>Amount:</strong> ₹${formData.amount}</p>
              ${activeTab === 'sip' ? `
                <p><strong>Frequency:</strong> ${sipData.frequency}</p>
                <p><strong>Start Date:</strong> ${sipData.startDate ? new Date(sipData.startDate).toLocaleDateString() : 'N/A'}</p>
                ${sipData.endDate ? `<p><strong>End Date:</strong> ${new Date(sipData.endDate).toLocaleDateString()}</p>` : ''}
                ${sipData.totalInstallments ? `<p><strong>Total Installments:</strong> ${sipData.totalInstallments}</p>` : ''}
              ` : ''}
            </div>
            <p style="margin-top: 20px; font-size: 14px; color: #37584F;">
              This message was sent from the Qode investor portal. Please review and process the request.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    try {
      await sendEmail({
        to: 'sanket.shinde@qodeinvest.com',
        subject: `New ${activeTab === 'sip' ? 'SIP Setup' : 'Payment'} Request from ${formData.nuvamaCode}`,
        html: emailHtml,
        from: 'investor.relations@qodeinvest.com',
        fromName: 'Qode Investor Relations',
      });

      setPaymentStatus(activeTab === 'sip' ? 'SIP setup successfully!' : 'Payment processed successfully!');
      toast({
        title: "Success",
        description: activeTab === 'sip' ? 'Your SIP has been set up successfully.' : 'Your payment has been processed successfully.',
      });
      setFormData({
        nuvamaCode: selectedClientCode || 'QAW0001',
        amount: '',
      });
      setSipData({
        frequency: 'monthly',
        startDate: '',
        endDate: '',
        totalInstallments: '',
      });
      setErrors({
        nuvamaCode: '',
        amount: '',
        startDate: '',
        endDate: '',
        totalInstallments: '',
      });
      if (formRef.current) {
        formRef.current.reset();
      }
      setTimeout(() => {
        setPaymentStatus('');
        onClose();
      }, 2000);
    } catch (error) {
      console.error('Payment error:', error);
      setPaymentStatus('Failed to process payment. Please try again.');
      toast({
        title: "Error",
        description: "Failed to process payment. Please try again or contact support.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-card rounded-lg shadow-2xl overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-lg font-semibold text-foreground">Add Funds / Create SIP</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-muted rounded-md"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">
          <div className="text-center mb-[20px]">
            <div className="flex items-center justify-center mb-[10px]">
              <IndianRupee className="sm:w-[40px] sm:h-[40px] text-primary mr-[5px]" />
              <h1 className="sm:text-[28px] text-primary font-heading text-[24px]">Invest With Qode</h1>
            </div>
            <div className="flex items-center justify-center text-[14px] text-text-secondary">
              <Lock className="sm:w-[16px] sm:h-[16px] mr-[5px]" />
              <span className="font-body">Secure Payment Gateway Powered by Cashfree</span>
            </div>
          </div>

          <div className="bg-white rounded-t-lg shadow p-[15px] border-b">
            <div className="flex justify-center">
              <div className="flex bg-lightBeige rounded p-[3px]">
                <button
                  onClick={() => setActiveTab('oneTime')}
                  className={`px-[20px] py-[10px] text-[14px] font-semibold rounded transition-all font-body ${activeTab === 'oneTime'
                    ? 'bg-primary text-white shadow'
                    : 'text-brown hover:bg-beige'
                    }`}
                >
                  <div className="flex items-center">
                    <CreditCard className="w-[18px] h-[18px] mr-[5px]" />
                    One-Time Payment
                  </div>
                </button>
                <div
                  className="relative"
                  onMouseEnter={() => setShowTooltip(true)}
                  onMouseLeave={() => setShowTooltip(false)}
                >
                  <button
                    onClick={() => SIP_ENABLED && setActiveTab('sip')}
                    disabled={!SIP_ENABLED}
                    className={`px-[20px] py-[10px] text-[14px] font-semibold rounded transition-all font-body ${!SIP_ENABLED
                      ? 'text-darkGray bg-lightGray cursor-not-allowed opacity-60'
                      : activeTab === 'sip'
                        ? 'bg-primary text-white shadow'
                        : 'text-brown hover:bg-beige'
                      }`}
                  >
                    <div className="flex items-center">
                      <TrendingUp className="w-[18px] h-[18px] mr-[5px]" />
                      SIP Setup
                      {!SIP_ENABLED && (
                        <span className="ml-[8px] px-[8px] py-[2px] bg-beige text-brown text-[10px] rounded-full font-body">
                          Coming Soon
                        </span>
                      )}
                    </div>
                  </button>
                  {showTooltip && (
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-[8px] bg-brown text-white text-[12px] font-body px-[12px] py-[6px] rounded-lg shadow-lg z-10 whitespace-nowrap">
                      {SIP_ENABLED
                        ? 'Setup recurring investments'
                        : 'Coming soon'
                      }
                      <div className="absolute -top-[6px] left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-b-[6px] border-l-transparent border-r-transparent border-b-brown" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-b-lg shadow p-[20px]">
            <form ref={formRef} className="space-y-[15px]">
              <div className="p-[12px] rounded-lg shadow-sm border border-lightGray">
                <label className="block text-[16px] font-semibold text-text-secondary mb-[5px] font-body">Nuvama Code</label>
                <select
                  name="nuvamaCode"
                  value={formData.nuvamaCode}
                  onChange={handleInputChange}
                  className={`w-full p-[12px] border-2 rounded text-[14px] font-body ${errors.nuvamaCode ? 'border-brown' : 'border-lightGray focus:border-primary'} focus:outline-none transition-all`}
                  required
                >
                  {clients.length > 0 ? (
                    clients.map((client) => (
                      <option key={client.clientid} value={client.clientcode}>
                        {client.clientcode} ({client.clientid})
                      </option>
                    ))
                  ) : (
                    <option value="QAW0001">QAW0001 (Default)</option>
                  )}
                </select>
                <p className="text-xs text-muted-foreground mt-1">
                  Currently selected: {selectedClientCode || 'QAW0001'}
                </p>
                {errors.nuvamaCode && <p className="mt-[5px] text-[12px] text-brown font-body">{errors.nuvamaCode}</p>}
              </div>

              {accountDetails && (
                <div className="p-[12px] bg-lightBeige rounded-lg shadow-sm border-2 border-beige">
                  <div className="flex items-center mb-[10px]">
                    <CheckCircle className="w-[16px] h-[16px] text-primary mr-[5px]" />
                    <h3 className="text-[16px] font-semibold text-brown font-body">Verified Account Details</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-[10px] text-[14px]">
                    {renderPaymentDetail('Client Name', accountDetails.client_name, 'brown')}
                    {renderPaymentDetail('Account Number', accountDetails.account_number_masked, 'brown')}
                    {renderPaymentDetail('IFSC Code', accountDetails.ifsc_code, 'brown')}
                  </div>
                </div>
              )}

              <div className="p-[12px] rounded-lg shadow-sm border border-lightGray">
                <label className="block text-[16px] font-semibold text-text-secondary mb-[5px] font-body">
                  {activeTab === 'sip' ? 'SIP Amount (₹)' : 'Payment Amount (₹)'}
                </label>
                <input
                  type="number"
                  name="amount"
                  value={formData.amount}
                  onChange={handleInputChange}
                  min="100"
                  className={`w-full p-[12px] text-[14px] font-semibold border-2 rounded font-body ${errors.amount ? 'border-brown' : 'border-lightGray focus:border-primary'} focus:outline-none transition-all`}
                  placeholder="Enter amount (e.g., 1000.00)"
                  required
                />
                {errors.amount && <p className="mt-[5px] text-[12px] text-brown font-body">{errors.amount}</p>}
                <p className="mt-[5px] text-[12px] text-darkGray font-body">Minimum: ₹100</p>
              </div>

              {activeTab === 'sip' && (
                <>
                  <div className="p-[12px] rounded-lg shadow-sm border border-lightGray">
                    <label className="block text-[16px] font-semibold text-text-secondary mb-[5px] font-body">Frequency</label>
                    <select
                      name="frequency"
                      value={sipData.frequency}
                      onChange={handleInputChange}
                      className="w-full p-[12px] border-2 border-lightGray focus:border-primary rounded text-[14px] focus:outline-none font-body"
                    >
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="yearly">Yearly</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-[15px]">
                    <div className="p-[12px] rounded-lg shadow-sm border border-lightGray">
                      <label className="block text-[16px] font-semibold text-text-secondary mb-[5px] font-body">Start Date</label>
                      <input
                        type="date"
                        name="startDate"
                        value={sipData.startDate}
                        onChange={handleInputChange}
                        min={getTomorrowDate()}
                        className={`w-full p-[12px] border-2 rounded text-[14px] font-body ${errors.startDate ? 'border-brown' : 'border-lightGray focus:border-primary'} focus:outline-none transition-all`}
                        required
                      />
                      {errors.startDate && <p className="mt-[5px] text-[12px] text-brown font-body">{errors.startDate}</p>}
                    </div>

                    <div className="p-[12px] rounded-lg shadow-sm border border-lightGray">
                      <label className="block text-[16px] font-semibold text-text-secondary mb-[5px] font-body">
                        {sipData.frequency === 'custom' ? 'Total Installments' : 'End Date (Optional)'}
                      </label>
                      {sipData.frequency === 'custom' ? (
                        <input
                          type="number"
                          name="totalInstallments"
                          value={sipData.totalInstallments}
                          onChange={handleInputChange}
                          min="1"
                          className={`w-full p-[12px] border-2 rounded text-[14px] font-body ${errors.totalInstallments ? 'border-brown' : 'border-lightGray focus:border-primary'} focus:outline-none transition-all`}
                          placeholder="e.g., 12"
                          required
                        />
                      ) : (
                        <input
                          type="date"
                          name="endDate"
                          value={sipData.endDate}
                          onChange={handleInputChange}
                          min={sipData.startDate}
                          className={`w-full p-[12px] border-2 rounded text-[14px] font-body ${errors.endDate ? 'border-brown' : 'border-lightGray focus:border-primary'} focus:outline-none transition-all`}
                        />
                      )}
                      {errors.totalInstallments && <p className="mt-[5px] text-[12px] text-brown font-body">{errors.totalInstallments}</p>}
                      {errors.endDate && <p className="mt-[5px] text-[12px] text-brown font-body">{errors.endDate}</p>}
                    </div>
                  </div>

                  <div className="p-[12px] bg-lightBeige rounded-lg border border-beige">
                    <div className="flex items-center mb-[10px]">
                      <Calendar className="w-[16px] h-[16px] text-primary mr-[5px]" />
                      <h3 className="text-[16px] font-semibold text-brown font-heading">SIP Summary</h3>
                    </div>
                    <div className="text-[14px] text-brown font-body">
                      {sipData.amount && sipData.frequency && (
                        <p>
                          ₹{sipData.amount} will be deducted {sipData.frequency}
                          {sipData.startDate && ` starting from ${new Date(sipData.startDate).toLocaleDateString()}`}
                          {sipData.endDate && ` until ${new Date(sipData.endDate).toLocaleDateString()}`}
                          {sipData.totalInstallments && ` for ${sipData.totalInstallments} installments`}
                        </p>
                      )}
                      {!sipData.amount && !sipData.frequency && (
                        <p>Please fill in the SIP details to see the summary.</p>
                      )}
                    </div>
                  </div>
                </>
              )}

              <div className="flex justify-center">
                <button
                  onClick={handlePayment}
                  disabled={loading || !formData.amount || !formData.nuvamaCode || Object.keys(errors).some(key => errors[key])}
                  className={`p-[12px] text-[14px] font-semibold text-white bg-primary rounded-lg shadow font-body transition-all ${loading || !formData.amount || !formData.nuvamaCode || Object.keys(errors).some(key => errors[key])
                    ? 'bg-darkGray cursor-not-allowed opacity-50'
                    : 'hover:bg-brown'
                    }`}
                >
                  {loading ? (
                    <div className="flex items-center">
                      <Loader className="animate-spin h-[16px] w-[16px] mr-[5px]" />
                      {activeTab === 'sip' ? 'Setting up SIP...' : 'Processing Payment...'}
                    </div>
                  ) : (
                    activeTab === 'sip' ? 'Setup SIP' : 'Pay Now'
                  )}
                </button>
              </div>

              {paymentStatus && (
                <div className="p-[12px] bg-lightBeige rounded-lg border border-beige">
                  <div className="flex items-center">
                    <Info className="w-[16px] h-[16px] text-brown mr-[5px]" />
                    <p className="text-[14px] text-brown font-body">{paymentStatus}</p>
                  </div>
                </div>
              )}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

function SwitchReallocationModal({
  isOpen,
  onClose,
  selectedClientCode,
  selectedClientId,
  clients,
}: {
  isOpen: boolean;
  onClose: () => void;
  selectedClientCode: string;
  selectedClientId: string;
  clients: { clientid: string; clientcode: string }[];
}) {
  const [formData, setFormData] = useState({
    investedIn: selectedClientCode ? selectedClientCode.slice(0, 3) : 'QGF',
    switchTo: '',
    amount: '',
    reason: '',
    additionalNotes: '',
    nuvamaCode: selectedClientCode || 'QAW0001',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const { toast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      nuvamaCode: selectedClientCode || 'QAW0001',
      investedIn: selectedClientCode ? selectedClientCode.slice(0, 3) : 'QGF',
    }));
  }, [selectedClientCode]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const formData = {
      nuvamaCode: form.get('nuvama-code')?.toString() || selectedClientCode,
      investedIn: form.get('invested-in')?.toString() || (selectedClientCode ? selectedClientCode.slice(0, 3) : 'QGF'),
      switchTo: form.get('switch-to')?.toString() || '',
      amount: form.get('amount')?.toString() || '',
      reason: form.get('reason')?.toString() || '',
      additionalNotes: form.get('additional-notes')?.toString() || '',
    };

    if (!formData.switchTo || !formData.reason || !formData.amount || !formData.nuvamaCode) {
      toast({
        title: 'Error',
        description: 'Please fill in all required fields including Nuvama Code.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus('idle');

    const userEmail = 'user@example.com';

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
            .info-box { background: #EFECD3; padding: 15px; border-left: 4px solid #DABD38; margin: 15px 0; }
            h1 { font-family: 'Playfair Display', Georgia, serif; color: #DABD38; }
            h3 { font-family: 'Playfair Display', Georgia, serif; color: #37584F; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">Switch/Reallocation Request</h1>
            </div>
            <div class="content">
              <p><strong>Request Type:</strong> Switch/Reallocation</p>
              <p><strong>Submitted via:</strong> Qode Investor Portal</p>
              <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
              <div class="info-box">
                <h3 style="margin-top: 0;">Request Details:</h3>
                <p><strong>Nuvama Code:</strong> ${formData.nuvamaCode}</p>
                <p><strong>Client ID:</strong> ${selectedClientId}</p>
                <p><strong>User Email:</strong> ${userEmail}</p>
                <p><strong>Currently Invested In:</strong> ${formData.investedIn}</p>
                <p><strong>Switch To:</strong> ${formData.switchTo}</p>
                <p><strong>Amount:</strong> ${formData.amount}</p>
                <p><strong>Reason:</strong> ${formData.reason.replace(/\n/g, '<br>')}</p>
                ${formData.additionalNotes ? `<p><strong>Additional Notes:</strong> ${formData.additionalNotes.replace(/\n/g, '<br>')}</p>` : ''}
              </div>
              <p style="margin-top: 20px; font-size: 14px; color: #37584F;">
                This message was sent from the Qode investor portal. Please review and process the request.
              </p>
            </div>
          </div>
        </body>
        </html>
      `;

      await sendEmail({
        to: 'sanket.shinde@qodeinvest.com',
        subject: `New Switch/Reallocation Request from ${formData.nuvamaCode}`,
        html: emailHtml,
        from: 'investor.relations@qodeinvest.com',
        fromName: 'Qode Investor Relations',
        inquiry_type: 'switch', // Updated to match valid inquiry_type
        nuvama_code: formData.nuvamaCode,
        client_id: selectedClientId,
        user_email: userEmail,
        priority: 'normal',
        inquirySpecificData: {
          invested_in: formData.investedIn,
          switch_to: formData.switchTo,
          amount: formData.amount,
          reason: formData.reason,
          additional_notes: formData.additionalNotes,
        },
      });

      setSubmitStatus('success');
      toast({
        title: 'Thank you!',
        description: 'Your switch/reallocation request has been submitted successfully.',
      });
      setFormData({
        investedIn: selectedClientCode ? selectedClientCode.slice(0, 3) : 'QGF',
        switchTo: '',
        amount: '',
        reason: '',
        additionalNotes: '',
        nuvamaCode: selectedClientCode || 'QAW0001',
      });
      if (formRef.current) {
        formRef.current.reset();
      }
      setTimeout(() => {
        setSubmitStatus('idle');
        onClose();
      }, 2000);
    } catch (error) {
      console.error('Switch submission error:', error);
      setSubmitStatus('error');
      toast({
        title: 'Error',
        description: 'Failed to send your request. Please try again or contact us directly.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="relative w-full max-w-md max-h-[90vh] bg-card rounded-lg shadow-2xl overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-lg font-semibold text-foreground">Request Switch/Reallocation</h3>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded-md" aria-label="Close modal">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Nuvama Code *</label>
              <select
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
              <p className="text-xs text-muted-foreground mt-1">Currently selected: {selectedClientCode}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Currently Invested In</label>
              <input
                name="invested-in"
                type="text"
                value={formData.investedIn}
                disabled
                className="w-full p-3 border border-border rounded-md bg-muted text-muted-foreground cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Switch To *</label>
              <select
                name="switch-to"
                value={formData.switchTo}
                onChange={(e) => setFormData({ ...formData, switchTo: e.target.value })}
                className="w-full p-3 border border-border rounded-md bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-primary"
                required
              >
                <option value="">Select Strategy</option>
                <option value="QGF">QGF</option>
                <option value="QFH">QFH</option>
                <option value="QTF">QTF</option>
                <option value="QAW">QAW</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Amount *</label>
              <input
                name="amount"
                type="text"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                className="w-full p-3 border border-border rounded-md bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-primary"
                placeholder="Enter amount (e.g. All, 30 lakhs, etc.)"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Reason for Switching *</label>
              <textarea
                name="reason"
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                rows={3}
                className="w-full p-3 border border-border rounded-md bg-background text-foreground resize-none focus:ring-2 focus:ring-primary focus:border-primary"
                placeholder="Please provide reason for switching..."
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Additional Notes</label>
              <textarea
                name="additional-notes"
                value={formData.additionalNotes}
                onChange={(e) => setFormData({ ...formData, additionalNotes: e.target.value })}
                rows={2}
                className="w-full p-3 border border-border rounded-md bg-background text-foreground resize-none focus:ring-2 focus:ring-primary focus:border-primary"
                placeholder="Any additional notes..."
              />
            </div>
            {submitStatus === 'success' && (
              <div className="p-3 bg-green-100 border border-green-400 text-green-700 rounded text-sm">
                Your switch/reallocation request has been sent successfully! Our team will review it and get back to you.
              </div>
            )}
            {submitStatus === 'error' && (
              <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded text-sm">
                Failed to send your request. Please try again or contact us directly.
              </div>
            )}
            <div className="flex gap-3 justify-end pt-4">
              <button
                type="button"
                onClick={() => {
                  setFormData({
                    investedIn: selectedClientCode ? selectedClientCode.slice(0, 3) : 'QGF',
                    switchTo: '',
                    amount: '',
                    reason: '',
                    additionalNotes: '',
                    nuvamaCode: selectedClientCode || 'QAW0001',
                  });
                  setSubmitStatus('idle');
                  onClose();
                }}
                className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !formData.switchTo || !formData.amount || !formData.reason || !formData.nuvamaCode}
                className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Sending...' : 'Request'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function WithdrawalModal({
  isOpen,
  onClose,
  selectedClientCode,
  selectedClientId,
  clients,
}: {
  isOpen: boolean;
  onClose: () => void;
  selectedClientCode: string;
  selectedClientId: string;
  clients: { clientid: string; clientcode: string }[];
}) {
  const [formData, setFormData] = useState({
    nuvamaCode: selectedClientCode || 'QGF0001',
    amount: '',
    additionalNotes: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const { toast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      nuvamaCode: selectedClientCode || 'QGF0001',
    }));
  }, [selectedClientCode]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const formData = {
      nuvamaCode: form.get('nuvama-code')?.toString() || selectedClientCode,
      amount: form.get('amount')?.toString() || '',
      additionalNotes: form.get('additional-notes')?.toString() || '',
    };

    if (!formData.amount || !formData.nuvamaCode) {
      toast({
        title: 'Error',
        description: 'Please provide a Nuvama Code and withdrawal amount.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus('idle');

    const userEmail = 'user@example.com';

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
            .info-box { background: #EFECD3; padding: 15px; border-left: 4px solid #DABD38; margin: 15px 0; }
            h1 { font-family: 'Playfair Display', Georgia, serif; color: #DABD38; }
            h3 { font-family: 'Playfair Display', Georgia, serif; color: #37584F; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">Withdrawal Request</h1>
            </div>
            <div class="content">
              <p><strong>Request Type:</strong> Withdrawal</p>
              <p><strong>Submitted via:</strong> Qode Investor Portal</p>
              <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
              <div class="info-box">
                <h3 style="margin-top: 0;">Request Details:</h3>
                <p><strong>Nuvama Code:</strong> ${formData.nuvamaCode}</p>
                <p><strong>Client ID:</strong> ${selectedClientId}</p>
                <p><strong>User Email:</strong> ${userEmail}</p>
                <p><strong>Amount:</strong> ${formData.amount}</p>
                ${formData.additionalNotes ? `<p><strong>Additional Notes:</strong> ${formData.additionalNotes.replace(/\n/g, '<br>')}</p>` : ''}
              </div>
              <p style="margin-top: 20px; font-size: 14px; color: #37584F;">
                This message was sent from the Qode investor portal. Please review and process the request.
              </p>
            </div>
          </div>
        </body>
        </html>
      `;

      await sendEmail({
        to: 'sanket.shinde@qodeinvest.com',
        subject: `New Withdrawal Request from ${formData.nuvamaCode}`,
        html: emailHtml,
        from: 'investor.relations@qodeinvest.com',
        fromName: 'Qode Investor Relations',
        inquiry_type: 'withdrawal',
        nuvama_code: formData.nuvamaCode,
        client_id: selectedClientId,
        user_email: userEmail,
        priority: 'normal',
        inquirySpecificData: {
          amount: formData.amount,
          additional_notes: formData.additionalNotes,
        },
      });

      setSubmitStatus('success');
      toast({
        title: 'Thank you!',
        description: 'Your withdrawal request has been submitted successfully.',
      });
      setFormData({
        nuvamaCode: selectedClientCode || 'QGF0001',
        amount: '',
        additionalNotes: '',
      });
      if (formRef.current) {
        formRef.current.reset();
      }
      setTimeout(() => {
        setSubmitStatus('idle');
        onClose();
      }, 2000);
    } catch (error) {
      console.error('Withdrawal submission error:', error);
      setSubmitStatus('error');
      toast({
        title: 'Error',
        description: 'Failed to send your request. Please try again or contact us directly.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="relative w-full max-w-md max-h-[90vh] bg-card rounded-lg shadow-2xl overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-lg font-semibold text-foreground">Submit Withdrawal Request</h3>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded-md" aria-label="Close modal">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Nuvama Code *</label>
              <select
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
              <p className="text-xs text-muted-foreground mt-1">Currently selected: {selectedClientCode}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Amount *</label>
              <input
                name="amount"
                type="text"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                className="w-full p-3 border border-border rounded-md bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-primary"
                placeholder="Enter amount (e.g. All, 30 lakhs, etc.)"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Additional Notes</label>
              <textarea
                name="additional-notes"
                value={formData.additionalNotes}
                onChange={(e) => setFormData({ ...formData, additionalNotes: e.target.value })}
                rows={3}
                className="w-full p-3 border border-border rounded-md bg-background text-foreground resize-none focus:ring-2 focus:ring-primary focus:border-primary"
                placeholder="Any additional notes..."
              />
            </div>
            {submitStatus === 'success' && (
              <div className="p-3 bg-green-100 border border-green-400 text-green-700 rounded text-sm">
                Your withdrawal request has been sent successfully! Our team will review it and get back to you.
              </div>
            )}
            {submitStatus === 'error' && (
              <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded text-sm">
                Failed to send your request. Please try again or contact us directly.
              </div>
            )}
            <div className="flex gap-3 justify-end pt-4">
              <button
                type="button"
                onClick={() => {
                  setFormData({
                    nuvamaCode: selectedClientCode || 'QGF0001',
                    amount: '',
                    additionalNotes: '',
                  });
                  setSubmitStatus('idle');
                  onClose();
                }}
                className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !formData.amount || !formData.nuvamaCode}
                className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Sending...' : 'Submit Request'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function InvestmentActionsPage() {
  const [isAddFundsModalOpen, setIsAddFundsModalOpen] = useState(false);
  const [isSwitchModalOpen, setIsSwitchModalOpen] = useState(false);
  const [isWithdrawalModalOpen, setIsWithdrawalModalOpen] = useState(false);
  const { selectedClientCode, selectedClientId, clients, loading } = useClient();

  if (loading) {
    return (
      <main className="space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-300 rounded w-64 mb-2"></div>
          <div className="h-4 bg-gray-300 rounded w-96"></div>
        </div>
      </main>
    );
  }

  if (clients.length === 0) {
    return (
      <main className="space-y-6">
        <header className="mb-2">
          <h1 className="text-pretty text-xl font-bold text-foreground">
            Investment Actions
          </h1>
          <p className="text-sm text-muted-foreground">
            No client accounts found. Please contact support.
          </p>
        </header>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <header className="mb-2">
        <h1 className="text-pretty text-xl font-bold text-foreground">
          Investment Actions
        </h1>
        <p className="text-sm text-muted-foreground">
          The portal enables investors to seamlessly manage their portfolios, from allocating new capital to adjusting investment strategies and withdrawing funds. All key actions can be initiated in a secure, efficient, and compliant manner.
          {selectedClientCode && (
            <span className="ml-2 text-primary font-medium">
              Current Account: {selectedClientCode}
            </span>
          )}
        </p>
      </header>

      <SectionHeader>Add Funds / Create SIP</SectionHeader>
      <InfoCard
        title="Top-ups & SIPs"
        action={
          <Button
            onClick={() => setIsAddFundsModalOpen(true)}
            className="inline-flex items-center justify-center rounded-md border border-border bg-primary text-white px-4 py-2 text-sm font-medium"
            aria-label="Add Funds or Create SIP"
          >
            Add Funds / Create SIP
          </Button>
        }
      >
        <p>Add to your investment anytime with a top-up.</p>
        <p>
          Set up a <span className="font-semibold">Systematic Investment Plan (SIP)</span> for
          disciplined, periodic investing.
        </p>
        <p>
          <span className="font-semibold">Timeline:</span> Executed once funds reflect
          in the PMS bank account (T+1).
        </p>
      </InfoCard>

      <SectionHeader>Switch Strategy / Reallocation</SectionHeader>
      <InfoCard
        title="Strategy Flexibility"
        action={
          <Button
            onClick={() => setIsSwitchModalOpen(true)}
            className="inline-flex items-center justify-center rounded-md border border-border bg-primary text-white px-4 py-2 text-sm font-medium"
            aria-label="Request Switch or Reallocation"
          >
            Request Switch/Reallocation
          </Button>
        }
      >
        <p>
          Move investments between Qode strategies to better align with your
          goals.
        </p>
        <p>Changes typically executed during the next rebalancing window.</p>
        <p>
          <span className="font-semibold">Timeline:</span> As per rebalancing
          schedule.
        </p>
      </InfoCard>

      <SectionHeader>Withdrawal / Redemption</SectionHeader>
      <InfoCard
        title="Access Your Capital"
        action={
          <Button
            onClick={() => setIsWithdrawalModalOpen(true)}
            className="inline-flex items-center justify-center rounded-md border border-border bg-primary text-white px-4 py-2 text-sm font-medium"
            aria-label="Submit Withdrawal Request"
          >
            Submit Withdrawal Request
          </Button>
        }
      >
        <p>Submit a withdrawal request at your convenience.</p>
        <p>Proceeds are credited directly to your registered bank account.</p>
        <p>
          <span className="font-semibold">Timeline:</span> Standard T+10 days as
          per PMS guidelines.
        </p>
      </InfoCard>

      <AddFundsModal
        isOpen={isAddFundsModalOpen}
        onClose={() => setIsAddFundsModalOpen(false)}
        selectedClientCode={selectedClientCode}
        selectedClientId={selectedClientId}
        clients={clients}
      />

      <SwitchReallocationModal
        isOpen={isSwitchModalOpen}
        onClose={() => setIsSwitchModalOpen(false)}
        selectedClientCode={selectedClientCode}
        selectedClientId={selectedClientId}
        clients={clients}
      />

      <WithdrawalModal
        isOpen={isWithdrawalModalOpen}
        onClose={() => setIsWithdrawalModalOpen(false)}
        selectedClientCode={selectedClientCode}
        selectedClientId={selectedClientId}
        clients={clients}
      />
    </main>
  );
}