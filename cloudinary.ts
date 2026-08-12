const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || "dis7rvtue";
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || "inventory_upload";

export async function uploadImage(file: File, folder = "inventory"): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", UPLOAD_PRESET);
  formData.append("folder", folder);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
    {
      method: "POST",
      body: formData,
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const msg = (errorData as { error?: { message?: string } })?.error?.message || "Upload failed";
    throw new Error(msg);
  }

  const data = await response.json();
  return data.secure_url as string;
}

export function getOptimizedImageUrl(publicId: string, options: { width?: number; height?: number; quality?: string } = {}): string {
  const { width, height, quality = "auto" } = options;
  const transforms = ["f_auto", `q_${quality}`];
  if (width) transforms.push(`w_${width}`);
  if (height) transforms.push(`h_${height}`);
  const transformStr = transforms.join(",");
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${transformStr}/${publicId}`;
}

export async function uploadVideo(file: File, folder = "promotions"): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", UPLOAD_PRESET);
  formData.append("folder", folder);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/video/upload`,
    { method: "POST", body: formData }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const msg = (errorData as { error?: { message?: string } })?.error?.message || "Video upload failed";
    throw new Error(msg);
  }

  const data = await response.json();
  return data.secure_url as string;
}

export { CLOUD_NAME, UPLOAD_PRESET };
