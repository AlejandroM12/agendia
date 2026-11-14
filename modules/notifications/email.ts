import "server-only";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Nombre visible del remitente (el del negocio, en los avisos a sus
   * clientes). La dirección es siempre la de EMAIL_FROM.
   */
  fromName?: string;
};

export type EmailResult = { ok: true } | { ok: false; error: string };

/**
 * Canal de email (Resend, vía su API HTTP — sin SDK).
 *
 * Solo está "configurado" si existen RESEND_API_KEY y EMAIL_FROM. Sin esas
 * credenciales no se simula ningún envío: quien llama debe tratar el canal
 * como no disponible (ver `isEmailConfigured`).
 */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/**
 * Remitente con el nombre del negocio y la dirección configurada:
 * `"Estudio Luna" <turnos@dominio>`. El nombre se limpia de todo lo que
 * pueda alterar la cabecera.
 */
export function senderFor(from: string, fromName: string | undefined): string {
  const name = fromName?.replace(/[\r\n"<>\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 70);
  if (!name) return from;
  const address = from.match(/<([^<>]+)>/)?.[1] ?? from.trim();
  return `"${name}" <${address}>`;
}

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    return { ok: false, error: "El canal de email no está configurado." };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: senderFor(from, message.fromName),
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { ok: false, error: `Resend respondió ${response.status}: ${body.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Error de red al enviar el email." };
  }
}
