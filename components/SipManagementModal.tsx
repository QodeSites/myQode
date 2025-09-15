// components/SipManagementModal.tsx
import React, { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { 
  Pause, 
  Play, 
  StopCircle, 
  Calendar, 
  IndianRupee, 
  Clock, 
  AlertTriangle,
  Loader,
  CheckCircle,
  XCircle,
  Info
} from 'lucide-react';

interface SipDetails {
  id: number;
  order_id: string;
  client_name: string;
  amount: number;
  currency: string;
  frequency: string;
  payment_status: string;
  start_date: string;
  end_date?: string;
  next_charge_date?: string;
  created_at: string;
  updated_at: string;
  canceled_at?: string;
  total_installments?: number;
}

interface SipManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedClientCode: string;
  onSipUpdated?: () => void;
}

const SipManagementModal: React.FC<SipManagementModalProps> = ({
  isOpen,
  onClose,
  selectedClientCode,
  onSipUpdated
}) => {
  const [sips, setSips] = useState<SipDetails[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    sipId: string;
    action: 'CANCEL' | 'PAUSE' | 'ACTIVATE';
    reason?: string;
  } | null>(null);
  const [actionReason, setActionReason] = useState('');

  const { toast } = useToast();

  // Fetch SIPs when modal opens
  useEffect(() => {
    if (isOpen && selectedClientCode) {
      fetchSips();
    }
  }, [isOpen, selectedClientCode]);

  const fetchSips = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/cashfree/manage-sip?nuvama_code=${selectedClientCode}`);
      const result = await response.json();
      
      if (result.success) {
        setSips(result.data);
      } else {
        setError(result.message || 'Failed to fetch SIPs');
      }
    } catch (err) {
      setError('Failed to fetch SIP data');
      console.error('Error fetching SIPs:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSipAction = async (sipId: string, action: 'CANCEL' | 'PAUSE' | 'ACTIVATE', reason?: string) => {
    setActionLoading(sipId);
    try {
      const response = await fetch('/api/cashfree/manage-sip', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subscription_id: sipId,
          action,
          reason: reason || undefined
        }),
      });

      const result = await response.json();
      
      if (result.success) {
        toast({
          title: "Success",
          description: result.message,
        });
        
        // Refresh SIP list
        await fetchSips();
        
        // Notify parent component
        if (onSipUpdated) {
          onSipUpdated();
        }
      } else {
        toast({
          title: "Error",
          description: result.message || `Failed to ${action.toLowerCase()} SIP`,
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: `Failed to ${action.toLowerCase()} SIP. Please try again.`,
        variant: "destructive",
      });
      console.error(`Error ${action}ing SIP:`, error);
    } finally {
      setActionLoading(null);
      setConfirmAction(null);
      setActionReason('');
    }
  };

  const getStatusColor = (status: string) => {
    const statusLower = status.toLowerCase();
    if (['active', 'pending'].includes(statusLower)) return 'text-green-600';
    if (['paused', 'on_hold'].includes(statusLower)) return 'text-yellow-600';
    if (['cancelled', 'expired', 'failed'].includes(statusLower)) return 'text-red-600';
    return 'text-gray-600';
  };

  const getStatusIcon = (status: string) => {
    const statusLower = status.toLowerCase();
    if (['active', 'pending'].includes(statusLower)) return <CheckCircle className="w-4 h-4 text-green-500" />;
    if (['paused', 'on_hold'].includes(statusLower)) return <Pause className="w-4 h-4 text-yellow-500" />;
    if (['cancelled', 'expired', 'failed'].includes(statusLower)) return <XCircle className="w-4 h-4 text-red-500" />;
    return <Info className="w-4 h-4 text-gray-500" />;
  };

  const canPerformAction = (status: string, action: string) => {
    const statusLower = status.toLowerCase();
    switch (action) {
      case 'PAUSE':
        return ['active', 'pending'].includes(statusLower);
      case 'ACTIVATE':
        return ['paused', 'on_hold'].includes(statusLower);
      case 'CANCEL':
        return !['cancelled', 'expired', 'failed'].includes(statusLower);
      default:
        return false;
    }
  };

  const renderSipCard = (sip: SipDetails) => {
    const nextChargeDate = sip.next_charge_date ? new Date(sip.next_charge_date).toLocaleDateString() : 'N/A';
    const startDate = new Date(sip.start_date).toLocaleDateString();
    const endDate = sip.end_date ? new Date(sip.end_date).toLocaleDateString() : 'Ongoing';

    return (
      <div key={sip.id} className="p-4 border rounded-lg bg-card">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            {getStatusIcon(sip.payment_status)}
            <div>
              <h3 className="font-semibold text-sm">{sip.order_id}</h3>
              <p className={`text-xs font-medium ${getStatusColor(sip.payment_status)}`}>
                {sip.payment_status}
              </p>
            </div>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-1 text-lg font-bold">
              <IndianRupee className="w-4 h-4" />
              {sip.amount.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">{sip.frequency}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4 text-xs">
          <div>
            <p className="text-muted-foreground">Start Date</p>
            <p className="font-medium">{startDate}</p>
          </div>
          <div>
            <p className="text-muted-foreground">End Date</p>
            <p className="font-medium">{endDate}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Next Charge</p>
            <p className="font-medium">{nextChargeDate}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Client</p>
            <p className="font-medium">{sip.client_name}</p>
          </div>
        </div>

        <div className="flex gap-2">
          {canPerformAction(sip.payment_status, 'PAUSE') && (
            <button
              onClick={() => setConfirmAction({ sipId: sip.order_id, action: 'PAUSE' })}
              disabled={actionLoading === sip.order_id}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200 disabled:opacity-50"
            >
              <Pause className="w-3 h-3" />
              Pause
            </button>
          )}
          
          {canPerformAction(sip.payment_status, 'ACTIVATE') && (
            <button
              onClick={() => setConfirmAction({ sipId: sip.order_id, action: 'ACTIVATE' })}
              disabled={actionLoading === sip.order_id}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-green-100 text-green-800 rounded hover:bg-green-200 disabled:opacity-50"
            >
              <Play className="w-3 h-3" />
              Resume
            </button>
          )}
          
          {canPerformAction(sip.payment_status, 'CANCEL') && (
            <button
              onClick={() => setConfirmAction({ sipId: sip.order_id, action: 'CANCEL' })}
              disabled={actionLoading === sip.order_id}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-red-100 text-red-800 rounded hover:bg-red-200 disabled:opacity-50"
            >
              <StopCircle className="w-3 h-3" />
              Cancel
            </button>
          )}

          {actionLoading === sip.order_id && (
            <div className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-600">
              <Loader className="w-3 h-3 animate-spin" />
              Processing...
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderConfirmationDialog = () => {
    if (!confirmAction) return null;

    const actionText = {
      PAUSE: 'pause',
      ACTIVATE: 'resume',
      CANCEL: 'cancel'
    }[confirmAction.action];

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
          <div className="flex items-center gap-3 mb-4">
            <AlertTriangle className="w-6 h-6 text-orange-500" />
            <h3 className="text-lg font-semibold">Confirm Action</h3>
          </div>
          
          <p className="text-sm text-gray-600 mb-4">
            Are you sure you want to {actionText} this SIP? 
            {confirmAction.action === 'CANCEL' && ' This action cannot be undone.'}
          </p>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">
              Reason (Optional)
            </label>
            <textarea
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
              placeholder={`Why are you ${actionText}ing this SIP?`}
              className="w-full p-2 border rounded text-sm"
              rows={3}
            />
          </div>

          <div className="flex gap-3 justify-end">
            <button
              onClick={() => {
                setConfirmAction(null);
                setActionReason('');
              }}
              className="px-4 py-2 text-sm text-gray-600 border rounded hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => handleSipAction(confirmAction.sipId, confirmAction.action, actionReason)}
              className={`px-4 py-2 text-sm text-white rounded ${
                confirmAction.action === 'CANCEL' 
                  ? 'bg-red-600 hover:bg-red-700'
                  : confirmAction.action === 'PAUSE'
                  ? 'bg-yellow-600 hover:bg-yellow-700'
                  : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              Confirm {actionText.charAt(0).toUpperCase() + actionText.slice(1)}
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Modal Overlay */}
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden">
          {/* Modal Header */}
          <div className="flex items-center justify-between p-6 border-b">
            <h2 className="text-xl font-semibold text-gray-900">Manage Your SIPs</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-2xl font-semibold"
            >
              ×
            </button>
          </div>

          {/* Modal Body */}
          <div className="p-6">
            <div className="max-h-96 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader className="w-6 h-6 animate-spin text-primary" />
                  <span className="ml-2 text-sm text-muted-foreground">Loading SIPs...</span>
                </div>
              ) : error ? (
                <div className="p-6 text-center">
                  <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                  <p className="text-sm text-red-600">{error}</p>
                  <button
                    onClick={fetchSips}
                    className="mt-4 px-4 py-2 text-sm bg-primary text-white rounded hover:bg-primary/90"
                  >
                    Retry
                  </button>
                </div>
              ) : sips.length === 0 ? (
                <div className="p-6 text-center">
                  <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-sm text-gray-600">No SIPs found for this account.</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Set up a new SIP using the "Add Funds / SIP" option.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium">
                      Found {sips.length} SIP{sips.length !== 1 ? 's' : ''}
                    </h3>
                    <button
                      onClick={fetchSips}
                      disabled={loading}
                      className="text-xs text-primary hover:underline"
                    >
                      Refresh
                    </button>
                  </div>
                  {sips.map(renderSipCard)}
                </div>
              )}
            </div>

            <div className="mt-6 pt-4 border-t">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Info className="w-4 h-4" />
                <span>
                  Actions may take a few minutes to reflect. Contact support for urgent changes.
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {renderConfirmationDialog()}
    </>
  );
};

export default SipManagementModal;