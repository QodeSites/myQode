"use client";
import type React from "react";
import { useState, useRef, useEffect } from "react";
import { X, IndianRupee, Lock, CreditCard, TrendingUp, CheckCircle, Calendar, Loader, Info, RefreshCw, Settings, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast, useToast } from "@/hooks/use-toast";
import { useClient } from "@/contexts/ClientContext";
import { AlertTriangle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const strategy = {
  'QFH': 'Qode Future Horizons',
  'QAW': 'Qode All Weather',
  'QTF': 'Qode Tactical Fund',
  'QGF': 'Qode Growth Fund'
}
/* ---------------------------
   Reusable Modal Component
---------------------------- */
function ModalShell({
  title,
  onClose,
  children,
  size = "md", // "sm" | "md" | "lg"
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClass =
    size === "lg"
      ? "sm:max-w-xl md:max-w-2xl lg:max-w-3xl"
      : size === "sm"
        ? "sm:max-w-sm md:max-w-md"
        : "sm:max-w-md md:max-w-lg";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`relative w-full ${sizeClass} bg-card shadow-2xl
          h-[98dvh] sm:h-auto sm:rounded-lg
          flex flex-col max-h-[90dvh] mt-6 lg:mt-14`}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between p-4 border-b border-border flex-none ">
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded-md" aria-label="Close modal">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto overscroll-contain flex-1">{children}</div>
      </div>
    </div>
  );
}

function InfoCard({
  title,
  children,
  action,
  icon: Icon,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <section className="group rounded-lg border border-border bg-card p-6 shadow-sm transition-all hover:shadow-md flex flex-col min-h-[200px]">
      <div className="flex items-center gap-3 mb-4">
        {Icon && <Icon className="h-6 w-6 text-primary" aria-hidden="true" />}
        <h3 className="text-lg font-bold text-foreground">{title}</h3>
      </div>
      <div className="space-y-3 text-sm text-muted-foreground flex-grow">{children}</div>
      {action && (
        <div className="mt-4 flex justify-center">
          <div className="transition-transform group-hover:scale-105">{action}</div>
        </div>
      )}
    </section>
  );
}

/* ---------------------------
   Add Funds / SIP / New Strategy Modal - Enhanced with New Strategy Tab
   Modified to send email before Cashfree payment/subscription
---------------------------- */
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
    console.log("🚀 sendEmail function called with data:", {
    to: emailData.to,
    subject: emailData.subject,
    inquiry_type: emailData.inquiry_type,
    nuvama_code: emailData.nuvama_code,
    htmlLength: emailData.html?.length,
    timestamp: new Date().toISOString()
  });
    const response = await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(emailData),
    });

    const contentType = response.headers.get("content-type");
    if (!response.ok) {
      const errorText = await response.text();
      console.error("API response not OK:", {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
      });
      throw new Error(`Failed to send email: ${response.status} ${response.statusText}`);
    }

    if (contentType && contentType.includes("application/json")) {
      const data = await response.json();
      return data;
    } else {
      console.warn("API response is not JSON:", await response.text());
      return { success: true };
    }
  } catch (error) {
    console.error("Email sending failed:", error);
    throw error;
  }
}

