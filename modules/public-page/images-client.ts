/**
 * URL pública de una imagen guardada. Vive aparte de images.ts (solo
 * servidor) para poder usarla también desde componentes del navegador. Cambia
 * cada vez que se reemplaza la imagen, así que se puede cachear para siempre.
 */
export const imageUrl = (id: string) => `/api/media/${id}`;
