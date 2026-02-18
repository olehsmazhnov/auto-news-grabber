import { MAX_IMAGE_BYTES, REQUEST_TIMEOUT_MS, USER_AGENT } from "../constants.js";

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function requestHeaders(): Record<string, string> {
  return {
    "User-Agent": USER_AGENT,
    Accept: "*/*",
  };
}

export async function fetchText(url: string): Promise<string> {
  if (!isHttpUrl(url)) {
    throw new Error("Invalid URL");
  }

  const response = await fetch(url, {
    headers: requestHeaders(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

export async function fetchHtmlOrEmpty(url: string): Promise<string> {
  if (!isHttpUrl(url)) {
    return "";
  }

  try {
    const response = await fetch(url, {
      headers: requestHeaders(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      return "";
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      return "";
    }

    return response.text();
  } catch {
    return "";
  }
}

export async function fetchBinaryImage(
  url: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!isHttpUrl(url)) {
    return null;
  }

  try {
    const response = await fetch(url, {
      headers: requestHeaders(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      return null;
    }

    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader) {
      const length = Number.parseInt(contentLengthHeader, 10);
      if (Number.isFinite(length) && length > MAX_IMAGE_BYTES) {
        return null;
      }
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
      return null;
    }

    return {
      buffer: Buffer.from(arrayBuffer),
      contentType,
    };
  } catch {
    return null;
  }
}
