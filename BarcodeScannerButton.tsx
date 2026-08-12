import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera } from "lucide-react";
// @ts-ignore
import { Html5Qrcode } from "html5-qrcode";

interface BarcodeScannerButtonProps {
  onScan: (value: string) => void;
  className?: string;
}

const SCANNER_ID = "nexus-barcode-scanner-div";

export function BarcodeScannerButton({ onScan, className }: BarcodeScannerButtonProps) {
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const scannerRef = useRef<any>(null);

  async function stopScanner() {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {}
      scannerRef.current = null;
    }
    setScanning(false);
  }

  async function startScanner() {
    setError("");
    try {
      const el = document.getElementById(SCANNER_ID);
      if (!el) return;
      const scanner = new Html5Qrcode(SCANNER_ID);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 12, qrbox: { width: 280, height: 120 } },
        (decoded: string) => {
          stopScanner();
          setOpen(false);
          onScan(decoded.trim());
        },
        (_err: any) => {}
      );
      setScanning(true);
    } catch (e: any) {
      setError(e?.message || "Camera access denied. Please allow camera permission.");
    }
  }

  useEffect(() => {
    if (open) {
      const timer = setTimeout(startScanner, 400);
      return () => clearTimeout(timer);
    } else {
      stopScanner();
    }
    return () => { stopScanner(); };
  }, [open]);

  function handleClose() {
    stopScanner();
    setOpen(false);
    setError("");
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={`flex-shrink-0 ${className ?? ""}`}
        title="Scan barcode with camera"
        onClick={() => setOpen(true)}
      >
        <Camera className="w-4 h-4" />
      </Button>

      <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="w-4 h-4" /> Scan Barcode
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground text-center">
              Point the camera at a product barcode or QR code
            </p>
            <div
              id={SCANNER_ID}
              className="w-full rounded-lg overflow-hidden bg-black min-h-[200px]"
            />
            {error && (
              <p className="text-sm text-red-500 text-center">{error}</p>
            )}
            {!scanning && !error && (
              <p className="text-xs text-muted-foreground text-center animate-pulse">
                Starting camera…
              </p>
            )}
            {scanning && (
              <p className="text-xs text-green-600 text-center font-medium animate-pulse">
                🔍 Scanning — hold steady over barcode
              </p>
            )}
            <Button variant="outline" className="w-full" onClick={handleClose}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
