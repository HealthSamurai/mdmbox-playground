import { Lock } from "lucide-react";

export default function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[200px] gap-4">
      <Lock className="h-12 w-12 text-primary" />
      <p className="text-lg font-medium text-foreground">Access denied</p>
    </div>
  );
}
