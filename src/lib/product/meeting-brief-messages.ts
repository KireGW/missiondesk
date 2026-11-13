import type { PersonalLanguage } from "@/lib/product/profiles";

const messages={
  sv:{title:"Mötesrubrik",date:"Mötesdatum",save:"Spara mötesuppgifter",cancel:"Ångra ändringar",up:"Flytta upp",down:"Flytta ned",
    help:"Spara rubrik och datum före utskrift. Använd pilarna vid artiklarna för att ändra ordningen."},
  nb:{title:"Møtetittel",date:"Møtedato",save:"Lagre møtedetaljer",cancel:"Forkast endringer",up:"Flytt opp",down:"Flytt ned",
    help:"Lagre tittel og dato før utskrift. Bruk pilene ved artiklene for å endre rekkefølgen."},
  en:{title:"Meeting title",date:"Meeting date",save:"Save meeting details",cancel:"Discard changes",up:"Move up",down:"Move down",
    help:"Save the title and date before printing. Use the arrows beside articles to change their order."},
  es:{title:"Título de la reunión",date:"Fecha de la reunión",save:"Guardar datos de la reunión",cancel:"Descartar cambios",up:"Subir",down:"Bajar",
    help:"Guarda el título y la fecha antes de imprimir. Usa las flechas junto a las noticias para cambiar el orden."},
};
export const meetingBriefMessages=(language:PersonalLanguage)=>messages[language];
