// Tres negocios de demostración, ficticios y reproducibles, para desarrollo LOCAL.
//
//   node scripts/seed-demos.mjs            # crea (o recrea) los tres
//   node scripts/seed-demos.mjs --clean    # los borra
//
// 1. Espacio Raíz — Psicología y Bienestar   (una profesional independiente, en prueba)
// 2. Barbería Don Lucho                      (3 profesionales, con fotos y turnos simultáneos, Plan Equipo)
// 3. Centro Estético Almendra                (5 profesionales, cuentas individuales y permisos, Plan Equipo)
//
// Seguridad:
//  - Se niega a correr si DATABASE_URL no apunta a localhost/127.0.0.1 o si NODE_ENV=production.
//  - Todo es inventado: nombres, teléfonos y emails @example.com. No hay datos reales ni de clientes reales.
//  - Las contraseñas no están en el repositorio: se toman de DEMO_PASSWORD o se generan al azar en cada
//    ejecución y se muestran una sola vez en la consola. Las cuentas existen solo en la base local.
//  - Las suscripciones de los demos son registros locales (sin identificador de Mercado Pago): no hay cobros.
//  - No se publican ni se exponen: viven en tu base de desarrollo.

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import sharp from "sharp";

if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  const { config } = await import("dotenv");
  config({ path: ".env.local", quiet: true });
}
const databaseUrl = process.env.DATABASE_URL ?? "";
const host = (() => {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    return "";
  }
})();
if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(host)) {
  console.error(`Rechazado: DATABASE_URL apunta a "${host || "(vacía)"}" o NODE_ENV=production. Este script solo corre contra una base local de desarrollo.`);
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });
const password = process.env.DEMO_PASSWORD || randomBytes(9).toString("base64url");
const passwordHash = await bcrypt.hash(password, 10);
const DAY = 86400000;
const SLUGS = ["demo-espacio-raiz", "demo-barberia-don-lucho", "demo-centro-almendra"];
const EMAIL_SUFFIX = "@demo.agendia.example.com";

async function clean() {
  const orgs = await db.organization.findMany({ where: { slug: { in: SLUGS } }, select: { id: true } });
  const ids = orgs.map((o) => o.id);
  // Los turnos referencian servicios y clientes con RESTRICT: se borran primero.
  await db.appointment.deleteMany({ where: { organizationId: { in: ids } } });
  await db.organization.deleteMany({ where: { id: { in: ids } } });
  await db.user.deleteMany({ where: { email: { endsWith: EMAIL_SUFFIX } } });
}

