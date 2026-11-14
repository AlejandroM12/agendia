"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Monitor, Smartphone } from "lucide-react";
import { ButtonLink } from "@/components/ui/button-link";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { useForm } from "@/components/form/use-form";
import { contrastRatio, normalizeHexColor, resolveTheme, THEME_FONTS, THEME_PRESETS, type ThemePreset } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { updatePublicPageAction } from "@/modules/public-page/actions";
import type { PublicProfile } from "@/modules/public-page/settings";
import { ImageUploader } from "./image-uploader";

type Values = {
  name: string;
  specialty: string;
  description: string;
  address: string;
  phone: string;
  whatsapp: string;
  instagram: string;
  themePrimary: string;
  themeSecondary: string;
  themeFont: string;
  slug: string;
  showAddress: boolean;
  showPhone: boolean;
  showWhatsapp: boolean;
  showInstagram: boolean;
  showPrices: boolean;
};

const DEVICES = {
  mobile: { label: "Celular", width: 390, icon: Smartphone },
  desktop: { label: "Escritorio", width: 1280, icon: Monitor },
} as const;
type Device = keyof typeof DEVICES;

const PREVIEW_HEIGHT = 680;

function toValues(profile: PublicProfile): Values {
  return {
    name: profile.name,
    specialty: profile.specialty ?? "",
    description: profile.description ?? "",
    address: profile.address ?? "",
    phone: profile.phone ?? "",
    whatsapp: profile.whatsapp ?? "",
    instagram: profile.instagram ?? "",
    themePrimary: profile.themePrimary,
    themeSecondary: profile.themeSecondary,
    themeFont: profile.themeFont,
    slug: profile.slug,
    showAddress: profile.showAddress,
    showPhone: profile.showPhone,
    showWhatsapp: profile.showWhatsapp,
    showInstagram: profile.showInstagram,
    showPrices: profile.showPrices,
  };
}

/** Parámetros de la vista previa: los mismos nombres que el formulario. */
function previewQuery(values: Values): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "boolean") {
      if (value) params.set(key, "on");
    } else {
      params.set(key, value);
    }
  }
  return params.toString();
}

