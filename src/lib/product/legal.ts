import type { PersonalLanguage } from "@/lib/product/profiles";

type LegalCopy = {
  title: string;
  operator: string;
  sections: readonly { id: string; title: string; paragraphs: readonly string[] }[];
};

export const legalMessages = {
  en: {
    title: "Legal information",
    operator: "Service provider",
    sections: [
      { id: "about", title: "About MissionDesk", paragraphs: ["MissionDesk is an independent service for monitoring public sources. It is not an official embassy or government service. A station name in a profile describes the monitoring context, not an official affiliation."] },
      { id: "sources", title: "Sources and assessments", paragraphs: ["The service searches a curated source list, not the entire internet. Articles and excerpts may contain errors, opinions or outdated information. Automated summaries, topics and relevance assessments are aids to selection, not independent fact-checks. Consult the original source before relying on a signal."] },
      { id: "use", title: "Use of the service", paragraphs: ["Use MissionDesk for public information only. Do not enter confidential, classified or sensitive work material. Keep your sign-in details private."] },
      { id: "copyright", title: "Copyright", paragraphs: ["Rights in external articles, images and excerpts remain with their respective rights holders. MissionDesk's copyright notice applies to its own original material, not third-party source material. Access to this service does not grant additional republication rights."] },
    ],
  },
  nb: {
    title: "Juridisk informasjon",
    operator: "Tjenesteleverandør",
    sections: [
      { id: "about", title: "Om MissionDesk", paragraphs: ["MissionDesk er en uavhengig tjeneste for overvåking av offentlige kilder. Den er ikke en offisiell ambassade- eller myndighetstjeneste. Stasjonsnavnet i en profil beskriver overvåkingskonteksten, ikke en offisiell tilknytning."] },
      { id: "sources", title: "Kilder og vurderinger", paragraphs: ["Tjenesten søker i en utvalgt kildeliste, ikke på hele internett. Artikler og utdrag kan inneholde feil, meninger eller utdatert informasjon. Automatiske sammendrag, emner og relevansvurderinger er støtte for utvalg, ikke uavhengig faktasjekk. Les originalkilden før du legger et signal til grunn for beslutninger."] },
      { id: "use", title: "Bruk av tjenesten", paragraphs: ["Bruk MissionDesk kun til offentlig informasjon. Ikke legg inn fortrolig, gradert eller sensitivt arbeidsmateriale. Hold innloggingsopplysningene dine private."] },
      { id: "copyright", title: "Opphavsrett", paragraphs: ["Rettighetene til eksterne artikler, bilder og utdrag tilhører de respektive rettighetshaverne. MissionDesks opphavsrettsmerknad gjelder eget originalmateriale, ikke tredjepartsmateriale. Tilgang til tjenesten gir ingen ytterligere rett til viderepublisering."] },
    ],
  },
  es: {
    title: "Información legal",
    operator: "Proveedor del servicio",
    sections: [
      { id: "about", title: "Acerca de MissionDesk", paragraphs: ["MissionDesk es un servicio independiente de seguimiento de fuentes públicas. No es un servicio oficial de ninguna embajada ni gobierno. El nombre de la sede en un perfil describe el contexto del seguimiento, no una afiliación oficial."] },
      { id: "sources", title: "Fuentes y evaluaciones", paragraphs: ["El servicio busca en una lista de fuentes seleccionadas, no en todo internet. Los artículos y extractos pueden contener errores, opiniones o información desactualizada. Los resúmenes, temas y evaluaciones de relevancia automáticos ayudan a seleccionar información; no son una verificación independiente de los hechos. Consulte la fuente original antes de basarse en una señal."] },
      { id: "use", title: "Uso del servicio", paragraphs: ["Utilice MissionDesk solo para información pública. No introduzca material de trabajo confidencial, clasificado o sensible. Mantenga sus credenciales de acceso en privado."] },
      { id: "copyright", title: "Derechos de autor", paragraphs: ["Los derechos sobre artículos, imágenes y extractos externos pertenecen a sus respectivos titulares. El aviso de copyright de MissionDesk se aplica a su material original, no al de terceros. El acceso al servicio no concede derechos adicionales de republicación."] },
    ],
  },
  sv: {
    title: "Juridisk information",
    operator: "Tjänsteleverantör",
    sections: [
      { id: "about", title: "Om MissionDesk", paragraphs: ["MissionDesk är en fristående tjänst för bevakning av offentliga källor. Den är inte en officiell ambassad- eller myndighetstjänst. Stationsnamnet i en profil beskriver bevakningens sammanhang, inte en officiell anknytning."] },
      { id: "sources", title: "Källor och bedömningar", paragraphs: ["Tjänsten söker i en utvald källista, inte på hela internet. Artiklar och utdrag kan innehålla fel, åsikter eller inaktuell information. Automatiska sammanfattningar, ämnen och relevansbedömningar är urvalsstöd, inte oberoende faktagranskning. Läs originalkällan innan du använder en signal som beslutsunderlag."] },
      { id: "use", title: "Användning av tjänsten", paragraphs: ["Använd MissionDesk enbart för offentlig information. Lägg inte in konfidentiellt, sekretessbelagt eller känsligt arbetsmaterial. Håll dina inloggningsuppgifter privata."] },
      { id: "copyright", title: "Upphovsrätt", paragraphs: ["Rättigheterna till externa artiklar, bilder och utdrag tillhör respektive rättighetshavare. MissionDesks copyrightinformation gäller eget originalmaterial, inte material från tredje part. Tillgång till tjänsten ger inga ytterligare rättigheter till återpublicering."] },
    ],
  },
} as const satisfies Record<PersonalLanguage, LegalCopy>;
