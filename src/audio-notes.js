function uint8ArrayToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function encryptAudioBlob(blob) {
  const plainBytes = new Uint8Array(await blob.arrayBuffer());
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plainBytes);
  const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', key));

  return {
    encryptedBytes: new Uint8Array(ciphertext),
    mediaEncryption: {
      scheme: 'aes-gcm',
      key_b64: uint8ArrayToBase64(rawKey),
      iv_b64: uint8ArrayToBase64(iv),
    },
  };
}

export async function decryptAudioBytes(encryptedBytes, mediaEncryption, mimeType = 'audio/webm;codecs=opus') {
  if (!mediaEncryption?.key_b64 || !mediaEncryption?.iv_b64) {
    throw new Error('Missing audio encryption metadata.');
  }

  const key = await crypto.subtle.importKey(
    'raw',
    base64ToUint8Array(mediaEncryption.key_b64),
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );

  const plainBytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToUint8Array(mediaEncryption.iv_b64) },
    key,
    encryptedBytes,
  );

  return new Blob([plainBytes], { type: mimeType });
}

export async function measureAudioDuration(blob) {
  if (typeof window === 'undefined') return null;

  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    const cleanup = () => URL.revokeObjectURL(url);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : null;
      cleanup();
      resolve(duration);
    };
    audio.onerror = () => {
      cleanup();
      resolve(null);
    };
    audio.src = url;
  });
}
