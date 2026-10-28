# Preliminär Källmall: Norge–Mexiko

Granskad 2026-10-27. Mall-id: `norway-mexico-sources-v1`.

Detta är ett förslag för den norska piloten, inte en aktiverad skanningslista eller en organisationssparad kundlista. Förslaget ligger separat i `src/lib/product/source-catalog.ts`. Den svenska motorns källista, källtabeller och hämtare ändras inte. Den svenska personprofilens fem publiceringskällor är inte hela den svenska motorns källista.

## Förslag

| Källa | Roll | Status Vid Kontroll |
| --- | --- | --- |
| El Universal, El Financiero, La Jornada Politica, Expansion Mexico, BBC Latin America | Gemensam nyhetsbas om Mexiko | De fem befintliga publiceringskällorna återanvänds. Ingen ny hälsokontroll eller ny hämtning av dessa har gjorts här. |
| [Norges ambassad: nyheter](https://www.norway.no/es/mexico/noruega-mexico/news/) | Bilaterala relationer och norsk närvaro | Nyhetssidan verifierad via ambassadens officiella startsida. Mexiko behöver skiljas från ambassadens övriga ländertäckning. |
| [UD / Regjeringen: RSS](https://www.regjeringen.no/no/aktuelt/rss/id2581966/) | Norsk utrikespolitik med Mexikokoppling | RSS finns och XML-tolkning lyckades. Det breda flödet blandar bland annat kalenderposter; inte en färdig UD-/Mexikoprenumeration. |
| [UD: reseinformation för Mexiko](https://www.regjeringen.no/no/tema/utenrikssaker/reiseinformasjon/velg-land/reiseinfo_mexico/id2416296/) | Konsulär bevakning | Officiell sida verifierad. Ändringar och uppdateringsdatum ska bevakas, inte återkommande kopior av samma text. |
| [SSB: utrikeshandel med varor](https://www.ssb.no/utenriksokonomi/utenrikshandel/statistikk/utenrikshandel-med-varer) | Norsk handel med Mexiko | Referens/statistik. Landdimensionen måste väljas till Mexiko; den allmänna sidans totalsiffror får inte presenteras som bilateral handel. |
| [EFTA: Mexiko](https://www.efta.int/trade-relations/free-trade-network/mexico) | Avtals- och handelsreferens | Officiell Mexikosida verifierad. Referensmaterial, inte ett aktuellt nyhetsflöde. |
| [Innovasjon Norge: nyheter](https://www.innovasjonnorge.no/seksjon/nyheter) | Export och företagssamarbeten | Officiell sida verifierad, men artikelupptäckt återstår att testa. Kräver uttrycklig Mexikokoppling. |
| [NOREF: nyheter](https://noref.no/insights/news) | Fred, medling och diplomati | Officiell lista verifierad. Låg publiceringstakt och äldre material om andra länder kräver datum- och landsfilter. |
| [SRE: pressarkiv](https://www.gob.mx/sre/archivo/prensa) | Mexikansk utrikespolitik och Norgekoppling | Arkivet gav HTTP 403. Föreslagen, inte tekniskt godkänd hämtning. |
| [Secretaría de Economía: pressarkiv](https://www.gob.mx/se/archivo/prensa) | Handel och investeringar | Arkivet gav HTTP 403. Föreslagen, inte tekniskt godkänd hämtning. |
| [INEGI: pressrum](https://www.inegi.org.mx/app/saladeprensa/) | Ekonomi och samhällsstatistik | Officiell sida verifierad, men listan laddas dynamiskt. Kräver adapterprov och korrekta statistikperioder. |
| [Ambassadens X-konto](https://twitter.com/NoruegaMexCA) | Social Premium-kandidat | Länken är verifierad från [ambassadens webbplats](https://www.norway.no/es/mexico), men aktivitet och API-åtkomst är inte verifierade. Förblir låst. |

Totalt: 16 källposter, varav 5 i befintligt publiceringsurval, 10 föreslagna offentliga källor och 1 låst social Premium-kandidat. En kontolänk är inte en OAuth-anslutning och innebär inte att sociala anrop får göras.

## Avgränsning Före Aktivering

- Nyheter behöver en uttrycklig Mexikokoppling i originalmaterialet. Källans land eller sidans navigering räcker inte som belägg. För bilateralt urval behövs även Norgekoppling.
- Kalenderdatum, avtalsdatum, statistikperiod och publiceringsdatum måste hållas isär. Referenser och reseinformation ska inte fylla listan över färska nyhetssignaler.
- RSS-flödet från Regjeringen svarade HTTP 200 och gav 96 tolkningsbara poster vid kontrollen, men innehöll kalenderposter med framtida datum. Dessa datum bevisar inte att nyheter nyligen publicerats.
- Åtkomstspärrar kringgås inte. Webbåtkomst betyder inte heller att automatiserad hämtning eller återpublicering är licensierad; användningsvillkor granskas före anslutning.
- Inga nya poster, AI-analyser, globala källändringar eller sociala API-anrop skapas av denna mall eller dess granskningsvy.

## Nästa Beslut

Pilotkontakten bör bekräfta sakprioriteringar, exempelvis handel, energi, maritima frågor, fred/medling och konsulär bevakning. Därefter kopieras valda mallposter till arbetsytans egen källista när medlemskap och gemensam kvot införs. Ändringar i en arbetsytas lista ska inte ändra andra arbetsytor eller den svenska motorns källista.

Den tekniska anslutningen behöver en separat läs-/publiceringsväg med verifierade adaptrar, datum, landsfilter, deduplicering och rättigheter. Godkända öppna källor kan återanvända gemensam råinhämtning, medan privata källval, kundspecifika analyser och social förbrukning avgränsas per arbetsyta.
