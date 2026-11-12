// Verifica la configuración de Resend enviando un email de prueba real.
//
//   npm run email:test -- destino@email.com
//
// En producción:
//   docker compose --env-file .env.production run --rm \
//     -e RESEND_API_KEY -e EMAIL_FROM migrate node scripts/send-test-email.mjs destino@email.com
//
// Usa RESEND_API_KEY y EMAIL_FROM del entorno (o de .env.local). Si falla,
// muestra la respuesta de Resend: lo más común es que el dominio de
// EMAIL_FROM todavía no esté verificado.

import { existsSync } from "node:fs";

if (!process.env.RESEND_API_KEY && existsSync(".env.local")) {
  const { config } = await import("dotenv");
  config({ path: ".env.local", quiet: true });
}

const to = process.argv[2]?.trim();
const { RESEND_API_KEY, EMAIL_FROM } = process.env;

if (!to) {
  console.error("Uso: node scripts/send-test-email.mjs <destino@email.com>");
  process.exit(1);
}
if (!RESEND_API_KEY || !EMAIL_FROM) {
  console.error("Faltan RESEND_API_KEY y/o EMAIL_FROM. Sin esos dos valores Agendia no envía emails.");
  process.exit(1);
}

const response = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    from: EMAIL_FROM,
    to: [to],
    subject: "Prueba de envío de Agendia",
    text: "Si estás leyendo esto, el envío de emails de Agendia está bien configurado.",
  }),
});

const body = await response.text();
if (response.ok) {
  console.log(`Enviado a ${to} desde ${EMAIL_FROM}. Revisá la bandeja de entrada (y spam). Respuesta: ${body}`);
} else {
  console.error(`Resend respondió ${response.status}: ${body}`);
  process.exitCode = 1;
}