export function PublicPageEditor({
  profile,
  images,
  baseUrl,
  suggestedPresetId,
  disabled,
}: {
  profile: PublicProfile;
  images: { logoUrl: string | null; coverUrl: string | null };
  baseUrl: string;
  suggestedPresetId: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const form = useForm(updatePublicPageAction);
  const [values, setValues] = useState<Values>(() => toValues(profile));
  const [device, setDevice] = useState<Device>("mobile");
  const [query, setQuery] = useState(() => previewQuery(toValues(profile)));
  // Cambia al subir o quitar una imagen: fuerza a recargar la vista previa.
  const [imagesVersion, setImagesVersion] = useState(0);

  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((current) => ({ ...current, [key]: value }));

  // La vista previa se actualiza un momento después de dejar de escribir.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(previewQuery(values)), 450);
    return () => clearTimeout(timer);
  }, [values]);

  // Tras guardar, el resto del panel (enlace para compartir, QR) toma los datos nuevos.
  const saved = form.state;
  const handled = useRef<typeof saved>(undefined);
  useEffect(() => {
    if (saved?.ok && saved !== handled.current) {
      handled.current = saved;
      router.refresh();
    }
  }, [saved, router]);

  const theme = useMemo(
    () => resolveTheme({ primary: values.themePrimary, secondary: values.themeSecondary, font: values.themeFont }),
    [values.themePrimary, values.themeSecondary, values.themeFont],
  );
  const primaryValid = normalizeHexColor(values.themePrimary) !== null;
  const activePreset = THEME_PRESETS.find(
    (preset) =>
      preset.primary === theme.primary && preset.secondary === theme.secondary && preset.font === values.themeFont,
  );

  function applyPreset(preset: ThemePreset) {
    setValues((current) => ({
      ...current,
      themePrimary: preset.primary,
      themeSecondary: preset.secondary,
      themeFont: preset.font,
    }));
  }

  const host = baseUrl.replace(/^https?:\/\//, "");

  return (
    <div className="grid gap-10 xl:grid-cols-[minmax(0,27rem)_minmax(0,1fr)] xl:items-start">
      <form {...form.formProps}>
        <fieldset disabled={disabled} className="space-y-9">
          <Group title="Identidad" description="Cómo se presenta tu negocio.">
            <div className="grid gap-4 sm:grid-cols-2">
              <ImageUploader
                kind="logo"
                label="Logo"
                hint="Cuadrado, JPG, PNG o WebP."
                url={images.logoUrl}
                fallback={values.name}
                disabled={disabled}
                onChanged={() => setImagesVersion((v) => v + 1)}
              />
              <ImageUploader
                kind="cover"
                label="Imagen de portada"
                hint="Opcional. Apaisada, mínimo 600 px de ancho."
                url={images.coverUrl}
                fallback={values.name}
                disabled={disabled}
                onChanged={() => setImagesVersion((v) => v + 1)}
              />
            </div>
            <Field label="Nombre comercial o profesional" htmlFor="name" error={form.error("name")}>
              <Input id="name" name="name" value={values.name} onChange={(e) => set("name", e.target.value)} maxLength={80} required />
            </Field>
            <Field
              label="Especialidad o categoría"
              htmlFor="specialty"
              optional
              hint="Por ejemplo: Osteopatía, Barbería, Uñas esculpidas."
              error={form.error("specialty")}
            >
              <Input id="specialty" name="specialty" value={values.specialty} onChange={(e) => set("specialty", e.target.value)} maxLength={60} />
            </Field>
            <Field label="Descripción" htmlFor="description" optional error={form.error("description")}>
              <textarea
                id="description"
                name="description"
                value={values.description}
                onChange={(e) => set("description", e.target.value)}
                maxLength={300}
                rows={3}
                className="field h-auto py-2"
              />
            </Field>
          </Group>

          <Group title="Estilo" description="Elegí un punto de partida y ajustalo a tu marca.">
            <div>
              <p className="mb-2 text-sm font-medium">Estilos sugeridos</p>
              <div className="flex flex-wrap gap-2">
                {THEME_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    aria-pressed={activePreset?.id === preset.id}
                    className={cn(
                      "flex items-center gap-2 rounded-full border bg-card py-1.5 pr-3 pl-1.5 text-sm font-medium transition-colors",
                      activePreset?.id === preset.id ? "border-primary ring-2 ring-primary/20" : "border-input hover:border-primary",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="size-6 rounded-full border border-black/10"
                      style={{ background: `linear-gradient(135deg, ${preset.primary} 50%, ${preset.secondary} 50%)` }}
                    />
                    {preset.label}
                    {preset.id === suggestedPresetId && (
                      <span className="text-xs font-normal text-muted-foreground">· para tu rubro</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <ColorField
                id="themePrimary"
                label="Color principal"
                hint="Botones, enlaces y detalles."
                value={values.themePrimary}
                onChange={(value) => set("themePrimary", value)}
                error={form.error("themePrimary")}
              />
              <ColorField
                id="themeSecondary"
                label="Color secundario"
                hint="Acompaña al principal en la portada."
                value={values.themeSecondary}
                onChange={(value) => set("themeSecondary", value)}
                error={form.error("themeSecondary")}
              />
            </div>

            {primaryValid && (
              <div className="rounded-xl border border-border bg-card p-3.5 text-sm" data-testid="contrast-check">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="rounded-lg px-3 py-1.5 text-sm font-medium"
                    style={{ backgroundColor: theme.primary, color: theme.primaryForeground }}
                  >
                    Botón
                  </span>
                  <span className="font-medium" style={{ color: theme.primaryText }}>
                    Texto y enlaces
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Contraste {contrastRatio(theme.primaryText, "#ffffff").toFixed(1)}:1
                  </span>
                </div>
                <p className="mt-2 text-muted-foreground">
                  {theme.adjusted
                    ? "Es un color claro: lo usamos tal cual en botones y portada, y una versión más oscura en textos y enlaces para que se lean bien."
                    : "Este color se lee bien sobre fondo claro."}
                </p>
              </div>
            )}

            <Field label="Tipografía" htmlFor="themeFont" error={form.error("themeFont")}>
              <select id="themeFont" name="themeFont" className="field" value={values.themeFont} onChange={(e) => set("themeFont", e.target.value)}>
                {THEME_FONTS.map((font) => (
                  <option key={font.id} value={font.id}>
                    {font.label} — {font.hint}
                  </option>
                ))}
              </select>
            </Field>
          </Group>

          <Group title="Contacto" description="Dejá vacío lo que no quieras mostrar, o apagá su visibilidad.">
            <ContactField
              id="address"
              label="Dirección"
              value={values.address}
              onChange={(value) => set("address", value)}
              visible={values.showAddress}
              onVisible={(value) => set("showAddress", value)}
              toggleName="showAddress"
              error={form.error("address")}
              maxLength={160}
            />
            <ContactField
              id="whatsapp"
              label="WhatsApp"
              hint="Con característica, sin 0 ni 15. Ej.: 11 5555 0000."
              inputMode="tel"
              value={values.whatsapp}
              onChange={(value) => set("whatsapp", value)}
              visible={values.showWhatsapp}
              onVisible={(value) => set("showWhatsapp", value)}
              toggleName="showWhatsapp"
              error={form.error("whatsapp")}
              maxLength={40}
            />
            <ContactField
              id="instagram"
              label="Instagram"
              hint="Tu usuario, por ejemplo @minegocio."
              value={values.instagram}
              onChange={(value) => set("instagram", value)}
              visible={values.showInstagram}
              onVisible={(value) => set("showInstagram", value)}
              toggleName="showInstagram"
              error={form.error("instagram")}
              maxLength={80}
            />
            <ContactField
              id="phone"
              label="Teléfono"
              inputMode="tel"
              value={values.phone}
              onChange={(value) => set("phone", value)}
              visible={values.showPhone}
              onVisible={(value) => set("showPhone", value)}
              toggleName="showPhone"
              error={form.error("phone")}
              maxLength={40}
            />
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-4">
              <input
                type="checkbox"
                name="showPrices"
                checked={values.showPrices}
                onChange={(e) => set("showPrices", e.target.checked)}
                className="mt-0.5 size-5 accent-[var(--primary)]"
              />
              <span>
                <span className="block font-medium">Mostrar los precios de mis servicios</span>
                <span className="block text-sm text-muted-foreground">
                  Los servicios sin precio cargado nunca muestran uno.
                </span>
              </span>
            </label>
          </Group>

          <Group title="Dirección de tu página" description="El enlace que compartís con tus clientes.">
            <Field
              label="Identificador"
              htmlFor="slug"
              hint="Solo letras, números y guiones. Si lo cambiás, el enlace anterior sigue funcionando y lleva al nuevo."
              error={form.error("slug")}
            >
              <div className="flex items-center rounded-lg border border-input bg-card focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/25">
                <span className="shrink-0 pl-3 text-sm text-muted-foreground">{host}/</span>
                <input
                  id="slug"
                  name="slug"
                  value={values.slug}
                  onChange={(e) => set("slug", e.target.value)}
                  className="h-10 min-w-0 flex-1 bg-transparent pr-3 outline-none"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={50}
                  required
                />
              </div>
            </Field>
          </Group>

          <div className="sticky bottom-20 z-10 space-y-3 rounded-2xl border border-border bg-card/95 p-4 shadow-lg backdrop-blur lg:bottom-4">
            <FormMessage message={form.message} tone={form.state?.ok ? "success" : "error"} />
            {disabled ? (
              <p className="text-sm text-muted-foreground">Tu cuenta está en solo lectura: activá tu plan para editar tu página.</p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <SubmitButton pending={form.pending}>Guardar cambios</SubmitButton>
                <ButtonLink variant="outline" href={`${baseUrl}/${profile.slug}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink aria-hidden="true" /> Ver página publicada
                </ButtonLink>
              </div>
            )}
          </div>
        </fieldset>
      </form>

      <section aria-labelledby="vista-previa" className="xl:sticky xl:top-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="vista-previa" className="text-lg font-semibold">
            Vista previa
          </h2>
          <div role="group" aria-label="Dispositivo" className="flex rounded-lg border border-input bg-card p-0.5">
            {(Object.keys(DEVICES) as Device[]).map((key) => {
              const item = DEVICES[key];
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={device === key}
                  onClick={() => setDevice(key)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    device === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <item.icon className="size-4" aria-hidden="true" /> {item.label}
                </button>
              );
            })}
          </div>
        </div>
        <PreviewFrame src={`/vista-previa?${query}&_=${imagesVersion}`} width={DEVICES[device].width} />
        <p className="mt-2 text-xs text-muted-foreground">
          Muestra tus cambios antes de guardarlos. Las imágenes se aplican apenas las subís.
        </p>
      </section>
    </div>
  );
}

function Group({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      <div className="mt-4 space-y-5">{children}</div>
    </section>
  );
}

function ColorField({
  id,
  label,
  hint,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
}) {
  const normalized = normalizeHexColor(value);
  return (
    <Field label={label} htmlFor={id} hint={hint} error={error ?? (normalized ? null : "Usá un color como #1f4d3f.")}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label}: selector`}
          value={normalized ?? "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="size-10 shrink-0 cursor-pointer rounded-lg border border-input bg-card p-1"
        />
        <Input
          id={id}
          name={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={7}
          autoCapitalize="none"
          spellCheck={false}
          className="font-mono"
        />
      </div>
    </Field>
  );
}

function ContactField({
  id,
  label,
  hint,
  value,
  onChange,
  visible,
  onVisible,
  toggleName,
  error,
  maxLength,
  inputMode,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onVisible: (value: boolean) => void;
  toggleName: string;
  error: string | null;
  maxLength: number;
  inputMode?: "tel";
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint} error={error} optional>
      <div className="flex items-center gap-3">
        <Input id={id} name={id} value={value} onChange={(e) => onChange(e.target.value)} maxLength={maxLength} inputMode={inputMode} />
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-sm text-muted-foreground">
          <input
            type="checkbox"
            name={toggleName}
            checked={visible}
            onChange={(e) => onVisible(e.target.checked)}
            className="size-4 accent-[var(--primary)]"
          />
          Mostrar
        </label>
      </div>
    </Field>
  );
}

/**
 * La página real dentro de un marco del ancho del dispositivo elegido,
 * reducida para entrar en el espacio disponible. Al ser un documento aparte,
 * responde al ancho simulado igual que en un celular o un monitor de verdad.
 */
function PreviewFrame({ src, width }: { src: string; width: number }) {
  const container = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setAvailable(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const scale = available > 0 ? Math.min(1, available / width) : 1;

  return (
    <div ref={container} className="overflow-hidden rounded-2xl border border-border bg-muted">
      <div className="mx-auto overflow-hidden bg-background" style={{ width: width * scale, height: PREVIEW_HEIGHT }}>
        <iframe
          title="Vista previa de tu página pública"
          src={src}
          loading="lazy"
          style={{
            width,
            height: PREVIEW_HEIGHT / scale,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            border: 0,
          }}
        />
      </div>
    </div>
  );
}
