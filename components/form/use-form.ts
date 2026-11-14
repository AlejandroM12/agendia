"use client";

import { startTransition, useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { unstable_rethrow } from "next/navigation";

/**
 * Formularios de Agendia: una sola forma de enviarlos.
 *
 * Por qué existe: un `<form action={serverAction}>` de React **reinicia
 * todos los campos no controlados cuando la acción termina**, también
 * cuando termina con un error de validación. La persona corregía un dato y
 * encontraba el resto del formulario vacío. Acá el envío se hace a mano
 * (`onSubmit`), así que los campos conservan lo escrito hasta que la
 * operación sale bien o se navega a otra pantalla.
 *
 * Además:
 * - valida en el navegador antes de enviar (restricciones nativas del
 *   campo —required, type, minLength…— con mensajes en español, más una
 *   validación propia opcional, normalmente el mismo esquema del servidor);
 * - muestra cada error debajo de su campo, lo quita cuando el dato se
 *   corrige y lleva el foco al primer campo con error;
 * - convierte un fallo de red en un mensaje, sin perder lo escrito;
 * - ignora un segundo envío mientras hay uno en curso.
 *
 * La validación del servidor sigue siendo la que manda: esto solo evita
 * viajes innecesarios.
 */

export const NETWORK_ERROR_MESSAGE =
  "No pudimos conectarnos. Revisá tu conexión e intentá de nuevo: tus datos siguen acá.";

type StateShape = { ok?: boolean; message?: string; errors?: Record<string, string[] | undefined> } | undefined;

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const isControl = (element: Element): element is FormControl =>
  element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement;

/** Mensaje en español para una restricción nativa que el campo no cumple. */
function nativeMessage(control: FormControl): string | null {
  const validity = control.validity;
  if (validity.valid) return null;
  const type = control instanceof HTMLInputElement ? control.type : "";
  if (validity.valueMissing) {
    if (type === "checkbox") return "Tenés que marcar esta casilla para continuar.";
    return control instanceof HTMLSelectElement ? "Elegí una opción." : "Completá este campo.";
  }
  if (validity.typeMismatch) {
    return type === "email" ? "Ingresá un email válido, como nombre@ejemplo.com." : "Ingresá un valor válido.";
  }
  if (validity.tooShort) return `Tiene que tener al menos ${control.getAttribute("minlength")} caracteres.`;
  if (validity.tooLong) return `Puede tener hasta ${control.getAttribute("maxlength")} caracteres.`;
  if (validity.rangeUnderflow) return `El mínimo es ${control.getAttribute("min")}.`;
  if (validity.rangeOverflow) return `El máximo es ${control.getAttribute("max")}.`;
  if (validity.patternMismatch) return control.title || "El formato no es válido.";
  return "Ingresá un valor válido.";
}

function nativeErrors(form: HTMLFormElement): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const element of Array.from(form.elements)) {
    if (!isControl(element) || !element.name || !element.willValidate || element.name in errors) continue;
    const message = nativeMessage(element);
    if (message) errors[element.name] = message;
  }
  return errors;
}

/**
 * Un campo "tiene dónde mostrar su error" si está dentro de un <Field> (que
 * marca su contenedor con data-field). Los que no —un selector de fecha
 * suelto, por ejemplo— muestran su error en el mensaje general del formulario.
 */
function unplacedMessage(form: HTMLFormElement, errors: Record<string, string>): string | null {
  for (const element of Array.from(form.elements)) {
    if (!isControl(element) || !(element.name in errors)) continue;
    if (element.id && form.querySelector(`[data-field="${CSS.escape(element.id)}"]`)) continue;
    const label = element.getAttribute("aria-label") ?? element.labels?.[0]?.textContent?.trim().slice(0, 60);
    return label ? `${label}: ${errors[element.name]}` : errors[element.name];
  }
  return null;
}

function focusFirstInvalid(form: HTMLFormElement, names: string[]) {
  for (const element of Array.from(form.elements)) {
    if (!isControl(element) || !names.includes(element.name) || element.disabled) continue;
    if (element instanceof HTMLInputElement && element.type === "hidden") continue;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: "center", behavior: "smooth" });
    return;
  }
}

export type UseFormOptions = {
  /**
   * Validación propia en el navegador, además de las restricciones nativas.
   * Devuelve un mensaje por nombre de campo, o nada si está todo bien.
   */
  validate?: (data: FormData) => Record<string, string> | null | undefined;
  /** Vaciar el formulario cuando la acción responde `ok` (formularios de alta que no navegan). */
  resetOnSuccess?: boolean;
};

