"use server";

import { z } from "zod";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import {
  registerOrganizationSchema,
  registerOrganization,
} from "@/modules/organizations/register";
import {
  requestPasswordReset,
  resetPassword,
} from "@/modules/auth/password-reset";

export type ActionState = {
  errors?: Record<string, string[]>;
  message?: string;
} | undefined;

export async function registerAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const validated = registerOrganizationSchema.safeParse({
    businessName: formData.get("businessName"),
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
      redirectTo: "/dashboard",
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
  try {
    await signIn("credentials", {
      email: formData.get("email"),
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

export async function logoutAction() {
  await signOut({ redirectTo: "/" });
}

export async function requestPasswordResetAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState & { devResetLink?: string }> {
  const result = await requestPasswordReset({ email: formData.get("email") });

  if (!result.requested) {
    return { message: "Ingresá un email válido." };
  }

  return {
    message:
      "Si existe una cuenta con ese email, vas a poder restablecer la contraseña.",
    devResetLink: result.devResetLink,
  };
}

export async function resetPasswordAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await resetPassword({
    token: formData.get("token"),
    password: formData.get("password"),
  });

  if (!result.success) {
    return { message: result.error };
  }

  return { message: "Contraseña actualizada. Ya podés iniciar sesión." };
}
