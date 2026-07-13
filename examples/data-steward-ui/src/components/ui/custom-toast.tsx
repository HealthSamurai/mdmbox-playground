
import { toast as sonnerToast } from "sonner"
import { CircleCheckIcon, XCircleIcon, AlertTriangleIcon, InfoIcon } from "lucide-react"

interface CustomToastOptions {
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
  duration?: number
}

const ToastContent = ({
  icon,
  title,
  description,
  action,
  iconColor,
  onDismiss
}: {
  icon: React.ReactNode
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
  iconColor: string
  onDismiss?: () => void
}) => (
  <div className="flex w-full items-start gap-3">
    <div className={`mt-0.5 shrink-0 ${iconColor}`}>
      {icon}
    </div>
    <div className="flex grow flex-col gap-2">
      <div className="space-y-1">
        <div className="font-semibold text-sm">{title}</div>
        {description && (
          <div className="text-sm opacity-90">{description}</div>
        )}
      </div>
      {action && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            action.onClick()
            onDismiss?.()
          }}
          className="text-sm font-medium self-start px-3 py-1.5 rounded-md bg-black/10 hover:bg-black/20 transition-colors cursor-pointer"
        >
          {action.label}
        </button>
      )}
    </div>
  </div>
)

const ToastWrapper = ({
  icon,
  title,
  description,
  action,
  iconColor,
  bgColor,
  borderColor,
  progressColor,
  onDismiss,
}: {
  icon: React.ReactNode
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
  iconColor: string
  bgColor: string
  borderColor: string
  progressColor: string
  onDismiss: () => void
}) => (
  <div className={`relative overflow-hidden ${bgColor} border ${borderColor} rounded-lg p-4 shadow-lg min-w-[350px]`}>
    <ToastContent
      icon={icon}
      title={title}
      description={description}
      action={action}
      iconColor={iconColor}
      onDismiss={onDismiss}
    />
    <div className={`absolute bottom-0 left-0 h-1 ${progressColor} animate-progress`} />
  </div>
)

export const toast = {
  success: (options: CustomToastOptions) => {
    return sonnerToast.custom(
      (t) => (
        <ToastWrapper
          icon={<CircleCheckIcon size={20} />}
          title={options.title}
          description={options.description}
          action={options.action}
          iconColor="text-green-600"
          bgColor="bg-green-50"
          borderColor="border-green-200"
          progressColor="bg-green-500"
          onDismiss={() => sonnerToast.dismiss(t)}
        />
      ),
      { duration: options.duration || 5000 }
    )
  },

  error: (options: CustomToastOptions) => {
    return sonnerToast.custom(
      (t) => (
        <ToastWrapper
          icon={<XCircleIcon size={20} />}
          title={options.title}
          description={options.description}
          action={options.action}
          iconColor="text-red-600"
          bgColor="bg-red-50"
          borderColor="border-red-200"
          progressColor="bg-red-500"
          onDismiss={() => sonnerToast.dismiss(t)}
        />
      ),
      { duration: options.duration || 5000 }
    )
  },

  warning: (options: CustomToastOptions) => {
    return sonnerToast.custom(
      (t) => (
        <ToastWrapper
          icon={<AlertTriangleIcon size={20} />}
          title={options.title}
          description={options.description}
          action={options.action}
          iconColor="text-yellow-600"
          bgColor="bg-yellow-50"
          borderColor="border-yellow-200"
          progressColor="bg-yellow-500"
          onDismiss={() => sonnerToast.dismiss(t)}
        />
      ),
      { duration: options.duration || 5000 }
    )
  },

  info: (options: CustomToastOptions) => {
    return sonnerToast.custom(
      (t) => (
        <ToastWrapper
          icon={<InfoIcon size={20} />}
          title={options.title}
          description={options.description}
          action={options.action}
          iconColor="text-blue-600"
          bgColor="bg-blue-50"
          borderColor="border-blue-200"
          progressColor="bg-blue-500"
          onDismiss={() => sonnerToast.dismiss(t)}
        />
      ),
      { duration: options.duration || 5000 }
    )
  },
}
