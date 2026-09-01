
type FieldDisplayProps = {
  label: string;
  value: string | number | null | undefined;
}

export function FieldDisplay({ label, value }: FieldDisplayProps) {
  return (
    <div className="grid grid-cols-[1fr_3fr] gap-4">
      <p className="font-size=14px">{label}:</p>
      <p className="font-size=14px text-text-primary">{value === null || value === undefined || value === '' ? '—' : value}</p>
    </div>
  );
}

export function FieldDisplay2({ label, value }: FieldDisplayProps) {
  return (
    <div className="flex flex-col">
      <span className="text-sm text-gray-400">{label}</span>
      <span className="font-size=14px">{value || '-'}</span>
    </div>
  );
} 
