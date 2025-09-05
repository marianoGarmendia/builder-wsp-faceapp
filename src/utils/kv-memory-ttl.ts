import { CaptacionRecord } from "../types/body";
  
  const TTL_MS = 1000 * 60 * 30; // 30 minutos (ajustá a gusto)
  
  const userCaptaciones = new Map<string, CaptacionRecord>(); // phone -> record
  
  const normalizePhone = (raw: string) =>
    raw.replace(/[^\d]/g, ""); // deja solo dígitos (ajustá si necesitás prefijos)
  
 export  function setCaptacion(phoneRaw: string, rec: Omit<CaptacionRecord, "createdAt"|"expiresAt">) {
    console.log("setCaptacion", phoneRaw, rec);
    const phone = normalizePhone(phoneRaw);
    const now = Date.now();
    userCaptaciones.set(phone, {
      ...rec,
      createdAt: now,
      expiresAt: now + TTL_MS,
    });
    console.log("userCaptaciones");
    console.dir(userCaptaciones, { depth: null });
  }
  
  export function getCaptacion(phoneRaw: string): CaptacionRecord | undefined {
    console.log("getCaptacion", phoneRaw);
    const phone = normalizePhone(phoneRaw);
    const rec = userCaptaciones.get(phone);
    if (!rec) return undefined;
    if (Date.now() > rec.expiresAt) {
      userCaptaciones.delete(phone);
      return undefined;
    }
    console.log("rec", rec);
    return rec;
  }
  
  // limpieza periódica (opcional)
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of userCaptaciones.entries()) {
      if (now > v.expiresAt) userCaptaciones.delete(k);
    }
  }, 60_000);
  