
import { cn } from "./utils"

export interface UserAction {
    id: string
    icon: string
    alt?: string
}

export interface PageHeaderProps {
    breadcrumbs?: React.ReactNode
    userActions?: UserAction[]
    className?: string
    onUserActionClick?: (action: UserAction) => void
}

const defaultUserActions: UserAction[] = [
    { id: 'docs', icon: '/icons/documentation.svg', alt: 'Documentation' },
    { id: 'support', icon: '/icons/support.svg', alt: 'Support' },
]

export function PageHeader({
    breadcrumbs,
    userActions = defaultUserActions,
    className,
    onUserActionClick
}: PageHeaderProps) {

    const handleUserActionClick = (action: UserAction) => {
        if (onUserActionClick) {
            onUserActionClick(action)
        } else {
            // Handle user action internally when no callback provided
            console.log('User action clicked:', action)
        }
    }

    return (
        <div className={cn("bg-white border-b border-[#EBECEE]", className)}>
            {/* Top Header with Breadcrumb and User Actions */}
            <div className="flex items-center justify-between gap-[115px] px-4 pr-6 pl-4 py-3">
                <div className="flex items-center gap-6">
                    {/* Breadcrumb */}
                    {breadcrumbs}
                </div>

                {/* User Actions */}
                <div className="flex items-center gap-3">
                    {userActions.map((action) => (
                        <button
                            key={action.id}
                            onClick={() => handleUserActionClick(action)}
                            className="flex items-center justify-center w-7 h-7 bg-[#F5F5F6] rounded-full hover:bg-gray-200 transition-colors"
                        >
                            <img
                                src={action.icon}
                                alt={action.alt || action.id}
                                className="w-4 h-4"
                            />
                        </button>
                    ))}
                    <button className="flex items-center justify-center w-7 h-7 bg-[#A0A7BB] rounded-full">
                        <span className="text-sm font-normal text-white text-center leading-[24px]">
                            KB
                        </span>
                    </button>
                </div>
            </div>
        </div>
    )
} 
