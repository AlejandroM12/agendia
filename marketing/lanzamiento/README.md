# Lanzamiento de Agendia — campaña inicial en redes

Seis piezas listas para publicar (un carrusel de Instagram y una publicación de fotos de TikTok), con sus textos, y todo lo necesario para regenerarlas.

| Red | Pieza | Archivo | Tamaño |
|---|---|---|---|
| Instagram | 1 · El problema | `instagram/01-problema.png` | 1080 × 1350 (4:5) |
| Instagram | 2 · Tu propia página | `instagram/02-solucion.png` | 1080 × 1350 (4:5) |
| Instagram | 3 · Probá gratis | `instagram/03-conversion.png` | 1080 × 1350 (4:5) |
| TikTok | 1 · Hook | `tiktok/01-hook.png` | 1080 × 1920 (9:16) |
| TikTok | 2 · Reservan solos | `tiktok/02-solucion.png` | 1080 × 1920 (9:16) |
| TikTok | 3 · Llamada a la acción | `tiktok/03-conversion.png` | 1080 × 1920 (9:16) |

Textos para pegar: `instagram/caption.md` y `tiktok/caption.md`.

## Antes de publicar (checklist)

- [ ] El enlace de la bio de ambos perfiles es `https://agendia.atajolab.dev` (de preferencia con `?utm_source=instagram&utm_medium=organico` / `?utm_source=tiktok&utm_medium=organico`).
- [ ] Las capturas muestran **datos de ejemplo** (negocios y personas ficticios): cada pieza lo aclara al pie. No las presentes como clientes reales.
- [ ] No publiques testimonios ni cantidades de usuarios hasta tenerlos de verdad (y con permiso).
- [ ] Las piezas no mencionan precios a propósito, para que no queden desactualizadas. Si agregás alguno, verificalo antes en `lib/brand.ts` y en `/admin` (hoy: Plan Profesional $14.000 por mes; Licencia independiente $199.000).

## Orden de publicación

1. **Instagram, carrusel de 3 imágenes** en este orden: `01-problema` → `02-solucion` → `03-conversion`. La primera frena el scroll, la segunda muestra el producto y la tercera convierte.
2. **TikTok, publicación de fotos** con las tres imágenes en este orden: `01-hook` → `02-solucion` → `03-conversion`. Publicalo uno o dos días después del carrusel, para no competir con vos mismo.
3. Los días siguientes, **historias** de Instagram con la imagen 2 (sticker de enlace) y la 3, y una respuesta a cada comentario o mensaje.

## Estrategia creativa

La historia es la misma en las dos redes, contada con otro ritmo:

1. **Problema reconocible:** coordinar turnos por mensajes, a cualquier hora (conversaciones sueltas en Instagram; notificaciones de madrugada en TikTok, más directo y con humor «POV»).
2. **Diferencial concreto:** no es «una agenda más»: es **tu propia página de reservas**, con tu logo, tus colores, tu enlace y tu QR. Es lo que Agendia hace distinto y lo que se ve en la interfaz real.
3. **Acción simple:** probar 7 días gratis.

Decisiones de diseño:
- **Interfaz real como protagonista.** Todas las pantallas son capturas de la aplicación real corriendo en un entorno local con datos de ejemplo; no hay maquetas inventadas.
- **Identidad de Agendia:** papel cálido, verde pino y terracota, títulos en Fraunces y texto en Geist (los mismos de la aplicación y de la landing).
- **Tres negocios ficticios con identidades distintas** (estética, barbería, kinesiología) en la pieza 2 de Instagram, para mostrar que cada profesional tiene su propia marca y no una plantilla común.
- **Un QR real** en la pieza 2: apunta a `agendia.atajolab.dev`, así que se puede escanear desde la pantalla.
- **TikTok no es un reescalado de Instagram:** otra composición, otros fondos (oscuro, claro y verde) y tipografía más grande. Los textos importantes están dentro de la zona segura (x 70–910 px, y 190–1440 px), lejos de los botones laterales y de la descripción de la interfaz de TikTok.
- **Sin promesas de más:** no se mencionan recordatorios por WhatsApp, dominios propios, testimonios, métricas ni resultados garantizados. Lo que se dice (reservas online, página con logo y colores, enlace y QR, confirmación y recordatorio por email, clientes y turnos ordenados) existe hoy en el producto.

## Público objetivo

Profesionales independientes, emprendedores y pequeños negocios que trabajan con turnos —peluquerías y barberías, estética y uñas, consultorios, psicología, kinesiología, nutrición, masajes, clases particulares, servicios técnicos— principalmente de **Formosa, Chaco, Corrientes, Misiones** y el resto de Argentina. Quien agenda hoy con mensajes, un cuaderno o una planilla y quiere dejar de coordinar a mano. El tono es rioplatense, cercano y sin jerga técnica.

## Copy final

### Instagram — texto de la publicación (`instagram/caption.md`)

