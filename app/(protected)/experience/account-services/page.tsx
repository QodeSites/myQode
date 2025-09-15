"use client";
import type React from "react";
import { useState, useRef, useEffect } from "react";
import { X, IndianRupee, Lock, CreditCard, TrendingUp, CheckCircle, Calendar, Loader, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useClient } from "@/contexts/ClientContext";


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
          h-[100dvh] sm:h-auto sm:rounded-lg
          flex flex-col max-h-[90dvh] mt-4 lg:mt-14`}
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

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-5 rounded-sm bg-primary px-4 py-2 text-center text-sm font-bold tracking-wide text-white">
      {children}
    </div>
  );
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

/* ---------------------------
   Add Funds / SIP Modal - Updated for SIP API Integration and User Data from Bank Details
---------------------------- */
function AddFundsModal({
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
  const [activeTab, setActiveTab] = useState<"oneTime" | "sip">("oneTime");
  const [loading, setLoading] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState("");
  const [showTooltip, setShowTooltip] = useState(false);
  const [accountDetails, setAccountDetails] = useState<{
    client_name: string;
    account_number_masked: string;
    account_number: string;
    ifsc_code: string;
    cashfree_bank_code: string;
    phone_number: string;
    email: string;
  } | null>(null);
  const [formData, setFormData] = useState({ nuvamaCode: selectedClientCode || "QAW0001", amount: "" });
  const [sipData, setSipData] = useState({
    frequency: 'monthly',
    startDate: '',
    endDate: '',
    amount: ''
  });
  const [errors, setErrors] = useState({
    nuvamaCode: "",
    amount: "",
    startDate: "",
    endDate: "",
  });
  const { toast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const SIP_ENABLED = true;

  useEffect(() => {
    setFormData((p) => ({ ...p, nuvamaCode: selectedClientCode || "QAW0001" }));
  }, [selectedClientCode]);

  useEffect(() => {
    if (formData.nuvamaCode) {
      const fetchBankDetails = async () => {
        try {
          const response = await fetch(`/api/bank-details?nuvama_code=${encodeURIComponent(formData.nuvamaCode)}`, {
            method: 'GET',
            credentials: 'include',
          });
          console.log('Bank details API response status:', response.status);
          if (response.ok) {
            const data = await response.json();
            console.log('Bank details fetched:', data);
            if (data.bankDetails && data.bankDetails.length > 0) {
              const bankDetail = data.bankDetails[0];
              setAccountDetails({
                client_name: bankDetail.client_name || 'Unknown Client',
                account_number_masked: bankDetail.account_number ? `XXXX-XXXX-${bankDetail.account_number.slice(-4)}` : 'N/A',
                account_number: bankDetail.account_number || '',
                ifsc_code: bankDetail.ifsc_code || 'N/A',
                cashfree_bank_code: bankDetail.cashfree_bank_code || 'CASHFREE',
                phone_number: bankDetail.phone_number || 'N/A',
                email: bankDetail.email || 'N/A',
              });
            } else {
              setAccountDetails(null);
              toast({
                title: 'Error',
                description: 'No bank details found for the selected Account ID.',
                variant: 'destructive',
              });
            }
          } else {
            console.error('Failed to fetch bank details:', response.status, response.statusText);
            setAccountDetails(null);
            toast({
              title: 'Error',
              description: 'Failed to fetch bank details. Please try again.',
              variant: 'destructive',
            });
          }
        } catch (error) {
          console.error('Error fetching bank details:', error);
          setAccountDetails(null);
          toast({
            title: 'Error',
            description: 'An error occurred while fetching bank details.',
            variant: 'destructive',
          });
        }
      };
      fetchBankDetails();
    } else {
      setAccountDetails(null);
    }
  }, [formData.nuvamaCode]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (["frequency", "startDate", "endDate"].includes(name)) {
      setSipData((prev) => ({ ...prev, [name]: value }));
      validateField(name, value);
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
      validateField(name, value);
    }
  };

  const validateField = (name: string, value: string) => {
    setErrors((prev) => {
      const ne = { ...prev };
      if (name === "nuvamaCode") {
        ne.nuvamaCode = value ? "" : "Account ID is required";
      } else if (name === "amount") {
        ne.amount = !value ? "Amount is required" : Number(value) < 100 ? "Amount must be at least ₹100" : "";
      } else if (name === "startDate" && value) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        ne.startDate = new Date(value) < tomorrow ? "Start date must be tomorrow or later" : "";
      } else if (name === "endDate" && value && sipData.startDate) {
        ne.endDate = new Date(value) < new Date(sipData.startDate) ? "End date must be after start date" : "";
      }
      return ne;
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
            description: `${activeTab === 'sip' ? 'SIP setup' : 'Payment'} timed out`,
            variant: "destructive",
          });
          reject(new Error('Payment timeout'));
        }, 300000);

        cashfree.checkout({
          paymentSessionId: orderToken,
          redirectTarget: '_self',
          onSuccess: (result) => {
            clearTimeout(paymentTimeout);
            setPaymentStatus('Payment completed successfully!');
            toast({
              title: "Payment Successful",
              description: `Your payment of ₹${formData.amount} has been processed successfully.`,
            });
            setFormData({
              nuvamaCode: selectedClientCode || 'QAW0001',
              amount: '',
            });
            setErrors({
              nuvamaCode: '',
              amount: '',
              startDate: '',
              endDate: '',
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
        }).then((result) => {
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
            console.log('SIP checkout initiated, result:', result);
            toast({
              title: "SIP Authorized",
              description: "Your SIP has been set up and authorized successfully.",
            });

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

      // Basic validation
      if (!formData?.nuvamaCode || !formData?.amount) {
        toast({
          title: "Error",
          description: "Please fill in all required fields.",
          variant: "destructive",
        });
        return;
      }

      // Validate amount is a positive number
      const amount = parseFloat(formData.amount);
      if (isNaN(amount) || amount <= 0) {
        toast({
          title: "Error",
          description: "Please enter a valid amount greater than 0.",
          variant: "destructive",
        });
        return;
      }

      if (!accountDetails) {
        toast({
          title: "Error",
          description: "Bank details not loaded. Please try again.",
          variant: "destructive",
        });
        return;
      }

      // SIP-specific validation
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

        // Validate start date is not in the past
        const startDate = new Date(sipData.startDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (startDate < today) {
          toast({
            title: "Error",
            description: "SIP start date cannot be in the past.",
            variant: "destructive",
          });
          return;
        }

        // Validate end date if provided
        if (sipData.endDate) {
          const endDate = new Date(sipData.endDate);
          if (endDate <= startDate) {
            toast({
              title: "Error",
              description: "SIP end date must be after the start date.",
              variant: "destructive",
            });
            return;
          }
        }

        // Validate frequency
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

      // Check for required user data for one-time payments
      if (activeTab !== 'sip') {
        if (!accountDetails?.email || !accountDetails?.phone_number) {
          toast({
            title: "Error",
            description: "User information is incomplete. Please try again.",
            variant: "destructive",
          });
          return;
        }

        if (!selectedClientId) {
          toast({
            title: "Error",
            description: "Client ID is missing. Please refresh and try again.",
            variant: "destructive",
          });
          return;
        }
      }

      setLoading(true);
      setPaymentStatus('');

      if (activeTab === 'sip') {
        console.log('Processing SIP flow...');

        // SIP flow
        const sipPayload = {
          order_amount: amount,
          nuvama_code: formData.nuvamaCode.trim(),
          sip_details: {
            frequency: sipData.frequency,
            start_date: sipData.startDate,
            ...(sipData.endDate && { end_date: sipData.endDate }),
          },
          order_meta: {
            return_url: `${window.location.origin}/payment/sip-success`,
          },
          account_number: accountDetails.account_number,
          ifsc_code: accountDetails.ifsc_code,
          cashfree_bank_code: String(accountDetails.cashfree_bank_code),
          client_id: selectedClientId,
          customer_name: accountDetails.client_name || 'N/A',
          customer_email: accountDetails.email,
          customer_phone: accountDetails.phone_number,
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

        // Handle different response scenarios
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

        console.log('Initiating Cashfree subscription with session ID:', subscriptionSessionId, 'Subscription ID:', subscriptionId);

        toast({
          title: "SIP Authorization Initiated",
          description: "Opening payment gateway for SIP authorization...",
        });

        await initiateCashfreeSubscription(subscriptionSessionId, subscriptionId);

      } else {
        // One-time payment flow
        console.log('Processing one-time payment flow...');

        const orderPayload = {
          amount: amount,
          currency: 'INR',
          customer_name: accountDetails.client_name || 'N/A',
          customer_email: accountDetails.email,
          customer_phone: accountDetails.phone_number,
          nuvama_code: formData.nuvamaCode.trim(),
          client_id: selectedClientId,
          order_type: 'one_time',
          return_url: `${window.location.origin}/payment/success`,
          account_number: accountDetails.account_number,
          ifsc_code: accountDetails.ifsc_code,
          cashfree_bank_code: accountDetails.cashfree_bank_code,
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

        await initiateCashfreePayment(orderData.payment_session_id, orderData.order_id);

        toast({
          title: "Payment Initiated",
          description: "Opening payment gateway...",
        });
      }
    } catch (error) {
      console.error('Payment error:', error);

      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
      const actionType = activeTab === 'sip' ? 'setting up SIP' : 'processing payment';

      setPaymentStatus(`Failed to ${actionType}. Please try again.`);

      toast({
        title: "Error",
        description: `${errorMessage}. Please try again or contact support if the issue persists.`,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;
  return (
    <ModalShell title="Add Funds / Create SIP" onClose={onClose} size="lg">
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
          <div className="flex rounded p-[3px]">
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
                onClick={() => setActiveTab('sip')}
                className={`px-[20px] py-[10px] text-[14px] font-semibold rounded transition-all font-body ${activeTab === 'sip'
                  ? 'bg-primary text-white shadow'
                  : 'text-brown hover:bg-beige'
                  }`}
              >
                <div className="flex items-center">
                  <TrendingUp className="w-[18px] h-[18px] mr-[5px]" />
                  SIP Setup
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>

      <form ref={formRef} className="space-y-[15px]">
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
                  {client.clientcode} ({client.clientid})
                </option>
              ))
            ) : (
              <option value="QAW0001">QAW0001 (Default)</option>
            )}
          </select>
          <p className="text-xs text-muted-foreground mt-1">Currently selected: {selectedClientCode || "QAW0001"}</p>
          {errors.nuvamaCode && <p className="mt-[5px] text-[12px] text-brown font-body">{errors.nuvamaCode}</p>}
        </div>

        {accountDetails && (
          <div className="p-[12px] rounded-sm border-2 border-beige">
            <div className="flex items-center mb-[10px]">
              <CheckCircle className="w-[16px] h-[16px] text-primary mr-[5px]" />
              <h3 className="text-[16px] font-semibold text-brown font-body">Verified Account Details</h3>
            </div>
            <div className="grid grid-cols-2 gap-[10px] text-[14px]">
              {renderPaymentDetail('Client Name', accountDetails.client_name, 'brown')}
              {renderPaymentDetail('Account Number', accountDetails.account_number_masked, 'brown')}
              {renderPaymentDetail('IFSC Code', accountDetails.ifsc_code, 'brown')}
              {renderPaymentDetail('Email', accountDetails.email, 'brown')}
              {renderPaymentDetail('Phone Number', accountDetails.phone_number, 'brown')}
            </div>
          </div>
        )}

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
            disabled={loading || !formData.amount || !formData.nuvamaCode || !accountDetails || Object.values(errors).some(error => error)}
            className={`px-[20px] py-[12px] text-[14px] font-semibold text-white bg-primary rounded-sm shadow font-body transition-all ${loading || !formData.amount || !formData.nuvamaCode || !accountDetails || Object.values(errors).some(error => error)
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
          <div className="p-[12px] rounded-sm border border-beige">
            <div className="flex items-center">
              <Info className="w-[16px] h-[16px] text-brown mr-[5px]" />
              <p className="text-[14px] text-brown font-body">{paymentStatus}</p>
            </div>
          </div>
        )}
      </form>

    </ModalShell>
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
    const userEmail = "user@example.com";

    const emailHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <style>body{font-family:Lato,Arial,sans-serif;line-height:1.6;color:#002017;background-color:#EFECD3}
      .container{max-width:600px;margin:0 auto;padding:20px}.header{background:#02422B;padding:20px;border-radius:8px;margin-bottom:20px;text-align:center}
      .content{background:#FFFFFF;padding:20px;border:1px solid #37584F;border-radius:8px}.info-box{background:#EFECD3;padding:15px;border-left:4px solid #DABD38;margin:15px 0}
      h1{font-family:'Playfair Display',Georgia,serif;color:#DABD38}h3{font-family:'Playfair Display',Georgia,serif;color:#37584F}</style>
      </head><body><div class="container"><div class="header">
      <h1 style="margin:0;">Switch/Reallocation Request</h1></div>
      <div class="content"><p><strong>Request Type:</strong> Switch/Reallocation</p>
      <p><strong>Submitted via:</strong> Qode Investor Portal</p><p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
      <div class="info-box"><h3 style="margin-top:0;">Request Details:</h3>
      <p><strong>Account ID:</strong> ${payload.nuvamaCode}</p>
      <p><strong>Client ID:</strong> ${selectedClientId}</p>
      <p><strong>User Email:</strong> ${userEmail}</p>
      <p><strong>Currently Invested In:</strong> ${payload.investedIn}</p>
      <p><strong>Switch To:</strong> ${payload.switchTo}</p>
      <p><strong>Amount:</strong> ${payload.amount}</p>
      <p><strong>Reason:</strong> ${payload.reason.replace(/\n/g, "<br>")}</p>
      ${payload.additionalNotes ? `<p><strong>Additional Notes:</strong> ${payload.additionalNotes.replace(/\n/g, "<br>")}</p>` : ""}
      </div><p style="margin-top:20px;font-size:14px;color:#37584F;">This message was sent from the Qode investor portal. Please review and process the request.</p>
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
            onChange={(e) => setFormData({ ...formData, nuvamaCode: e.target.value })}
            className="w-full p-3 border border-border rounded-md text-foreground focus:ring-2 focus:ring-primary focus:border-primary"
            required
          >
            {clients.map((c) => (
              <option key={c.clientid} value={c.clientcode}>
                {c.clientcode} ({c.clientid})
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
            className="w-full p-3 border border-border rounded-md text-foreground focus:ring-2 focus:ring-primary focus:border-primary"
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
  clients,
}: {
  isOpen: boolean;
  onClose: () => void;
  selectedClientCode: string;
  selectedClientId: string;
  clients: { clientid: string; clientcode: string }[];
}) {
  const [formData, setFormData] = useState({ nuvamaCode: selectedClientCode || "QGF0001", amount: "", additionalNotes: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "success" | "error">("idle");
  const { toast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    setFormData((prev) => ({ ...prev, nuvamaCode: selectedClientCode || "QGF0001" }));
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
      toast({ title: "Error", description: "Please provide a Account ID and withdrawal amount.", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus("idle");
    const userEmail = "user@example.com";

    const emailHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <style>body{font-family:Lato,Arial,sans-serif;line-height:1.6;color:#002017;background-color:#EFECD3}
      .container{max-width:600px;margin:0 auto;padding:20px}.header{background:#02422B;padding:20px;border-radius:8px;margin-bottom:20px;text-align:center}
      .content{background:#FFFFFF;padding:20px;border:1px solid #37584F;border-radius:8px}.info-box{background:#EFECD3;padding:15px;border-left:4px solid #DABD38;margin:15px 0}
      h1{font-family:'Playfair Display',Georgia,serif;color:#DABD38}h3{font-family:'Playfair Display',Georgia,serif;color:#37584F}</style>
      </head><body><div class="container"><div class="header">
      <h1 style="margin:0;">Withdrawal Request</h1></div>
      <div class="content"><p><strong>Request Type:</strong> Withdrawal</p>
      <p><strong>Submitted via:</strong> Qode Investor Portal</p><p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
      <div class="info-box"><h3 style="margin-top:0;">Request Details:</h3>
      <p><strong>Account ID:</strong> ${payload.nuvamaCode}</p>
      <p><strong>Client ID:</strong> ${selectedClientId}</p>
      <p><strong>User Email:</strong> ${userEmail}</p>
      <p><strong>Amount:</strong> ${payload.amount}</p>
      ${payload.additionalNotes ? `<p><strong>Additional Notes:</strong> ${payload.additionalNotes.replace(/\n/g, "<br>")}</p>` : ""}
      </div><p style="margin-top:20px;font-size:14px;color:#37584F;">This message was sent from the Qode investor portal. Please review and process the request.</p>
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
      setFormData({ nuvamaCode: selectedClientCode || "QGF0001", amount: "", additionalNotes: "" });
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
            {clients.map((c) => (
              <option key={c.clientid} value={c.clientcode}>
                {c.clientcode} ({c.clientid})
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
              setFormData({ nuvamaCode: selectedClientCode || "QGF0001", amount: "", additionalNotes: "" });
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
  const { selectedClientCode, selectedClientId, clients, loading } = useClient();

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
        </InfoCard>
      </div>

      {/* Modals */}
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
