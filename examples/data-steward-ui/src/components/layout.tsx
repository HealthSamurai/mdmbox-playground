import { Toaster, MdmNavbar, MdmTabs } from "@/components/ui";
import { useNavigate } from "react-router";

export type LayoutProps = {
  activeTab?: string;
  breadcrumbItems: Array<{ title: string; link?: string }>;
  children: React.ReactNode;
};

const toasterStyles = {
  toast:
    "group toast group-[.toaster]:bg-white group-[.toaster]:text-gray-900 group-[.toaster]:border-gray-200 group-[.toaster]:shadow-lg",
  description: "group-[.toast]:text-gray-600",
  actionButton: "group-[.toast]:bg-gray-900 group-[.toast]:text-gray-50",
  cancelButton: "group-[.toast]:bg-gray-100 group-[.toast]:text-gray-600",
  error:
    "group toast group-[.toaster]:bg-red-50 group-[.toaster]:text-red-900 group-[.toaster]:border-red-200",
  success:
    "group toast group-[.toaster]:bg-green-50 group-[.toaster]:text-green-900 group-[.toaster]:border-green-200",
  warning:
    "group toast group-[.toaster]:bg-yellow-50 group-[.toaster]:text-yellow-900 group-[.toaster]:border-yellow-200",
  info: "group toast group-[.toaster]:bg-blue-50 group-[.toaster]:text-blue-900 group-[.toaster]:border-blue-200",
} as const;

const navTabs = [
  { id: "patients", label: "Patients", pathTo: "/patients" },
  { id: "merges", label: "Merges", pathTo: "/merges" },
  { id: "unmerges", label: "Unmerges", pathTo: "/unmerges" },
];

export default function Layout({ activeTab, breadcrumbItems, children }: LayoutProps) {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col h-screen">
      <MdmNavbar breadcrumbItems={breadcrumbItems} />
      {activeTab && (
        <MdmTabs
          defaultValue={activeTab}
          tabs={navTabs.map((t) => ({ id: t.id, label: t.label, content: null }))}
          onValueChange={(id: string) => {
            const tab = navTabs.find((t) => t.id === id);
            if (tab) navigate(tab.pathTo);
          }}
        />
      )}
      <div className="flex-1 overflow-auto">{children}</div>
      <Toaster
        position="top-right"
        expand={true}
        richColors
        closeButton
        toastOptions={{ classNames: toasterStyles }}
      />
    </div>
  );
}