```
¿Cuántas veces por día respondés «¿tenés turno para mañana?»

Si trabajás con turnos, seguro te suena: mensajes a cualquier hora, horarios que se pisan, gente que pide cambiar el turno y vos tratando de acordarte de todo.

Agendia es una agenda online para profesionales independientes y pequeños negocios. Con ella:

✔ Tenés tu propia página de reservas, con tu logo, tus colores y tu enlace (y un código QR para tu local o tus redes).
✔ Tus clientes eligen servicio, día y horario libre, sin crear cuentas ni escribirte.
✔ Reciben la confirmación y un recordatorio por email.
✔ Tus turnos y tus clientes quedan ordenados en un solo lugar, desde el celular.
✔ Pueden cancelar o reprogramar desde su enlace, dentro del plazo que vos definís.

Sirve para peluquerías, barberías, estética, consultorios, psicología, kinesiología, clases particulares y cualquier trabajo que se organice con turnos.

Probala gratis durante 7 días 👉 agendia.atajolab.dev (link en la bio).

¿Tenés dudas o querés que te contemos cómo empezar? Comentá «AGENDA» o escribinos por mensaje y te respondemos.

Para profesionales y emprendedores de Formosa, Chaco, Corrientes, Misiones y todo el país.

#Agendia #TurnosOnline #AgendaDigital #Emprendedores #Formosa
```

Hashtags: el texto usa **cinco**. Las fuentes consultadas recomiendan pocos hashtags muy relevantes (entre 3 y 5) porque su peso en el algoritmo bajó; no hay datos oficiales de Instagram que lo confirmen, así que probá y medí. Alternativas para rotar, **sin volúmenes verificados** (revisá en la app cuántas publicaciones tiene cada uno antes de elegir):

- Marca: `#Agendia` `#AtajoLab`
- Producto: `#TurnosOnline` `#AgendaDigital` `#ReservasOnline` `#GestionDeTurnos`
- Público: `#Emprendedores` `#EmprendedoresArgentinos` `#PymesArgentinas` `#ProfesionalesIndependientes` `#NegociosLocales`
- Zona: `#Formosa` `#NEA` `#Chaco` `#Corrientes` `#Misiones` `#Resistencia` `#Posadas` `#Argentina`

### TikTok — texto de la publicación (`tiktok/caption.md`)

```
¿Pasás el día contestando mensajes para dar turnos? 😮‍💨

Con Agendia tus clientes reservan solos, desde tu propia página con tu logo, tus colores y tu enlace. Vos solo atendés.

Probala gratis durante 7 días. Encontrá el enlace en nuestro perfil 👆

#Agendia #TurnosOnline #EmprendedoresArgentinos #Formosa #NEA
```

Hashtags: cinco, mezclando producto y zona (`#Agendia #TurnosOnline #EmprendedoresArgentinos #Formosa #NEA`). No usé etiquetas genéricas de viralidad. Podés cambiar `#Formosa` por la provincia de la cuenta que publica o sumar una segunda.

**Audio sugerido.** Es una publicación de fotos: elegí música instrumental, ligera y con ritmo medio (pop acústico o lo-fi «productivo»), a volumen bajo, sin letra que compita con el texto. Como la cuenta es comercial, buscá el sonido en la **Biblioteca de música comercial** de TikTok (en el selector de sonidos, filtro «Uso comercial»): la música que no esté en esa biblioteca puede no estar habilitada para publicidad de marcas. Los sonidos en tendencia solo valen si figuran ahí. No fijé una canción concreta porque el catálogo cambia.

## Recomendaciones para publicación orgánica

- **Primeras horas:** respondé cada comentario y mensaje rápido; es la señal más fácil de controlar. Fijá un comentario con el enlace y la invitación a probar.
- **Probá horarios** (por ejemplo noche entre semana y mediodía de fin de semana) y comparalos con las estadísticas de tu cuenta; no hay un horario universal.
- **Instagram:** el carrusel es el formato indicado para contenido que se guarda y se comparte; pedí explícitamente guardar o enviar a alguien que da turnos. Agregá texto alternativo a cada imagen. Compartí la imagen 2 en historias con el enlace.
- **TikTok:** usá la portada de la primera imagen, activá los subtítulos del texto en pantalla si los ofrece y respondé comentarios con video o foto cuando sea posible.
- **Mostrá el producto de verdad:** cuando tengas negocios reales usando Agendia, pedí permiso para mostrar su página (logo, colores y enlace) y recién ahí publicá testimonios. Hasta entonces, las piezas son ilustrativas y lo dicen.
- **Medí con enlaces con UTM** (`utm_source`, `utm_medium`, `utm_campaign=lanzamiento`) y mirá cuántos registros llegan por cada red.
- **Frecuencia:** tres publicaciones por semana, alternando problema → producto → pregunta, rinden más que una sola tanda.

## Recomendaciones para una futura campaña paga en Meta Ads

Son sugerencias para testear, no resultados garantizados.

