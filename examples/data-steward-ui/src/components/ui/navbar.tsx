import { Link } from "react-router";
import { MdmBreadcrumbs, MdmBreadcrumbItem } from "./breadcrumbs";
import { MdmboxStatus } from "./mdmbox-status";

export type NavbarProps = {
  breadcrumbItems: MdmBreadcrumbItem[];
  logoSrc?: string;
  children?: React.ReactNode;
};

export function MdmNavbar({
  breadcrumbItems,
  logoSrc = "/icons/mdmbox-logo.svg",
  children,
}: NavbarProps) {
  return (
    <div className="flex-none h-15 flex items-center border-b bg-gray-100">
      <Link
        to="/patients"
        className="h-full shrink-0 flex items-center gap-2 px-4 hover:bg-muted/30"
      >
        <img src={logoSrc} alt="Logo" className="h-6 w-6" />
        <span className="text-sm font-semibold">Example App</span>
      </Link>
      <div className="pl-4 pr-5 w-full flex items-center justify-between">
        <MdmBreadcrumbs items={breadcrumbItems} />
        <div className="flex items-center gap-4">
          {children}
          <MdmboxStatus />
        </div>
      </div>
    </div>
  );
}
