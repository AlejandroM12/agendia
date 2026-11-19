"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { useForm } from "@/components/form/use-form";
import type { ActionState } from "@/lib/action-state";
import {
  issueWhatsappVerifyTokenAction,
  revokeWhatsappCredentialsAction,
  saveWhatsappConnectionAction,
  sendWhatsappTestAction,
  setWhatsappEnabledAction,
  syncWhatsappTemplatesAction,
  updateWhatsappLimitsAction,
  validateWhatsappAction,
} from "@/modules/admin/whatsapp-actions";

export type AdminWhatsappProps = {
  organizationId: string;
  exists: boolean;
  enabled: boolean;
  status: string;
  phoneNumberId: string | null;
  wabaId: string | null;
  templateLanguage: string;
  credentialsHint: string | null;
  hasVerifyToken: boolean;
  settings: { sendConfirmations: boolean; sendReminders: boolean; reminderHoursBefore: number; sendCancellations: boolean; sendReschedules: boolean };
  monthlyLimit: number;
  testRecipients: string[];
  webhookUrl: string;
};

/** Botón de una acción de un clic con su resultado. */
function ActionButton({ label, run, variant = "outline", confirm }: { label: string; run: () => Promise<ActionState>; variant?: "outline" | "default" | "destructive"; confirm?: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>(undefined);
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant={variant}
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => setState(await run()));
        }}
      >
        {pending ? "Un momento…" : label}
      </Button>
      <FormMessage message={state?.message} tone={state?.ok ? "success" : "error"} />
    </div>
  );
}