- **Objetivo:** empezá con *Tráfico* a la landing o *Clientes potenciales / registros* si ya medís registros (ver el aviso sobre el Pixel abajo).
- **Segmentación:** ubicación por provincias (Formosa, Chaco, Corrientes, Misiones y después el resto del país), 25–54 años, intereses de emprendimiento, pequeños negocios y los rubros objetivo (belleza, salud, bienestar). Dejá que el algoritmo amplíe y comparalo con una audiencia amplia.
- **Creatividades:** el carrusel de Instagram completo; las tres imágenes de TikTok como historias y reels (9:16, dejando libre el 14 % superior e inferior). Probá dos titulares: «¿Seguís coordinando turnos por mensajes?» contra «Tu negocio. Tu propia página de reservas.».
- **Presupuesto:** poco y parejo (por ejemplo, un monto diario bajo durante 7 a 10 días) y decidí con el **costo por registro**, no con los «me gusta».
- **Medición:** hoy el sitio **no tiene Pixel de Meta ni eventos de conversión** (agregarlos es un cambio del producto y requiere la política de privacidad). Sin eso, medí con UTM y con los registros nuevos del panel de plataforma (`/admin`).
- **Políticas:** no prometas resultados («vas a vender más»), no menciones atributos personales del público y mantené la aclaración de datos de ejemplo.
- **Destino:** `https://agendia.atajolab.dev/registro` si querés que lleguen directo a crear la cuenta, o la landing si preferís que vean primero los dos planes.

## Archivos fuente

```
fuentes/
  fonts.css                 Tipografías de la marca (Fraunces y Geist), incrustadas
  fonts/                    Archivos .woff2
  piezas/                   Una página HTML por pieza + base.css (sistema visual)
    assets/qr.svg           QR a agendia.atajolab.dev (se genera al renderizar)
  capturas/                 Capturas reales del producto (PNG)
  demo/seed-demo.mjs        Carga tres negocios ficticios en una base LOCAL
  demo/capturar.mjs         Toma las capturas de la aplicación
  renderizar.mjs            Exporta las piezas a PNG con el tamaño exacto
```

Para una campaña nueva alcanza con copiar una pieza de `fuentes/piezas/`, cambiar el texto y, si hace falta, tomar capturas nuevas.

## Cómo regenerar las imágenes

Solo para uso local: `seed-demo.mjs` se niega a correr contra una base que no sea `localhost`, y nada de esto toca producción.

1. Base local en marcha (la del proyecto: `docker start agendia-postgres`) con las migraciones aplicadas (`npx prisma migrate deploy`) y el build de la aplicación hecho (`npm run build`).
2. Servidor local con registro habilitado y la URL pública de la marca (así el panel muestra `agendia.atajolab.dev/...`):
   ```sh
   ALLOW_REGISTRATION_WITHOUT_EMAIL=1 AUTH_URL=http://localhost:3100 APP_URL=https://agendia.atajolab.dev npx next start -p 3100
   ```
3. Datos de ejemplo (crea los tres negocios y los turnos de la estética; es idempotente):
   ```sh
   node marketing/lanzamiento/fuentes/demo/seed-demo.mjs
   ```
   Para recrearlos desde cero, borrá antes los usuarios `demo-*@example.com` en la base local.
4. Capturas de pantalla (usa los turnos «de hoy» y «del lunes» relativos a la fecha en que se corre; conviene correrlo el mismo día que el seed):
   ```sh
   node marketing/lanzamiento/fuentes/demo/capturar.mjs
   ```
5. Exportar las seis imágenes (o solo algunas: `... renderizar.mjs ig-02`):
   ```sh
   node marketing/lanzamiento/fuentes/renderizar.mjs
   ```

Las capturas quedan en `fuentes/capturas/` y las imágenes finales en `instagram/` y `tiktok/`.

## Fuentes consultadas para las recomendaciones

Material de blogs de herramientas de marketing, con intereses comerciales; tomalo como orientativo.

- [Metricool — Alcance de Instagram](https://metricool.com/es/alcance-instagram/)
- [Reason Why — Estudio de Instagram de Metricool 2026](https://www.reasonwhy.es/actualidad/estudio-instagram-metricool-2026)
- [Dataslayer — Algoritmo de Instagram, diciembre de 2025](https://www.dataslayer.ai/es/blog/instagrams-december-2025-algorithm-updat)
- [Socialz — Cómo publicar en Instagram](https://socialz.ai/es/blog/como-publicar-en-instagram)
- [Metricool — TikTok Photo Mode](https://metricool.com/tiktok-slideshow/)
- [Soundstripe — Música en TikTok](https://www.soundstripe.com/blogs/how-to-make-a-tiktok-with-pictures-and-music)
- [Metricool — Música en publicaciones de TikTok](https://metricool-onxkr.hc.ferndesk.com/how-to-add-music-to-your-tiktok-posts-x8ch4)
