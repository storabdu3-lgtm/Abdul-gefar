// @ts-ignore – dom-to-image-more has no bundled types
import domtoimage from "dom-to-image-more";
import jsPDF from "jspdf";

const DOM_TO_IMAGE_OPTS = {
  bgcolor: "#ffffff",
  scale: 2,
  style: { borderRadius: "0" },
};

/** Read a Blob as a base64 data URL */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** Get natural image dimensions from a data URL */
function getImageDimensions(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = dataUrl;
  });
}

/**
 * Temporarily resolves CSS custom-property (variable) colours to concrete
 * computed values so dom-to-image inlines them correctly.
 * Without this, colours like `hsl(var(--muted-foreground))` render as
 * transparent / black in the captured image.
 */
async function withResolvedStyles<T>(
  root: HTMLElement,
  fn: () => Promise<T>
): Promise<T> {
  const saved: { node: HTMLElement; prev: string }[] = [];

  const nodes = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const el of nodes) {
    if (!(el instanceof HTMLElement)) continue;
    saved.push({ node: el, prev: el.getAttribute("style") ?? "" });
    const cs = window.getComputedStyle(el);
    const props = [
      "color",
      "background-color",
      "border-top-color",
      "border-right-color",
      "border-bottom-color",
      "border-left-color",
      "font-family",
      "font-size",
      "font-weight",
      "line-height",
    ];
    for (const p of props) {
      const v = cs.getPropertyValue(p);
      if (v) el.style.setProperty(p, v, "important");
    }
  }

  try {
    return await fn();
  } finally {
    for (const { node, prev } of saved) {
      if (prev) node.setAttribute("style", prev);
      else node.removeAttribute("style");
    }
  }
}

/**
 * Captures a DOM element as a PNG and either:
 *  1. Shares it via the Web Share API (mobile / supported browsers)
 *  2. Opens it in a new tab so the user can save manually
 *
 * Returns "shared" | "downloaded" | "failed"
 */
export async function shareAsImage(
  element: HTMLElement,
  filename = "voucher.png"
): Promise<"shared" | "downloaded" | "failed"> {
  try {
    const blob: Blob = await withResolvedStyles(element, () =>
      domtoimage.toBlob(element, DOM_TO_IMAGE_OPTS)
    );
    if (!blob) return "failed";

    const file = new File([blob], filename, { type: "image/png" });

    if (
      typeof navigator !== "undefined" &&
      navigator.canShare &&
      navigator.canShare({ files: [file] })
    ) {
      try {
        await navigator.share({ files: [file], title: filename.replace(".png", "") });
        return "shared";
      } catch {
        // User cancelled — fall through to download
      }
    }

    const url = URL.createObjectURL(blob);
    const opened = window.open(url, "_blank");
    if (!opened) {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return "downloaded";
  } catch (err) {
    console.error("shareAsImage failed:", err);
    return "failed";
  }
}

/**
 * Captures a DOM element as a PDF.
 * Uses the same dom-to-image-more engine as shareAsImage (reliable inside dialogs).
 *
 * Returns "shared" | "downloaded" | "failed"
 */
export async function shareAsPdf(
  element: HTMLElement,
  filename = "voucher.pdf"
): Promise<"shared" | "downloaded" | "failed"> {
  try {
    // 1. Capture element as PNG blob with resolved CSS variable colours
    const blob: Blob = await withResolvedStyles(element, () =>
      domtoimage.toBlob(element, DOM_TO_IMAGE_OPTS)
    );
    if (!blob) return "failed";

    // 2. Convert blob → base64 data URL for jsPDF
    const dataUrl = await blobToDataUrl(blob);

    // 3. Get the actual pixel dimensions of the captured image
    const { w: imgW, h: imgH } = await getImageDimensions(dataUrl);
    if (!imgW || !imgH) return "failed";

    // 4. Build PDF — auto-pick orientation from content aspect ratio so
    //    wide tables/reports don't get their columns cut off, fit to page
    //    width, and add pages if content is taller than one page.
    const isWide = imgW > imgH;
    const pdf = new jsPDF({ orientation: isWide ? "landscape" : "portrait", unit: "mm", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const scaledH = (imgH * pageW) / imgW;            // proportional height in mm

    if (scaledH <= pageH) {
      pdf.addImage(dataUrl, "PNG", 0, 0, pageW, scaledH);
    } else {
      // Slice image across multiple pages of the same size/orientation
      let yMm = 0;
      let first = true;
      while (yMm < scaledH) {
        if (!first) pdf.addPage();
        first = false;
        pdf.addImage(dataUrl, "PNG", 0, -yMm, pageW, scaledH);
        yMm += pageH;
      }
    }

    const pdfBlob = pdf.output("blob");
    const pdfFile = new File([pdfBlob], filename, { type: "application/pdf" });

    // 5. Try native share first (Android Chrome / iOS Safari)
    if (
      typeof navigator !== "undefined" &&
      navigator.canShare &&
      navigator.canShare({ files: [pdfFile] })
    ) {
      try {
        await navigator.share({ files: [pdfFile], title: filename.replace(".pdf", "") });
        return "shared";
      } catch {
        // Cancelled — fall through to download
      }
    }

    // 6. Fallback: direct download
    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return "downloaded";
  } catch (err) {
    console.error("shareAsPdf failed:", err);
    return "failed";
  }
}
