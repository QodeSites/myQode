'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/components/ui/use-toast';
import { Loader2 as Loader, CheckCircle, AlertCircle, XCircle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SubscriptionDetails {
  success: boolean;
  subscription_id: string;
  cf_subscription_id: string;
  status: string;
  subscription_status: string;
  customer_details: {
    customer_name: string;
    customer_email: string;
    customer_phone: string;
  };
  plan_details: {
    plan_name: string;
    plan_amount: number;
    plan_currency: string;
    plan_interval_type: string;
    plan_intervals: number;
  };
  authorization_details: {
    authorization_status: string;
    authorization_time: string;
    payment_methods: string[];
  };
  subscription_first_charge_time: string;
  subscription_expiry_time: string;
  next_schedule_date: string | null;
  error_code?: string;
  error_reason?: string;
}

export default function SipSuccessPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [subscriptionDetails, setSubscriptionDetails] = useState<SubscriptionDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const subscriptionId = searchParams.get('subscription_id');

  useEffect(() => {
    const fetchSubscriptionStatus = async () => {
      if (!subscriptionId) {
        setError('Subscription ID is missing');
        setLoading(false);
        toast({
          title: 'Error',
          description: 'No subscription ID provided. Please try again.',
          variant: 'destructive',
        });
        return;
      }

      try {
        const response = await fetch(`/api/cashfree/setup-sip?subscription_id=${encodeURIComponent(subscriptionId)}&action=verify`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.message || data.error || 'Failed to fetch subscription details');
        }

        setSubscriptionDetails(data);
        setLoading(false);

        if (data.status === 'ACTIVE') {
          toast({
            title: 'SIP Setup Successful',
            description: 'Your Systematic Investment Plan has been successfully authorized.',
          });
        } else if (data.status === 'PENDING') {
          toast({
            title: `SIP Status: ${data.subscription_status}`,
            description:
              data.subscription_status === 'BANK_APPROVAL_PENDING'
                ? 'Your SIP is awaiting bank confirmation, which may take 24-48 hours.'
                : data.subscription_status === 'INITIALIZED'
                ? 'Your SIP is initialized and awaiting customer authorization.'
                : data.subscription_status === 'ON_HOLD'
                ? 'Your SIP is on hold due to a failed payment. It will resume once reactivated.'
                : data.subscription_status === 'PAUSED'
                ? 'Your SIP is paused by the merchant. It can be resumed when needed.'
                : 'Your SIP is being processed. Please check back later.',
            variant: 'default',
          });
        } else if (data.status === 'CANCELLED') {
          toast({
            title: `SIP Status: ${data.subscription_status}`,
            description:
              data.subscription_status === 'COMPLETED'
                ? 'Your SIP has completed its cycle.'
                : data.subscription_status === 'CUSTOMER_CANCELLED'
                ? 'Your SIP was cancelled at the bank.'
                : data.subscription_status === 'CUSTOMER_PAUSED'
                ? 'Your SIP was paused via your UPI app.'
                : data.subscription_status === 'EXPIRED'
                ? 'Your SIP has reached its expiry date.'
                : data.subscription_status === 'LINK_EXPIRED'
                ? 'The authorization link for your SIP has expired.'
                : 'Your SIP has been cancelled. Please contact support for details.',
            variant: 'destructive',
          });
        } else {
          toast({
            title: `SIP Status: ${data.subscription_status}`,
            description: data.error_reason || 'There was an issue setting up your SIP. Please contact support.',
            variant: 'destructive',
          });
        }
      } catch (err) {
        console.error('Error fetching subscription status:', err);
        setError(err instanceof Error ? err.message : 'An unexpected error occurred');
        setLoading(false);
        toast({
          title: 'Error',
          description: 'Failed to verify SIP status. Please try again or contact support.',
          variant: 'destructive',
        });
      }
    };

    fetchSubscriptionStatus();
  }, [subscriptionId, toast]);

  const handleBackToDashboard = () => {
    router.push('/dashboard');
  };

  const renderStatusIcon = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return <CheckCircle className="w-6 h-6 text-primary" />;
      case 'PENDING':
        return <AlertCircle className="w-6 h-6 text-yellow-500" />;
      default:
        return <XCircle className="w-6 h-6 text-red-500" />;
    }
  };

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-background space-y-6 p-4 sm:p-6">
      <header className="mb-2">
        <div className="flex flex-col items-center sm:flex-row sm:justify-between sm:items-end">
          <div>
            <h1 className="text-pretty text-xl font-bold text-foreground flex items-center gap-2">
              {subscriptionDetails && renderStatusIcon(subscriptionDetails.status)}
              Systematic Investment Plan Status
            </h1>
            <p className="text-sm text-muted-foreground max-w-md">
              Review the details of your SIP setup. For any issues, contact{' '}
              <a href="mailto:support@qodeinvest.com" className="text-primary hover:underline">
                support@qodeinvest.com
              </a>.
              {subscriptionId && (
                <span className="ml-2 font-medium text-primary">Subscription ID: {subscriptionId}</span>
              )}
            </p>
          </div>
        </div>
      </header>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-8">
          <Loader className="h-8 w-8 animate-spin text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">Verifying SIP status...</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-8">
          <XCircle className="h-12 w-12 text-red-500" />
          <h2 className="mt-4 text-lg font-bold text-foreground">Error</h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-md text-center">{error}</p>
          <Button
            onClick={handleBackToDashboard}
            className="mt-6 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
          >
            Back to Dashboard
          </Button>
        </div>
      ) : subscriptionDetails ? (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-md border border-border bg-card p-6">
            <div className="flex items-center gap-2 mb-4">
              {renderStatusIcon(subscriptionDetails.status)}
              <h2 className="text-lg font-bold text-foreground">SIP Overview</h2>
            </div>
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <span className="mt-1 text-primary" aria-hidden="true">•</span>
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold">Status:</span> {subscriptionDetails.subscription_status}
                </p>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-1 text-primary" aria-hidden="true">•</span>
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold">Subscription ID:</span> {subscriptionDetails.subscription_id}
                </p>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-1 text-primary" aria-hidden="true">•</span>
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold">Cashfree Subscription ID:</span> {subscriptionDetails.cf_subscription_id}
                </p>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-1 text-primary" aria-hidden="true">•</span>
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold">Amount:</span> ₹{subscriptionDetails.plan_details.plan_amount}{' '}
                  {subscriptionDetails.plan_details.plan_currency}{' '}
                  {subscriptionDetails.plan_details.plan_intervals}{' '}
                  {subscriptionDetails.plan_details.plan_interval_type.toLowerCase()}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-md border border-border bg-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <Info className="w-6 h-6 text-primary" />
              <h2 className="text-lg font-bold text-foreground">Subscription Details</h2>
            </div>
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <span className="mt-1 text-primary" aria-hidden="true">•</span>
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold">Customer Name:</span> {subscriptionDetails.customer_details.customer_name}
                </p>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-1 text-primary" aria-hidden="true">•</span>
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold">Email:</span> {subscriptionDetails.customer_details.customer_email}
                </p>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-1 text-primary" aria-hidden="true">•</span>
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold">Phone:</span> {subscriptionDetails.customer_details.customer_phone}
                </p>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-1 text-primary" aria-hidden="true">•</span>
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold">First Charge Date:</span>{' '}
                  {new Date(subscriptionDetails.subscription_first_charge_time).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-1 text-primary" aria-hidden="true">•</span>
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold">Expiry Date:</span>{' '}
                  {new Date(subscriptionDetails.subscription_expiry_time).toLocaleDateString()}
                </p>
              </div>
              {subscriptionDetails.next_schedule_date && (
                <div className="flex items-start gap-2">
                  <span className="mt-1 text-primary" aria-hidden="true">•</span>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-semibold">Next Schedule Date:</span>{' '}
                    {new Date(subscriptionDetails.next_schedule_date).toLocaleDateString()}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-md border border-border bg-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <Info className="w-6 h-6 text-primary" />
              <h2 className="text-lg font-bold text-foreground">Authorization Details</h2>
            </div>
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <span className="mt-1 text-primary" aria-hidden="true">•</span>
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold">Authorization Status:</span>{' '}
                  {subscriptionDetails.authorization_details.authorization_status}
                </p>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-1 text-primary" aria-hidden="true">•</span>
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold">Authorized On:</span>{' '}
                  {subscriptionDetails.authorization_details.authorization_time
                    ? new Date(subscriptionDetails.authorization_details.authorization_time).toLocaleString()
                    : 'N/A'}
                </p>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-1 text-primary" aria-hidden="true">•</span>
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold">Payment Methods:</span>{' '}
                  {subscriptionDetails.authorization_details.payment_methods.join(', ')}
                </p>
              </div>
            </div>
          </div>

          {subscriptionDetails.error_code && (
            <div className="rounded-md border border-red-200 bg-red-50 p-6">
              <div className="flex items-center gap-2 mb-4">
                <XCircle className="w-6 h-6 text-red-500" />
                <h2 className="text-lg font-bold text-red-600">Error Details</h2>
              </div>
              <div className="space-y-3">
                <div className="flex items-start gap-2">
                  <span className="mt-1 text-red-500" aria-hidden="true">•</span>
                  <p className="text-sm text-red-600">
                    <span className="font-semibold">Error Code:</span> {subscriptionDetails.error_code}
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="mt-1 text-red-500" aria-hidden="true">•</span>
                  <p className="text-sm text-red-600">
                    <span className="font-semibold">Error Reason:</span> {subscriptionDetails.error_reason}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-center mt-6">
            <Button
              onClick={handleBackToDashboard}
              className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
            >
              Back to Dashboard
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-8">
          <AlertCircle className="h-12 w-12 text-yellow-500" />
          <h2 className="mt-4 text-lg font-bold text-foreground">No Subscription Details</h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-md text-center">
            No subscription details available. Please try again or contact{' '}
            <a href="mailto:support@qodeinvest.com" className="text-primary hover:underline">
              support@qodeinvest.com
            </a>.
          </p>
          <Button
            onClick={handleBackToDashboard}
            className="mt-6 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
          >
            Back to Dashboard
          </Button>
        </div>
      )}
    </main>
  );
}