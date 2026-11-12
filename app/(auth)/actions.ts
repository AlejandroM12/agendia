"use server";

import { z } from "zod";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import {
  registerOrganizationSchema,
  registerOrganization,
} from "@/modules/organizations/register";
import {
  requestPasswordReset,
  resetPassword,
} from "@/modules/auth/password-reset";
import { clientIp, rateLimit, TOO_MANY_ATTEMPTS } from "@/lib/rate-limit";
import { getRegistrationStatus } from "@/modules/auth/registration";

export type ActionState = {
  ok?: boolean;
  errors?: Record<string, string[]>;
  message?: string;
} | undefined;

export async function registerAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ip = await clientIp();
  if (!(await rateLimit(`register:${ip}`, 8, 3600)).allowed) {
    return { message: TOO_MANY_ATTEMPTS };
  }

  // El formulario ya no se muestra con el registro cerrado; esto cubre el
  // envío directo de la acción.
  if (!(await getRegistrationStatus()).open) {
    return { message: "El registro de cuentas nuevas no está disponible en este momento." };
  }

  const validated = registerOrganizationSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!validated.success) {
    return { errors: z.flattenError(validated.error).fieldErrors };
  }

  const result = await registerOrganization(validated.data);

  if (!result.success) {
    return { message: result.error };
  }

  try {
    await signIn("credentials", {
      email: validated.data.email,
      password: validated.data.password,
      redirectTo: "/onboarding",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        message:
          "La cuenta se creó correctamente, pero no pudimos iniciar sesión automáticamente. Probá iniciar sesión manualmente.",
      };
    }
    throw error;
  }
}

export async function loginAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ip = await clientIp();
  const email = String(formData.get("email") ?? "").toLowerCase().slice(0, 200);
  const [byIp, byAccount] = await Promise.all([
    rateLimit(`login:ip:${ip}`, 30, 900),
    rateLimit(`login:account:${email}`, 10, 900),
  ]);
  if (!byIp.allowed || !byAccount.allowed) return { message: TOO_MANY_ATTEMPTS };

  try {
    await signIn("credentials", {
      email,
      password: formData.get("password"),
      redirectTo: "/dashboard",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { message: "Email o contraseña incorrectos." };
    }
    throw error;
  }
}

export async function requestPasswordResetAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState & { devResetLink?: string }> {
  const ip = await clientIp();
  if (!(await rateLimit(`password-reset:${ip}`, 5, 3600)).allowed) {
    return { message: TOO_MANY_ATTEMPTS };
  }

  const result = await requestPasswordReset({ email: formData.get("email") });

  if (!result.requested) {
    return { message: "Ingresá un email válido." };
  }

  return {
    message:
      "Si existe una cuenta con ese email, te enviamos un enlace para restablecer la contraseña.",
    devResetLink: result.devResetLink,
  };
}

export async function resetPasswordAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const password = String(formData.get("password") ?? "");
  if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return { message: "La contraseña debe tener al menos 8 caracteres, con letras y números." };
  }

  const result = await resetPassword({
    token: formData.get("token"),
    password: formData.get("password"),
  });

  if (!result.success) {
    return { message: result.error };
  }

  return { ok: true };
}
