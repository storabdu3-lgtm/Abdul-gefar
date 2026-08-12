import { Share2, FileText, FileSpreadsheet, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ReceiptActionBarProps {
  onPrint?: () => void;
  onShare?: () => void;
  onSharePdf?: () => void;
  onExportExcel?: () => void;
  sharing?: boolean;
  sharingPdf?: boolean;
  disabled?: boolean;
  className?: string;
}

export function ReceiptActionBar({
  onPrint,
  onShare,
  onSharePdf,
  onExportExcel,
  sharing,
  sharingPdf,
  disabled,
  className,
}: ReceiptActionBarProps) {
  const btnClass = "flex-1 sm:flex-none justify-center min-w-[100px]";
  return (
    <div className={`flex flex-wrap gap-2 ${className || ""}`}>
      {onExportExcel && (
        <Button
          variant="outline"
          size="sm"
          onClick={onExportExcel}
          disabled={disabled}
          className={btnClass}
          data-testid="button-export-excel"
        >
          <FileSpreadsheet className="w-4 h-4 mr-1.5" /> Excel
        </Button>
      )}
      {onSharePdf && (
        <Button
          variant="outline"
          size="sm"
          onClick={onSharePdf}
          disabled={disabled || sharingPdf}
          className={btnClass}
          data-testid="button-share-pdf"
        >
          <FileText className="w-4 h-4 mr-1.5" /> {sharingPdf ? "Generating…" : "PDF"}
        </Button>
      )}
      {onShare && (
        <Button
          variant="outline"
          size="sm"
          onClick={onShare}
          disabled={disabled || sharing}
          className={btnClass}
          data-testid="button-share"
        >
          <Share2 className="w-4 h-4 mr-1.5" /> {sharing ? "Sharing…" : "Share"}
        </Button>
      )}
      {onPrint && (
        <Button
          variant="outline"
          size="sm"
          onClick={onPrint}
          disabled={disabled}
          className={btnClass}
          data-testid="button-print"
        >
          <Printer className="w-4 h-4 mr-1.5" /> Print
        </Button>
      )}
    </div>
  );
}