export function useForm<S extends StateShape>(
  action: (previous: S | undefined, data: FormData) => Promise<S | undefined>,
  options: UseFormOptions = {},
) {
  const actionRef = useRef(action);
  const optionsRef = useRef(options);
  useEffect(() => {
    actionRef.current = action;
    optionsRef.current = options;
  });

  const [state, dispatch, pending] = useActionState<S | undefined, FormData>(async (previous, data) => {
    try {
      return await actionRef.current(previous, data);
    } catch (error) {
      // Las redirecciones de Next viajan como excepción: siguen su camino.
      unstable_rethrow(error);
      return { ok: false, message: NETWORK_ERROR_MESSAGE } as S;
    }
  }, undefined);

  const formRef = useRef<HTMLFormElement>(null);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [clientMessage, setClientMessage] = useState<string | null>(null);
  // Errores del servidor que la persona ya empezó a corregir. Se guardan
  // junto a la respuesta a la que pertenecen: una respuesta nueva los descarta.
  const [dismissed, setDismissed] = useState<{ state: S | undefined; names: string[]; message: boolean }>({
    state: undefined,
    names: [],
    message: false,
  });
  const dismissedNow = useMemo(
    () => (dismissed.state === state ? dismissed : { state, names: [] as string[], message: false }),
    [dismissed, state],
  );

  const error = useCallback(
    (name: string): string | null =>
      clientErrors[name] ?? (dismissedNow.names.includes(name) ? null : (state?.errors?.[name]?.[0] ?? null)),
    [clientErrors, dismissedNow, state],
  );

  const errorNames = [
    ...Object.keys(clientErrors),
    ...Object.keys(state?.errors ?? {}).filter((name) => !dismissedNow.names.includes(name) && state?.errors?.[name]?.length),
  ];
  const errorKey = errorNames.join("|");

  // Accesibilidad: cada campo anuncia su error y su ayuda (ver <Field>).
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    for (const element of Array.from(form.elements)) {
      if (!isControl(element) || !element.name || !element.id) continue;
      const invalid = errorNames.includes(element.name);
      if (invalid) element.setAttribute("aria-invalid", "true");
      else element.removeAttribute("aria-invalid");
      const described = [`${element.id}-error`, `${element.id}-hint`].filter((id) => form.ownerDocument.getElementById(id));
      if (described.length) element.setAttribute("aria-describedby", described.join(" "));
      else element.removeAttribute("aria-describedby");
    }
  });

  // Una respuesta del servidor con errores por campo lleva el foco al primero.
  useEffect(() => {
    const names = Object.keys(state?.errors ?? {}).filter((name) => state?.errors?.[name]?.length);
    if (formRef.current && names.length) focusFirstInvalid(formRef.current, names);
    if (formRef.current && state?.ok && optionsRef.current.resetOnSuccess) formRef.current.reset();
  }, [state]);

  const submitting = useRef(false);
  useEffect(() => {
    if (!pending) submitting.current = false;
  }, [pending]);

  const onSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (pending || submitting.current) return;

      const form = event.currentTarget;
      const data = new FormData(form);
      // La validación propia da mensajes más específicos: gana sobre la nativa.
      const errors = { ...nativeErrors(form), ...(optionsRef.current.validate?.(data) ?? {}) };
      const names = Object.keys(errors);
      if (names.length > 0) {
        setClientErrors(errors);
        setClientMessage(unplacedMessage(form, errors));
        setDismissed({ state, names: Object.keys(state?.errors ?? {}), message: true });
        focusFirstInvalid(form, names);
        return;
      }

      setClientErrors({});
      setClientMessage(null);
      submitting.current = true;
      startTransition(() => dispatch(data));
    },
    [dispatch, pending, state],
  );

  /** Al corregir un campo, su error desaparece (el resto queda). */
  const onInput = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      const name = (event.target as Partial<FormControl>).name;
      if (!name) return;
      setClientMessage(null);
      setClientErrors((current) => {
        if (!(name in current)) return current;
        const next = { ...current };
        delete next[name];
        return next;
      });
      if (state?.errors?.[name] && !dismissedNow.names.includes(name)) {
        setDismissed({ state, names: [...dismissedNow.names, name], message: dismissedNow.message });
      }
    },
    [dismissedNow, state],
  );

  /** Marca errores desde fuera del envío (por ejemplo, al validar un campo controlado). */
  const clearError = useCallback((name: string) => {
    setClientErrors((current) => {
      if (!(name in current)) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }, []);

  return {
    state,
    pending,
    error,
    clearError,
    /** Mensaje general de la última respuesta (se oculta mientras se corrigen errores del navegador). */
    message: clientMessage ?? (dismissedNow.message ? null : (state?.message ?? null)),
    hasErrors: errorKey !== "",
    formProps: { ref: formRef, onSubmit, onInput, noValidate: true as const },
  };
}
