import React from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useToastStore, ToastItem } from '../../stores/toastStore';

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed z-[9999] pointer-events-none flex flex-col space-y-2.5 top-3 sm:top-5 right-3 sm:right-6 left-3 sm:left-auto sm:max-w-md w-auto"
    >
      {toasts.map((item) => (
        <ToastCard key={item.id} item={item} onDismiss={() => removeToast(item.id)} />
      ))}
    </div>
  );
};

interface ToastCardProps {
  item: ToastItem;
  onDismiss: () => void;
}

const ToastCard: React.FC<ToastCardProps> = ({ item, onDismiss }) => {
  const getStyleConfig = () => {
    switch (item.type) {
      case 'success':
        return {
          icon: <CheckCircle2 className="w-4 h-4 text-[#E3B5BE] shrink-0" />,
          borderColor: 'border-l-4 border-l-[#E3B5BE] border-[#393B3F]',
          badgeText: item.title || 'Success',
          badgeColor: 'text-[#F7D7D1]',
        };
      case 'error':
        return {
          icon: <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />,
          borderColor: 'border-l-4 border-l-rose-500 border-[#393B3F]',
          badgeText: item.title || 'Error',
          badgeColor: 'text-rose-300',
        };
      case 'warning':
        return {
          icon: <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />,
          borderColor: 'border-l-4 border-l-amber-400 border-[#393B3F]',
          badgeText: item.title || 'Warning',
          badgeColor: 'text-amber-300',
        };
      case 'info':
      default:
        return {
          icon: <Info className="w-4 h-4 text-[#F7D7D1] shrink-0" />,
          borderColor: 'border-l-4 border-l-[#F7D7D1] border-[#393B3F]',
          badgeText: item.title || 'Studio Notice',
          badgeColor: 'text-[#F7D7D1]',
        };
    }
  };

  const config = getStyleConfig();

  return (
    <div
      className={`pointer-events-auto rounded-xl bg-[#222326]/95 backdrop-blur-md border shadow-2xl p-3.5 sm:p-4 text-[#FFF5F5] transition-all transform animate-in fade-in slide-in-from-top-3 sm:slide-in-from-right-4 duration-200 flex items-start space-x-3 ${config.borderColor}`}
      role="alert"
    >
      <div className="mt-0.5">{config.icon}</div>

      <div className="flex-1 min-w-0 pr-2">
        <div className="flex items-center justify-between mb-0.5">
          <span
            className={`text-[10px] font-mono uppercase tracking-wider font-bold ${config.badgeColor}`}
          >
            {config.badgeText}
          </span>
        </div>
        <p className="text-xs text-[#FFF5F5]/90 leading-relaxed break-words font-sans">
          {item.message}
        </p>
      </div>

      <button
        onClick={onDismiss}
        className="p-1 -mr-1 -mt-1 text-[#FFF5F5]/40 hover:text-[#FFF5F5] hover:bg-[#2A2C2F] rounded-lg transition-colors shrink-0"
        aria-label="Dismiss notification"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
