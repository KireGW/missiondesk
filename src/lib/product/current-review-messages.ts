import type { PersonalLanguage } from "@/lib/product/profiles";

const messages={
  sv:{label:"Ny i urvalet",help:"Tillkommen sedan du senast markerade urvalet som genomgånget. Märkningen avser urvalet, inte publiceringsdatumet.",
    count:"{count} nya i urvalet",acknowledge:"Markera urvalet som genomgånget",scope:"Gäller alla {count} signaler i Current signals.",
    loading:"Laddar nyhetsmarkeringar…",saving:"Sparar genomgången…",saved:"Urvalet är markerat som genomgånget.",
    loadFailed:"Nyhetsmarkeringarna kunde inte laddas.",saveFailed:"Genomgången kunde inte sparas. Markeringarna behålls.",
    conflict:"Genomgången har ändrats i en annan flik. Kontrollera markeringarna och försök igen.",
    unavailable:"Uppdatera nyhetsflödet innan du markerar urvalet som genomgånget.",retry:"Ladda om markeringar"},
  nb:{label:"Ny i utvalget",help:"Lagt til siden du sist markerte utvalget som gjennomgått. Merkingen gjelder utvalget, ikke publiseringsdatoen.",
    count:"{count} nye i utvalget",acknowledge:"Marker utvalget som gjennomgått",scope:"Gjelder alle {count} saker i Current signals.",
    loading:"Laster nyhetsmarkeringer…",saving:"Lagrer gjennomgangen…",saved:"Utvalget er markert som gjennomgått.",
    loadFailed:"Nyhetsmarkeringene kunne ikke lastes.",saveFailed:"Gjennomgangen kunne ikke lagres. Markeringene beholdes.",
    conflict:"Gjennomgangen er endret i en annen fane. Kontroller markeringene og prøv igjen.",
    unavailable:"Oppdater nyhetsstrømmen før du markerer utvalget som gjennomgått.",retry:"Last markeringene på nytt"},
  en:{label:"New in selection",help:"Added since you last marked the selection reviewed. This refers to selection membership, not publication date.",
    count:"{count} new in selection",acknowledge:"Mark selection reviewed",scope:"Applies to all {count} stories in Current signals.",
    loading:"Loading news markers…",saving:"Saving review…",saved:"Selection marked reviewed.",
    loadFailed:"News markers could not be loaded.",saveFailed:"The review could not be saved. New markers are retained.",
    conflict:"The review changed in another tab. Check the updated markers and try again.",
    unavailable:"Refresh the news feed before marking the selection reviewed.",retry:"Reload markers"},
  es:{label:"Nueva en la selección",help:"Añadida desde que marcaste la selección como revisada. Se refiere a la selección, no a la fecha de publicación.",
    count:"{count} nuevas en la selección",acknowledge:"Marcar selección como revisada",scope:"Se aplica a las {count} noticias de Current signals.",
    loading:"Cargando marcas de noticias…",saving:"Guardando revisión…",saved:"Selección marcada como revisada.",
    loadFailed:"No se pudieron cargar las marcas de noticias.",saveFailed:"No se pudo guardar la revisión. Se conservan las marcas de novedades.",
    conflict:"La revisión cambió en otra pestaña. Comprueba las marcas actualizadas e inténtalo de nuevo.",
    unavailable:"Actualiza las noticias antes de marcar la selección como revisada.",retry:"Volver a cargar marcas"},
};
export const currentReviewMessages=(language:PersonalLanguage)=>messages[language];