async function image(organizationId, kind, label, color, size = 400) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="${color}"/><circle cx="${size * 0.5}" cy="${size * 0.4}" r="${size * 0.16}" fill="#ffffff55"/><rect x="${size * 0.28}" y="${size * 0.62}" width="${size * 0.44}" height="${size * 0.3}" rx="${size * 0.12}" fill="#ffffff55"/><text x="50%" y="96%" font-family="sans-serif" font-size="${size * 0.07}" fill="#ffffffcc" text-anchor="middle">${label}</text></svg>`;
  const bytes = await sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer();
  const row = await db.organizationImage.create({
    data: { organizationId, kind, contentType: "image/webp", width: size, height: size, bytes },
  });
  return row.id;
}

const business = (name, slug, extra) =>
  db.organization.create({
    data: {
      name,
      slug,
      trialStartedAt: new Date(),
      trialEndsAt: new Date(Date.now() + 14 * DAY),
      onboardingCompletedAt: new Date(),
      minNoticeMinutes: 0,
      ...extra,
    },
  });

async function owner(organization, name, email) {
  const user = await db.user.create({ data: { email: `${email}${EMAIL_SUFFIX}`, name, passwordHash, emailVerifiedAt: new Date() } });
  await db.membership.create({ data: { organizationId: organization.id, userId: user.id, role: "owner", notifyBookings: true } });
  return user;
}

async function professional(organization, order, data, hours) {
  const pro = await db.professional.create({ data: { organizationId: organization.id, sortOrder: order, ...data } });
  const days = hours.days ?? [1, 2, 3, 4, 5, 6];
  await db.availabilityRule.createMany({
    data: days.flatMap((weekday) => hours.ranges.map(([startMinute, endMinute]) => ({ organizationId: organization.id, professionalId: pro.id, weekday, startMinute, endMinute }))),
  });
  return pro;
}

const services = (organization, list) =>
  Promise.all(list.map((s, index) => db.service.create({ data: { organizationId: organization.id, sortOrder: index, ...s } })));

let customerCounter = 0;
async function customers(organization, names) {
  return Promise.all(
    names.map((name) => {
      customerCounter++;
      return db.customer.create({
        data: { organizationId: organization.id, name, email: `cliente${customerCounter}@example.com`, phone: `11555${String(10000 + customerCounter).slice(-5)}` },
      });
    }),
  );
}

/** Fecha local (Buenos Aires, UTC-3 sin horario de verano) a las `minutes` del día `offset` desde hoy. */
function at(offset, minutes) {
  const now = new Date(Date.now() + offset * DAY);
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(now).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0) + (minutes + 180) * 60000);
}

async function appointment(organization, pro, service, customer, when, extra = {}) {
  return db.appointment.create({
    data: {
      organizationId: organization.id,
      professionalId: pro.id,
      serviceId: service.id,
      customerId: customer.id,
      startsAt: when,
      endsAt: new Date(when.getTime() + service.durationMinutes * 60000),
      manageToken: randomBytes(16).toString("hex"),
      source: "public_booking",
      price: service.price,
      ...extra,
    },
  });
}

async function plan(code) {
  return db.plan.findUniqueOrThrow({ where: { code } });
}
async function activate(organization, code) {
  const p = await plan(code);
  await db.organization.update({ where: { id: organization.id }, data: { status: "active" } });
  await db.subscription.create({
    data: { organizationId: organization.id, planId: p.id, status: "active", lastPaymentAt: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * DAY), contractedAmount: p.price, contractedCurrency: p.currency },
  });
}

async function seed() {
  const result = [];

  // 1) Independiente ------------------------------------------------------
  {
    const org = await business("Espacio Raíz — Psicología y Bienestar", SLUGS[0], {
      industry: "psicologia",
      specialty: "Psicología clínica y acompañamiento",
      description: "Sesiones individuales y de pareja, en consultorio y online. Un espacio tranquilo para ordenar lo que sentís.",
      address: "Av. Ejemplo 1234, Ciudad Ejemplo",
      whatsapp: "5491155550001",
      instagram: "espacioraiz.demo",
      themePrimary: "#2f5d50",
      themeSecondary: "#d98f6a",
      themeFont: "elegante",
      workMode: "solo",
    });
    await owner(org, "Dra. Valeria Ejemplo", "raiz");
    const pro = await db.professional.create({ data: { organizationId: org.id, displayName: "Valeria Ejemplo", color: "#2f5d50" } });
    const logo = await image(org.id, "logo", "Raíz", "#2f5d50");
    void logo;
    await image(org.id, "cover", "Espacio Raíz", "#3f7a68", 1200);
    await db.availabilityRule.createMany({
      data: [1, 2, 3, 4].flatMap((weekday) => [[600, 780], [900, 1140]].map(([startMinute, endMinute]) => ({ organizationId: org.id, professionalId: pro.id, weekday, startMinute, endMinute }))),
    });
    const list = await services(org, [
      { name: "Primera entrevista", durationMinutes: 60, price: 25000 },
      { name: "Sesión individual", durationMinutes: 50, price: 22000 },
      { name: "Sesión de pareja", durationMinutes: 70, price: 30000 },
    ]);
    const clients = await customers(org, ["Camila Ruiz", "Tomás Herrera", "Lucía Paredes"]);
    await appointment(org, pro, list[1], clients[0], at(1, 600));
    await appointment(org, pro, list[0], clients[1], at(2, 960));
    await appointment(org, pro, list[2], clients[2], at(3, 1020));
    result.push([org.name, "1 profesional · prueba gratuita", "raiz"]);
  }

  // 2) Barbería con 3 profesionales ---------------------------------------
  {
    const org = await business("Barbería Don Lucho", SLUGS[1], {
      industry: "belleza",
      specialty: "Cortes, barba y afeitado clásico",
      description: "Tres barberos, un solo lugar. Elegí con quién querés atenderte o dejá que te asignemos al primero libre.",
      address: "Calle Muestra 456, Ciudad Ejemplo",
      whatsapp: "5491155550002",
      instagram: "donlucho.demo",
      themePrimary: "#1c1917",
      themeSecondary: "#b8893b",
      themeFont: "fuerte",
      teamModeEnabled: true,
      workMode: "team",
    });
    await activate(org, "equipo");
    const user = await owner(org, "Luciano Ejemplo", "lucho");
    await db.professional.deleteMany({ where: { organizationId: org.id } });
    const pros = [];
    const roster = [
      ["Luciano", "Barbero y dueño. Especialista en afeitado clásico.", "#b8893b", [[540, 840], [960, 1200]], [2, 3, 4, 5, 6]],
      ["Mateo", "Cortes modernos y degradados.", "#3b82a8", [[600, 1080]], [1, 2, 3, 4, 5]],
      ["Santi", "Barba y perfilado.", "#8a5a44", [[720, 1260]], [2, 3, 4, 5, 6]],
    ];
    for (const [index, [name, description, color, ranges, days]] of roster.entries()) {
      const photoImageId = await image(org.id, "professional", name, color);
      pros.push(await professional(org, index, { displayName: name, description, color, photoImageId, userId: index === 0 ? user.id : null }, { ranges, days }));
    }
    await image(org.id, "logo", "Don Lucho", "#1c1917");
    await image(org.id, "cover", "Barbería Don Lucho", "#2c2724", 1200);
    const list = await services(org, [
      { name: "Corte clásico", durationMinutes: 30, price: 9000 },
      { name: "Corte y barba", durationMinutes: 45, price: 13000 },
      { name: "Afeitado con toalla caliente", durationMinutes: 30, price: 8000, allProfessionals: false },
    ]);
    // El afeitado clásico lo hace solo Luciano.
    await db.serviceProfessional.create({ data: { organizationId: org.id, serviceId: list[2].id, professionalId: pros[0].id } });
    const clients = await customers(org, ["Nicolás Vega", "Joaquín Silva", "Emiliano Torres", "Bruno Díaz", "Franco Rojas", "Agustín Lemos"]);
    // Tres turnos al mismo horario, uno por profesional: no se pisan porque cada uno tiene su agenda.
    await appointment(org, pros[0], list[0], clients[0], at(1, 660));
    await appointment(org, pros[1], list[0], clients[1], at(1, 660), { professionalSelection: "any" });
    await appointment(org, pros[2], list[1], clients[2], at(1, 780), { requestedProfessionalId: pros[2].id });
    await appointment(org, pros[1], list[1], clients[3], at(2, 720));
    await appointment(org, pros[0], list[2], clients[4], at(2, 1000), { requestedProfessionalId: pros[0].id });
    await appointment(org, pros[2], list[0], clients[5], at(3, 840));
    result.push([org.name, "3 profesionales con fotos · Plan Equipo", "lucho"]);
  }

  // 3) Centro estético con 5 profesionales y cuentas individuales ---------
  {
    const org = await business("Centro Estético Almendra", SLUGS[2], {
      industry: "unas",
      specialty: "Estética facial, corporal y manos",
      description: "Cinco profesionales con agenda propia. Reservá tu tratamiento con quien prefieras.",
      address: "Pasaje Demostración 78, Ciudad Ejemplo",
      whatsapp: "5491155550003",
      instagram: "almendra.demo",
      themePrimary: "#a8456a",
      themeSecondary: "#e3b9a4",
      themeFont: "elegante",
      teamModeEnabled: true,
      teamAccountsEnabled: true,
      workMode: "team",
      // Permisos de los profesionales con cuenta propia: pueden cancelar sus turnos, no editar sus horarios.
      professionalPermissions: { cancelAppointments: true, manageHours: false },
    });
    await activate(org, "equipo");
    await owner(org, "Carolina Ejemplo", "almendra");
    await db.professional.deleteMany({ where: { organizationId: org.id } });
    const roster = [
      ["Carolina", "Cosmetóloga. Limpiezas y tratamientos faciales.", "#a8456a", [[540, 1020]]],
      ["Belén", "Manicuría y esmaltado semipermanente.", "#c9788f", [[600, 1140]]],
      ["Florencia", "Masajes descontracturantes.", "#7a9e87", [[780, 1260]]],
      ["Julieta", "Depilación definitiva.", "#6b7fb0", [[540, 900]]],
      ["Rocío", "Pestañas y cejas.", "#d49a6a", [[660, 1200]]],
    ];
    const pros = [];
    for (const [index, [name, description, color, ranges]] of roster.entries()) {
      const photoImageId = await image(org.id, "professional", name, color);
      const pro = await professional(org, index, { displayName: name, description, color, photoImageId }, { ranges, days: index % 2 === 0 ? [1, 2, 3, 4, 5] : [2, 3, 4, 5, 6] });
      pros.push(pro);
    }
    // Cuentas individuales para tres profesionales: ven solo su agenda.
    for (const [index, key] of [[1, "belen"], [2, "flor"], [4, "rocio"]]) {
      const user = await db.user.create({ data: { email: `${key}${EMAIL_SUFFIX}`, name: roster[index][0], passwordHash, emailVerifiedAt: new Date() } });
      await db.membership.create({ data: { organizationId: org.id, userId: user.id, role: "professional", notifyBookings: false } });
      await db.professional.update({ where: { id: pros[index].id }, data: { userId: user.id } });
    }
    await image(org.id, "logo", "Almendra", "#a8456a");
    await image(org.id, "cover", "Centro Estético Almendra", "#c9788f", 1200);
    const list = await services(org, [
      { name: "Limpieza facial profunda", durationMinutes: 60, price: 18000, allProfessionals: false },
      { name: "Manicuría semipermanente", durationMinutes: 75, price: 12000, allProfessionals: false },
      { name: "Masaje descontracturante", durationMinutes: 50, price: 16000, allProfessionals: false },
      { name: "Depilación definitiva (zona)", durationMinutes: 30, price: 9000, allProfessionals: false },
      { name: "Lifting de pestañas", durationMinutes: 60, price: 15000, allProfessionals: false },
    ]);
    for (const [index, service] of list.entries()) {
      await db.serviceProfessional.create({ data: { organizationId: org.id, serviceId: service.id, professionalId: pros[index].id } });
    }
    const clients = await customers(org, ["Sofía Acosta", "Martina Ledesma", "Paula Benítez", "Daniela Cruz", "Micaela Soto", "Abril Pereyra"]);
    for (const [index, pro] of pros.entries()) {
      await appointment(org, pro, list[index], clients[index], at(2 + (index % 2), 660 + index * 30));
    }
    await appointment(org, pros[0], list[0], clients[5], at(4, 600));
    result.push([org.name, "5 profesionales · 3 cuentas individuales · Plan Equipo", "almendra, belen, flor, rocio"]);
  }

  return result;
}

try {
  await clean();
  if (process.argv.includes("--clean")) {
    console.log("Demos eliminados.");
  } else {
    const summary = await seed();
    console.log("\nDemos creados en la base local:\n");
    for (const [name, detail, users] of summary) console.log(` • ${name} — ${detail}\n     usuarios: ${users.split(", ").map((u) => `${u}${EMAIL_SUFFIX}`).join(", ")}`);
    console.log(`\nContraseña de todas las cuentas demo (solo esta ejecución): ${password}`);
    console.log("Páginas públicas: /demo-espacio-raiz · /demo-barberia-don-lucho · /demo-centro-almendra\n");
  }
} finally {
  await db.$disconnect();
}
