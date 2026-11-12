import type { PersonalLanguage } from "@/lib/product/profiles";

const messages = {
  sv: {loading:"Laddar sparade urval…",saving:"Sparar urval…",saved:"Urvalet är sparat.",loadFailed:"Urvalen kunde inte laddas. Markeringar är tillfälligt avstängda.",
    saveFailed:"Sparningen kunde inte bekräftas. Försök igen.",conflict:"Urvalet har ändrats i en annan flik. Granska det uppdaterade urvalet och försök igen.",
    retry:"Ladda om urvalen",bookmarkOnly:"Sparad källänk · materialet finns inte i det aktuella arkivet"},
  nb: {loading:"Laster lagrede utvalg…",saving:"Lagrer utvalg…",saved:"Utvalget er lagret.",loadFailed:"Utvalgene kunne ikke lastes. Markeringer er midlertidig deaktivert.",
    saveFailed:"Lagringen kunne ikke bekreftes. Prøv igjen.",conflict:"Utvalget er endret i en annen fane. Se gjennom det oppdaterte utvalget og prøv igjen.",
    retry:"Last utvalgene på nytt",bookmarkOnly:"Lagret kildelenke · materialet finnes ikke i det gjeldende arkivet"},
  en: {loading:"Loading saved selections…",saving:"Saving selection…",saved:"Selection saved.",loadFailed:"Your selections could not be loaded. Selection controls are temporarily disabled.",
    saveFailed:"Saving could not be confirmed. Please try again.",conflict:"Your selection changed in another tab. Review the updated selection and try again.",
    retry:"Reload selections",bookmarkOnly:"Saved source link · material is outside the available archive"},
  es: {loading:"Cargando selecciones guardadas…",saving:"Guardando selección…",saved:"Selección guardada.",loadFailed:"No se pudieron cargar tus selecciones. Las casillas están temporalmente desactivadas.",
    saveFailed:"No se pudo confirmar el guardado. Inténtalo de nuevo.",conflict:"La selección cambió en otra pestaña. Revisa la selección actualizada e inténtalo de nuevo.",
    retry:"Volver a cargar selecciones",bookmarkOnly:"Enlace guardado · el material no está en el archivo disponible"},
};
export const personalSelectionMessages = (language:PersonalLanguage)=>messages[language];
