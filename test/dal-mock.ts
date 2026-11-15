import type { AppContext } from "@/lib/app-context";
import { FORBIDDEN_MESSAGE, type Permission } from "@/lib/permissions";

/**
 * Reemplaza SOLO la lectura de la sesión de lib/dal: los permisos se evalúan
 * con el contexto real (lib/app-context.ts), igual que en la aplicación.
 */
export function createDalMock(getContext: () => AppContext) {
  const writable = (context: AppContext) =>
    context.canWrite ? { ok: true as const, context } : { ok: false as const, message: "solo lectura" };
  const requireWriteContext = async (permission?: Permission) => {
    const context = getContext();
    if (permission && !context.permissions.has(permission)) return { ok: false as const, message: FORBIDDEN_MESSAGE };
    return writable(context);
  };
  return {
    READ_ONLY_MESSAGE: "solo lectura",
    ACTIVE_ORGANIZATION_COOKIE: "agendia_org",
    requireContext: async () => getContext(),
    requireOrganization: async () => getContext(),
    requireSignedInUser: async () => getContext(),
    requirePagePermission: async (permission: Permission) => {
      const context = getContext();
      if (!context.permissions.has(permission)) throw new Error("REDIRECT:/dashboard");
      return context;
    },
    requireWriteContext,
    requirePermission: requireWriteContext,
    requireScopedManage: async (any: Permission, own: Permission) => {
      const context = getContext();
      if (!context.permissions.has(any) && !context.permissions.has(own)) return { ok: false as const, message: FORBIDDEN_MESSAGE };
      return context.canManageExisting ? { ok: true as const, context } : { ok: false as const, message: "solo lectura" };
    },
    requireScopedWrite: async (any: Permission, own: Permission) => {
      const context = getContext();
      if (!context.permissions.has(any) && !context.permissions.has(own)) return { ok: false as const, message: FORBIDDEN_MESSAGE };
      return writable(context);
    },
  };
}
