export const LS_IMGBB_KEY = "app_imgbb_api_key"

const FALLBACK_IMGBB_KEY = "4042c537845e8b19b443add46f4a859c"

function getImgbbApiKey() {
  try {
    const stored = localStorage.getItem(LS_IMGBB_KEY)?.trim()
    if (stored) return stored
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }

  return FALLBACK_IMGBB_KEY
}

export async function uploadImageToImgBB(file: File): Promise<string> {
  const formData = new FormData()
  formData.append("image", file)

  const response = await fetch(`https://api.imgbb.com/1/upload?key=${getImgbbApiKey()}`, {
    method: "POST",
    body: formData,
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error?.message ?? "Upload failed")
  }

  const imageUrl = payload.data?.display_url ?? payload.data?.url
  if (!imageUrl) {
    throw new Error("Upload succeeded without an image URL")
  }

  return imageUrl as string
}