export function WhatsappAdminPanel(props: AdminWhatsappProps) {
  const id = props.organizationId;
  const connectionForm = useForm(saveWhatsappConnectionAction.bind(null, id));
  const limitsForm = useForm(updateWhatsappLimitsAction.bind(null, id));
  const testForm = useForm(sendWhatsappTestAction.bind(null, id));

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h3 className="font-semibold">1. Conexión</h3>
        <p className="text-sm text-muted-foreground">
          Los datos salen de la cuenta de Meta de este negocio (o del número de prueba). El token y el secreto se guardan <strong>cifrados</strong> y no se vuelven a mostrar
          {props.credentialsHint ? ` (token actual: ${props.credentialsHint})` : ""}. Si no los completás, se conservan los guardados.
        </p>
        <form {...connectionForm.formProps} className="grid gap-3 sm:grid-cols-2">
          <Field label="ID del número de teléfono" htmlFor="phoneNumberId" error={connectionForm.error("phoneNumberId")}>
            <Input id="phoneNumberId" name="phoneNumberId" defaultValue={props.phoneNumberId ?? ""} inputMode="numeric" autoComplete="off" required />
          </Field>
          <Field label="ID de la cuenta de WhatsApp Business (WABA)" htmlFor="wabaId" error={connectionForm.error("wabaId")}>
            <Input id="wabaId" name="wabaId" defaultValue={props.wabaId ?? ""} inputMode="numeric" autoComplete="off" required />
          </Field>
          <Field label="Token de acceso (permanente)" htmlFor="accessToken" optional={props.exists} error={connectionForm.error("accessToken")}>
            <Input id="accessToken" name="accessToken" type="password" autoComplete="off" required={!props.exists} />
          </Field>
          <Field label="Secreto de la aplicación de Meta" htmlFor="appSecret" optional={props.exists} error={connectionForm.error("appSecret")}>
            <Input id="appSecret" name="appSecret" type="password" autoComplete="off" required={!props.exists} />
          </Field>
          <Field label="Idioma de las plantillas" htmlFor="templateLanguage">
            <Input id="templateLanguage" name="templateLanguage" defaultValue={props.templateLanguage} autoComplete="off" />
          </Field>
          <div className="flex items-end">
            <SubmitButton pending={connectionForm.pending}>Guardar conexión</SubmitButton>
          </div>
          <div className="sm:col-span-2">
            <FormMessage message={connectionForm.message} tone={connectionForm.state?.ok ? "success" : "error"} />
          </div>
        </form>
      </div>

      <div className="space-y-3">
        <h3 className="font-semibold">2. Webhook en Meta</h3>
        <p className="text-sm text-muted-foreground">
          En la aplicación de Meta → WhatsApp → Configuración → Webhook: URL de devolución de llamada <code className="rounded bg-muted px-1">{props.webhookUrl}</code> y el token de verificación de abajo; suscribirse al campo{" "}
          <code className="rounded bg-muted px-1">messages</code>. El secreto de la aplicación es el que firma los avisos.
        </p>
        <p className="text-sm">{props.hasVerifyToken ? "Hay un token de verificación generado (no se vuelve a mostrar; generá otro si lo necesitás)." : "Todavía no se generó el token de verificación."}</p>
        <ActionButton label="Generar token de verificación" run={() => issueWhatsappVerifyTokenAction(id, undefined)} />
      </div>

      <div className="space-y-3">
        <h3 className="font-semibold">3. Validar y plantillas</h3>
        <div className="flex flex-wrap gap-3">
          <ActionButton label="Validar conexión" run={() => validateWhatsappAction(id, undefined)} variant="default" />
          <ActionButton label="Crear / sincronizar plantillas" run={() => syncWhatsappTemplatesAction(id, undefined)} />
        </div>
        <p className="text-xs text-muted-foreground">Las plantillas las aprueba Meta (hasta 24 h). Hasta que estén aprobadas, los avisos fallan con un mensaje claro.</p>
      </div>

      <div className="space-y-3">
        <h3 className="font-semibold">4. Límites, avisos y destinatarios de prueba</h3>
        <form {...limitsForm.formProps} className="grid gap-3 sm:grid-cols-2">
          <Field label="Límite mensual de mensajes" htmlFor="monthlyLimit" error={limitsForm.error("monthlyLimit")}>
            <Input id="monthlyLimit" name="monthlyLimit" type="number" min={0} defaultValue={props.monthlyLimit} required />
          </Field>
          <Field label="Recordatorio, horas antes del turno" htmlFor="reminderHoursBefore">
            <Input id="reminderHoursBefore" name="reminderHoursBefore" type="number" min={1} max={168} defaultValue={props.settings.reminderHoursBefore} />
          </Field>
          <fieldset className="grid gap-1.5 text-sm sm:col-span-2 sm:grid-cols-2">
            {([
              ["sendConfirmations", "Confirmaciones", props.settings.sendConfirmations],
              ["sendReminders", "Recordatorios", props.settings.sendReminders],
              ["sendCancellations", "Avisos de cancelación", props.settings.sendCancellations],
              ["sendReschedules", "Avisos de reprogramación", props.settings.sendReschedules],
            ] as const).map(([name, label, checked]) => (
              <label key={name} className="flex items-center gap-2">
                <input type="checkbox" name={name} defaultChecked={checked} className="size-4 accent-primary" /> {label}
              </label>
            ))}
          </fieldset>
          <div className="sm:col-span-2">
            <Field label="Números autorizados para envíos de prueba" htmlFor="testRecipients" hint="Con característica, separados por coma. Con el número de prueba de Meta deben estar verificados en la consola de Meta." error={limitsForm.error("testRecipients")}>
              <Input id="testRecipients" name="testRecipients" defaultValue={props.testRecipients.join(", ")} autoComplete="off" />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <FormMessage message={limitsForm.message} tone={limitsForm.state?.ok ? "success" : "error"} />
          </div>
          <SubmitButton pending={limitsForm.pending}>Guardar configuración</SubmitButton>
        </form>
      </div>

      <div className="space-y-3">
        <h3 className="font-semibold">5. Envío de prueba</h3>
        <form {...testForm.formProps} className="grid gap-3 sm:grid-cols-3">
          <Field label="Número (autorizado arriba)" htmlFor="to" error={testForm.error("to")}>
            <Input id="to" name="to" autoComplete="off" required />
          </Field>
          <Field label="Plantilla" htmlFor="template">
            <select id="template" name="template" className="field" defaultValue="hello_world">
              <option value="hello_world">hello_world (de Meta)</option>
              <option value="booking_confirmation">Confirmación (propia)</option>
              <option value="reminder">Recordatorio (propia)</option>
              <option value="cancellation">Cancelación (propia)</option>
              <option value="reschedule">Reprogramación (propia)</option>
            </select>
          </Field>
          <div className="flex items-end">
            <SubmitButton pending={testForm.pending}>Enviar prueba</SubmitButton>
          </div>
          <div className="sm:col-span-3">
            <FormMessage message={testForm.message} tone={testForm.state?.ok ? "success" : "error"} />
          </div>
        </form>
      </div>

      <div className="space-y-3 border-t border-border pt-6">
        <h3 className="font-semibold">6. Activación</h3>
        <div className="flex flex-wrap gap-3">
          {props.enabled ? (
            <ActionButton label="Desactivar WhatsApp" run={() => setWhatsappEnabledAction(id, false)} confirm="¿Desactivar el WhatsApp automático de este negocio? Los avisos pendientes no se enviarán." />
          ) : (
            <ActionButton label="Activar WhatsApp" run={() => setWhatsappEnabledAction(id, true)} variant="default" />
          )}
          {props.exists && (
            <ActionButton label="Revocar credenciales" run={() => revokeWhatsappCredentialsAction(id)} variant="destructive" confirm="Se borran el token y el secreto guardados y se desactiva WhatsApp. ¿Seguir?" />
          )}
        </div>
      </div>
    </div>
  );
}
