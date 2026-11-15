import { brand, licenseRenewalText, offers, trialPolicy } from "@/lib/brand";
import { PLAN_CAPABILITIES } from "@/lib/plans";

export type Faq = { q: string; a: string };

/**
 * Preguntas frecuentes de la landing y de los datos estructurados (FAQPage). Un solo lugar: lo que se
 * responde acá sale de las mismas constantes que usan los planes y los precios. Las preguntas sobre
 * equipos se agregan solo cuando los planes con equipo están publicados.
 *
 * Los textos son comerciales, no legales: lo que compromete a las partes son los Términos y las
 * condiciones de la licencia (docs/LEGAL_REVIEW.md).
 */
export function getFaqs({ team }: { team: boolean }): Faq[] {
  const pro = PLAN_CAPABILITIES.profesional;
  const equipo = PLAN_CAPABILITIES.equipo;

  const common: Faq[] = [
    { q: "¿Necesito instalar algún programa?", a: `No. ${brand.name} funciona desde el navegador, en el celular o en la computadora. No hay nada que descargar.` },
    { q: `¿Puedo usar ${brand.name} si trabajo solo o sola?`, a: "Sí. Es lo más común: tenés tu agenda, tu página de reservas y tus recordatorios, sin configurar nada de equipos." },
    { q: `¿Puedo usar ${brand.name} desde mi celular?`, a: "Sí. Está pensada para el celular: ves tu agenda, cargás turnos y respondés a tus clientes desde el teléfono." },
    { q: "¿Mis clientes necesitan descargar alguna aplicación?", a: "No. Entran a tu enlace desde el navegador, eligen servicio, día y horario, dejan su nombre y un contacto, y listo. No tienen que crear cuentas." },
    { q: "¿Necesito conocimientos de informática?", a: "No. Si usás WhatsApp, podés usar Agendia. Además, te ayudamos a configurar tu agenda." },
    { q: "¿Me ayudan a configurar mi agenda?", a: "Sí. La configuración inicial es asistida: te acompañamos con tus servicios, duraciones y horarios para que arranques tranquilo." },
    { q: "¿Puedo registrar los turnos que recibo por WhatsApp, por teléfono o en persona?", a: "Sí. Los cargás desde tu panel en un momento, eligiendo servicio, día y horario, y quedan en tu agenda junto con los que reservan online. Así evitás que se te pisen." },
    { q: "¿Puedo compartir mi página de reservas por Instagram y WhatsApp?", a: "Sí. Tenés un enlace propio para pegar en tu perfil de Instagram, en tu estado o en un mensaje de WhatsApp." },
    { q: "¿Puedo personalizar mi página de reservas?", a: "Sí. Podés ponerle tu logo, tu foto de portada, tus colores y tu estilo, para que se vea como tu negocio." },
    { q: `¿${brand.name} envía recordatorios a mis clientes?`, a: "Sí, por correo electrónico: la confirmación al reservar y un recordatorio antes del turno, de forma automática." },
    { q: "¿Los recordatorios por WhatsApp son automáticos?", a: "No. Desde cada turno abrís un chat de WhatsApp con el mensaje ya escrito y lo enviás vos, a mano. Lo único automático son los correos electrónicos." },
    { q: "¿Cómo funcionan los mensajes de WhatsApp?", a: "Son mensajes preparados: tocás el botón, se abre WhatsApp con el texto listo (con el nombre, el día y la hora) y lo mandás desde tu propio teléfono." },
    { q: "¿Qué incluye la prueba gratuita?", a: `${trialPolicy.trialDays} días con todas las funciones del ${offers.monthly}, hasta ${pro.maxActiveProfessionals} profesionales activos, sin tarjeta y sin cobros automáticos. Al terminar, vos decidís si seguís.` },
    { q: `¿Qué pasa si no contrato cuando terminan los ${trialPolicy.trialDays} días?`, a: `Tu cuenta queda en modo de solo lectura durante ${trialPolicy.readonlyGraceDays} días: seguís viendo tus turnos y clientes, pero no podés crear turnos nuevos ni recibir reservas hasta elegir un plan. Nunca borramos tus datos automáticamente.` },
    { q: "¿Cómo me entero de una reserva nueva?", a: "Aparece al instante en tu agenda y, si querés, también te avisamos por email." },
    { q: "¿Sirve para mi rubro?", a: "Si trabajás con turnos, sí. Vos definís tus propios servicios, duraciones y horarios: no está atada a ninguna actividad en particular." },
    { q: "¿Puedo cancelar mi suscripción?", a: "Sí, cuando quieras. No hay permanencia mínima y tus datos siguen siendo tuyos." },
  ];

  const teamFaqs: Faq[] = [
    { q: "¿Puedo sumar profesionales?", a: `Sí. El ${offers.monthly} admite hasta ${pro.maxActiveProfessionals} profesionales activos y el ${offers.team}, hasta ${equipo.maxActiveProfessionals}. Cada profesional tiene su propia agenda, sus horarios y sus servicios.` },
    { q: "¿Los profesionales necesitan una cuenta propia?", a: "No es obligatorio. Podés administrar todas las agendas vos, o invitar a cada profesional por email para que entre con su propia cuenta y vea solo su agenda. Vos decidís qué puede hacer cada uno." },
    { q: "¿Pago por cada profesional?", a: `No se paga por profesional: cada plan tiene un precio fijo por mes. Lo que cambia entre planes es cuántos profesionales activos admite. Las cuentas individuales no se cobran, y quien administra pero no atiende no ocupa lugar.` },
    { q: "¿Puedo administrar las agendas de todos?", a: "Sí. Como propietario ves y administrás las agendas de todo el equipo desde un solo lugar." },
    { q: "¿El cliente puede elegir quién lo atiende?", a: "Sí. Puede elegir a un profesional o dejar «cualquier profesional»: en ese caso asignamos a alguien que esté libre en ese horario, sin superponer turnos." },
    { q: "¿Qué pasa si necesito más profesionales?", a: `Pasás al ${offers.team} desde «Mi plan». Se habilita cuando Mercado Pago confirma el pago, no antes.` },
    { q: "¿Cómo cambio de plan?", a: "Desde «Mi plan», con una pantalla que te muestra el plan actual, el nuevo, el precio, cuántos profesionales admite y desde cuándo rige." },
    { q: `¿Qué pasa si paso del ${offers.team} al ${offers.monthly}?`, a: `El ${offers.monthly} admite ${pro.maxActiveProfessionals} profesionales activos. Elegís quiénes siguen recibiendo reservas y tenés 7 días para adaptarte. No borramos profesionales, clientes ni historial, y no cancelamos ningún turno ya confirmado. Si volvés al ${offers.team}, recuperás todo.` },
    { q: `¿Qué diferencia hay entre el ${offers.monthly} y el ${offers.team}?`, a: `Solo la cantidad de profesionales activos: hasta ${pro.maxActiveProfessionals} con el ${offers.monthly} y hasta ${equipo.maxActiveProfessionals} con el ${offers.team}. Todas las funciones son las mismas.` },
  ];

  const license: Faq[] = [
    { q: "¿Qué incluye la licencia?", a: `Una licencia de uso permanente, con la instalación y la configuración a cargo nuestro, en una instalación independiente con base de datos propia. El primer año incluye alojamiento, dominio y soporte. ${team ? `La ${offers.licenseProfessional} admite hasta ${pro.maxActiveProfessionals} profesionales activos y la ${offers.licenseTeam}, hasta ${equipo.maxActiveProfessionals}.` : ""}`.trim() },
    { q: "¿Qué significa que la licencia sea permanente?", a: "Que pagás una sola vez por el derecho a usar el sistema y esa licencia no vence. No quiere decir que el alojamiento, el dominio o el soporte estén incluidos para siempre: eso se explica en la pregunta siguiente." },
    { q: "¿Qué sucede después del primer año?", a: `La licencia sigue siendo tuya. Lo que cambia es que, desde el segundo año, el alojamiento, el dominio y el soporte se renuevan por separado. ${licenseRenewalText()}` },
    { q: "¿La licencia incluye el código fuente?", a: "No. Es una licencia de uso: te instalamos y configuramos el sistema en una instalación independiente, con tu propia base de datos, pero no se entrega el código fuente." },
    ...(team
      ? []
      : [{ q: `¿Qué diferencia hay entre el ${offers.monthly} y la ${offers.license}?`, a: `Con el ${offers.monthly} pagás por mes y usás ${brand.name} online, con hosting y soporte incluidos mientras dure la suscripción. La ${offers.license} es un pago único por una licencia de uso permanente: una instalación independiente, con base de datos propia, que instalamos y configuramos por vos. No incluye el código fuente. ${licenseRenewalText()}` }]),
  ];

  return [...common, ...(team ? teamFaqs : []), ...license];
}