function AddFundsModal({
  isOpen,
  onClose,
  selectedClientCode,
  selectedClientId,
  clients,
  customer_name,
  customer_email,
  customer_phone,
}: {
  isOpen: boolean;
  onClose: () => void;
  selectedClientCode: string;
  selectedClientId: string;
  clients: { clientid: string; clientcode: string }[];
  customer_name: string;
  customer_email: string;
  customer_phone: string;
}) {

  console.log(customer_name, customer_email, customer_phone);
  const [activeTab, setActiveTab] = useState<"oneTime" | "sip" | "newStrategy">("oneTime");
  const [loading, setLoading] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState("");
  const [showTooltip, setShowTooltip] = useState(false);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [userInvestments, setUserInvestments] = useState([]); // Track user's current investments
  const [loadingInvestments, setLoadingInvestments] = useState(false);
  const [formData, setFormData] = useState({ nuvamaCode: selectedClientCode || "QAW0001", amount: "" });
  const [sipData, setSipData] = useState({
    frequency: 'monthly',
    startDate: '',
    endDate: '',
    amount: ''
  });
  const [newStrategyData, setNewStrategyData] = useState({
    selectedStrategy: '',
    amount: ''
  });
  const [errors, setErrors] = useState({
    nuvamaCode: "",
    amount: "",
    startDate: "",
    endDate: "",
    selectedStrategy: "",
  });
  const { toast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const SIP_ENABLED = true;
  console.log('activeTab:', activeTab);
  // Email sending helper functions - ONLY SEND AFTER SUCCESSFUL PAYMENT
  const sendPaymentSuccessEmail = async (amount: string, paymentResult: any, investmentType: string) => {
    try {
      const accountCode = formData.nuvamaCode;
      const strategyName = activeTab === "newStrategy"
        ? strategy[newStrategyData.selectedStrategy]
        : getStrategyName(formData.nuvamaCode);

      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
          <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #8B4513; margin: 0; font-size: 28px;">Payment Successful</h1>
              <div style="width: 50px; height: 3px; background-color: #D4AF37; margin: 10px auto;"></div>
            </div>
            
            <div style="background-color: #e8f5e8; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h2 style="color: #2e7d32; margin: 0 0 15px 0; font-size: 20px;">
                ${activeTab === "newStrategy" ? "🎉 New Strategy Investment Completed!" : "✅ Payment Completed!"}
              </h2>
              <p style="color: #2e7d32; margin: 0; font-size: 16px;">
                Your ${activeTab === "newStrategy" ? "new strategy investment" : "payment"} has been processed successfully.
              </p>
            </div>

            <div style="background-color: #F5F5DC; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h3 style="color: #8B4513; margin: 0 0 15px 0; font-size: 18px;">Payment Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Account ID:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd; text-align: right;">${accountCode}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Strategy:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd; text-align: right;">${strategyName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Amount:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd; text-align: right; color: #4CAF50; font-size: 18px;"><strong>₹${amount}</strong></td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Investment Type:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd; text-align: right;">
                    ${activeTab === "newStrategy" ? "New Strategy Investment" : "One-time Payment"}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Transaction ID:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd; text-align: right;">${paymentResult?.order_id || 'N/A'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><strong>Date:</strong></td>
                  <td style="padding: 8px 0; text-align: right;">${new Date().toLocaleDateString()}</td>
                </tr>
              </table>
            </div>

            ${activeTab === "newStrategy" ? `
              <div style="background-color: #e8f5e8; padding: 20px; border-radius: 8px; margin-bottom: 25px; border-left: 4px solid #4CAF50;">
                <h3 style="color: #2e7d32; margin: 0 0 10px 0; font-size: 16px;">🚀 New Strategy Investment Completed!</h3>
                <p style="color: #2e7d32; margin: 0; font-size: 14px;">
                  Investment in your new Qode strategy has been completed successfully. Your new account ID is <strong>${accountCode}</strong>.
                  Your investment is now active and being managed by our team.
                </p>
              </div>
            ` : ''}

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
      `;

      console.log('Sending payment success notification to Qode Investor Relations:', {
        to: 'sanket.shinde@qodeinvest.com',
        subject: `Payment Completed - ₹${amount} ${activeTab === "newStrategy" ? "New Strategy Investment" : "Investment"} | Qode Advisors`,
        inquiry_type: activeTab === "newStrategy" ? "new_strategy_payment_success" : "payment_success",
        nuvama_code: accountCode,
        client_id: selectedClientId,
      });

      const result = await sendEmail({
        to: 'investor.relations@qodeinvest.com',
        subject: `Payment Completed - ₹${amount} ${activeTab === "newStrategy" ? "New Strategy Investment" : "Investment"} | Qode Advisors`,
        html: emailHtml,
        inquiry_type: activeTab === "newStrategy" ? "new_strategy_payment_success" : "payment_success",
        nuvama_code: accountCode,
        client_id: selectedClientId,
        user_email: "investor.relations@qodeinvest.com",
        priority: "high",
        from: "investor.relations@qodeinvest.com",
        fromName: "Qode Investor Relations",
        payment_amount: amount,
        investment_type: investmentType,
        transaction_id: paymentResult?.order_id || 'N/A',
        payment_status: "success"
      });

      console.log('Payment success notification sent successfully:', result);
      return result;
    } catch (error) {
      console.error('Error sending payment success notification:', error);
      throw error;  
    }
  };

  const sendSipSuccessEmail = async (sipResult: any) => {
    try {
      const accountCode = formData.nuvamaCode;
      const strategyName = getStrategyName(formData.nuvamaCode);
      const amount = formData.amount;

      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
          <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #8B4513; margin: 0; font-size: 28px;">SIP Authorized Successfully</h1>
              <div style="width: 50px; height: 3px; background-color: #D4AF37; margin: 10px auto;"></div>
            </div>
            
            <div style="background-color: #e8f5e8; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h2 style="color: #2e7d32; margin: 0 0 15px 0; font-size: 20px;">
                🔄 SIP Successfully Authorized!
              </h2>
              <p style="color: #2e7d32; margin: 0; font-size: 16px;">
                Your Systematic Investment Plan (SIP) has been successfully authorized and is now active.
              </p>
            </div>

            <div style="background-color: #F5F5DC; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h3 style="color: #8B4513; margin: 0 0 15px 0; font-size: 18px;">SIP Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Account ID:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd; text-align: right;">${accountCode}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Strategy:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd; text-align: right;">${strategyName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>SIP Amount:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd; text-align: right; color: #4CAF50; font-size: 18px;"><strong>₹${amount}</strong></td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Frequency:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd; text-align: right; text-transform: capitalize;">${sipData.frequency}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Start Date:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd; text-align: right;">${new Date(sipData.startDate).toLocaleDateString()}</td>
                </tr>
                ${sipData.endDate ? `
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>End Date:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #ddd; text-align: right;">${new Date(sipData.endDate).toLocaleDateString()}</td>
                  </tr>
                ` : `
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Duration:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #ddd; text-align: right; color: #ff9800;">Indefinite</td>
                  </tr>
                `}
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Subscription ID:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #ddd; text-align: right;">${sipResult?.subscription_id || 'N/A'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><strong>Authorization Date:</strong></td>
                  <td style="padding: 8px 0; text-align: right;">${new Date().toLocaleDateString()}</td>
                </tr>
              </table>
            </div>

            <div style="background-color: #e3f2fd; padding: 20px; border-radius: 8px; margin-bottom: 25px; border-left: 4px solid #2196F3;">
              <h3 style="color: #1976d2; margin: 0 0 10px 0; font-size: 16px;">📅 SIP Status: Active</h3>
              <ul style="color: #1976d2; margin: 0; padding-left: 20px; font-size: 14px;">
                <li>Your SIP is now active and authorized. The first deduction will occur on ${new Date(sipData.startDate).toLocaleDateString()}.</li>
                <li>Subsequent deductions will happen automatically every ${sipData.frequency}.</li>
                <li>You can manage your SIP anytime from your dashboard.</li>
              </ul>
            </div>

            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
              <p style="color: #666; margin: 0 0 10px 0; font-size: 14px;">
                Questions about your SIP? Contact our team:
              </p>
              <p style="color: #8B4513; margin: 0; font-size: 16px;">
                📧 <a href="mailto:support@qodeinvest.com" style="color: #8B4513; text-decoration: none;">support@qodeinvest.com</a>
              </p>
            </div>
          </div>
        </div>
      `;

      const result = await sendEmail({
        to: "investor.relations@qodeinvest.com",
        subject: `SIP Authorized Successfully - ₹${amount} ${sipData.frequency} | ${strategyName} | Qode Advisors`,
        html: emailHtml,
        inquiry_type: "sip_success",
        nuvama_code: accountCode,
        client_id: selectedClientId,
        user_email: "investor.relations@qodeinvest.com",
        priority: "high",
        sip_amount: amount,
        sip_frequency: sipData.frequency,
        sip_start_date: sipData.startDate,
        sip_end_date: sipData.endDate || 'indefinite',
        subscription_id: sipResult?.subscription_id || 'N/A',
        payment_status: "success"
      });

      console.log('SIP success notification sent successfully:', result);
      return result;
    } catch (error) {
      console.error('Error sending SIP success notification:', error);
      throw error;
    }
  };

  // Strategy mapping
  const strategy = {
    'QFH': 'Qode Future Horizons',
    'QAW': 'Qode All Weather',
    'QTF': 'Qode Tactical Fund',
    'QGF': 'Qode Growth Fund'
  };

  // Get strategy name based on account code
  const getStrategyName = (accountCode: string) => {
    const prefix = accountCode.substring(0, 3).toUpperCase();
    return strategy[prefix] || 'Unknown Strategy';
  };

  // Get available strategies (not currently invested in)
  const getAvailableStrategies = () => {
    const investedPrefixes = userInvestments.map(inv => inv.substring(0, 3).toUpperCase());
    const allStrategies = Object.keys(strategy);
    return allStrategies.filter(prefix => !investedPrefixes.includes(prefix));
  };

  // Fetch user's current investments
  const fetchUserInvestments = async () => {
    if (!selectedClientCode) return;

    setLoadingInvestments(true);
    try {
      const userStrategies = clients
        .filter(client => client.clientid === selectedClientId)
        .map(client => client.clientcode);

      setUserInvestments(userStrategies);
    } catch (error) {
      console.error('Error fetching user investments:', error);
      setUserInvestments([selectedClientCode]);
    } finally {
      setLoadingInvestments(false);
    }
  };

  useEffect(() => {
    setFormData((p) => ({ ...p, nuvamaCode: selectedClientCode || "QAW0001" }));
    fetchUserInvestments();
  }, [selectedClientCode, selectedClientId]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (["frequency", "startDate", "endDate"].includes(name)) {
      setSipData((prev) => ({ ...prev, [name]: value }));
      validateField(name, value);
    } else if (["selectedStrategy"].includes(name)) {
      setNewStrategyData((prev) => ({ ...prev, [name]: value }));
      validateField(name, value);
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
      validateField(name, value);
    }
  };

  const handleNewStrategyAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = e.target;
    setNewStrategyData((prev) => ({ ...prev, amount: value }));
    validateField("amount", value);
  };

  const validateField = (name: string, value: string) => {
    setErrors((prev) => {
      const ne = { ...prev };
      if (name === "nuvamaCode") {
        ne.nuvamaCode = value ? "" : "Account ID is required";
      } else if (name === "amount") {
        ne.amount = !value ? "Amount is required" : Number(value) < 100 ? "Amount must be at least ₹100" : "";
      } else if (name === "selectedStrategy") {
        ne.selectedStrategy = value ? "" : "Please select a strategy";
      } else if (name === "startDate" && value) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);

        const selectedDate = new Date(value);
        selectedDate.setHours(0, 0, 0, 0);

        ne.startDate = selectedDate < tomorrow ? "Start date must be tomorrow or later" : "";
      } else if (name === "endDate" && value && sipData.startDate) {
        const startDate = new Date(sipData.startDate);
        const endDate = new Date(value);
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(0, 0, 0, 0);

        ne.endDate = endDate <= startDate ? "End date must be after start date" : "";
      }
      return ne;
    });
  };

  const getTomorrowDate = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const year = tomorrow.getFullYear();
    const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const day = String(tomorrow.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  };

  const isFormValid = () => {
    const currentAmount = activeTab === "newStrategy" ? newStrategyData.amount : formData.amount;

    if (!currentAmount || !formData.nuvamaCode || loading) {
      return false;
    }

    const amount = parseFloat(currentAmount);
    if (isNaN(amount) || amount < 100) {
      return false;
    }

    if (activeTab === "newStrategy") {
      if (!newStrategyData.selectedStrategy) {
        return false;
      }
    }

    if (Object.values(errors).some(error => error)) {
      return false;
    }

    if (activeTab === "sip") {
      if (!sipData.startDate) {
        return false;
      }

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      const startDate = new Date(sipData.startDate);
      startDate.setHours(0, 0, 0, 0);

      if (startDate < tomorrow) {
        return false;
      }

      if (sipData.endDate) {
        const endDate = new Date(sipData.endDate);
        endDate.setHours(0, 0, 0, 0);

        if (endDate <= startDate) {
          return false;
        }
      }
    }

    return true;
  };

  const SummaryModal = () => {
    if (!showSummaryModal) return null;

    const currentAmount = activeTab === "newStrategy" ? newStrategyData.amount : formData.amount;
    const strategyName = activeTab === "newStrategy"
      ? strategy[newStrategyData.selectedStrategy]
      : getStrategyName(formData.nuvamaCode);

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
          <div className="text-center mb-6">
            <h2 className="text-xl font-semibold text-brown font-heading mb-2">
              {activeTab === "newStrategy" ? "New Strategy Investment" : "Investment Summary"}
            </h2>
            <div className="w-12 h-0.5 bg-primary mx-auto"></div>
          </div>

          <div className="space-y-4 mb-6">
            <div className="p-4 bg-beige rounded-lg">
              <h3 className="font-semibold text-brown mb-2">Investment Details</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Account ID:</span>
                  <span className="font-semibold">
                   {formData.nuvamaCode}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Strategy:</span>
                  <span className="font-semibold">{strategyName}</span>
                </div>
                <div className="flex justify-between">
                  <span>Amount:</span>
                  <span className="font-semibold">₹{currentAmount}</span>
                </div>
                {activeTab === "newStrategy" && (
                  <div className="flex justify-between">
                    <span>Type:</span>
                    <span className="font-semibold text-green-600">New Strategy Investment</span>
                  </div>
                )}
                {activeTab === "sip" && (
                  <>
                    <div className="flex justify-between">
                      <span>Frequency:</span>
                      <span className="font-semibold capitalize">{sipData.frequency}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Start Date:</span>
                      <span className="font-semibold">{new Date(sipData.startDate).toLocaleDateString()}</span>
                    </div>
                    {sipData.endDate && (
                      <div className="flex justify-between">
                        <span>End Date:</span>
                        <span className="font-semibold">{new Date(sipData.endDate).toLocaleDateString()}</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="flex items-start">
                <Info className="w-5 h-5 text-yellow-600 mr-2 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-yellow-800">
                  <p className="font-semibold mb-1">Important Notes:</p>
                  <ul className="space-y-1 text-xs">
                    <li>• Please ensure you have sufficient funds in your account for the transaction.</li>
                    <li>• In case you are unsure, please get in touch with us.</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <div className="flex space-x-2">
            <button
              onClick={() => setShowSummaryModal(false)}
              className="flex-1 px-4 py-2 border border-gray-300 rounded text-gray-700 font-semibold hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmPayment}
              className="flex-1 px-4 py-2 bg-primary text-white rounded font-semibold hover:bg-brown transition-colors"
            >
              {activeTab === 'sip' ? 'Proceed with SIP' :
                activeTab === 'newStrategy' ? 'Start New Strategy' : 'Proceed with Payment'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const initiateCashfreePayment = async (orderToken: string, orderId: string) => {
    setLoading(true);
    try {
      if (!window.Cashfree) {
        toast({
          title: "Loading",
          description: "Loading payment SDK...",
        });
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://sdk.cashfree.com/js/v3/cashfree.js';
          const timeout = setTimeout(() => {
            toast({
              title: "Error",
              description: "Payment SDK load timeout",
              variant: "destructive",
            });
            reject(new Error('SDK timeout'));
          }, 10000);
          script.onload = () => { clearTimeout(timeout); setTimeout(resolve, 500); };
          script.onerror = () => {
            clearTimeout(timeout);
            toast({
              title: "Error",
              description: "Failed to load payment SDK",
              variant: "destructive",
            });
            reject(new Error('SDK load failed'));
          };
          document.head.appendChild(script);
        });
      }

      const cashfree = window.Cashfree({
        mode: process.env.NEXT_PUBLIC_CASHFREE_ENV === 'production' ? 'production' : 'sandbox'
      });

      return new Promise((resolve, reject) => {
        const paymentTimeout = setTimeout(() => {
          toast({
            title: "Error",
            description: `Payment timed out`,
            variant: "destructive",
          });
          reject(new Error('Payment timeout'));
        }, 300000);

        cashfree.checkout({
          paymentSessionId: orderToken,
          redirectTarget: '_self',
          onSuccess: async (result) => {
            clearTimeout(paymentTimeout);
            const currentAmount = activeTab === "newStrategy" ? newStrategyData.amount : formData.amount;
            setPaymentStatus('Payment completed successfully!');
            console.log('Payment Success:', result);
            toast({
              title: "Payment Successful",
              description: `Your payment of ₹${currentAmount} has been processed successfully.`,
            });

            // Send success notification to Qode Investor Relations ONLY AFTER successful payment
            try {
              await sendPaymentSuccessEmail(currentAmount, result);
              toast({
                title: "Notification Sent",
                description: "Payment notification has been sent to Qode Investor Relations.",
              });
            } catch (emailError) {
              console.error('Failed to send payment success notification:', emailError);
              toast({
                title: "Email Error",
                description: "Payment was successful, but we couldn't send the notification. Please contact support.",
                variant: "destructive",
              });
            }

            // Reset form
            setFormData({
              nuvamaCode: selectedClientCode || 'QAW0001',
              amount: '',
            });
            setNewStrategyData({
              selectedStrategy: '',
              amount: ''
            });
            setErrors({
              nuvamaCode: '',
              amount: '',
              startDate: '',
              endDate: '',
              selectedStrategy: '',
            });

            setTimeout(() => {
              setPaymentStatus('');
              onClose();
            }, 3000);
            resolve(result);
          },
          onError: (error) => {
            clearTimeout(paymentTimeout);
            setPaymentStatus('Payment failed. Please try again.');
            toast({
              title: "Payment Failed",
              description: error.message || "Payment could not be processed. Please try again.",
              variant: "destructive",
            });
            reject(error);
          },
          onClose: () => {
            clearTimeout(paymentTimeout);
            setPaymentStatus('Payment cancelled by user.');
            toast({
              title: "Payment Cancelled",
              description: "Payment was cancelled by the user.",
              variant: "destructive",
            });
            reject(new Error('Payment cancelled'));
          }
        }).catch((err) => {
          clearTimeout(paymentTimeout);
          toast({
            title: "Error",
            description: `Payment failed: ${err.message}`,
            variant: "destructive",
          });
          reject(err);
        });
      });
    } catch (error) {
      toast({
        title: "Error",
        description: `Initialization failed: ${error.message}`,
        variant: "destructive",
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const initiateCashfreeSubscription = async (subscriptionSessionId, subscriptionId) => {
    console.log('Starting SIP authorization with session:', subscriptionSessionId);
    setLoading(true);

    try {
      if (!window.Cashfree) {
        toast({
          title: "Loading",
          description: "Loading payment SDK...",
        });

        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://sdk.cashfree.com/js/v3/cashfree.js';

          const timeout = setTimeout(() => {
            toast({
              title: "Error",
              description: "Payment SDK load timeout",
              variant: "destructive",
            });
            reject(new Error('SDK timeout'));
          }, 10000);

          script.onload = () => {
            clearTimeout(timeout);
            console.log('Cashfree SDK loaded successfully');
            setTimeout(resolve, 500);
          };

          script.onerror = () => {
            clearTimeout(timeout);
            toast({
              title: "Error",
              description: "Failed to load payment SDK",
              variant: "destructive",
            });
            reject(new Error('SDK load failed'));
          };

          document.head.appendChild(script);
        });
      }

      console.log('Initializing Cashfree with mode:', process.env.NEXT_PUBLIC_CASHFREE_ENV === 'production' ? 'production' : 'sandbox');

      const cashfree = window.Cashfree({
        mode: process.env.NEXT_PUBLIC_CASHFREE_ENV === 'production' ? 'production' : 'sandbox'
      });

      return new Promise((resolve, reject) => {
        const paymentTimeout = setTimeout(() => {
          toast({
            title: "Error",
            description: "SIP setup timed out",
            variant: "destructive",
          });
          reject(new Error('SIP setup timeout'));
        }, 300000);

        console.log('Calling cashfree.subscriptionsCheckout with subsSessionId:', subscriptionSessionId);

        cashfree.subscriptionsCheckout({
          subsSessionId: subscriptionSessionId,
          redirectTarget: '_self',
        }).then(async (result) => {
          clearTimeout(paymentTimeout);
          if (result.error) {
            console.error('SIP Checkout Error:', result.error);
            toast({
              title: "SIP Authorization Failed",
              description: result.error.message || 'SIP setup failed',
              variant: "destructive",
            });
            reject(new Error(result.error.message || 'SIP setup failed'));
          } else {
            console.log('SIP checkout successful, result:', result);
            toast({
              title: "SIP Authorized",
              description: "Your SIP has been set up and authorized successfully.",
            });

            // Send success notification to Qode Investor Relations ONLY AFTER successful SIP authorization
            try {
              await sendSipSuccessEmail(result);
              toast({
                title: "Notification Sent",
                description: "SIP authorization notification has been sent to Qode Investor Relations.",
              });
            } catch (emailError) {
              console.error('Failed to send SIP success notification:', emailError);
              toast({
                title: "Email Error",
                description: "SIP was authorized successfully, but we couldn't send the notification. Please contact support.",
                variant: "destructive",
              });
            }

            // Reset form
            setFormData({
              nuvamaCode: selectedClientCode || 'QAW0001',
              amount: '',
            });

            setSipData({
              frequency: 'monthly',
              startDate: '',
              endDate: '',
              amount: ''
            });

            setErrors({
              nuvamaCode: '',
              amount: '',
              startDate: '',
              endDate: '',
              selectedStrategy: '',
            });

            setTimeout(() => {
              setPaymentStatus('');
              onClose();
            }, 3000);

            resolve(result);
          }
        }).catch((error) => {
          clearTimeout(paymentTimeout);
          console.error('SIP Checkout Promise Error:', error);
          toast({
            title: "Error",
            description: `SIP authorization failed: ${error.message}`,
            variant: "destructive",
          });
          reject(error);
        });
      });

    } catch (error) {
      console.error('SIP initialization error:', error);
      toast({
        title: "Error",
        description: `SIP initialization failed: ${error.message}`,
        variant: "destructive",
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const handlePayment = async () => {
    try {
      console.log('handlePayment called with activeTab:', activeTab);

      if (!isFormValid()) {
        const currentAmount = activeTab === "newStrategy" ? newStrategyData.amount : formData.amount;

        if (!formData?.nuvamaCode || !currentAmount) {
          toast({
            title: "Error",
            description: "Please fill in all required fields.",
            variant: "destructive",
          });
          return;
        }

        if (activeTab === "newStrategy" && !newStrategyData.selectedStrategy) {
          toast({
            title: "Error",
            description: "Please select a strategy to start investing.",
            variant: "destructive",
          });
          return;
        }

        if (activeTab === 'sip' && !sipData.startDate) {
          toast({
            title: "Error",
            description: "Please select a start date for the SIP.",
            variant: "destructive",
          });
          return;
        }

        toast({
          title: "Error",
          description: "Please check all form fields and correct any errors.",
          variant: "destructive",
        });
        return;
      }

      const currentAmount = activeTab === "newStrategy" ? newStrategyData.amount : formData.amount;
      const amount = parseFloat(currentAmount);
      
      if (isNaN(amount) || amount <= 0) {
        toast({
          title: "Error",
          description: "Please enter a valid amount greater than 0.",
          variant: "destructive",
        });
        return;
      }

      if (activeTab === 'sip') {
        console.log('Validating SIP data:', sipData);

        if (!sipData?.startDate) {
          toast({
            title: "Error",
            description: "Please select a start date for the SIP.",
            variant: "destructive",
          });
          return;
        }

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);

        const startDate = new Date(sipData.startDate);
        startDate.setHours(0, 0, 0, 0);

        if (startDate < tomorrow) {
          toast({
            title: "Error",
            description: "SIP start date must be tomorrow or later.",
            variant: "destructive",
          });
          return;
        }

        if (sipData.endDate) {
          const endDate = new Date(sipData.endDate);
          endDate.setHours(0, 0, 0, 0);

          if (endDate <= startDate) {
            toast({
              title: "Error",
              description: "SIP end date must be after the start date.",
              variant: "destructive",
            });
            return;
          }
        }

        const validFrequencies = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];
        if (!sipData.frequency || !validFrequencies.includes(sipData.frequency)) {
          toast({
            title: "Error",
            description: "Please select a valid SIP frequency.",
            variant: "destructive",
          });
          return;
        }
      }

      if (!selectedClientId) {
        toast({
          title: "Error",
          description: "Client ID is missing. Please refresh and try again.",
          variant: "destructive",
        });
        return;
      }

      setShowSummaryModal(true);

    } catch (error) {
      console.error('Validation error:', error);
      toast({
        title: "Error",
        description: "An error occurred during validation. Please try again.",
        variant: "destructive",
      });
    }
  };

 const handleConfirmPayment = async () => {
  try {
    setShowSummaryModal(false);
    setLoading(true);
    setPaymentStatus('');
    console.log('handleConfirmPayment called with activeTab:', activeTab);
    const currentAmount = activeTab === "newStrategy" ? newStrategyData.amount : formData.amount;
    const amount = parseFloat(currentAmount);
    const investmentType = activeTab === "newStrategy" ? "new_strategy" : "one_time";

    // Validate required customer information
    if (!customer_name || customer_name.trim() === '') {
      throw new Error('Missing required fields: customer_name');
    }
    if (!customer_email || customer_email.trim() === '') {
      throw new Error('Missing required fields: customer_email');
    }
    if (!customer_phone || customer_phone.trim() === '') {
      throw new Error('Missing required fields: customer_phone');
    }

    let accountCodeToUse = formData.nuvamaCode;

    if (activeTab === 'sip') {
      console.log('Processing SIP flow...');
      const sipPayload = {
        order_amount: amount,
        nuvama_code: accountCodeToUse.trim(),
        sip_details: {
          frequency: sipData.frequency,
          start_date: sipData.startDate,
          ...(sipData.endDate && { end_date: sipData.endDate }),
        },
        order_meta: {
          return_url: `${window.location.origin}/payment/sip-success`,
        },
        client_id: selectedClientId,
        customer_name: customer_name,
        customer_email: customer_email,
        customer_phone: customer_phone,
        order_type: 'sip', // Explicitly set for SIP
      };

      console.log('Sending SIP payload:', sipPayload);

      const response = await fetch('/api/cashfree/setup-sip', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(sipPayload),
      });

      let responseData;
      const contentType = response.headers.get('content-type');

      if (contentType && contentType.includes('application/json')) {
        responseData = await response.json();
      } else {
        const responseText = await response.text();
        console.log('Non-JSON response received:', responseText);
        try {
          responseData = JSON.parse(responseText);
        } catch {
          throw new Error(response.ok ? 'Invalid response format from server' : `Server error: ${response.status}`);
        }
      }

      console.log('SIP API Response:', responseData);

      if (!response.ok) {
        console.error('SIP API Error Response:', responseData);
        const errorMessage = responseData?.message || responseData?.error || `HTTP ${response.status}: Failed to create SIP order`;
        throw new Error(errorMessage);
      }

      if (!responseData.success) {
        console.error('API returned success: false:', responseData);
        throw new Error(responseData.message || responseData.error || 'SIP order creation failed');
      }

      if (!responseData.data) {
        console.error('Missing data object in response:', responseData);
        throw new Error('Invalid response structure: missing data object');
      }

      const subscriptionSessionId = responseData.data.checkout_url;
      const subscriptionId = responseData.data.subscription_id || responseData.data.order_id;

      if (!subscriptionSessionId) {
        console.error('No subscription session ID in response data:', responseData.data);
        console.error('Available fields in data:', Object.keys(responseData.data));
        throw new Error('Subscription session ID not provided by SIP service');
      }

      if (!subscriptionId) {
        console.error('No subscription ID in response data:', responseData.data);
        throw new Error('Subscription ID not provided by SIP service');
      }

      // Store subscription ID for success page
      sessionStorage.setItem('qode_payment_order_id', subscriptionId);
      sessionStorage.setItem('qode_payment_type', 'sip');
      sessionStorage.setItem('qode_payment_amount', currentAmount);
      sessionStorage.setItem('qode_payment_nuvama_code', accountCodeToUse);

      console.log('Initiating Cashfree subscription with session ID:', subscriptionSessionId, 'Subscription ID:', subscriptionId);

      toast({
        title: "SIP Authorization Starting",
        description: "Opening payment gateway for SIP authorization...",
      });

      await initiateCashfreeSubscription(subscriptionSessionId, subscriptionId);
    } else {
      console.log('Processing payment flow...');
      const orderPayload = {
        amount: amount,
        currency: 'INR',
        customer_name: customer_name,
        customer_email: customer_email,
        customer_phone: customer_phone,
        nuvama_code: accountCodeToUse.trim(),
        client_id: selectedClientId,
        order_type: activeTab === "newStrategy" ? 'new_strategy' : 'one_time', // Set order_type dynamically
        return_url: `${window.location.origin}/payment/success`,
        ...(activeTab === "newStrategy" && {
          is_new_strategy: true,
          strategy_type: newStrategyData.selectedStrategy,
        }),
      };

      console.log('Sending order payload:', orderPayload);

      const response = await fetch('/api/cashfree/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(orderPayload),
      });

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch {
          errorData = { error: `Server error: ${response.status}` };
        }
        console.error('API Error Response:', errorData);
        throw new Error(errorData.error || errorData.message || 'Failed to create payment order');
      }

      const orderData = await response.json();
      console.log('Order created successfully:', orderData);

      if (!orderData.payment_session_id) {
        console.error('Missing payment_session_id in orderData:', orderData);
        throw new Error('Payment session ID is missing in the response');
      }

      if (!orderData.order_id) {
        console.error('Missing order_id in orderData:', orderData);
        throw new Error('Order ID is missing in the response');
      }

      // Store order details for success page
      sessionStorage.setItem('qode_payment_order_id', orderData.order_id);
      sessionStorage.setItem('qode_payment_cf_order_id', orderData.cf_order_id || '');
      sessionStorage.setItem('qode_payment_type', activeTab === "newStrategy" ? 'new_strategy' : 'one_time');
      sessionStorage.setItem('qode_payment_amount', currentAmount);
      sessionStorage.setItem('qode_payment_nuvama_code', accountCodeToUse);

      toast({
        title: "Payment Starting",
        description: "Opening payment gateway...",
      });

      await initiateCashfreePayment(orderData.payment_session_id, orderData.order_id);
    }
  } catch (error) {
    console.error('Payment error:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    const actionType = activeTab === 'sip' ? 'setting up SIP' :
      activeTab === 'newStrategy' ? 'starting new strategy' : 'processing payment';

    setPaymentStatus(`Failed to ${actionType}. Please try again.`);

    toast({
      title: "Error",
      description: `${errorMessage}. Please try again or contact support.`,
      variant: "destructive",
    });
  } finally {
    setLoading(false);
  }
};

  if (!isOpen) return null;

  return (
    <>
      <ModalShell title="Investment Options" onClose={onClose} size="lg">
        <div className="text-center hidden mb-[20px]">
          <div className="flex items-center justify-center mb-[10px]">
            <IndianRupee className="sm:w-[40px] sm:h-[40px] text-primary mr-[5px]" />
            <h1 className="sm:text-[28px] text-primary font-heading text-[24px]">Invest With Qode</h1>
          </div>
          <div className="flex items-center justify-center text-[14px] text-text-secondary">
            <Lock className="sm:w-[16px] sm:h-[16px] mr-[5px]" />
            <span className="font-body">Secure Payment Gateway Powered by Cashfree</span>
          </div>
        </div>

        <div className="p-[15px]">
          <div className="flex justify-center">
            <div className="flex bg-accent rounded p-[3px]">
              <button
                onClick={() => setActiveTab('oneTime')}
                className={`px-[15px] py-[8px] text-[12px] font-semibold rounded transition-all font-body ${activeTab === 'oneTime'
                  ? 'bg-primary text-white shadow'
                  : 'text-brown hover:bg-beige'
                  }`}
              >
                <div className="flex items-center">
                  <CreditCard className="w-[16px] h-[16px] mr-[4px]" />
                  Add Funds
                </div>
              </button>

              <div
                className="relative"
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
              >
                <button
                  onClick={() => setActiveTab('sip')}
                  className={`px-[15px] py-[8px] text-[12px] font-semibold rounded transition-all font-body ${activeTab === 'sip'
                    ? 'bg-primary text-white shadow'
                    : 'text-brown hover:bg-beige'
                    }`}
                >
                  <div className="flex items-center">
                    <TrendingUp className="w-[16px] h-[16px] mr-[4px]" />
                    SIP Setup
                  </div>
                </button>
              </div>

              <button
                onClick={() => setActiveTab('newStrategy')}
                className={`px-[15px] py-[8px] text-[12px] font-semibold rounded transition-all font-body ${activeTab === 'newStrategy'
                  ? 'bg-primary text-white shadow'
                  : 'text-brown hover:bg-beige'
                  }`}
              >
                <div className="flex items-center">
                  <Plus className="w-[16px] h-[16px] mr-[4px]" />
                  Start New Strategy
                </div>
              </button>
            </div>
          </div>
        </div>

        <form ref={formRef} className="space-y-[15px]">
          {(activeTab === 'oneTime' || activeTab === 'sip') && (
            <div className="p-[12px] rounded-sm border border-lightGray">
              <label className="block text-[16px] font-semibold text-text-secondary mb-[5px] font-body">Account ID</label>
              <select
                name="nuvamaCode"
                value={formData.nuvamaCode}
                onChange={handleInputChange}
                className={`w-full p-[12px] border-2 rounded text-[14px] font-body ${errors.nuvamaCode ? "border-brown" : "border-lightGray focus:border-primary"
                  } focus:outline-none transition-all`}
                required
              >
                {clients.length > 0 ? (
                  clients.map((client) => (
                    <option key={client.clientid} value={client.clientcode}>
                      {client.clientname} - ({client.clientcode})
                    </option>
                  ))
                ) : (
                  <option value="QAW0001">QAW0001 (Default)</option>
                )}
              </select>
              <p className="text-xs text-muted-foreground mt-1">Currently selected: {selectedClientCode || "QAW0001"}</p>
              <p className="text-xs text-primary mt-1">Strategy: {getStrategyName(formData.nuvamaCode)}</p>
              {errors.nuvamaCode && <p className="mt-[5px] text-[12px] text-brown font-body">{errors.nuvamaCode}</p>}
            </div>
          )}

          {activeTab === 'newStrategy' && (
            <div className="space-y-[15px]">
              <div className="p-[12px] rounded-sm border border-lightGray">
                <label className="block text-[16px] font-semibold text-text-secondary mb-[5px] font-body">
                  Account ID
                </label>
                <select
                  name="nuvamaCode"
                  value={formData.nuvamaCode}
                  onChange={handleInputChange}
                  className="w-full p-[12px] border-2 rounded text-[14px] font-body border-lightGray focus:border-primary focus:outline-none transition-all"
                >
                  {clients.length > 0 ? (
                    clients.map((client) => (
                      <option key={client.clientid} value={client.clientcode}>
                        {client.clientname} - ({client.clientcode})
                      </option>
                    ))
                  ) : (
                    <option value="QAW0001">QAW0001 (Default)</option>
                  )}
                </select>
              </div>
              
              {loadingInvestments ? (
                <div className="p-[12px] rounded-sm border border-lightGray">
                  <div className="flex items-center justify-center py-4">
                    <Loader className="h-5 w-5 animate-spin text-primary mr-2" />
                    <span className="text-sm text-muted-foreground">Loading available strategies...</span>
                  </div>
                </div>
              ) : (
                <>
                  <div className="p-[12px] rounded-sm border border-lightGray">
                    <label className="block text-[16px] font-semibold text-text-secondary mb-[5px] font-body">
                      Select Strategy to Start
                    </label>
                    <select
                      name="selectedStrategy"
                      value={newStrategyData.selectedStrategy}
                      onChange={handleInputChange}
                      className={`w-full p-[12px] border-2 rounded text-[14px] font-body ${errors.selectedStrategy ? "border-brown" : "border-lightGray focus:border-primary"
                        } focus:outline-none transition-all`}
                      required
                    >
                      <option value="">Choose a strategy...</option>
                      {getAvailableStrategies().map((strategyCode) => (
                        <option key={strategyCode} value={strategyCode}>
                          {strategy[strategyCode]} ({strategyCode})
                        </option>
                      ))}
                    </select>
                    {errors.selectedStrategy && (
                      <p className="mt-[5px] text-[12px] text-brown font-body">{errors.selectedStrategy}</p>
                    )}
                  </div>

                  <div className="p-[12px] rounded-sm border border-lightGray">
                    <label className="block text-[16px] font-semibold text-text-secondary mb-[5px] font-body">
                      Investment Amount (₹)
                    </label>
                    <input
                      type="number"
                      name="newStrategyAmount"
                      value={newStrategyData.amount}
                      onChange={handleNewStrategyAmountChange}
                      min="100"
                      className={`w-full p-[12px] text-[14px] font-semibold border-2 rounded font-body ${errors.amount ? "border-brown" : "border-lightGray focus:border-primary"
                        } focus:outline-none transition-all`}
                      placeholder="Enter amount (e.g., 1000.00)"
                      required
                    />
                    {errors.amount && <p className="mt-[5px] text-[12px] text-brown font-body">{errors.amount}</p>}
                    <p className="mt-[5px] text-[12px] text-darkGray font-body">Minimum: ₹100</p>
                  </div>
                </>
              )}
            </div>
          )}

          {(activeTab === 'oneTime' || activeTab === 'sip') && (
            <div className="p-[12px] rounded-sm border border-lightGray">
              <label className="block text-[16px] font-semibold text-text-secondary mb-[5px] font-body">
                {activeTab === "sip" ? "SIP Amount (₹)" : "Payment Amount (₹)"}
              </label>
              <input
                type="number"
                name="amount"
                value={formData.amount}
                onChange={handleInputChange}
                min="100"
                className={`w-full p-[12px] text-[14px] font-semibold border-2 rounded font-body ${errors.amount ? "border-brown" : "border-lightGray focus:border-primary"
                  } focus:outline-none transition-all`}
                placeholder="Enter amount (e.g., 1000.00)"
                required
              />
              {errors.amount && <p className="mt-[5px] text-[12px] text-brown font-body">{errors.amount}</p>}
              <p className="mt-[5px] text-[12px] text-darkGray font-body">Minimum: ₹100</p>
            </div>
          )}

          {activeTab === "sip" && (
            <>
              <div className="p-[12px] rounded-sm border border-lightGray">
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-[15px]">
                <div className="p-[12px] rounded-sm border border-lightGray">
                  <label className="block text-[16px] font-semibold text-text-secondary mb-[5px] font-body">Start Date</label>
                  <input
                    type="date"
                    name="startDate"
                    value={sipData.startDate}
                    onChange={handleInputChange}
                    min={getTomorrowDate()}
                    className={`w-full p-[12px] border-2 rounded text-[14px] font-body ${errors.startDate ? "border-brown" : "border-lightGray focus:border-primary"
                      } focus:outline-none transition-all`}
                    required
                  />
                  {errors.startDate && <p className="mt-[5px] text-[12px] text-brown font-body">{errors.startDate}</p>}
                  <p className="mt-[5px] text-[12px] text-darkGray font-body">
                    Earliest date: {new Date(getTomorrowDate()).toLocaleDateString()}
                  </p>
                </div>

                <div className="p-[12px] rounded-sm border border-lightGray">
                  <label className="block text-[16px] font-semibold text-text-secondary mb-[5px] font-body">
                    End Date (Optional)
                  </label>
                  <input
                    type="date"
                    name="endDate"
                    value={sipData.endDate}
                    onChange={handleInputChange}
                    min={sipData.startDate}
                    className={`w-full p-[12px] border-2 rounded text-[14px] font-body ${errors.endDate ? "border-brown" : "border-lightGray focus:border-primary"
                      } focus:outline-none transition-all`}
                  />
                  {errors.endDate && <p className="mt-[5px] text-[12px] text-brown font-body">{errors.endDate}</p>}
                  <p className="mt-[5px] text-[12px] text-darkGray font-body">Leave empty for indefinite SIP</p>
                </div>
              </div>

              <div className="p-[12px] rounded-sm border border-beige">
                <div className="flex items-center mb-[10px]">
                  <Calendar className="w-[16px] h-[16px] text-primary mr-[5px]" />
                  <h3 className="text-[16px] font-semibold text-brown font-heading">SIP Summary</h3>
                </div>
                <div className="text-[14px] text-brown font-body">
                  {formData.amount && sipData.frequency && sipData.startDate ? (
                    <div className="space-y-1">
                      <p>
                        <strong>Amount:</strong> ₹{formData.amount} will be deducted {sipData.frequency}
                      </p>
                      <p>
                        <strong>Start Date:</strong> {new Date(sipData.startDate).toLocaleDateString()}
                      </p>
                      {sipData.endDate && (
                        <p>
                          <strong>End Date:</strong> {new Date(sipData.endDate).toLocaleDateString()}
                        </p>
                      )}
                      {!sipData.endDate && (
                        <p className="text-orange-600">
                          <strong>Duration:</strong> Indefinite (until you cancel)
                        </p>
                      )}
                    </div>
                  ) : (
                    <p>Please fill in the SIP details to see the summary.</p>
                  )}
                </div>
              </div>
            </>
          )}

          <div className="flex justify-center">
            <button
              type="button"
              onClick={handlePayment}
              disabled={!isFormValid()}
              className={`px-[20px] py-[12px] text-[14px] font-semibold text-white bg-primary rounded-sm shadow font-body transition-all ${!isFormValid()
                ? 'bg-darkGray cursor-not-allowed opacity-50'
                : 'hover:bg-brown'
                }`}
            >
              {loading ? (
                <div className="flex items-center">
                  <Loader className="animate-spin h-[16px] w-[16px] mr-[5px]" />
                  {activeTab === 'sip' ? 'Setting up SIP...' :
                    activeTab === 'newStrategy' ? 'Starting New Strategy...' : 'Processing Payment...'}
                </div>
              ) : (
                activeTab === 'sip' ? 'Setup SIP' :
                  activeTab === 'newStrategy' ? 'Start New Strategy' : 'Pay Now'
              )}
            </button>
          </div>

          {paymentStatus && (
            <div className="p-[12px] rounded-sm border border-beige">
              <div className="flex items-center">
                <Info className="w-[16px] h-[16px] text-brown mr-[5px]" />
                <p className="text-[14px] text-brown font-body">{paymentStatus}</p>
              </div>
            </div>
          )}

          {process.env.NODE_ENV === 'development' && (
            <div className="p-3 bg-gray-100 rounded text-xs space-y-1">
              <p><strong>Debug Info:</strong></p>
              <p>Active Tab: {activeTab}</p>
              <p>Available Strategies: {getAvailableStrategies().join(', ') || 'None'}</p>
              <p>User Investments: {userInvestments.join(', ') || 'None'}</p>
              <p>Form Valid: {isFormValid().toString()}</p>
              <p>Current Amount: {activeTab === 'newStrategy' ? newStrategyData.amount : formData.amount}</p>
              <p>Selected Strategy: {newStrategyData.selectedStrategy || 'None'}</p>
            </div>
          )}
        </form>

      </ModalShell>

      <SummaryModal />
    </>
  );
}

function SwitchReallocationModal({
  isOpen,
  onClose,
  selectedClientCode,
  selectedClientId,
  selectedEmailClient,
  clients,
}: {
  isOpen: boolean;
  onClose: () => void;
  selectedClientCode: string;
  selectedClientId: string;
  selectedEmailClient: string;
  clients: { clientid: string; clientcode: string; clientname: string }[];
}) {
  const [formData, setFormData] = useState({
    investedIn: selectedClientCode ? selectedClientCode.slice(0, 3) : "QGF",
    switchTo: "",
    amount: "",
    reason: "",
    additionalNotes: "",
    nuvamaCode: selectedClientCode || "QAW0001",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "success" | "error">("idle");
  const { toast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);

  // Strategy mapping
  const strategy = {
    'QFH': 'Qode Future Horizons',
    'QAW': 'Qode All Weather',
    'QTF': 'Qode Tactical Fund',
    'QGF': 'Qode Growth Fund'
  };

  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      nuvamaCode: selectedClientCode || "QAW0001",
      investedIn: selectedClientCode ? selectedClientCode.slice(0, 3) : "QGF",
    }));
  }, [selectedClientCode]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
      nuvamaCode: fd.get("nuvama-code")?.toString() || selectedClientCode,
      investedIn: fd.get("invested-in")?.toString() || (selectedClientCode ? selectedClientCode.slice(0, 3) : "QGF"),
      switchTo: fd.get("switch-to")?.toString() || "",
      amount: fd.get("amount")?.toString() || "",
      reason: fd.get("reason")?.toString() || "",
      additionalNotes: fd.get("additional-notes")?.toString() || "",
    };

    if (!payload.switchTo || !payload.reason || !payload.amount || !payload.nuvamaCode) {
      toast({ title: "Error", description: "Please fill in all required fields including Account ID.", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus("idle");
    // Use the actual user email from props instead of hardcoded email
    const userEmail = selectedEmailClient || "user@example.com";

    const emailHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <style>body{font-family:Lato,Arial,sans-serif;line-height:1.6;color:#002017;background-color:#EFECD3}
      .container{max-width:600px;margin:0 auto;padding:20px}.header{background:#02422B;padding:20px;border-radius:8px;margin-bottom:20px;text-align:center}
      .content{background:#FFFFFF;padding:20px;border:1px solid #37584F;border-radius:8px}.info-box{background:#EFECD3;padding:15px;border-left:4px solid #DABD38;margin:15px 0}
      h1{font-family:'Playfair Display',Georgia,serif;color:#DABD38}h3{font-family:'Playfair Display',Georgia,serif;color:#37584F}</style>
      </head><body><div class="container"><div class="header">
      <h1 style="margin:0;">Switch/Reallocation Request</h1></div>
      <div class="content"><p><strong>Request Type:</strong> Switch/Reallocation</p>
      <p><strong>Submitted via:</strong> myQode Portal</p><p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
      <div class="info-box"><h3 style="margin-top:0;">Request Details:</h3>
      <p><strong>Account ID:</strong> ${payload.nuvamaCode}</p>
      <p><strong>Client ID:</strong> ${selectedClientId}</p>
      <p><strong>User Email:</strong> ${userEmail}</p>
      <p><strong>Currently Invested In:</strong> ${payload.investedIn}</p>
      <p><strong>Switch To:</strong> ${payload.switchTo}</p>
      <p><strong>Amount:</strong> ${payload.amount}</p>
      <p><strong>Reason:</strong> ${payload.reason.replace(/\n/g, "<br>")}</p>
      ${payload.additionalNotes ? `<p><strong>Additional Notes:</strong> ${payload.additionalNotes.replace(/\n/g, "<br>")}</p>` : ""}
      </div><p style="margin-top:20px;font-size:14px;color:#37584F;">This message was sent from the myQode Portal. Please review and process the request.</p>
      </div></div></body></html>`;

    try {
      await sendEmail({
        to: "sanket.shinde@qodeinvest.com",
        subject: `New Switch/Reallocation Request from ${payload.nuvamaCode}`,
        html: emailHtml,
        from: "investor.relations@qodeinvest.com",
        fromName: "Qode Investor Relations",
        inquiry_type: "switch",
        nuvama_code: payload.nuvamaCode,
        client_id: selectedClientId,
        user_email: userEmail,
        priority: "normal",
        inquirySpecificData: {
          invested_in: payload.investedIn,
          switch_to: payload.switchTo,
          amount: payload.amount,
          reason: payload.reason,
          additional_notes: payload.additionalNotes,
        },
      });

      setSubmitStatus("success");
      toast({ title: "Thank you!", description: "Your switch/reallocation request has been submitted successfully." });
      setFormData({
        investedIn: selectedClientCode ? selectedClientCode.slice(0, 3) : "QGF",
        switchTo: "",
        amount: "",
        reason: "",
        additionalNotes: "",
        nuvamaCode: selectedClientCode || "QAW0001",
      });
      formRef.current?.reset();
      setTimeout(() => {
        setSubmitStatus("idle");
        onClose();
      }, 2000);
    } catch (error) {
      console.error("Switch submission error:", error);
      setSubmitStatus("error");
      toast({ title: "Error", description: "Failed to send your request. Please try again or contact us directly.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <ModalShell title="Request Switch/Reallocation" onClose={onClose} size="md">
      <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Account ID *</label>
          <select
            name="nuvama-code"
            value={formData.nuvamaCode}
            onChange={(e) => setFormData({ ...formData, nuvamaCode: e.target.value, investedIn: e.target.value.slice(0, 3) })}
            className="w-full p-3 border border-border rounded-md text-foreground focus:ring-2 focus:ring-primary focus:border-primary"
            required
          >
            {clients.length > 0 ? (
              clients.map((client) => (
                <option key={client.clientid} value={client.clientcode}>
                  {client.clientname} - ({client.clientcode})
                </option>
              ))
            ) : (
              <option value="QAW0001">QAW0001 (Default)</option>
            )}
          </select>
          <p className="text-xs text-muted-foreground mt-1">Currently selected: {selectedClientCode}</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Currently Invested In</label>
          <input
            name="invested-in"
            type="text"
            value={`${strategy[formData.investedIn]} - ${formData.investedIn}`}
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
            className="w-full p-3 border border-border rounded-md text-foreground focus:ring-2 focus:ring-primary focus:border-primary"
            required
          >
            <option value="">Select Strategy</option>
            {Object.entries(strategy)
              .filter(([value]) => value !== formData.investedIn)
              .map(([value, label]) => (
                <option key={value} value={value}>
                  {label} ({value})
                </option>
              ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Amount *</label>
          <input
            name="amount"
            type="text"
            value={formData.amount}
            onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
            className="w-full p-3 border border-border rounded-md text-foreground focus:ring-2 focus:ring-primary focus:border-primary"
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
            className="w-full p-3 border border-border rounded-md text-foreground resize-none focus:ring-2 focus:ring-primary focus:border-primary"
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
            className="w-full p-3 border border-border rounded-md text-foreground resize-none focus:ring-2 focus:ring-primary focus:border-primary"
            placeholder="Any additional notes..."
          />
        </div>

        {submitStatus === "success" && (
          <div className="p-3 bg-green-100 border border-green-400 text-green-700 rounded text-sm">
            Your switch/reallocation request has been sent successfully! Our team will review it and get back to you.
          </div>
        )}
        {submitStatus === "error" && (
          <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded text-sm">
            Failed to send your request. Please try again or contact us directly.
          </div>
        )}

        <div className="flex gap-3 justify-end pt-2">
          <button
            type="button"
            onClick={() => {
              setFormData({
                investedIn: selectedClientCode ? selectedClientCode.slice(0, 3) : "QGF",
                switchTo: "",
                amount: "",
                reason: "",
                additionalNotes: "",
                nuvamaCode: selectedClientCode || "QAW0001",
              });
              setSubmitStatus("idle");
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
            {isSubmitting ? "Sending..." : "Request"}
          </button>
        </div>

      </form>
    </ModalShell>
  );
}

/* ---------------------------
   Withdrawal Modal
---------------------------- */
function WithdrawalModal({
  isOpen,
  onClose,
  selectedClientCode,
  selectedClientId,
  selectedEmailClient,
  clients,
}: {
  isOpen: boolean;
  onClose: () => void;
  selectedClientCode: string;
  selectedClientId: string;
  selectedEmailClient: string;
  clients: { clientid: string; clientcode: string }[];
}) {
  const [formData, setFormData] = useState({
    nuvamaCode: selectedClientCode || "",
    amount: "",
    additionalNotes: ""
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "success" | "error">("idle");
  const { toast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      nuvamaCode: selectedClientCode || ""
    }));
  }, [selectedClientCode]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
      nuvamaCode: fd.get("nuvama-code")?.toString() || selectedClientCode,
      amount: fd.get("amount")?.toString() || "",
      additionalNotes: fd.get("additional-notes")?.toString() || "",
    };

    if (!payload.amount || !payload.nuvamaCode) {
      toast({ title: "Error", description: "Please provide an Account ID and withdrawal amount.", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus("idle");
    // Use the actual user email from props instead of hardcoded email
    const userEmail = selectedEmailClient || "user@example.com";

    const emailHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <style>body{font-family:Lato,Arial,sans-serif;line-height:1.6;color:#002017;background-color:#EFECD3}
      .container{max-width:600px;margin:0 auto;padding:20px}.header{background:#02422B;padding:20px;border-radius:8px;margin-bottom:20px;text-align:center}
      .content{background:#FFFFFF;padding:20px;border:1px solid #37584F;border-radius:8px}.info-box{background:#EFECD3;padding:15px;border-left:4px solid #DABD38;margin:15px 0}
      h1{font-family:'Playfair Display',Georgia,serif;color:#DABD38}h3{font-family:'Playfair Display',Georgia,serif;color:#37584F}</style>
      </head><body><div class="container"><div class="header">
      <h1 style="margin:0;">Withdrawal Request</h1></div>
      <div class="content"><p><strong>Request Type:</strong> Withdrawal</p>
      <p><strong>Submitted via:</strong> myQode Portal</p><p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
      <div class="info-box"><h3 style="margin-top:0;">Request Details:</h3>
      <p><strong>Account ID:</strong> ${payload.nuvamaCode}</p>
      <p><strong>Client ID:</strong> ${selectedClientId}</p>
      <p><strong>User Email:</strong> ${userEmail}</p>
      <p><strong>Amount:</strong> ${payload.amount}</p>
      ${payload.additionalNotes ? `<p><strong>Additional Notes:</strong> ${payload.additionalNotes.replace(/\n/g, "<br>")}</p>` : ""}
      </div><p style="margin-top:20px;font-size:14px;color:#37584F;">This message was sent from the myQode Portal. Please review and process the request.</p>
      </div></div></body></html>`;

    try {
      await sendEmail({
        to: "sanket.shinde@qodeinvest.com",
        subject: `New Withdrawal Request from ${payload.nuvamaCode}`,
        html: emailHtml,
        from: "investor.relations@qodeinvest.com",
        fromName: "Qode Investor Relations",
        inquiry_type: "withdrawal",
        nuvama_code: payload.nuvamaCode,
        client_id: selectedClientId,
        user_email: userEmail,
        priority: "normal",
        inquirySpecificData: { amount: payload.amount, additional_notes: payload.additionalNotes },
      });

      setSubmitStatus("success");
      toast({ title: "Thank you!", description: "Your withdrawal request has been submitted successfully." });
      setFormData({ nuvamaCode: selectedClientCode || "", amount: "", additionalNotes: "" });
      formRef.current?.reset();
      setTimeout(() => {
        setSubmitStatus("idle");
        onClose();
      }, 2000);
    } catch (error) {
      console.error("Withdrawal submission error:", error);
      setSubmitStatus("error");
      toast({ title: "Error", description: "Failed to send your request. Please try again or contact us directly.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <ModalShell title="Submit Withdrawal Request" onClose={onClose} size="sm">
      <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Account ID *</label>
          <select
            name="nuvama-code"
            value={formData.nuvamaCode}
            onChange={(e) => setFormData({ ...formData, nuvamaCode: e.target.value })}
            className="w-full p-3 border border-border rounded-md text-foreground focus:ring-2 focus:ring-primary focus:border-primary"
            required
          >
            <option value="">Select Account</option>
            {clients.map((c) => (
              <option key={c.clientid} value={c.clientcode}>
                {c.clientcode} ({c.clientid})
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground mt-1">
            {selectedClientCode ? `Currently selected: ${selectedClientCode}` : 'Please select an account'}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Amount *</label>
          <input
            name="amount"
            type="text"
            value={formData.amount}
            onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
            className="w-full p-3 border border-border rounded-md text-foreground focus:ring-2 focus:ring-primary focus:border-primary"
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
            className="w-full p-3 border border-border rounded-md text-foreground resize-none focus:ring-2 focus:ring-primary focus:border-primary"
            placeholder="Any additional notes..."
          />
        </div>

        {submitStatus === "success" && (
          <div className="p-3 bg-green-100 border border-green-400 text-green-700 rounded text-sm">
            Your withdrawal request has been sent successfully! Our team will review it and get back to you.
          </div>
        )}
        {submitStatus === "error" && (
          <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded text-sm">
            Failed to send your request. Please try again or contact us directly.
          </div>
        )}

        <div className="flex gap-3 justify-end pt-2">
          <button
            type="button"
            onClick={() => {
              setFormData({ nuvamaCode: selectedClientCode || "", amount: "", additionalNotes: "" });
              setSubmitStatus("idle");
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
            {isSubmitting ? "Sending..." : "Submit Request"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

/* ---------------------------
   Main Page
---------------------------- */
export default function InvestmentActionsPage() {
  const [isAddFundsModalOpen, setIsAddFundsModalOpen] = useState(false);
  const [isSwitchModalOpen, setIsSwitchModalOpen] = useState(false);
  const [isWithdrawalModalOpen, setIsWithdrawalModalOpen] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [refreshResult, setRefreshResult] = useState(null);
  const { selectedClientCode, selectedClientId, clients, loading, selectedEmailClient, selectedClientMobile, selectedClientName } = useClient();
  const [cancelingSipId, setCancelingSipId] = useState(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [sipToCancel, setSipToCancel] = useState(null);

  // Function to handle SIP cancellation
  const handleCancelSip = async (sipRecord) => {
    setCancelingSipId(sipRecord.id);
    try {
      const response = await fetch('/api/cancel-sip', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subscription_id: sipRecord.order_id,
          nuvama_code: selectedClientCode,
        }),
      });

      const result = await response.json();

      if (result.success) {
        // Show success message
        setRefreshResult({
          total: 1,
          updated: 1,
          failed: 0,
          sipsCancelled: 1,
          message: 'SIP cancelled successfully'
        });

        // Refresh transactions to show updated status
        await fetchTransactions();

        // Clear success message after 5 seconds
        setTimeout(() => {
          setRefreshResult(null);
        }, 5000);
      } else {
        throw new Error(result.error || 'Failed to cancel SIP');
      }
    } catch (error) {
      setError(`Failed to cancel SIP: ${error.message}`);
      setTimeout(() => {
        setError(null);
      }, 5000);
    } finally {
      setCancelingSipId(null);
      setCancelDialogOpen(false);
      setSipToCancel(null);
    }
  };

  const openCancelDialog = (sipRecord) => {
    setSipToCancel(sipRecord);
    setCancelDialogOpen(true);
  };

  // Add these state variables
  const [pausingSipId, setPausingSipId] = useState(null);
  const [pauseDialogOpen, setPauseDialogOpen] = useState(false);
  const [sipToPause, setSipToPause] = useState(null);

  // Function to handle SIP pause/resume
  const handlePauseSip = async (sipRecord) => {
    setPausingSipId(sipRecord.id);
    try {
      const action = ['PAUSED', 'CUSTOMER_PAUSED'].includes(sipRecord.payment_status.toUpperCase()) ? 'resume' : 'pause';

      const response = await fetch('/api/pause-resume-sip', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subscription_id: sipRecord.order_id,
          nuvama_code: selectedClientCode,
          action: action,
        }),
      });

      const result = await response.json();

      if (result.success) {
        // Show success message
        setRefreshResult({
          total: 1,
          updated: 1,
          failed: 0,
          sipsPaused: action === 'pause' ? 1 : 0,
          sipsResumed: action === 'resume' ? 1 : 0,
          message: `SIP ${action}d successfully`
        });

        // Refresh transactions to show updated status
        await fetchTransactions();

        // Clear success message after 5 seconds
        setTimeout(() => {
          setRefreshResult(null);
        }, 5000);
      } else {
        throw new Error(result.error || `Failed to ${action} SIP`);
      }
    } catch (error) {
      setError(`Failed to ${['PAUSED', 'CUSTOMER_PAUSED'].includes(sipRecord.payment_status.toUpperCase()) ? 'resume' : 'pause'} SIP: ${error.message}`);
      setTimeout(() => {
        setError(null);
      }, 5000);
    } finally {
      setPausingSipId(null);
      setPauseDialogOpen(false);
      setSipToPause(null);
    }
  };

  const openPauseDialog = (sipRecord) => {
    setSipToPause(sipRecord);
    setPauseDialogOpen(true);
  };

  // Helper function to check if SIP can be cancelled
  const canCancelSip = (tx) => {
    return tx.payment_type === 'SIP' &&
      ['ACTIVE', 'BANK_APPROVAL_PENDING', 'PENDING', 'ON_HOLD', 'CUSTOMER_PAUSED'].includes(tx.payment_status.toUpperCase());
  };

  // Helper function to check if SIP can be paused/resumed
  const canPauseResumeSip = (tx) => {
    return tx.payment_type === 'SIP' &&
      ['ACTIVE', 'PAUSED', 'CUSTOMER_PAUSED'].includes(tx.payment_status.toUpperCase());
  };

  // Helper function to get pause/resume action text
  const getPauseResumeText = (tx) => {
    if (['PAUSED', 'CUSTOMER_PAUSED'].includes(tx.payment_status.toUpperCase())) {
      return 'Resume';
    }
    return 'Pause';
  };
  // Fetch transactions function
  const fetchTransactions = async () => {
    setIsLoadingTransactions(true);
    setError(null);
    try {
      const response = await fetch(`/api/fetch-transactions?nuvama_code=${selectedClientCode}`);
      const result = await response.json();
      if (result.success) {
        // Combine one-time and SIP transactions
        setTransactions([
          ...result.data.one_time_transactions,
          ...result.data.sip_transactions,
        ]);
      } else {
        setError(result.error || 'Failed to fetch transactions');
      }
    } catch (err) {
      setError('Failed to fetch transactions');
    } finally {
      setIsLoadingTransactions(false);
    }
  };

  // Fetch transactions when selectedClientId changes
  useEffect(() => {
    if (selectedClientCode) {
      fetchTransactions();
    }
  }, [selectedClientCode]);

  // Refresh transaction status function
  const refreshTransactionStatus = async () => {
    if (!selectedClientCode) return;

    setIsRefreshing(true);
    setRefreshResult(null);
    setError(null);

    try {
      // First get pending/active transactions for this client
      const pendingTxResponse = await fetch(
        `/api/sync-client-orders?nuvama_code=${selectedClientCode}&status=pending`
      );
      const pendingResult = await pendingTxResponse.json();

      if (!pendingResult.success) {
        throw new Error(pendingResult.error || 'Failed to sync orders');
      }

      // Show refresh result
      setRefreshResult(pendingResult.results);

      // Refetch transactions to show updated data
      await fetchTransactions();

      // Clear refresh result after 5 seconds
      setTimeout(() => {
        setRefreshResult(null);
      }, 5000);

    } catch (err) {
      setError(`Refresh failed: ${err.message}`);
      setTimeout(() => {
        setError(null);
      }, 5000);
    } finally {
      setIsRefreshing(false);
    }
  };


  if (loading) {
    return (
      <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading your account details...</p>
        </div>
      </main>
    );
  }

  if (clients.length === 0) {
    return (
      <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-background">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">Investment Actions</h1>
          <p className="text-sm text-muted-foreground max-w-md">
            No client accounts found. Please contact{" "}
            <a href="mailto:support@qodeinvest.com" className="text-primary hover:underline">
              support@qodeinvest.com
            </a>{" "}
            to set up your account.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <header className="mb-2">
        <div className="flex flex-col items-center sm:flex-row sm:justify-between sm:items-end">
          <div>
            <h1 className="text-pretty text-xl font-bold text-foreground flex items-center gap-2">Manage Your Investments</h1>
            <p className="text-sm text-muted-foreground">
              Seamlessly manage your portfolio with Qode. Add funds, switch strategies, or withdraw capital securely and efficiently.
              {selectedClientCode && <span className="ml-2 font-medium text-primary">Account: {selectedClientCode}</span>}
            </p>
          </div>
        </div>
      </header>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <InfoCard
          title="Add Funds or SIP"
          icon={CreditCard}
          action={
            <Button
              onClick={() => setIsAddFundsModalOpen(true)}
              className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
              aria-label="Add Funds or Create SIP"
            >
              Add Funds / SIP
            </Button>
          }
        >
          <div className="flex items-start gap-2">
            <span className="mt-1 text-primary" aria-hidden="true">
              •
            </span>
            <p>Top up your investment anytime with a one-time payment.</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-1 text-primary" aria-hidden="true">
              •
            </span>
            <p>
              Set up a <span className="font-semibold">Systematic Investment Plan (SIP)</span> for disciplined, periodic investing.
            </p>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-1 text-primary" aria-hidden="true">
              •
            </span>
            <p>
              <span className="font-semibold">Timeline:</span> Executed T+1 after funds reflect in the PMS bank account.
            </p>
          </div>
        </InfoCard>

        {/* <InfoCard
          title="Manage SIPs"
          icon={Settings}
          action={
            <Button
              onClick={() => setIsSipManagementModalOpen(true)}
              className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              aria-label="Manage SIP Subscriptions"
            >
              Manage SIPs
            </Button>
          }
        >
          <div className="flex items-start gap-2">
            <span className="mt-1 text-blue-600" aria-hidden="true">
              •
            </span>
            <p>Pause, resume, or cancel your existing SIP subscriptions.</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-1 text-blue-600" aria-hidden="true">
              •
            </span>
            <p>View detailed information about all your active SIPs.</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-1 text-blue-600" aria-hidden="true">
              •
            </span>
            <p>
              <span className="font-semibold">Control:</span> Manage your automated investments as per your needs.
            </p>
          </div>
        </InfoCard> */}

        <InfoCard
          title="Switch Strategy"
          icon={TrendingUp}
          action={
            <Button
              onClick={() => setIsSwitchModalOpen(true)}
              className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
              aria-label="Request Switch or Reallocation"
            >
              Switch/Reallocate
            </Button>
          }
        >
          <div className="flex items-start gap-2">
            <span className="mt-1 text-primary" aria-hidden="true">
              •
            </span>
            <p>Move investments between Qode strategies to align with your goals.</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-1 text-primary" aria-hidden="true">
              •
            </span>
            <p>Adjust your portfolio to adapt to changing market conditions.</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-1 text-primary" aria-hidden="true">
              •
            </span>
            <p>
              <span className="font-semibold">Timeline:</span> Processed during the next rebalancing window.
            </p>
          </div>
        </InfoCard>

        <InfoCard
          title="Bank Transfer / RTGS"
          icon={IndianRupee}
          action={
            <Button
              onClick={() => {
                // Copy bank details to clipboard
                const bankDetails = `Qode Advisors LLP
Account Number: 43377275922
Bank: SBI Bank – Corporate Account Group Branch
IFSC Code: SBIN0009995
MICR Code: 40000213`;
                navigator.clipboard.writeText(bankDetails).then(() => {
                  toast({
                    title: "Bank Details Copied",
                    description: "Bank details have been copied to your clipboard.",
                  });
                }).catch(() => {
                  toast({
                    title: "Copy Failed",
                    description: "Please manually copy the bank details.",
                    variant: "destructive",
                  });
                });
              }}
              className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
              aria-label="Copy Bank Details"
            >
              Copy Bank Details
            </Button>
          }
        >
          <div className="flex items-start gap-2">
            <span className="mt-1 text-primary" aria-hidden="true">
              •
            </span>
            <p>Transfer funds directly via RTGS or Net Banking to Qode's bank account.</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-1 text-primary" aria-hidden="true">
              •
            </span>
            <p>
              <span className="font-semibold">Timeline:</span> Same day processing for bank transfers.
            </p>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-1 text-primary" aria-hidden="true">
              •
            </span>
            <p>
              <span className="font-semibold">Note:</span> If Transferred via NEFT, please inform Investor Relations Team. 
            </p>
          </div>
          <div className="bg-muted p-3 rounded-md mt-3">
            <p className="text-sm font-semibold text-foreground mb-2">Payable to: Qode Advisors LLP</p>
            <div className="space-y-1 text-xs text-muted-foreground">
              <p><span className="font-medium">Account Number:</span> 43377275922</p>
              <p><span className="font-medium">Bank:</span> SBI Bank – Corporate Account Group Branch</p>
              <p><span className="font-medium">IFSC Code:</span> SBIN0009995</p>
              <p><span className="font-medium">MICR Code:</span> 40000213</p>
            </div>
          </div>
        </InfoCard>

        {/* <InfoCard
          title="Withdraw Funds"
          icon={Calendar}
          action={
            <Button
              onClick={() => setIsWithdrawalModalOpen(true)}
              className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
              aria-label="Submit Withdrawal Request"
            >
              Withdraw Funds
            </Button>
          }
        >
          <div className="flex items-start gap-2">
            <span className="mt-1 text-primary" aria-hidden="true">
              •
            </span>
            <p>Request withdrawals at your convenience.</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-1 text-primary" aria-hidden="true">
              •
            </span>
            <p>Proceeds credited directly to your registered bank account.</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-1 text-primary" aria-hidden="true">
              •
            </span>
            <p>
              <span className="font-semibold">Timeline:</span> Standard T+10 days per PMS guidelines.
            </p>
          </div>
        </InfoCard> */}
      </div>

      {/* Transactions Table */}
      <section className="mt-8">
        <div className="flex items-start md:items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-foreground">Transaction History</h2>
          <div className="flex flex-col items-center lg:flex-row gap-1 md:gap-4">
            <Button
              onClick={refreshTransactionStatus}
              disabled={isRefreshing || !selectedClientCode}
              variant="outline"
              size="sm"
              className="inline-flex items-center gap-2 md:px-3 md:py-2 px-1 py-1 text-xs md:text-sm "
            >
              {isRefreshing ? (
                <Loader className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {isRefreshing ? 'Refreshing...' : 'Refresh Status'}
            </Button>
            <div className="text-xs md:text-sm text-muted-foreground">
              Last updated: {new Date().toLocaleDateString()}
            </div>
          </div>
        </div>

        {/* Refresh Result Banner */}
        {refreshResult && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span className="text-sm font-medium text-green-800">Refresh Completed</span>
            </div>
            <div className="text-sm text-green-700 space-y-1">
              <div>• Total orders checked: {refreshResult.total}</div>
              <div>• Updated: {refreshResult.updated}</div>
              <div>• Failed: {refreshResult.failed}</div>
              {refreshResult.updated > 0 && (
                <div className="text-xs text-green-600 mt-2">
                  Transaction statuses have been updated with the latest information from Cashfree.
                </div>
              )}
            </div>
          </div>
        )}

        {isLoadingTransactions ? (
          <div className="flex justify-center items-center py-12 bg-card rounded-lg border">
            <Loader className="h-6 w-6 animate-spin text-primary" />
            <span className="ml-2 text-sm text-muted-foreground">Loading transactions...</span>
          </div>
        ) : error ? (
          <div className="p-6 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-600 flex items-center gap-2">
              <span className="w-2 h-2 bg-red-500 rounded-full"></span>
              {error}
            </p>
          </div>
        ) : transactions.length === 0 ? (
          <div className="p-12 text-center bg-card border rounded-lg">
            <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
              <Calendar className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">No transactions found.</p>
            <p className="text-xs text-muted-foreground mt-1">Your transaction history will appear here once you make your first investment.</p>
          </div>
        ) : (
          <div className="bg-card border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Order ID
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Type
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Amount
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Currency
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Frequency
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Start Date
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Next Charge
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Account
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {transactions.map((tx, index) => (
                    <tr
                      key={tx.id}
                      className={`hover:bg-muted/20 transition-colors ${index % 2 === 0 ? 'bg-background' : 'bg-muted/10'
                        }`}
                    >
                      {/* ... existing table cells ... */}
                      <td className="px-6 py-4 text-sm font-medium text-foreground">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${tx.payment_type === 'SIP' ? 'bg-blue-500' : 'bg-primary/20'
                            }`}></span>
                          {tx.order_id}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-foreground">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${tx.payment_type === 'SIP'
                          ? 'bg-blue-100 text-blue-800'
                          : tx.payment_type.toLowerCase().includes('deposit') || tx.payment_type.toLowerCase().includes('add')
                            ? 'bg-green-100 text-green-800'
                            : tx.payment_type.toLowerCase().includes('withdrawal')
                              ? 'bg-red-100 text-red-800'
                              : tx.payment_type.toLowerCase().includes('switch') || tx.payment_type.toLowerCase().includes('reallocation')
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-gray-100 text-gray-800'
                          }`}>
                          {tx.payment_type}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm font-semibold text-foreground text-right">
                        <div className="flex items-center justify-end gap-1">
                          <span className={tx.payment_type.toLowerCase().includes('withdrawal') ? 'text-red-600' : 'text-green-600'}>
                            {tx.payment_type.toLowerCase().includes('withdrawal') ? '-' : '+'}
                          </span>
                          {tx.amount.toLocaleString()}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        <span className="font-mono text-xs bg-muted px-2 py-1 rounded">
                          {tx.currency}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-foreground">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${tx.payment_status.toLowerCase() === 'completed' || tx.payment_status.toLowerCase() === 'paid' || tx.payment_status.toLowerCase() === 'success'
                            ? 'bg-green-500'
                            : tx.payment_status.toLowerCase() === 'pending' || tx.payment_status.toLowerCase() === 'active' || tx.payment_status.toLowerCase() === 'bank_approval_pending'
                              ? 'bg-yellow-500'
                              : tx.payment_status.toLowerCase() === 'paused' || tx.payment_status.toLowerCase() === 'on_hold' || tx.payment_status.toLowerCase() === 'customer_paused'
                                ? 'bg-orange-500'
                                : tx.payment_status.toLowerCase() === 'cancelled' || tx.payment_status.toLowerCase() === 'customer_cancelled'
                                  ? 'bg-gray-500'
                                  : tx.payment_status.toLowerCase() === 'failed'
                                    ? 'bg-red-500'
                                    : 'bg-gray-400'
                            }`}></div>
                          <span className={`text-sm ${tx.payment_status.toLowerCase() === 'completed' || tx.payment_status.toLowerCase() === 'paid' || tx.payment_status.toLowerCase() === 'success'
                            ? 'text-green-700'
                            : tx.payment_status.toLowerCase() === 'pending' || tx.payment_status.toLowerCase() === 'active' || tx.payment_status.toLowerCase() === 'bank_approval_pending'
                              ? 'text-yellow-700'
                              : tx.payment_status.toLowerCase() === 'paused' || tx.payment_status.toLowerCase() === 'on_hold' || tx.payment_status.toLowerCase() === 'customer_paused'
                                ? 'text-orange-700'
                                : tx.payment_status.toLowerCase() === 'cancelled' || tx.payment_status.toLowerCase() === 'customer_cancelled'
                                  ? 'text-gray-700'
                                  : tx.payment_status.toLowerCase() === 'failed'
                                    ? 'text-red-700'
                                    : 'text-muted-foreground'
                            }`}>
                            {tx.payment_status.replace(/_/g, ' ')}
                          </span>
                          {tx.synced_at && new Date(tx.synced_at) > new Date(Date.now() - 30000) && (
                            <span className="ml-1 text-xs text-green-600 bg-green-100 px-1 py-0.5 rounded">
                              Updated
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        <div className="flex flex-col">
                          <span>{new Date(tx.created_at).toLocaleDateString()}</span>
                          <span className="text-xs text-muted-foreground/70">
                            {new Date(tx.created_at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        {tx.frequency ? (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800">
                            {tx.frequency}
                          </span>
                        ) : (
                          <span className="text-gray-400">One-time</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        {tx.payment_type === 'SIP' && tx.start_date ? (
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">
                              {new Date(tx.start_date).toLocaleDateString()}
                            </span>
                            <span className="text-xs text-muted-foreground/70">
                              {new Date(tx.start_date) <= new Date() ? 'Started' : 'Will start'}
                            </span>
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        {tx.payment_type === 'SIP' && tx.next_charge_date ? (
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">
                              {new Date(tx.next_charge_date).toLocaleDateString()}
                            </span>
                            <span className="text-xs text-muted-foreground/70">
                              {new Date(tx.next_charge_date) > new Date() ? 'Upcoming' : 'Due'}
                            </span>
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        <span className="font-mono text-xs">
                          {tx.account_number || 'N/A'}
                        </span>
                      </td>

                      {/* Actions Column */}
                      <td className="px-6 py-4 text-sm">
                        <div className="flex items-center gap-2">
                          {tx.payment_type === 'SIP' ? (
                            <div className="flex items-center gap-1">
                              {canPauseResumeSip(tx) && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openPauseDialog(tx)}
                                  disabled={pausingSipId === tx.id}
                                  className={`inline-flex items-center gap-1 px-2 py-1 text-xs ${['PAUSED', 'CUSTOMER_PAUSED'].includes(tx.payment_status.toUpperCase())
                                    ? 'border-green-200 text-green-600 hover:bg-green-50 hover:border-green-300'
                                    : 'border-orange-200 text-orange-600 hover:bg-orange-50 hover:border-orange-300'
                                    }`}
                                >
                                  {pausingSipId === tx.id ? (
                                    <Loader className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <div className={`h-3 w-3 ${['PAUSED', 'CUSTOMER_PAUSED'].includes(tx.payment_status.toUpperCase())
                                      ? 'bg-green-500 rounded-full'
                                      : 'bg-orange-500 rounded-sm'
                                      }`}></div>
                                  )}
                                  {pausingSipId === tx.id ? 'Processing...' : getPauseResumeText(tx)}
                                </Button>
                              )}

                              {canCancelSip(tx) && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openCancelDialog(tx)}
                                  disabled={cancelingSipId === tx.id}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-xs border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300"
                                >
                                  {cancelingSipId === tx.id ? (
                                    <Loader className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <X className="h-3 w-3" />
                                  )}
                                  {cancelingSipId === tx.id ? 'Cancelling...' : 'Cancel'}
                                </Button>
                              )}

                              {!canPauseResumeSip(tx) && !canCancelSip(tx) && (
                                <span className="text-xs text-muted-foreground">
                                  No actions available
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Table Footer */}
            <div className="px-6 py-4 bg-muted/20 border-t">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Showing {transactions.length} transaction{transactions.length !== 1 ? 's' : ''}</span>
                <div className="flex items-center gap-4">
                  <span>Total transactions: {transactions.length}</span>
                  {refreshResult && refreshResult.updated > 0 && (
                    <span className="text-green-600">
                      {refreshResult.updated} recently updated
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Pause/Resume SIP Confirmation Dialog */}
      <AlertDialog open={pauseDialogOpen} onOpenChange={setPauseDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <div className={`h-5 w-5 ${sipToPause && ['PAUSED', 'CUSTOMER_PAUSED'].includes(sipToPause.payment_status.toUpperCase())
                ? 'bg-green-500 rounded-full'
                : 'bg-orange-500 rounded-sm'
                }`}></div>
              {sipToPause && ['PAUSED', 'CUSTOMER_PAUSED'].includes(sipToPause.payment_status.toUpperCase())
                ? 'Resume SIP Subscription'
                : 'Pause SIP Subscription'
              }
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                {sipToPause && ['PAUSED', 'CUSTOMER_PAUSED'].includes(sipToPause.payment_status.toUpperCase())
                  ? 'Are you sure you want to resume this SIP subscription? Future payments will be automatically debited as scheduled.'
                  : 'Are you sure you want to pause this SIP subscription? No future payments will be debited until you resume it.'
                }
              </p>
              {sipToPause && (
                <div className="bg-muted p-3 rounded-lg space-y-1">
                  <div className="text-sm">
                    <span className="font-medium">Order ID:</span> {sipToPause.order_id}
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">Amount:</span> {sipToPause.currency} {sipToPause.amount.toLocaleString()}
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">Frequency:</span> {sipToPause.frequency || 'Monthly'}
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">Current Status:</span> {sipToPause.payment_status.replace(/_/g, ' ')}
                  </div>
                  {sipToPause.next_charge_date && (
                    <div className="text-sm">
                      <span className="font-medium">Next Charge:</span> {new Date(sipToPause.next_charge_date).toLocaleDateString()}
                    </div>
                  )}
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                <strong>Note:</strong> You can {sipToPause && ['PAUSED', 'CUSTOMER_PAUSED'].includes(sipToPause.payment_status.toUpperCase()) ? 'pause' : 'resume'} this SIP again at any time from this interface.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pausingSipId}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => sipToPause && handlePauseSip(sipToPause)}
              disabled={pausingSipId}
              className={sipToPause && ['PAUSED', 'CUSTOMER_PAUSED'].includes(sipToPause.payment_status.toUpperCase())
                ? "bg-green-600 hover:bg-green-700 text-white"
                : "bg-orange-600 hover:bg-orange-700 text-white"
              }
            >
              {pausingSipId ? (
                <>
                  <Loader className="h-4 w-4 animate-spin mr-2" />
                  Processing...
                </>
              ) : (
                <>
                  <div className={`h-4 w-4 mr-2 ${sipToPause && ['PAUSED', 'CUSTOMER_PAUSED'].includes(sipToPause.payment_status.toUpperCase())
                    ? 'bg-white rounded-full'
                    : 'bg-white rounded-sm'
                    }`}></div>
                  {sipToPause && ['PAUSED', 'CUSTOMER_PAUSED'].includes(sipToPause.payment_status.toUpperCase())
                    ? 'Resume SIP'
                    : 'Pause SIP'
                  }
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel SIP Confirmation Dialog */}
      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Cancel SIP Subscription
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                Are you sure you want to cancel this SIP subscription?
              </p>
              {sipToCancel && (
                <div className="bg-muted p-3 rounded-lg space-y-1">
                  <div className="text-sm">
                    <span className="font-medium">Order ID:</span> {sipToCancel.order_id}
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">Amount:</span> {sipToCancel.currency} {sipToCancel.amount.toLocaleString()}
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">Frequency:</span> {sipToCancel.frequency || 'Monthly'}
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">Status:</span> {sipToCancel.payment_status.replace(/_/g, ' ')}
                  </div>
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                <strong>Note:</strong> Once cancelled, this SIP cannot be reactivated. You'll need to create a new SIP if you want to continue periodic investments.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelingSipId}>
              Keep SIP Active
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => sipToCancel && handleCancelSip(sipToCancel)}
              disabled={cancelingSipId}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {cancelingSipId ? (
                <>
                  <Loader className="h-4 w-4 animate-spin mr-2" />
                  Cancelling...
                </>
              ) : (
                <>
                  <X className="h-4 w-4 mr-2" />
                  Cancel SIP
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modals */}
      <AddFundsModal
        isOpen={isAddFundsModalOpen}
        onClose={() => setIsAddFundsModalOpen(false)}
        selectedClientCode={selectedClientCode}
        selectedClientId={selectedClientId}
        clients={clients}
        customer_name={selectedClientName}
        customer_email={selectedEmailClient}
        customer_phone={selectedClientMobile}
      />
      {/* <SipManagementModal
        isOpen={isSipManagementModalOpen}
        onClose={() => setIsSipManagementModalOpen(false)}
        selectedClientCode={selectedClientCode}
        onSipUpdated={handleSipUpdated}
      /> */}
      <SwitchReallocationModal
        isOpen={isSwitchModalOpen}
        onClose={() => setIsSwitchModalOpen(false)}
        selectedClientCode={selectedClientCode}
        selectedClientId={selectedClientId}
        selectedEmailClient={selectedEmailClient} // Add this prop
        clients={clients}
      />
      {/* <WithdrawalModal
        isOpen={isWithdrawalModalOpen}
        onClose={() => setIsWithdrawalModalOpen(false)}
        selectedClientCode={selectedClientCode}
        selectedClientId={selectedClientId}
        selectedEmailClient={selectedEmailClient} // Add this prop
        clients={clients}
      /> */}
    </main>
  );
}