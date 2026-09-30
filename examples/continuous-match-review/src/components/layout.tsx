import { Link, Outlet } from "react-router";
import { ExternalLink } from "lucide-react";

export function Layout() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/mdmbox-logo.svg" alt="" className="size-6" />
            <span className="font-semibold">MDMbox</span>
            <span className="text-gray-300">/</span>
            <span className="text-gray-600">Data steward</span>
          </Link>
          <div className="flex-1" />
          <a
            href={`${__MDMBOX_URL__}/admin/continuous-match`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900"
          >
            MDMbox Admin
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
