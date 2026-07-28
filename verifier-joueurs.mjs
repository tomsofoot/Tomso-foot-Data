// verifier-joueurs.mjs  (v2 — clubs uniquement + retraités bien détectés)
// ─────────────────────────────────────────────────────────────────────────────
// Vérifie et met à jour la SITUATION de chaque joueur du jeu TomsoFoot depuis
// WIKIDATA, et ne réécrit que ce qui a réellement changé. Conçu pour GitHub Actions
// (lançable aussi à la main : node verifier-joueurs.mjs ; passe complète : --full).
//
// Pour chaque joueur : club actuel, statut (en_activite / sans_club / retraite),
// dernier mouvement (transfert ou prêt + date), date de dernière vérif, source,
// niveau de confiance, éligibilité "joueur du jour", et historique des changements.
//
// v2 : on ne regarde QUE les vrais clubs de foot (pas les sélections nationales),
//      et un joueur sans club ouvert est "retraité" s'il l'était déjà dans le jeu
//      OU si son dernier club s'est terminé il y a plus de 18 mois ; sinon "sans_club".
//
// Cadence : mercato (janv + juin-août) → tous les jours ; sinon 1/7 par jour (rotation).
// Sorties : registre.json + journal-<année>.jsonl. Prérequis : Node 18+.
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs/promises";

const UA = "TomsoFoot-verif/2.0 (jeu de devinette; contact: tomsofoot.fr)";
const SPARQL = "https://query.wikidata.org/sparql";
const REGISTRE = "registre.json";
const BATCH = 40;
const PAUSE = 500;
const GRACE_JOURS = 7;
const FRAIS_JOURS_RECENT = 30;
const RETRAITE_MOIS = 18;             // dernier club fini il y a > 18 mois → retraité
const sleep = ms => new Promise(r => setTimeout(r, ms));

const JOUEURS = {
  "Q245054":"Fabio Borini","Q318905":"Krisztián Németh","Q312183":"Mamadou Sakho","Q248228":"Luis Alberto","Q147589":"Kolo Touré","Q372624":"Jack Robinson","Q250901":"Álvaro Arbeloa","Q250978":"Djimi Traoré",
  "Q16239548":"Marko Grujić","Q252190":"Xherdan Shaqiri","Q27694":"Emre Can","Q360217":"Paul Anderson","Q339252":"Loris Karius","Q342342":"Gabriel Paletta","Q342497":"Miki Roqué","Q342690":"Florent Sinama-Pongolle",
  "Q342572":"Sander Westerveld","Q26517":"Luis Suárez","Q26704703":"Federico Chiesa","Q17493":"Thiago Alcántara","Q349125":"Dejan Lovren","Q350412":"Nikolay Mikhailov","Q350785":"Salif Diao","Q351797":"Emiliano Insúa",
  "Q357977":"Stephen Darby","Q185208":"Glen Johnson","Q1354960":"Mohamed Salah","Q368416":"Carl Medjani","Q155884":"Christian Ziege","Q155903":"Dietmar Hamann","Q128895":"Anthony Le Tallec","Q129700":"Mario Balotelli",
  "Q112813857":"Jarell Quansah","Q271615":"Boudewijn Zenden","Q125460":"Simon Mignolet","Q116067":"Philipp Degen","Q273715":"Jordan Henderson","Q10885":"Fara Williams","Q159159":"Andy Carroll","Q348195":"Daniel Ayala",
  "Q371594":"Sebastián Leto","Q372046":"Bernard Diomède","Q15477554":"Brad Smith","Q372379":"Georginio Wijnaldum","Q128829":"Michael Owen","Q161571":"Javier Mascherano","Q28531111":"Luis Díaz","Q296589":"Danny Murphy",
  "Q274626":"Martin Kelly","Q33297140":"Alexis Mac Allister","Q163666":"Pepe Reina","Q30134278":"Dominik Szoboszlai","Q107031318":"Conor Bradley","Q299228":"Brad Jones","Q113433814":"Stefan Bajčetić","Q27569376":"Trent Alexander-Arnold",
  "Q17325280":"Naby Keita","Q285841":"Nick Barmby","Q110739094":"Ben Doak","Q10526787":"Wataru Endō","Q3163157":"Javier Manquillo","Q17505113":"Joe Gomez","Q133903":"Virgil van Dijk","Q26192":"Steven Caulker",
  "Q104784711":"Fábio Carvalho","Q110874376":"Milos Kerkez","Q26380":"Iago Aspas","Q294214":"Dirk Kuyt","Q294501":"Steve McManaman","Q247708":"Suso","Q184946":"Joe Cole","Q295416":"Luis Javier García Sanz",
  "Q295627":"Scott Carson","Q295637":"Victor Moses","Q248890":"José Enrique Sánchez","Q175296":"Raul Meireles","Q296416":"Jermaine Pennant","Q298327":"Jay Spearing","Q2476368":"Harry Wilson","Q299403":"Charles Itandje",
  "Q18237361":"Alisson Becker","Q180581":"Milan Baroš","Q180939":"Peter Crouch","Q184205":"Daniel Agger","Q184218":"Ryan Babel","Q309894":"Diego Cavalieri","Q184612":"Robbie Keane","Q311162":"Nabil El Zhar",
  "Q311347":"David Ngog","Q311353":"Charlie Adam","Q311342":"Vladimír Šmicer","Q311872":"Philippe Coutinho","Q15915040":"Andrew Robertson","Q311947":"Daniel Pacheco","Q311941":"Sebastián Coates","Q312146":"Andrea Dossena",
  "Q312157":"Raheem Sterling","Q241321":"Stephen Warnock","Q241378":"Brad Friedel","Q312437":"Mikel San José","Q313054":"Jan Kromkamp","Q313090":"Paul Konchesky","Q313104":"Antonio Barragán","Q313131":"Mauricio Pellegrino",
  "Q313137":"Stéphane Henchoz","Q313250":"Joe Allen","Q314235":"Chris Kirkland","Q314627":"Jonjo Shelvey","Q314625":"Jon Flanagan","Q3557182":"Adrián San Miguel del Castillo","Q18336397":"Dominic Solanke","Q316540":"Oussama Assaidi",
  "Q316721":"Danny Guthrie","Q28801927":"Cody Gakpo","Q215435":"Albert Riera","Q219366":"David Martin","Q602525":"Roberto Firmino","Q714067":"Nathaniel Clyne","Q204141":"Christian Poulsen","Q204429":"Harry Kewell",
  "Q42100656":"Rhian Brewster","Q206548":"Robbie Fowler","Q723606":"Conor Coady","Q208433":"Milan Jovanović","Q208430":"Sotírios Kyrgiákos","Q19281946":"Danny Ward","Q209650":"Jari Litmanen","Q988626":"El-Hadji Diouf",
  "Q209942":"Sadio Mané","Q7800063":"Tiago Ilori","Q19518278":"Diogo Jota","Q191136":"James Milner","Q99529077":"Giorgi Mamardashvili","Q213124":"Mark González","Q56257870":"Ryan Gravenberch","Q18881":"Aly Cissokho",
  "Q100602910":"Hugo Ekitike","Q57567":"Joël Matip","Q46372260":"Darwin Núñez","Q22005877":"Konstantínos Tsimíkas","Q18982":"Tom Ince","Q72921909":"Neco Williams","Q42731":"Fernando Torres","Q4712133":"Alberto Moreno",
  "Q1926":"Alou Diarra","Q215425":"Andriy Voronin","Q215533":"Rigobert Song","Q53280628":"Ozan Kabak","Q1939":"Nicolas Anelka","Q216557":"Mohamed Sissoko","Q216910":"Fábio Aurélio","Q59432":"Andre Wisdom",
  "Q45567":"Fernando Morientes","Q59719":"Adam Lallana","Q511720":"Rickie Lambert","Q220593":"Lucas Pezzini Leiva","Q39667548":"Arthur Melo","Q66385776":"Nathaniel Phillips","Q56752774":"Harvey Elliott","Q512991":"Samed Yesil",
  "Q60326":"Christian Benteke","Q222231":"Daniel Sturridge","Q641425":"Fábio Henrique Tavares","Q61225":"Markus Babbel","Q5220475":"Danny Ings","Q776878":"Takumi Minamino","Q6277526":"Jordon Ibe","Q4254043":"Divock Origi",
  "Q67198835":"Jeremie Frimpong","Q5024":"Abel Xavier","Q239914":"Steve Finnan","Q223229":"Doni","Q941852":"Daniele Padelli","Q121422889":"Víctor Muñoz Villanueva","Q94699949":"Florian Wirtz","Q1936":"Djibril Cissé",
  "Q20932574":"Taiwo Awoniyi","Q20988104":"Pedro Chirivella","Q189449":"Yossi Benayoun","Q64627435":"Caoimhín Kelleher","Q189827":"John Arne Riise","Q190515":"Craig Bellamy","Q190651":"Jerzy Dudek","Q190929":"Maxi Rodríguez",
  "Q191151":"Alberto Aquilani","Q191162":"Emile Heskey","Q434432":"Igor Bišćan","Q21062024":"Ryan Kent","Q192840":"Sami Hyypiä","Q192913":"Martin Škrtel","Q687198":"Ádám Bogdán","Q194149":"Alex Oxlade-Chamberlain",
  "Q208104":"Carasu","Q23759917":"Alexander Isak","Q965705":"Lazar Marković","Q75857":"Nuri Şahin","Q458302":"Ragnar Klavan","Q459830":"Steven Gerrard","Q703414":"Jason McAteer","Q202312":"Stewart Downing",
  "Q19008392":"Sheyi Ojo","Q316935":"Paul McShane","Q245057":"Anders Lindegaard","Q188457":"Danny Welbeck","Q26259982":"Matthijs de Ligt","Q216614":"Alan Smith","Q247462":"Ryan Shawcross","Q322691":"Rodrigo Possebon",
  "Q191139":"Fabien Barthez","Q249488":"Erik Nevland","Q1361462":"Morgan Schneiderlin","Q2210473":"Wout Weghorst","Q326293":"Sylvan Ebanks-Blake","Q327227":"Sam Johnstone","Q16236289":"Tom Lawrence","Q251683":"Ángel Di María",
  "Q10585":"Ben Foster","Q221216":"Giuseppe Rossi","Q18637352":"Éric Bailly","Q196219":"Henrikh Mkhitaryan","Q112949":"Magnus Eikrem","Q334564":"Quinton Fortune","Q1112164":"Ángelo Henríquez","Q29491":"Chris Smalling",
  "Q258824":"Roy Carroll","Q29566":"Michael Carrick","Q342387":"Jesper Blomqvist","Q261534":"Diego Forlán","Q35831063":"Matheus Cunha","Q17507":"Gerard Piqué","Q126181":"Fraizer Campbell","Q350799":"Robbie Savage",
  "Q355847":"Jonathan Greening","Q2339":"Robin van Persie","Q154708":"Shinji Kagawa","Q19059840":"Donny van de Beek","Q266613":"Wayne Rooney","Q155049":"Q155049","Q19116103":"André Onana","Q29624459":"Scott McTominay",
  "Q163564":"Nemanja Vidić","Q128912":"Daley Blind","Q129027":"Paul Pogba","Q24258610":"Sergio Reguilón","Q1862778":"Danny Drinkwater","Q208673":"Federico Macheda","Q110001765":"Álvaro Fernández","Q275169":"Marouane Fellaini",
  "Q211596":"Zoran Tošić","Q106805131":"Anthony Elanga","Q29495":"Jonny Evans","Q29988852":"Angel Gomes","Q161041":"Jonathan Spector","Q1894":"Memphis Depay","Q18976":"Ole Gunnar Solskjær","Q130319703":"Ayden Heaven",
  "Q200785":"Tim Howard","Q19051":"Mame Biram Diouf","Q15149801":"Tyler Blackett","Q1916":"Patrice Évra","Q30148558":"Jadon Sancho","Q215463":"Sergio Romero","Q165125":"Javier Hernández Balcázar","Q3090268":"Frédéric Veseli",
  "Q15214940":"Alex Telles","Q165772":"Harry Maguire","Q189184":"Rafael","Q150268":"David de Gea","Q216917":"Jaap Stam","Q218063":"Philip Neville","Q167790":"Edinson Cavani","Q306351":"John O'Shea",
  "Q313617":"David Healy","Q168740":"Juan Mata","Q13422031":"Guillermo Varela","Q221222":"Darron Gibson","Q19996370":"Joel Castro Pereira","Q17517223":"Vanja Milinković-Savić","Q170235":"Dimitar Berbatov","Q321082":"Nick Powell",
  "Q27960175":"Manuel Ugarte Ribeiro","Q30689579":"Daniel James","Q172792":"Darren Fletcher","Q294593":"Jordi Cruijff","Q295506":"Nicky Butt","Q174486":"Antonio Valencia","Q28059260":"Dean Henderson","Q296207":"Chris Eagles",
  "Q10520":"David Beckham","Q30881092":"Lisandro Martínez","Q297603":"Nemanja Matić","Q2091463":"Anthony Martial","Q177343":"Mikaël Silvestre","Q298713":"Gabriel Obertan","Q11571":"Cristiano Ronaldo","Q22951255":"Marcus Rashford",
  "Q22969552":"Timothy Fosu-Mensah","Q111366053":"Alejandro Garnacho","Q180553":"Alexis Sánchez","Q10602":"Ashley Young","Q357912":"Thomas Heaton","Q309728":"Kieran Richardson","Q309781":"Ritchie De Laet","Q309890":"Manucho Gonçalves",
  "Q299450":"Bebé","Q311035":"Kléberson","Q16766365":"James Wilson","Q312152":"Ben Amos","Q206641":"Phil Jones","Q313316":"Romelu Lukaku","Q294951":"Christian Eriksen","Q314371":"Éric Djemba-Djemba",
  "Q315294":"Danny Simpson","Q315305":"Dong Fangzhuo","Q213401":"Fábio","Q713711":"Wilfried Zaha","Q72091732":"Facundo Pellistri","Q14327453":"Papa du Sénégal","Q472300":"Marcel Sabitzer","Q605817":"Jay-Jay Okocha",
  "Q464846":"Liam Miller","Q723565":"Will Keane","Q482955":"Edwin van der Sar","Q483417":"Rio Ferdinand","Q484766":"Tomasz Kuszczak","Q484968":"Louis Saha","Q65675442":"Joshua Zirkzee","Q489039":"Raphaël Varane",
  "Q72603655":"Amad Diallo","Q49561427":"Bryan Mbeumo","Q372709":"Alexander Büttner","Q65950315":"Benjamin Šeško","Q44298":"Bastian Schweinsteiger","Q4979316":"Bruno Fernandes","Q44788":"Matteo Darmian","Q616664":"Casemiro",
  "Q80712":"Michael Keane","Q755567":"Matty James","Q507890":"Marcos Rojo","Q59205608":"Antony","Q69569088":"Brandon Williams","Q45538":"Robbie Brady","Q546799":"James Chester","Q45626":"Ruud van Nistelrooy",
  "Q510401":"Martin Dúbravka","Q511997":"Ezekiel Fryers","Q96755704":"Hannibal Mejbri","Q642785":"Ravel Morrison","Q83756":"Wes Brown","Q853594":"Corry Evans","Q93563":"Luke Shaw","Q47548":"Víctor Valdés",
  "Q4125587":"Victor Lindelöf","Q920425":"Oliver Norwood","Q57415806":"Altay Bayındır","Q436237":"Joshua King","Q442911":"Ricardo López","Q50600":"Carlos Tévez","Q50603":"Park Ji-sung","Q63659":"Gabriel Heinze",
  "Q18428483":"Sofyan Amrabat","Q98100512":"Senne Lammens","Q484772":"Anderson","Q69965":"Phil Bardsley","Q437322":"Danny Higginbotham","Q38000669":"Mason Mount","Q61986758":"Mason Greenwood","Q965448":"Frederico Rodrigues Santos",
  "Q482947":"Nani","Q458316":"Craig Cathcart","Q46896":"Zlatan Ibrahimović","Q350547":"Filipe Luís Kasmirski","Q108776426":"Filip Jörgensen","Q10788":"Nathaniel Chalobah","Q354629":"Mario Dino Crisis Melchiot","Q126903":"Lucas Piazón",
  "Q29339":"Maniche","Q106366721":"Lesley Ugochukwu","Q266873":"Yūki Ōgimi","Q114859":"Loïc Rémy","Q27049064":"João Félix","Q41244":"Andriy Shevtchenko","Q41533":"Frank Lampard","Q274523":"Oriol Romeu",
  "Q10905":"Eniola Aluko","Q10911":"Ellen White","Q1255625":"Samuel Eto'o","Q27310755":"Kai Havertz","Q36696865":"Trevoh Chalobah","Q42396622":"Le pro coussou","Q30036972":"Pedro Neto","Q106915801":"Carney Chukwuemeka",
  "Q3810078":"Jorge Luiz Frello","Q44977":"Pierre-Emerick Aubameyang","Q110487162":"Lewis Hall","Q363769":"Chris Sutton","Q113515002":"Mike Penders","Q27736107":"Édouard Mendy","Q133556":"Ashley Cole","Q13409790":"Isaiah Brown",
  "Q312687":"Mineiro","Q375295":"Alexeï Smertine","Q3192187":"Kalidou Koulibaly","Q3195361":"Kepa Arrizabalaga","Q42847487":"Billy Gilmour","Q294806":"César Azpilicueta","Q296341":"Demba Ba","Q296391":"Ryan Bertrand",
  "Q296457":"Jesper Grønkjær","Q299515":"Miroslav Stoch","Q299703":"Gaël Kakuta","Q275710":"Steve Sidwell","Q3362956":"Papy Djilobodji","Q107766903":"Levi Colwill","Q276349":"Tal Ben Haim","Q111627959":"Jamie Gittens",
  "Q459707":"Diego Costa","Q299768":"Eduardo","Q310404":"Josh McEachran","Q310402":"Scott Sinclair","Q312120":"Asier Del Horno","Q3529022":"Timo Werner","Q312354":"Celestine Babayaro","Q312334":"Jared Borgetti",
  "Q105575806":"Datro Fofana","Q312980":"Sam Hutchinson","Q315330":"Franco Di Santo","Q315301":"Michael Mancienne","Q317389":"Baba Rahman","Q44737408":"Conor Gallagher","Q44737396":"Marc Guéhi","Q26250324":"Ethan Ampadu",
  "Q431368":"Asmir Begović","Q109397":"Claudio Pizarro","Q326181":"Patrick Bamford","Q438025":"Jack Cork","Q326240":"Ross Barkley","Q327456":"Hakim Ziyech","Q441986":"Willy Caballero","Q442838":"Marcos Alonso Mendoza",
  "Q118472572":"Marc Guiu","Q454196":"Jiří Jarošík","Q11948":"Michael Ballack","Q342214":"Magnus Hedman","Q108649714":"Roméo Lavia","Q342364":"Ben Sahar","Q342530":"Mikael Forssell","Q346676":"Jürgen Macho",
  "Q39076401":"Reece James","Q460559":"Jackie Groenen","Q350396":"Slobodan Rajković","Q187396":"Eidur Smári Gudjohnsen","Q96755":"Antonio Rüdiger","Q188241":"Ricardo Quaresma","Q16063229":"Andreas Christensen","Q61598452":"Morgan Rogers",
  "Q83632882":"Kiernan Dewsbury-Hall","Q21066260":"Denis Zakaria","Q191848":"Khalid Boulahrouz","Q16200385":"Marcus Bettinelli","Q570109":"Mbark Boussoufa","Q192747":"Shaun Wright-Phillips","Q181921":"Branislav Ivanović","Q192971":"Damien Duff",
  "Q16236909":"Matt Miazga","Q18616995":"Ruben Loftus-Cheek","Q193706":"David Luiz","Q58494476":"Mykhaylo Mudryk","Q1755683":"Nathan Aké","Q195682":"Jeffrey Bruma","Q150921":"Marko Marin","Q210944":"Tiago",
  "Q483137":"Petr Čech","Q5651446":"Jamal Blackman","Q83456":"John Terry","Q245022":"Ross Turnbull","Q23887767":"Axel Disasi","Q17499":"Cesc Fàbregas","Q701297":"Mateo Kovačić","Q73360":"Thibaut Courtois",
  "Q969520":"Michael Essien","Q200770":"Robert Green","Q2301910":"Michy Batshuayi","Q570811":"Ricardo Carvalho","Q202645":"Adrian Mutu","Q14625183":"Mario Pašalić","Q16665941":"N'Golo Kanté","Q24060309":"Keira Walsh",
  "Q24068577":"Fikayo Tomori","Q204059":"Mateja Kežman","Q204230":"Geremi Njitap","Q73480":"Willian","Q204407":"Ramires","Q210453":"Thiago Silva","Q155461":"Robert Huth","Q206677":"Wayne Bridge",
  "Q14755604":"Kenedy","Q207806":"Carlo Cudicini","Q21620666":"Tosin Adarabioyo","Q21621029":"Ben Chilwell","Q87347516":"Armando Broja","Q65029821":"Wesley Fofana","Q78752401":"Malo Gusto","Q213989":"Scott Parker",
  "Q21693199":"Christopher Nkunku","Q483846":"Gonzalo Higuaín","Q210056":"Emerson Thome","Q56043276":"Robert Sánchez","Q828627":"Bertrand Traoré","Q211271":"Kurt Zouma","Q158618":"Carlton Cole","Q159057":"Mark Schwarzer",
  "Q211996":"José Bosingwa","Q493184":"Ji So-Yun","Q96105248":"Enzo Jeremías Fernández","Q160206":"Hernán Crespo","Q99584177":"Liam Delap","Q15063275":"Tiémoué Bakayoko","Q214204":"Eden Hazard","Q1911":"Olivier Giroud",
  "Q214751":"Henrique Hilário","Q1913":"Florent Malouda","Q659634":"Deco","Q22082505":"Marc Cucurella","Q58377":"André Schürrle","Q99760796":"Cole Palmer","Q215944":"Tore André Flo","Q216142":"Alex Rodrigo Dias da Costa",
  "Q1937":"William Gallas","Q485196":"Lassana Diarra","Q19497":"Oscar dos Santos Emboaba Júnior","Q166984":"John Obi Mikel","Q69495231":"Ian Maatsen","Q110616805":"Diego Moreira","Q22279773":"Christian Pulisic","Q168287":"Christian Panucci",
  "Q509374":"Juan Guillermo Cuadrado","Q184614":"Paulo Ferreira","Q223176":"Jimmy Floyd Hasselbaink","Q912172":"Saúl Ñíguez","Q525816":"Serey Die","Q87715532":"Moisés Caicedo","Q223827":"Gary Cahill","Q22669663":"Charly Musonda jr.",
  "Q648671":"Marco van Ginkel","Q919182":"Christian Atsu","Q5241591":"Davide Zappacosta","Q61655":"Gökhan Töre","Q66801705":"Noni Madueke","Q48770":"Álvaro Morata","Q15608535":"Lewis Baker","Q48892":"Didier Drogba",
  "Q862539":"Tomáš Kalas","Q64005114":"João Pedro Junqueira de Jesus","Q80197171":"Tariq Lamptey","Q234866":"Marco Amelia","Q138075":"Alexandre Pato","Q180462":"Salomon Kalou","Q5370912":"Emerson Palmieri dos Santos","Q182041":"Kenneth Omeruo",
  "Q237561":"Juliano Belletti","Q57704058":"Benoît Badiashile","Q240008":"Phil Younghusband","Q184261":"Iouri Jirkov","Q184362":"Claude Makelélé","Q179773":"Pedro","Q313786":"Francisco Mérida Pérez","Q313936":"Håvard Nordtveit",
  "Q314755":"Lauren Étamé Mayer","Q314779":"Nacer Barazite","Q316512":"Luís Boa Morte","Q187450":"Philippe Senderos","Q188542":"Aliaksandr Hleb","Q188997":"Wojciech Szczęsny","Q319164":"Justin Hoyte","Q319180":"Jérémie Aliadière",
  "Q13306":"Alexandre Lacazette","Q21061767":"Rob Holding","Q21091691":"Alex Iwobi","Q192856":"Emmanuel Eboué","Q10711":"Manuel Almunia","Q192923":"Sokrátis Papastathópoulos","Q18614641":"Ainsley Maitland-Niles","Q16302330":"Lucas Torreira",
  "Q29162":"Tomáš Rosický","Q2245840":"Yaya Sanogo","Q113156":"Robert Pires","Q337448":"Henri Lansbury","Q29497":"Carl Jenkinson","Q21286402":"Takehiro Tomiyasu","Q29516":"Theo Walcott","Q24663885":"Matt Turner",
  "Q342219":"Nacho Monreal","Q310458":"André Santos","Q314102":"Stuart Taylor","Q201837":"Matthew Upson","Q14602686":"Gabriel Armando de Abreu","Q11860513":"Glen Kamara","Q2332951":"Nelson Vivas","Q204848":"Mathieu Flamini",
  "Q204895":"Júlio Baptista","Q127914":"Sead Kolašinac","Q208025":"Gervinho","Q208586":"Stephan Lichtsteiner","Q14824665":"Gedion Zelalem","Q14946556":"Kristoffer Olsson","Q16902219":"Martin Ødegaard","Q16972254":"Dani Ceballos",
  "Q210928":"Park Chu-young","Q14946538":"Isaac Hayden","Q14947422":"Héctor Bellerín","Q275977":"Vito Mannone","Q276208":"Benik Afobe","Q276399":"José Antonio Reyes","Q215322":"Denílson","Q213427":"Aaron Ramsey",
  "Q214124":"Kim Källström","Q19636859":"Oleksandr Zintchenko","Q1908":"Mathieu Debuchy","Q19665907":"David Raya","Q1915":"Laurent Koscielny","Q1920":"Samir Nasri","Q1929":"Gaël Clichy","Q215770":"Johan Djourou",
  "Q1938":"Bacary Sagna","Q1942":"Sébastien Squillaci","Q1943":"Abou Diaby","Q27663808":"Mattéo Guendouzi","Q217760":"Sylvain Wiltord","Q167240":"Nicklas Bendtner","Q19888012":"Kieran Tierney","Q10502548":"Luke Ayling",
  "Q219248":"Marc Overmars","Q101035007":"Folarin Balogun","Q17482506":"Rúnar Alex Rúnarsson","Q15199":"Jack Wilshere","Q27839155":"Ben White","Q223138":"Armand Traoré","Q17612631":"Mikel Merino","Q13467456":"Chuba Akpom",
  "Q2586675":"Lucas Pérez","Q27967807":"Aaron Ramsdale","Q293007":"Ólafur Ingi Skúlason","Q173360":"Giovanni van Bronckhorst","Q134976":"Lukas Podolski","Q190142":"Gilberto Silva","Q1587689":"Mathew Ryan","Q3275904":"Emiliano Martínez",
  "Q314750":"Edu","Q2092171":"Denis Suárez","Q3318533":"Mohamed El Nenny","Q25175970":"Gabriel","Q180193":"Francis Coquelin","Q10560":"Freddie Ljungberg","Q180444":"Eduardo Alves da Silva","Q30007142":"Declan Rice",
  "Q20641306":"Nicolas Pépé","Q18126412":"Krystian Bielik","Q11557367":"Takuma Asano","Q20738815":"Jeff Reine-Adélaïde","Q20740627":"Ismaël Bennacer","Q184177":"Thomas Vermaelen","Q309966":"Bernd Leno","Q310043":"Emmanuel Frimpong",
  "Q310055":"David Bentley","Q310605":"Ryo Miyaichi","Q311191":"Jun'ichi Inamoto","Q312002":"Sylvinho","Q241103":"Emiliano Viviano","Q185225":"Santiago Cazorla","Q185572":"Mikel Arteta","Q313140":"Quincy Owusu-Abeyie",
  "Q15963873":"Thomas Partey","Q313677":"Fabrice Muamba","Q354919":"Guy Demel","Q356392":"John Hartson","Q356797":"Joel Campbell","Q46347":"Patrick Vieira","Q40596":"Łukasz Fabiański","Q40604":"Kieran Gibbs",
  "Q55820249":"Emile Smith-Rowe","Q83488":"Mesut Özil","Q83638":"Sebastian Larsson","Q481330":"Cedric Soares","Q42010":"Marouane Chamakh","Q369915":"Rami Shaaban","Q42416276":"Lauren James","Q110458872":"Cristhian Mosquera",
  "Q59490":"Serge Gnabry","Q59600":"Nico Yennaris","Q46694474":"Albert Sambi Lokonga","Q45901":"Thierry Henry","Q101053044":"Piero Hincapié","Q46522":"Calum Chambers","Q434354":"Alex Scott","Q63384759":"Martín Zubimendi",
  "Q514427":"Granit Xhaka","Q56868118":"William Saliba","Q47015833":"Konstantínos Mavropános","Q47230":"Andreï Archavine","Q7121685":"Pablo Marí","Q47075606":"Viktor Gyökeres","Q377746":"Ray Parlour","Q53952196":"Jurrien Timber",
  "Q529162":"Oğuzhan Özyakup","Q529425":"Anthony Stokes","Q60676459":"Nuno Tavares","Q47950":"Carlos Vela","Q381401":"Tomas Danilevičius","Q538897":"Ignasi Miquel","Q386876":"Emmanuel Adebayor","Q40471152":"Joe Willock",
  "Q552171":"Kyle Bartley","Q28445512":"Eberechi Eze","Q62657":"Norberto Murara Neto","Q61460651":"Gabriel Martinelli","Q35039261":"Reiss Nelson","Q9675":"Kelly Smith","Q97999586":"Riccardo Calafiori","Q461488":"Kim Little",
  "Q63032399":"Fábio Vieira","Q41259115":"Eddie Nketiah","Q436987":"David Ospina","Q6509762":"Leandro Trossard","Q61744153":"Jakub Kiwior","Q70550":"Per Mertesacker","Q694014":"Shkodran Mustafi","Q375510":"Richard Wright",
  "Q599675":"Nwankwo Kanu","Q317317":"Danny Mills","Q244790":"Pablo Zabaleta","Q3637942":"Ben Mee","Q20994432":"Yangel Herrera","Q3645977":"Bruno Zuculini","Q321649":"Djamel Abdoun","Q191855":"Gareth Barry",
  "Q1083432":"Kieran Trippier","Q28967995":"Erling Braut Haaland","Q437329":"Danilo Luiz da Silva","Q326502":"Benjani","Q328911":"Dedryck Boyata","Q2811689":"Rony Lopes","Q194769":"Omar Elabdellaoui","Q356038":"Chris Killen",
  "Q150947":"Martin Demichelis","Q335693":"Gaï Assulin","Q151260":"Jérôme Boateng","Q314099":"Jô","Q455787":"Matija Nastasić","Q456617":"Nolito","Q152492":"Roque Santa Cruz","Q346735":"Émile Mpenza",
  "Q459356":"Fernando Luiz Rosa","Q26707066":"Uriel Antuna","Q460696":"Márton Fülöp","Q113916":"Stephen Ireland","Q153786":"Edin Džeko","Q351473":"Felipe Caicedo","Q2896171":"Benjamin Mendy","Q201381":"Vincent Kompany",
  "Q202329":"Joey Barton","Q202404":"Yeóryos Samarás","Q265654":"Hatem Trabelsi","Q14637461":"Enes Ünal","Q357664":"Keiren Westwood","Q471641":"Bernardo Corradi","Q26973015":"Brahim Abdelkader Díaz","Q363257":"Claudio Reyna",
  "Q205773":"Andreas Isaksson","Q206306":"Vedran Ćorluka","Q21013664":"Manuel García","Q206644":"Martin Petrov","Q21621168":"Rúben Dias","Q106625792":"Nico González","Q209944":"Micah Richards","Q370339":"Wilfried Bony",
  "Q210916":"Álvaro Negredo Sánchez","Q211126":"Paulo Wanchope","Q211451":"Aleksandar Kolarov","Q213095":"Gelson Fernandes","Q372276":"John Guidetti","Q1523509":"Karim Rekik","Q44309":"Daniel Van Buyten","Q207407":"Elano",
  "Q215812":"Shay Given","Q215841":"Joleon Lescott","Q3855340":"Aymeric Laporte","Q39500352":"Tijjani Reijnders","Q19968626":"Aleix García","Q20038711":"Ko Itakura","Q2025900":"John Stones","Q375487":"Sun Jihai",
  "Q223843":"Marc-Vivien Foé","Q119562":"Sergio Agüero","Q20994118":"Rodri","Q294541":"Stevan Jovetić","Q295797":"Kasper Schmeichel","Q28065104":"Omar Marmoush","Q22694710":"Pablo Maffeo","Q381672":"Ousmane Dabo",
  "Q296833":"Jack Rodwell","Q28363823":"Douglas Luiz","Q44080929":"Pedro Porro","Q111479885":"Abdukodir Khusanov","Q219884":"Stefan Savić","Q304901":"Teerasil Dangda","Q20641319":"Kalvin Phillips","Q217507":"Vladimír Weiss",
  "Q20688718":"Angeliño","Q44297797":"Ferran Torres","Q142283":"Michael Tarnat","Q107985608":"James Trafford","Q310330":"Javi García","Q310408":"Nedum Onuoha","Q310660":"Dickson Etuhu","Q310737":"Valeri Bojinov",
  "Q29456":"Michael Johnson","Q241502":"Richard Dunne","Q313035":"DaMarcus Beasley","Q313161":"Claudio Bravo","Q313582":"Javier Garrido Behobide","Q314865":"Darius Vassell","Q439309":"Costel Pantalon","Q316698":"Glenn Whelan",
  "Q316695":"Sylvain Distin","Q20925459":"Olivier Ntcham","Q301689":"Gunnar Nielsen","Q161069":"David Silva","Q59209505":"Jérémy Doku","Q59938996":"Eric García","Q821646":"Stefan Ortega","Q59108":"Kyle Walker",
  "Q70567":"David Pizarro","Q55956044":"Arijanet Muric","Q17074511":"Ederson Moraes","Q30346413":"Sergio Gómez","Q99485542":"Sávio Moreira de Oliveira","Q161089":"Ilkay Gündogan","Q96211488":"Matheus Nunes","Q52990659":"Antoine Semenyo",
  "Q58441":"Robinho","Q166285":"Fabian Delph","Q187184":"Joe Hart","Q59786":"Róbert Mak","Q19938984":"Manuel Akanji","Q73400656":"Joško Gvardiol","Q17517046":"Jason Denayer","Q104762954":"Elliot Anderson",
  "Q56809124":"Adrián Bernabé","Q177686":"Maicon Douglas","Q6298063":"João Cancelo","Q18086014":"Bersant Celina","Q67175861":"Issa Kaboré","Q15521306":"Bernardo Silva","Q182063":"Nicolás Otamendi","Q59381180":"Julián Álvarez",
  "Q184277":"Yaya Touré","Q185093":"Jesús Navas","Q185650":"Nigel de Jong","Q20830808":"Gianluigi Donnarumma","Q15980269":"Patrick Roberts","Q16056053":"Jack Grealish","Q64736321":"Rayan Cherki","Q18633850":"Zack Steffen",
  "Q18635274":"Seko Fofana","Q579231":"Eliaquim Mangala","Q15635801":"Albert Rusnák","Q8338725":"Riyad Mahrez","Q16499882":"Leroy Sané","Q973416":"Fernando Francisco Reges","Q115399505":"Yankuba Minteh","Q254410":"Andy O'Brien",
  "Q29454":"Sylvain Marveaux","Q125538":"Titus Bramble","Q342904":"Peter Løvenkrands","Q350466":"Xisco","Q459959":"Mike Williamson","Q460512":"Amdy Faye","Q348813":"Fraser Forster","Q35851317":"Lloyd Kelly",
  "Q349332":"Siem de Jong","Q113872":"Charles N'Zogbia","Q350976":"Ciaran Clark","Q126466":"Jack Colback","Q353520":"Lee Bowyer","Q342308":"Stephen Carr","Q357613":"José Salomón Rondón","Q1450945":"Valentino Lazaro",
  "Q465623":"Duncan Ferguson","Q177472":"Craig Moore","Q370688":"Wayne Routledge","Q315653":"Ignacio González","Q31775":"Yoan Gouffran","Q1257196":"Facundo Ferreyra","Q15044053":"Allan Saint-Maximin","Q32091":"Henri Saivet",
  "Q454220":"Laurent Robert","Q1910":"Yohan Cabaye","Q44527":"Ryan Fraser","Q1928":"Hatem Ben Arfa","Q282463":"Jean-Alain Boumsong","Q3852031":"Matt Ritchie","Q1059176":"Mehdi Abeid","Q27974879":"Harvey Barnes",
  "Q15427728":"Ayoze Pérez","Q26343":"Gaël Bigirimana","Q43402334":"Sandro Tonali","Q3196721":"Chancel Mbemba","Q134729":"José Luis Mato","Q378005":"Nolberto Solano","Q15401668":"Yoshinori Muto","Q296033":"Davide Santon",
  "Q296194":"Jetro Willems","Q296621":"Jermaine Jenas","Q296635":"Jonathan Woodgate","Q296979":"Tim Krul","Q298484":"David Rozehnal","Q299244":"Seydou Doumbia","Q390793":"Jeff Hendrick","Q299455":"Kieron Dyer",
  "Q27476":"Florian Thauvin","Q313911":"Luuk de Jong","Q302130":"Aaron Hughes","Q311951":"Steven Taylor","Q18128628":"Matt Targett","Q107930811":"Tino Livramento","Q28542599":"Sean Longstaff Jugador","Q308394":"Abdoulaye Diagne-Faye",
  "Q1679812":"Jamaal Lascelles","Q309628":"Papiss Cissé","Q334628":"Gary Caldwell","Q310668":"Cheik Tioté","Q311372":"Albert Luque","Q312117":"Steve Harper","Q313085":"Shola Ameobi","Q313961":"Patrick van Aanholt",
  "Q15999945":"Nick Pope","Q314643":"Habib Beye","Q1347269":"Islam Slimani","Q16023869":"Adam Armstrong","Q316923":"Vurnon Anita","Q316995":"Lomana LuaLua","Q317756":"Dan Gosling","Q318103":"Shaka Hislop",
  "Q318539":"Sébastien Bassong","Q318722":"Zurab Khizanishvili","Q189686":"Patrick Kluivert","Q16145667":"Miguel Almirón","Q326236":"Sammy Ameobi","Q438796":"Mapou Yanga-Mbiwa","Q148699":"Kevin Nolan","Q16239819":"Ivan Toney",
  "Q45179405":"Anthony Gordon","Q202569":"Emre Belözoğlu","Q203657":"Jon Dahl Tomasson","Q716134":"Rémy Cabella","Q87268125":"Malick Thiaw","Q207464":"Oguchi Onyewu","Q207548":"Obafemi Martins","Q208087":"Jonás Gutiérrez",
  "Q6792066":"Matz Sels","Q2447742":"Daryl Murphy","Q84086":"Aleksandar Mitrović","Q5022998":"Callum Wilson","Q215831":"Fabricio Coloccini","Q59064":"Andros Townsend","Q91531":"Odisseas Vlachodimos","Q74548":"Chris Wood",
  "Q63228677":"Jacob Ramsey","Q83498":"Danny Rose","Q20047360":"Joelinton","Q60545":"Moussa Sissoko","Q226125":"Marlon Harewood","Q7150395":"Paul Dummett","Q93666":"James Tavernier","Q5213217":"Dan Burn",
  "Q380128":"Mohamed Diamé","Q917958":"Haris Vučkić","Q28101965":"Yoane Wissa","Q2081532":"Níkos Dabízas","Q5371332":"Emil Krafth","Q239513":"Mark Viduka","Q557329":"James Troisi","Q6396879":"Kevin Mbabu",
  "Q313083":"Ki Sung-yueng","Q946679":"Pavel Srniček","Q673691":"Fabian Schär","Q247312":"John Ruddy","Q58323172":"Bruno Guimarães","Q1362064":"Grant Hanley","Q196069":"Daryl Janmaat","Q969467":"Shane Ferguson",
  "Q84158344":"Nick Woltemade","Q158980":"James Collins","Q321330":"Mile Jedinak","Q16148978":"Marco Asensio","Q249344":"Leandro Bacuna","Q192491":"Olof Mellberg","Q16212492":"Jan Bednarek","Q148312":"Zat Knight",
  "Q16235643":"Tyrone Mings","Q16236859":"Clément Lenglet","Q328479":"Jamie Ward","Q331926":"Liam Ridgewell","Q355807":"Steven Davis","Q37717":"Shaun Maloney","Q113246":"Karim El Ahmadi","Q125410":"Carlos Cuéllar",
  "Q342303":"Grant Holt","Q348439":"Jores Okore","Q349962":"Nicky Shorey","Q126279":"Craig Gardner","Q353013":"Ulises de la Cruz","Q356457":"Gavin McCann","Q24050378":"Tammy Abraham","Q24084301":"Donyell Malen",
  "Q178195":"Luke Moore","Q367861":"Jordan Ayew","Q1848545":"Nicklas Helenius","Q296410":"Luke Young","Q27063854":"Ezri Konsa","Q1859451":"Aleksandar Tonev","Q16911979":"Ollie Watkins","Q276379":"Nigel Reo-Coker",
  "Q212617":"Ron Vlaar","Q213119":"Jean II Makoun","Q116602":"Carlos Alberto Sánchez Moreno","Q213459":"Darren Bent","Q208425":"Michael Bradley","Q15221199":"Adama Traoré","Q166263":"Stilian Petrov","Q2067092":"Rob Edwards",
  "Q219026":"Zoltán Stieber","Q219167":"Bradley Guzan","Q219158":"Eric Lichaj","Q10512869":"Lovre Kalinić","Q17465944":"Anwar El-Ghazi","Q10547335":"John McGinn","Q294749":"Wilfred Bouma","Q378297":"Boško Balaban",
  "Q135314":"Gabriel Agbonlahor","Q3303586":"Mbwana Samata","Q175989":"Libor Kozák","Q135610":"Brett Holman","Q547455":"Gábor Király","Q2673319":"Albert Adomah","Q23041943":"Matty Cash","Q219030":"Joe Bennett",
  "Q18156147":"Pierluigi Gollini","Q1191188":"Neil Taylor","Q20716703":"Wesley Moraes Ferreira Da Silva","Q310037":"Alan Hutton","Q310620":"Juan Pablo Ángel","Q240456":"Savo Milošević","Q311163":"Moustapha Salifou","Q311344":"Mustapha Hadji",
  "Q311370":"Nathan Delfouneso","Q311377":"Marc Albrighton","Q312039":"Curtis Davies","Q192986":"John Carew","Q313207":"Martin Laursen","Q313610":"Marcus Allbäck","Q211120":"Thomas Sørensen","Q20890178":"Leon Bailey",
  "Q722348":"Jordan Veretout","Q4806248":"Ludwig Augustinsson","Q731869":"Matthew Lowton","Q59428":"Ashley Westwood","Q6734350":"Trézéguet","Q46679":"Idrissa Gueye","Q99328435":"Amadou Onana","Q6911830":"Morgan Sanson",
  "Q501201":"Andreas Weimann","Q5041170":"Carles Gil","Q631125":"Peter Whittingham","Q513874":"José Ángel Crespo","Q4022527":"Yannick Bolasie","Q970896":"Nathan Baker","Q865680":"Birkir Bjarnason","Q15830968":"Diego Carlos Santos Silva",
  "Q869214":"Ørjan Nyland","Q435749":"Alpay Özalan","Q64748320":"Jhon Durán","Q439302":"Boaz Myhill","Q442866":"Barry Bannan","Q51855361":"Moussa Diaby","Q43384100":"Pau Torres","Q72648":"Lucas Digne",
  "Q456647":"Ahmed al-Muhammadi","Q29841260":"Juan Foyth","Q31664":"Reto Ziegler","Q276213":"Tom Huddlestone","Q276358":"Pascal Chimbonda","Q27671184":"Tanguy Ndombele","Q294387":"Mido","Q28058687":"Cristian Romero",
  "Q296992":"Sergueï Rebrov","Q30123152":"Emerson","Q299503":"Wilson Palacios","Q2715111":"Emil Hallfredsson","Q310733":"Simon Davies","Q311246":"Lewis Holtby","Q311334":"Younès Kaboul","Q311659":"Steffen Iversen",
  "Q312091":"Paul Stalteri","Q312512":"Lee Young-pyo","Q312886":"Lucas Moura","Q313170":"Jan Vertonghen","Q313938":"Tomáš Pekhart","Q311335":"Gilberto","Q315043":"César Sánchez","Q315459":"Erik Edman",
  "Q318520":"Pedro Mendes","Q316501":"Teemu Tainio","Q28968069":"Manor Solomon","Q331908":"Stephen Kelly","Q334619":"Matthew Etherington","Q337617":"Erik Lamela","Q342282":"Jake Livermore","Q342350":"Federico Fazio",
  "Q342406":"Milenko Ačimovič","Q342703":"Radek Černý","Q444453":"Grzegorz Rasiak","Q115371638":"Lucas Bergvall","Q73082":"Paulinho","Q215824":"Paul Robinson","Q348754":"Kyle Naughton","Q350107":"Sol Bamba",
  "Q350616":"Adel Taarabt","Q201860":"Clint Dempsey","Q1439915":"Eric Dier","Q1849128":"Vlad Chiricheș","Q161054":"Ivan Perišić","Q1907":"Hugo Lloris","Q163974":"Rafael van der Vaart","Q168029":"Roman Pavlioutchenko",
  "Q17517177":"James Maddison","Q175303":"Aaron Lennon","Q177885":"Heurelho Gomes","Q15884045":"William Troost-Ekong","Q184586":"Gareth Bale","Q185115":"Edgar Davids","Q187891":"Fernando Llorente","Q188746":"Jermain Defoe",
  "Q16237064":"Miloš Veljković","Q193488":"Steven Pienaar","Q18638184":"Harry Winks","Q151034":"Kevin-Prince Boateng","Q18817134":"Rodrigo Bentancur","Q152286":"Bobby Zamora","Q470751":"Chris Gunter","Q359392":"Timothée Atouba",
  "Q11059683":"Pierre Højbjerg","Q363608":"Darren Anderton","Q207397":"Didier Zokora","Q128840":"Toby Alderweireld","Q208518":"Michel Vorm","Q208557":"Ryan Nelsen","Q208706":"Stipe Pletikosa","Q483837":"Luka Modrić",
  "Q55956041":"Oliver Skipp","Q14856634":"Vincent Janssen","Q84272":"Niko Kranjčar","Q59655998":"Randal Kolo Muani","Q56222532":"Djed Spence","Q65925174":"Xavi Simons","Q15084554":"Georges-Kévin Nkoudou","Q22001795":"Arnaut Groeneveld",
  "Q214117":"Hélder Postiga","Q214891":"Bongani Khumalo","Q59914139":"Dejan Kulusevski","Q373211":"Kazuyuki Toda","Q66108160":"Brennan Johnson","Q59105":"Gylfi Sigurðsson","Q59194":"Mousa Dembélé","Q59255":"Sandro Ranieri Guimarães Cordeiro",
  "Q599963":"Tom Carroll","Q59192":"Michael Dawson","Q508075":"Bruno Uvini","Q218394":"Frédéric Kanouté","Q218401":"Roberto Soldado","Q969725":"Harry Kane","Q93555":"Ben Davies","Q5084755":"Charlie Daniels",
  "Q77863":"Benoît Assou-Ekotto","Q69812902":"Micky van de Ven","Q60595":"Étienne Capoue","Q60605":"Serge Aurier","Q56877051":"Mohammed Kudus","Q10552708":"Kevin Wimmer","Q5134192":"Clinton Njie","Q375518":"Hossam Ghaly",
  "Q10553748":"Dele Alli","Q73825355":"Destiny Udogie","Q4118260":"Yuri Berchiche","Q22683033":"Yves Bissouma","Q60687576":"Bryan Gil","Q13054":"Steed Malbranque","Q44083681":"Guglielmo Vicario","Q47658470":"Joe Rodon",
  "Q62869":"Mounir El Hamdaoui","Q6381120":"DeAndre Yedlin","Q20743436":"Giovani Lo Celso","Q20806743":"Richarlison","Q114826394":"Archie Gray","Q795451":"Nacer Chadli","Q4459692":"Ryan Mason","Q245922":"Benjamin Stambouli",
  "Q115162374":"Luka Vušković","Q439282":"Iago Falque","Q439722":"Son Heung-min","Q16236952":"João Palhinha","Q18921915":"Mason Holgate","Q13014035":"Jordan Pickford","Q467034":"Marcus Bent","Q202237":"Landon Donovan",
  "Q202410":"Yakubu Aiyegbeni","Q264756":"Eddy Bosnar","Q16648816":"Yerry Mina","Q21484766":"Ademola Lookman Triplé","Q201394":"Ján Mucha","Q129101":"Davy Klaassen","Q137242":"Bernard","Q208700":"Aiden McGeady",
  "Q208933":"Phil Jagielka","Q276178":"Leon Osman","Q45134":"Lacina Traoré","Q215358":"Lucas Neill","Q215431":"Antolín Alcaraz","Q297845":"Manuel Fernandes","Q19956709":"Dominic Calvert-Lewin","Q287815":"Royston Drenthe",
  "Q17501875":"Nikola Vlašić","Q221233":"Nikica Jelavić","Q27889974":"Moise Kean","Q2470512":"Allan","Q213134":"Lars Jacobsen","Q2627900":"Shane Duffy","Q18015191":"Jonjoe Kenny","Q182685":"Maarten Stekelenburg",
  "Q1670298":"Jonas Lössl","Q310700":"James McFadden","Q15895665":"Tyias Browning","Q311324":"Thomas Gravesen","Q311983":"Andy van der Meyde","Q311968":"Nuno Valente","Q311990":"Victor Anichebe","Q185081":"Marco Materazzi",
  "Q20829745":"Ben Godfrey","Q313148":"Tobias Linderoth","Q313690":"James Vaughan","Q314366":"Brian McBride","Q314789":"Arouna Koné","Q314879":"Olivier Dacourt","Q316724":"Séamus Coleman","Q316917":"Kevin Mirallas",
  "Q316926":"Segundo Castillo Nazareno","Q187989":"Leighton Baines","Q276306":"Andy Johnson","Q316619":"David Carney","Q147896":"Joseph Yobo","Q325997":"Bryan Oviedo","Q192825":"Diniar Bilialetdinov","Q16239542":"Demarai Gray",
  "Q444814":"Tomasz Radzinski","Q187238":"Tim Cahill","Q2843080":"Enner Valencia","Q2268949":"Eduardo Vargas","Q461284":"Li Weifeng","Q356126":"Gerard Deulofeu","Q356404":"Lee Carsley","Q368441":"James Rodríguez",
  "Q350807":"James Beattie","Q369771":"Muhamed Bešić","Q53652291":"Dwight McNeil","Q529013":"James McCarthy","Q66737676":"Djibril Sidibé","Q519008":"André Gomes","Q547296":"Joel Robles","Q528983":"Ashley Williams",
  "Q401554":"Ramiro Funes Mori","Q70780349":"Jarrad Branthwaite","Q946457":"John Heitinga","Q3637067":"Baye Oumar Niasse","Q440437":"Steven Naismith","Q70564":"Marcus Hahnemann","Q442472":"Jermaine Beckford","Q37875995":"Vitaliy Mykolenko",
  "Q337639":"Felipe Mattioni","Q347603":"Matteo Ferrari","Q35778151":"Antonee Robinson","Q346694":"Per Krøldrup","Q350802":"Kevin Kilbane","Q353623":"Thomas Myhre","Q320517":"Nicolas Douchez","Q1354322":"Grzegorz Krychowiak",
  "Q16174734":"Lee Kang-in","Q191885":"Thiago Motta","Q31871265":"Timothy Weah","Q440846":"Mevlüt Erdinç","Q442457":"Christophe Jallet","Q443684":"Modeste Mbami","Q445796":"Tobin Heath","Q18637930":"Fabián Ruiz",
  "Q1378371":"Alessandro Florenzi","Q149933":"Mickaël Landreau","Q450725":"Camille Abily","Q150207":"Stéphane Sessègnon","Q18685713":"Abdou Diallo","Q112170256":"Désiré Doué","Q2839693":"Alphonse Areola","Q337623":"Marco Verratti",
  "Q455611":"Rafael Alcántara","Q218165":"Pauleta","Q342608":"Peguy Luyindula","Q343965":"Bonaventure Kalou","Q13488":"Grégory Coupet","Q26707913":"Carlos Soler","Q39230":"Marquinhos","Q18924954":"Lucas Hernandez",
  "Q1809423":"Layvin Kurzawa","Q201367":"Gregory van der Wiel","Q126640":"Marcelo Lipatín","Q39444":"Ronaldinho","Q242010":"Cristiane","Q26932598":"Achraf Hakimi","Q266507":"Marcelo Gallardo","Q266827":"Mathieu Bodmer",
  "Q16729477":"Gonçalo Guedes","Q112604843":"Lucas Beraldo","Q362848":"Steve Gohouri","Q314376":"Cristian Rodríguez","Q155604":"Vedad Ibišević","Q207399":"Marko Pantelić","Q36371294":"Matvey Safonov","Q275415":"Ezequiel Lavezzi",
  "Q276434":"Javier Pastore","Q18962":"Adrien Rabiot","Q483309":"Sergio Ramos","Q373547":"Diego Lugano","Q1921":"Blaise Matuidi","Q1923":"Jérémy Ménez","Q215040":"Sherrer Maxwell","Q433125":"Danijel Ljuboja",
  "Q19367":"Juan Bernat","Q1982869":"Marcos André Batista Santos","Q113551733":"João Neves","Q510165":"Pablo Sarabia","Q219771":"Ludovic Giuly","Q118207":"Kevin Trapp","Q142794":"Neymar","Q220746":"Juan Pablo Sorín",
  "Q513911":"Jesé Rodríguez Ruiz","Q21621995":"Kylian Mbappé","Q53798193":"Yacine Adli","Q172720":"Dani Alves","Q2604671":"Aliou Cissé","Q227053":"Zoumana Camara","Q530033":"Milan Biševac","Q2089098":"Christian Corrêa Dionisio",
  "Q298338":"Vikash Dhorasoo","Q136986":"Mauro Icardi","Q180952":"Éverton Santos","Q180968":"Reinaldo da Cruz Oliveira","Q122346":"Hakan Yakın","Q27649":"Jérôme Rothen","Q20666686":"Jonathan Ikoné","Q20745071":"Nordi Mukiele",
  "Q309532":"Eric-Maxim Choupo-Moting","Q309778":"Mario Yepes","Q13882431":"Youssouf Sabaly","Q311155":"Lorik Cana","Q312520":"Sergueï Semak","Q20823439":"Thilo Kehrer","Q313164":"Guillaume Hoarau","Q20851003":"Ousmane Dembélé",
  "Q314028":"Kévin Gameiro","Q18325379":"Presnel Kimpembe","Q315697":"Julian Draxler","Q2036160":"Thomas Meunier","Q316836":"Luis Nenê","Q318530":"Siaka Tiéné","Q981355":"Patrick Mboma","Q99360090":"Illya Zabarnyi",
  "Q891520":"Milan Škriniar","Q99670930":"Bradley Barcola","Q630170":"Leandro Paredes","Q76460067":"Arnau Tenas","Q6125605":"Sergio Rico","Q77538":"Fatmire Bajramaj","Q60583":"Jean-Christophe Bahebeck","Q96396963":"Nuno Mendes",
  "Q70068408":"Arnaud Kalimuendo","Q87767569":"Willian Pacho","Q615":"Lionel Messi","Q766289":"Danilo Pereira","Q66818509":"Vítor Ferreira","Q68060":"Gianluigi Buffon","Q556595":"Youssouf Mulumbu","Q6413296":"Kingsley Coman",
  "Q63878":"Anja Mittag","Q60621615":"Gonçalo Ramos","Q98102459":"Lucas Chevalier","Q685385":"Abdelaziz Barrada","Q61780902":"Khvicha Kvaratskhelia","Q6552885":"Lindsey Heaps","Q969423":"Keylor Navas","Q65159598":"Marcin Bulka",
  "Q350721":"Houssine Kharja","Q445477":"Alaixys Romao","Q194579":"Lucas Ocampos","Q150238":"Steven Fletcher","Q23771922":"Nemanja Radonjić","Q111009946":"Ismaël Koné","Q11966":"Bafétimbi Gomis","Q259801":"Gaël Givet",
  "Q342599":"Ibrahim Ba","Q342506":"Rudolf Skácel","Q342694":"Philippe Christanval","Q346712":"Boštjan Cesar","Q26704596":"Maxime Lopez","Q350738":"Alain Boghossian","Q41932444":"Jonathan Clauss","Q355820":"Benoît Pedretti",
  "Q357860":"Rod Fanni","Q360315":"Souleymane Diawara","Q208422":"Taye Taiwo","Q29901014":"Derek Cornelius","Q1883":"Sabri Lamouchi","Q19613570":"Cengiz Ünder","Q1909":"Adil Rami","Q116997":"Foued Kadir",
  "Q44689":"Saber Khalifa","Q1918":"Franck Ribéry","Q1919":"Mathieu Valbuena","Q1924":"Steve Mandanda","Q342707":"Mamadou Niang","Q1931":"Cédric gros Carrasso","Q438081":"Morgan Amalfitano","Q281734":"Yūto Nagatomo",
  "Q1940":"André-Pierre Gignac","Q27805413":"Michael Murillo","Q17612806":"Duje Ćaleta-Car","Q375800":"Vedran Runje","Q376247":"Dimitri Payet","Q382269":"Kōji Nakata","Q120156":"Abdoulaye Meïté","Q296222":"Mauricio Isla",
  "Q244894":"Lucho González","Q28131394":"Luiz Felipe Ramos Marchi","Q15627817":"Brice Samba","Q299383":"Dmitri Sytchev","Q299727":"Rolando Jorge Pires da Fonseca","Q137231":"Arkadiusz Milik","Q13780454":"Mario Lemina","Q183210":"Brandão",
  "Q310548":"Kevin Strootman","Q329451":"Luiz Gustavo","Q312928":"Stéphane Mbia","Q313142":"Bakari Koné","Q313159":"Karim Ziani","Q313155":"Nicolas Nkoulou","Q3554195":"Valère Germain","Q316573":"Paolo De Ceglie",
  "Q317004":"Iván de la Peña","Q317079":"Benoît Cheyrou","Q317322":"Alfonso Pérez","Q321552":"Raïs M'Bolhi","Q21039587":"André-Frank Zambo Anguissa","Q191080":"Seydou Keita","Q436247":"Jérémy Morel","Q439430":"Charles Kaboré",
  "Q603051":"Tomáš Hubočan","Q6696318":"Lucas Silva Borges","Q62456204":"Konrad de la Fuente","Q5879014":"Gerónimo Rulli","Q19599124":"Benjamin Pavard","Q65948595":"Amar Dedić","Q558887":"Hiroki Sakai","Q50233588":"Leonardo Balerdi",
  "Q60597":"Aymen Abdennour","Q516921":"André Ayew","Q28056787":"Facundo Medina","Q664053":"Fernandão","Q312534":"Kóstas Mítroglou","Q28872567":"Nayef Aguerd","Q55055451":"Renan Lodi","Q602311":"Lucas Mendes",
  "Q708323":"Wilson Oruma","Q326452":"Miguel Lopes","Q440097":"Fabián Monzón","Q311925":"François Clerc","Q315336":"Patrick Müller","Q195130":"Clément Grenier","Q108187024":"Mamadou Sarr","Q1392235":"Anthony Lopes",
  "Q454261":"Amandine Henry","Q335613":"Marc Crosas","Q342312":"Jimmy Briand","Q345343":"César Delgado","Q23884186":"Ferland Mendy","Q460924":"Caroline Seger","Q296133":"Lisandro López","Q349046":"Maciej Rybus",
  "Q4708679":"Alassane Pléa","Q350335":"Nadir Belhadj","Q705806":"Éric Deflandre","Q16724213":"Roman Iaremtchouk","Q716166":"Lamine Gassama","Q26964668":"Jean-Philippe Mateta","Q78541955":"Georges Mikautadze","Q721804":"Marcelo Antônio Guedes Filho",
  "Q2350103":"Daniëlle van de Donk","Q14778629":"Nabil Fekir","Q208687":"Nilmar","Q614334":"Ciprian Tătărușanu","Q2978523":"Claudio Beauvue","Q461505":"Ederson","Q6125267":"Sergi Darder","Q6809376":"Mehdi Zeffane",
  "Q2418732":"Henri Bedimo","Q30045780":"Amine Gouiri","Q22004066":"Pape Cheikh Diop","Q30089624":"Lucas Paquetá","Q1912":"Karim Benzema","Q44815":"Giovane Élber","Q1922":"Anthony Réveillère","Q1934":"Sidney Govou",
  "Q1935":"Éric Abidal","Q117436":"Yoann Gourcuff","Q1944":"Jérémy Toulalan","Q3876530":"Nicolás Tagliafico","Q110644260":"Endrick Felipe","Q15358470":"Moussa Dembélé","Q15406583":"Corentin Tolisso","Q60530":"Jérémie Bréchet",
  "Q3186498":"Rachid Ghezzal","Q4732":"Yassine Benzia","Q10556350":"Mariano","Q379805":"Mattia De Sciglio","Q296058":"Edmílson","Q230529":"Fabio Grosso","Q296780":"Kader Keita","Q60791524":"Pavel Šulc",
  "Q177595":"Timothée Kolodziejczak","Q299367":"Cristiano Marques Gomes","Q13055":"Rémy Vercoutre","Q20641574":"Lucas Tousart","Q310697":"Michel Bastos","Q310730":"John Mensah","Q438606":"Bakary Koné","Q312772":"Frederico Chaves Guedes",
  "Q219768":"Mahamadou Diarra","Q20981290":"Tino Kadewere","Q429193":"Maxime Gonalons","Q13308":"Samuel Umtiti","Q203451":"Juninho","Q146907":"Miralem Pjanić","Q714116":"Thorgan Hazard","Q724147":"Geoffrey Kondogbia",
  "Q81741599":"Loïc Badé","Q31760":"Jussiê","Q60407856":"Saud Abdulhamid","Q105203860":"Anass Zaroury","Q2699470":"Benjamin Moukandjo","Q64167368":"Michał Skóraś","Q311554":"Aruna Dindane","Q15043990":"Przemysław Frankowski",
  "Q313753":"Papa Bouba Diop","Q124745247":"Robin Risser","Q147111":"John Utaka","Q68110291":"Salis Abdul Samed","Q193717":"Jaroslav Plašil","Q58465451":"Khéphren Thuram-Ulien","Q58484930":"Wilson Isidor","Q331914":"Olivier Kapo",
  "Q311087":"Costinha","Q29168109":"Krépin Diatta","Q259247":"Ernesto Chevantón","Q342439":"Shabani Nonda","Q60596":"Emmanuel Rivière","Q349154":"Lukman Haruna","Q350502":"Pascal Feindouno","Q309662":"Diego Pérez",
  "Q466127":"Mohamed Kallon","Q2316179":"Fabio Santos Romeu","Q358075":"Danijel Subašić","Q360753":"Daniel Niculae","Q21620694":"Youssef Aït Bennasser","Q484384":"Fábio Coentrão","Q19361375":"Almamy Touré","Q370568":"Elderson Uwa Echiejile",
  "Q299435":"Petter Hansson","Q44513":"Willy Sagnol","Q2474222":"Frédéric Bulot","Q504393":"Tony Sylva","Q186330":"Rafael Márquez","Q219618":"Morgan De Sanctis","Q56282611":"Youssouf Fofana","Q222151":"João Moutinho",
  "Q17560793":"Gelson Martins","Q46951844":"Aurélien Tchouaméni","Q27899245":"Álvaro Fernández Llorente","Q290637":"Flavio Roma","Q518577":"Marama Vahirua","Q2070900":"Benjamin Lecomte","Q28051511":"Pietro Pellegri","Q295880":"Vágner Love",
  "Q20435178":"Alexander Nübel","Q3335491":"Nampalys Mendy","Q180326":"Lilian Thuram","Q27528":"Sambou Yatabaré","Q552597":"Dieumerci Mbokani","Q4284482":"Yannick Carrasco","Q2724855":"Adrien Silva","Q183967":"David Trezeguet",
  "Q310255":"Sani Kaita","Q310369":"Freddy Adu","Q310703":"Jakob Poulsen","Q312377":"Yióryos Tzabélas","Q242193":"Dario Šimić","Q313544":"Aléxandros Tziólis","Q186071":"Javier Saviola","Q314759":"Jerko Leko",
  "Q314770":"Leandro Cufré","Q317068":"Emir Bajrami","Q35124488":"Fodé Ballo-Touré","Q20992981":"Benjamin Henrichs","Q323358":"Pablo Contreras","Q438616":"Alain Traoré","Q439185":"Stéphane Ruffier","Q443338":"Gerard López Segú",
  "Q713627":"Lukáš Hrádecký","Q727417":"Nabil Dirar","Q129810":"Kevin Volland","Q14945895":"Keita Baldé","Q42725482":"Lyle Foster","Q15065431":"Aleksandr Golovine","Q15081905":"Thomas Lemar","Q59915117":"Mohammed Salisu",
  "Q6096043":"Ivan Cavaleiro","Q66743376":"Ansu Fati","Q12984":"Stephan El Shaarawy","Q136940":"Marco Di Vaio","Q137128":"Wissam Ben Yedder","Q107742783":"Simon Adingra","Q138172":"Radamel Falcao","Q122354":"Diego Benaglio",
  "Q15831045":"Jemerson","Q63180":"Kamil Glik","Q15956282":"Breel Embolo","Q146119":"Vladimir Jugović","Q147124":"Rabiu Afolabi","Q61899299":"Strahinja Pavlović","Q152340":"Jan Koller","Q974644":"Delvin Ndinga",
  "Q818111":"Benoît Costil","Q213112":"Valter Birsa","Q213616":"Thomas Kahlenberg","Q1917":"Philippe Mexès","Q26522":"Mbaye Niang","Q381378":"Khalilou Fadiga","Q552809":"Georges Mandjeck","Q15820881":"Jean-Charles Castelletto",
  "Q312897":"Dariusz Dudka","Q314090":"Stéphane Grichting","Q317083":"Ireneusz Jeleń","Q326445":"Aurélien Chedjou","Q570983":"Willy Boly","Q329501":"Hassan Yebda","Q18637429":"Serhou Guirassy","Q449434":"Taribo West",
  "Q334484":"Gabriel Tamaș","Q257251":"Ludovic Obraniak","Q7665927":"Sébastien Haller","Q155054":"Diego Contento","Q127480":"Rubén Pardo","Q16745198":"Malcom","Q482602":"Roberto Luís Gaspar Deus Severo","Q31442":"Emiliano Sala",
  "Q31744":"Cheick Diabaté","Q2412438":"Bruno Ecuele Manga","Q31766":"Mariano Ferreira Filho","Q31792":"Landry Nguémo","Q31803":"Ludovic Sané","Q31907":"Benoît Trémoulinas","Q3014830":"Diego Rolán","Q311641":"Denílson",
  "Q372451":"Sávio Bortolini Pimentel","Q2440999":"Martin Braithwaite","Q59914100":"Raoul Bellanova","Q215474":"Kalu Uche","Q22162696":"Aaron Boupendza","Q218730":"Floyd Ayité","Q169995":"Johan Micoud","Q84077":"Andreas Cornelius",
  "Q1572632":"Salif Sané","Q225254":"Ulrich Ramé","Q314541":"Rio Mavuba","Q47170176":"Jules Koundé","Q1334998":"Karl-Johan Johnsson","Q72886":"Ricardinho","Q27794":"Wahbi Khazri","Q315291":"Julien Faubert",
  "Q317223":"Fernando Cavenaghi","Q676721":"Loris Benito","Q573640":"Anthony Modeste","Q14320553":"Hwang Ui-jo","Q343997":"Marco Caneira","Q346402":"Diego Placente","Q459099":"Albert Celades","Q21403452":"Adam Ounas",
  "Q465975":"Michális Kapsís","Q314373":"Moussa Sow","Q266282":"Mile Sterjovski","Q362181":"Daniel Gygax","Q719509":"Edgar Ié","Q207403":"Róbert Vittek","Q27174724":"Hamza Mendyl","Q273776":"Éderzito António Macedo Lopes",
  "Q122971833":"Ayyoub Bouaddi","Q18765":"Burak Yılmaz","Q30055335":"Rafael Leão","Q17274709":"Mike Maignan","Q1927":"Marvin Martin","Q113472432":"Carlos Baleba","Q107094087":"Nathan Ngoy","Q154390":"Ricardo Costa",
  "Q25253293":"Victor Osimhen","Q380365":"Adekanmi Olufadé","Q50628268":"Mehmet Zeki Çelik","Q56085180":"Jonathan David","Q23063190":"Yusuf Yazıcı","Q20641502":"Naïm Sliti","Q208638":"Simon Kjær","Q2736254":"José Fonte",
  "Q311329":"Peter Odemwingie","Q80761":"Dante Bonfim Costa Santos","Q147172":"Vincent Enyeama","Q438035":"Túlio de Melo","Q18637185":"Sofiane Boufal","Q1392925":"Ryan Mendes da Graça","Q152236":"Matthieu Delpierre","Q969529":"Sébastien Corchia",
  "Q705220":"Marko Baša","Q266436":"Brown Ideye","Q211547":"Damien Perquis","Q1526376":"Giovanni Sio","Q17350546":"Famara Diédhiou","Q30301454":"Ibrahima Konaté","Q19903718":"Marcus Thuram","Q60286976":"Maxence Lacroix",
  "Q47067481":"Ermedin Demirović","Q294735":"Václav Svěrkoš","Q650638":"Modibo Maïga","Q18002292":"Karl Toko-Ekambi","Q312892":"Jérémy Mathieu","Q314395":"Ryad Boudebouz","Q314736":"Bojan Jokić","Q670876":"Didier Ovono Ebang",
  "Q318119":"João Miranda","Q431320":"Francileudo Santos","Q350607":"Duško Tošić","Q353258":"Mohamed Kader","Q202254":"Emmanuel Mayuka","Q714036":"Max Gradel","Q213091":"Carlos Bocanegra","Q213106":"Carlos Kameni",
  "Q161038":"Neven Subotić","Q3074150":"Florentin Pogba","Q2484011":"Faouzi Ghoulam","Q2517101":"Yohan Benalouane","Q2637126":"Josuha Guilavogui","Q924134":"Pape Thiaw","Q401771":"Bakary Sako","Q545665":"Augusto Fernández",
  "Q440409":"Willy Aubameyang","Q251966":"Ricky van Wolfswinkel","Q331938":"Daisuke Matsui","Q455328":"Bănel Nicoliță","Q18921387":"Jonathan Prank","Q349379":"Boubacar Sanogo","Q361196":"Alejandro Domínguez","Q361439":"Mario Regueiro",
  "Q367851":"Fabián Orellana","Q370403":"Mario Suárez Mata","Q277533":"Pablo Hernández Domínguez","Q372879":"Juan Francisco García","Q295883":"Claudio López","Q30346426":"Hugo Guillamón","Q359179":"Miku","Q366594":"Víctor Ruiz",
  "Q294204":"Joaquín","Q294852":"David Albelda","Q294963":"Hugo Viana","Q295410":"Gaizka Mendieta","Q296180":"Vicente Rodríguez Guillén","Q296684":"Ezequiel Garay","Q296965":"Ariel Ortega","Q296975":"Iván Helguera",
  "Q299488":"Rubén Baraja","Q371215":"Renan","Q301390":"Francisco Javier Muñoz Llompart","Q366556":"Tino Costa","Q326476":"Jonas","Q310034":"Cristiano Lucarelli","Q312942":"Alexis Ruano","Q313082":"Diego Alves Carreira",
  "Q313130":"Emiliano Moretti","Q313308":"Miguel Ángel Angulo","Q314761":"Kily González","Q315079":"Ricardo Oliveira","Q316692":"Iván Campo","Q316854":"Daniel Wass","Q318226":"Stefano Fiore","Q319890":"Pablo Piatti",
  "Q375703":"Guilherme Siqueira","Q334890":"Sofiane Feghouli","Q336860":"Javier Arizmendi","Q295315":"Miguel Monteiro","Q343976":"David Navarro","Q348199":"Mehmet Topal","Q359484":"Adrian Ilie","Q24052364":"Eray Cömert",
  "Q24084219":"Uroš Račić","Q21540971":"Rafa Mir","Q21584736":"Sadiq Umar","Q212223":"Andrés Palop","Q216260":"Hedwiges Maduro","Q19364":"Andrés Guardado","Q19365":"Vicente Guaita","Q19388":"Dani Parejo",
  "Q19392":"Éver Banega","Q19422":"Sergio Canales","Q2702056":"Anthony Lozano","Q189535":"Roberto Ayala","Q18124343":"Danilo Barbosa","Q2144609":"Diego Alonso","Q186415":"Carlos Marchena","Q187159":"Jordi Alba",
  "Q187426":"Fernando Gago","Q246417":"Denis Cheryshev","Q20994107":"Maximiliano Gómez","Q252596":"Martín Montoya","Q18719485":"Borja Iglesias","Q2296133":"Jonathan Viera","Q201373":"Nikola Žigić","Q192565":"João Pereira",
  "Q83006":"David Villa","Q128719":"Jasper Cillessen","Q130215":"Pablo Aimar","Q157584":"Nelson Valdez","Q99304192":"Yunus Musah","Q15917247":"Portu","Q57142":"Timo Hildebrand","Q22003119":"Selim Amallah",
  "Q15132963":"Rúben Vezo","Q164073":"Javier Navarro","Q6110670":"Rodrigo de Paul","Q507190":"Paco Alcácer","Q4599":"Raúl Albiol","Q169983":"Curro Torres","Q3961288":"Simone Zaza","Q3973800":"Stole Dimitrievski",
  "Q15396247":"José Luis Gayà","Q519654":"Ángel Moyá","Q17708755":"Samu Castillejo","Q380021":"Marius Stankevičius","Q862120":"Javi Fuego","Q658140":"Iago Herrerín","Q67222776":"Samuel Lino","Q7420322":"Santiago Mina",
  "Q15963931":"Munir El Haddadi","Q926353":"Enzo Pérez","Q679699":"Sisinio González Martínez","Q376394":"Rodrigo","Q16235035":"Rubén Sobrino","Q441769":"Víctor Aristizábal","Q16236874":"Nemanja Maksimović","Q444323":"Goran Vlaović",
  "Q14375620":"Zakaria Bakkali","Q1787955":"Mista","Q54105":"Aritz Aduriz","Q476817":"Gabriel Popescu","Q59649459":"Lucas Beltrán","Q703661":"Salva Ballesta","Q65205090":"Ilaix Moriba","Q27067753":"Takefusa Kubo",
  "Q2358664":"Miguel Layún","Q208436":"Martín Palermo","Q208619":"Jozy Altidore","Q2408770":"Javier Aquino","Q214903":"Diego Godín","Q283824":"Borja Valero","Q284359":"Nihat Kahveci","Q284473":"Óliver Torres",
  "Q285986":"Iván Marcano","Q234885":"Daniele Bonera","Q309680":"Sebastián Eguren","Q310657":"Matías Fernández","Q20994068":"Pervis Estupiñán","Q251767":"Ángel Domingo López Ruano","Q221798":"Cicinho","Q2269948":"Kiko Femenía",
  "Q2876432":"Aïssa Mandi","Q2300455":"Jefferson Montero","Q358214":"Josemi","Q980653":"Wakaso Mubarak","Q314617":"Diego López","Q6752290":"Manu Trigueros","Q314113":"Adrián López","Q100300095":"Ilias Akhomach",
  "Q370395":"Bruno Soriano","Q188793":"Joan Capdevila","Q371806":"Rodolfo Martín Arruabarrena","Q111604014":"Alex Freeman","Q372470":"Jonathan de Guzmán","Q100735281":"Yeremi Pino","Q503165":"Luciano Gabriel Figueroa","Q1153411":"Mateo Musacchio",
  "Q505800":"Thomas Christiansen","Q113564288":"Tani Oluwaseyi","Q19871936":"Alfonso Pedraza","Q19882804":"Akram Afif","Q63226171":"Andrei Rațiu","Q512377":"Mario Gaspar","Q3945419":"Salem al-Dossari","Q5550103":"Gerard Moreno",
  "Q376183":"Ikechukwu Uche","Q382193":"Alessio Tacchinardi","Q176119":"Guillermo Franco","Q1068786":"José Ángel Valdés","Q97404267":"Álex Baena","Q932982":"Cédric Bakambu","Q13784739":"Alexander Sørloth","Q314232":"Sergio Asenjo",
  "Q314445":"Ariel Ibagaza","Q316762":"Cristián Zapata","Q316778":"Walter Pandiani","Q562337":"Giovani dos Santos","Q318243":"Gonzalo Javier Rodríguez","Q321567":"Antonio Rukavina","Q326387":"Léo Baptistão","Q192965":"Juan Román Riquelme",
  "Q1220527":"Diego Mariño","Q194107":"Martín Cáceres","Q194439":"Marcos Senna","Q18719633":"Rafael Santos Borré","Q335026":"Luciano Vietto","Q358329":"Cani","Q62016194":"Tajon Buchanan","Q382074":"José Mari",
  "Q17492":"Jonathan dos Santos","Q356142":"Jackson Martínez","Q359056":"Manu del Moral","Q10855654":"Ángel Correa","Q1839524":"Felipe Augusto de Almeida Monteiro","Q365934":"José Manuel Jurado","Q367644":"Eduardo Salvio","Q203665":"Simão",
  "Q19612578":"Çağlar Söyüncü","Q372605":"Nicolás Gaitán","Q27469970":"Robin Le Normand","Q358688":"Gabi","Q113499581":"Arthur Vermeeren","Q2502118":"Santiago Arias","Q219879":"Rubén Olivera","Q221129":"Tomáš Ujfaluši",
  "Q116923606":"Samuel Omorodion","Q276091":"Koke","Q2058682":"Jan Oblak","Q295512":"Carlos Gamarra","Q296215":"Cosmin Contra","Q3180002":"Jonny","Q299238":"Yoúrkas Seïtarídis","Q299360":"Antonio López Guerrero",
  "Q13634114":"José María Giménez","Q182482":"Álvaro Domínguez Soto","Q20719582":"Mario Hermoso","Q311938":"Daniel Aranzubía","Q311972":"Santiago Ezquerro","Q279673":"Pablo García","Q314241":"José Sosa","Q3559484":"Matías Kranevitter",
  "Q114924158":"Pablo Barrios","Q315471":"Santiago Solari","Q3571952":"Yassine Bounou","Q187171":"Mario Mandžukić","Q316631":"Luis Amaranto Perea","Q316772":"Raúl García Escudero","Q316992":"Mariano Pernía","Q318184":"Juninho Paulista",
  "Q247456":"Zé Castro","Q1925465":"Raúl Jiménez","Q109428":"Diego","Q311368":"Nikola Kalinić","Q314138":"Pablo Ibáñez","Q151838":"Axel Witsel","Q342223":"Sergi Barjuan","Q2297174":"Héctor Miguel Herrera",
  "Q350270":"Daniel Díaz","Q263391":"Francisco Miguel Narváez Machón","Q354366":"Luciano Galletti","Q716089":"Cristian Ansaldi","Q55761514":"Morten Hjulmand","Q720908":"Jesus Gámez","Q487459":"Arda Turan","Q5951550":"Juan Musso",
  "Q489111":"Antonio Adán","Q110220404":"Marc Pubill","Q22082590":"Nahuel Molina","Q7944670":"Víctor Machín Pérez","Q514375":"Cléber Santana Loureiro","Q47503":"Leo Franco","Q921324":"Alejandro Grimaldo","Q63928290":"Sergio Camello",
  "Q391628":"Šime Vrsaljko","Q62166":"Christian Abbiati","Q62227":"Juan Eduardo Esnáider","Q47487":"Ignacio Camacho","Q552079":"Rubén Pérez del Mármol","Q7398276":"Saeid Ezzatollahi","Q611923":"Pizzi","Q111672750":"Giuliano Simeone",
  "Q21130285":"Marcos Llorente","Q449715":"Raphaël Wicky","Q23771427":"Dávid Hancko","Q455462":"Antoine Griezmann","Q456365":"Alessio Cerci","Q457527":"Roberto Jiménez Gago","Q127499":"Asier Illarramendi","Q13382434":"Diego Llorente",
  "Q1027459":"Igor Jovićević","Q484909":"Clarence Seedorf","Q16979983":"Luka Jović","Q131234":"Toni Kroos","Q19509544":"Federico Valverde","Q27342447":"Andriy Lounine","Q29950055":"Éder Gabriel Militão","Q212925":"Rubén de la Red",
  "Q44118":"Hamit Altıntop","Q123289726":"Franco Mastantuono","Q2469796":"Willian José","Q282990":"Esteban Granero","Q216816":"Míchel Salgado","Q286511":"Christian Karembeu","Q19948076":"Álvaro Odriozola","Q19952334":"Luca Zidane",
  "Q13418257":"Fernando Pacheco Flores","Q26069":"Klaas-Jan Huntelaar","Q20078774":"Philipp Lienhart","Q38136":"Marcelo","Q2617208":"Alan Pulido","Q17987582":"Jesús Vallejo","Q11576":"Raúl González","Q11584":"Iker Casillas",
  "Q111336539":"Nico Paz","Q180993":"Antonio Cassano","Q27691":"Alberto Bueno","Q42728914":"Rodrygo","Q310007":"Pedro León Sánchez Gil","Q15916807":"Rubén Yáñez","Q145436":"Pedro Mosquera","Q108159340":"Arda Güler",
  "Q124086":"Wesley Sneijder","Q102027":"Fabio Cannavaro","Q192122":"Esteban Cambiasso","Q28973866":"Vinicius Júnior","Q193702":"Walter Samuel","Q194461":"Guti","Q18649709":"Borja Mayoral","Q215952":"Emerson",
  "Q23703372":"Théo Hernandez","Q112184628":"Dean Huijsen","Q152984":"Christoph Metzelder","Q377945":"Adrián González","Q485697":"Pepe","Q358309":"Carlos Andres Diogo","Q98872225":"Fran García","Q122583363":"Raúl Asencio del Rosario",
  "Q721600":"Kiko Casilla","Q367022":"Francisco Pavón","Q554882":"José Rodríguez Martínez","Q531814":"Kaká","Q5981954":"Lucas Vázquez","Q529207":"Ronaldo","Q620792":"Aleix Vidal","Q503137":"Nacho",
  "Q31981":"David Alaba","Q372326":"Pedro Munitis","Q57167":"Zé Roberto","Q373064":"Aitor Karanka","Q5041702":"Carlos Alberto Peña","Q19882816":"Denzel Dumfries","Q66241169":"Jude Bellingham","Q59929":"Jesús Fernández Collado",
  "Q641387":"Raúl de Tomás","Q7089760":"Omar Mascarell","Q85713553":"Miguel Gutiérrez","Q545968":"Víctor Sánchez del Amo","Q314248":"Miguel Torres","Q654903":"Renato Ibarra","Q314652":"David Mateos","Q314494":"Raúl Bravo",
  "Q315702":"Efraín Juárez","Q322047":"Jordi Codina","Q326477":"Enzo Zidane","Q64606160":"Reinier","Q54084":"José Callejón","Q54094":"Sami Khedira","Q346708":"Javier Balboa","Q350536":"Flávio Conceição",
  "Q350823":"Javier Portillo","Q14623217":"Sergi Samper","Q204640":"Francesc Arnau","Q1028020":"Íñigo Martínez","Q21546191":"Carles Aleñá","Q115453":"Ivan Rakitić","Q310022":"Fernando Navarro","Q28861547":"Raphinha",
  "Q1988686":"Douglas","Q110258306":"Joan García Pons","Q160472":"Marc-André ter Stegen","Q18753":"Roberto Trashorras","Q19560313":"Dani Olmo","Q109327842":"Abdessamad Ezzalzouli","Q17508":"José Manuel Pinto","Q56424307":"Karim Adeyemi",
  "Q165014":"Ibrahim Afellay","Q19898898":"Frenkie de Jong","Q107089":"Robert Enke","Q104784108":"Chadi Riad","Q17593940":"Gerard Gumbau","Q111016177":"Vitor Roque","Q17158":"Q17158","Q111097366":"Pablo Torre",
  "Q298140":"Dmytro Chygrynskyi","Q179172":"Bojan Krkić","Q137856":"Alen Halilović","Q18044401":"Franck Kessié","Q182907":"Gianluca Zambrotta","Q310625":"Marc Bartra","Q102292155":"Óscar Mingueza","Q105681392":"Alejandro Baldé",
  "Q28842103":"Moussa Wagué","Q189012":"Alexandre Song","Q16182353":"Lee Seung-woo","Q192671":"Arturo Vidal","Q16235823":"Nélson Semedo","Q193221":"Gabriel Milito","Q151269":"Robert Lewandowski","Q151853":"Mark van Bommel",
  "Q125945":"Sergi Gómez","Q17500":"Xavi Hernández","Q201900":"Rüştü Reçber","Q332645":"Francesco Coco","Q356399":"Gabri","Q382069":"Giovanni","Q54055":"Cristian Tello","Q54060":"Isaac Cuenca",
  "Q316487":"Víctor Sánchez","Q464567":"Roberto Oscar Bonano","Q703269":"Sergi Roberto","Q470415":"Alberto Botía","Q24084271":"Francisco Trincão","Q367872":"Oier Olazábal","Q6698219":"Lucy Bronze","Q275405":"Jeffrén Suárez",
  "Q887406":"Fidel Martínez","Q371812":"Jonathan Soriano","Q56223972":"Jean-Clair Todibo","Q43729":"Andrés Iniesta","Q56332606":"Ronald Araújo","Q22082452":"Carles Pérez","Q76866":"Mohamed Zidan","Q359038":"Joan Verdú",
  "Q313201":"Sergio García","Q218982":"Andreu Fontàs","Q34658":"Michael Reiziger","Q375496":"Fábio Rochemback","Q50315237":"Riqui Puig","Q50375727":"Ona Batlle","Q381809":"Iván Rubén","Q117312887":"Fermín López Marín",
  "Q57456989":"Sergiño Dest","Q77237821":"Iñaki Peña","Q49704":"Sergio Busquets","Q312317":"Maxi López","Q313111":"Marc Muniesa","Q313576":"Henrique Adriano Buss","Q313687":"Albert Jorquera","Q313682":"Oleguer Presas",
  "Q314225":"Keirrison","Q314315":"Diego Capel","Q431526":"Emmanuel Amunike","Q94850":"Adriano","Q443770":"Jordi Gómez","Q203684":"Simone Pepe","Q18617137":"Gerson","Q205188":"Nicolás Burdisso",
  "Q16837911":"Ante Ćorić","Q19773058":"Lorenzo Pellegrini","Q2017857":"Loïc Nego","Q20066885":"Artem Dovbyk","Q2070423":"Antônio Carlos Zago","Q178683":"Cafu","Q20859426":"Amadou Diawara","Q186478":"Luca Toni",
  "Q18394009":"Renato Sanches","Q170452":"Adriano","Q192505":"Mirko Vučinić","Q1776347":"Ervin Zukanović","Q201776":"Vasílis Torosídis","Q202429":"Juan Silveira dos Santos","Q337646":"Marco Motta","Q454910":"Juan Jesus",
  "Q384232":"Gilberto Martínez","Q294980":"Rui Patrício","Q342228":"Stefano Okaka","Q342480":"Max Tonetto","Q1408340":"Andrea Bertolacci","Q343950":"Pierre Womé","Q10758":"Marco Cassetti","Q347710":"Gianluca Curci",
  "Q462779":"Medhi Benatia","Q462836":"Ivan Pelizzoli","Q16554916":"Ezequiel Ponce","Q350271":"Damiano Tommasi","Q468656":"Fábio Simplício","Q355830":"Matteo Brighi","Q10856523":"Antonio Sanabria","Q4754963":"Andrea Belotti",
  "Q367368":"Cesare Bovo","Q49166190":"Alexis Saelemaekers","Q128725":"Hidetoshi Nakata","Q210491":"Christian Chivu","Q456164":"Davide Astori","Q276284":"Christian Wilhelmsson","Q161044":"José Holebas","Q44097":"Marco Borriello",
  "Q3808761":"Norbert Gyömbér","Q296814":"Alessandro Mancini","Q3869208":"Mário Rui","Q3928977":"Rafael Tolói","Q221614":"Bogdan Lobonț","Q517192":"Radja Nainggolan","Q1572467":"Nicolás López","Q1573490":"José Rodolfo Pires Ribeiro",
  "Q1573556":"Leandro Castán","Q294293":"Federico Balzaretti","Q382168":"Marco Andreolli","Q110053":"Mats Hummels","Q298320":"Rodrigo Taddei","Q232789":"Simone Perrotta","Q299624":"Vincent Candela","Q64029237":"Manu Koné",
  "Q2117509":"Victor Ibarbo","Q311043":"Urby Emanuelson","Q28663925":"Matías Viña","Q312127":"Jonathan Zebina","Q313158":"Héctor Moreno","Q313208":"Cristiano Zanetti","Q313722":"Traïanós Déllas","Q313927":"Pablo Osvaldo",
  "Q315282":"Adem Ljajić","Q318526":"Edgar Álvarez","Q115194574":"Benjamin Tahirović","Q28973528":"Gianluca Mancini","Q250093":"Marco Delvecchio","Q438340":"Diego Perotti","Q442492":"Steven Nzonzi","Q442821":"Vitorino Antunes",
  "Q83192":"Iván Piris","Q719197":"Panagiotis Tachtsidis","Q7807765":"Tin Jedvaj","Q6789694":"Matteo Politano","Q166317":"Paulo Dybala","Q37282560":"Marash Kumbulla","Q650452":"Kóstas Manolás","Q8080968":"Łukasz Skorupski",
  "Q5298679":"Sardar Azmoun","Q554001":"Salih Uçan","Q726192":"Fábio Júnior","Q80306":"Giorgio Chiellini","Q795017":"Alessio Romagnoli","Q951342":"Samuel Osei Kuffour","Q6526099":"Leonardo Spinazzola","Q316457":"Cristian Daniel Ledesma",
  "Q316852":"Stefano Mauri","Q317298":"Sergio Conceição","Q949938":"Marco Parolo","Q433120":"Milan Badelj","Q28968068":"Mattia Zaccagni","Q436230":"Lucas Biglia","Q441426":"Lorenzo De Silvestri","Q441639":"Giuseppe Biava",
  "Q1380874":"Álvaro González","Q195953":"Stefan de Vrij","Q453512":"Senad Lulić","Q336870":"Juan Pablo Carrizo","Q55363875":"Roger Ibañez da Silva","Q125438":"Massimo Oddo","Q1413611":"Filip Djordjevic","Q458101":"Ciro Immobile",
  "Q464524":"Dušan Basta","Q203749":"Néstor Fernando Muslera","Q359494":"Matías Almeyda","Q57457130":"Kenneth Taylor","Q366837":"Guglielmo Stendardo","Q75580":"Tommaso Rocchi","Q210919":"Edson Braafheid","Q12015613":"Denis Vavro",
  "Q275986":"Valon Berisha","Q213002":"Samir Handanovič","Q1523030":"Etrit Berisha","Q32556":"Antonio Candreva","Q96335553":"Luka Romero","Q6097699":"Ivan Vargić","Q217089":"Moritz Leitner","Q217389":"Valon Behrami",
  "Q531302":"Francesco Acerbi","Q17399584":"Thomas Strakosha","Q15303013":"Wesley Hoedt","Q17477978":"Joaquín Correa","Q297397":"Julio Cruz","Q192640":"Dejan Stanković","Q20039495":"Daichi Kamada","Q171534":"Ștefan Radu",
  "Q36305":"Alessandro Matri","Q375758":"Anthony Šerić","Q227892":"Alessandro Nesta","Q295438":"Marcelo Salas","Q531107":"Giampiero Pinzi","Q313050":"Darko Kovačević","Q381262":"Fabio Liverani","Q2053358":"Matías Vecino",
  "Q72802":"Eliseu","Q3323347":"Jordan Lukaku","Q15620192":"Vedat Muriqi","Q15673000":"Sergej Milinković-Savić","Q5367516":"Elseid Hysaj","Q238163":"Goran Pandev","Q308391":"Abdoulay Konko","Q80132":"Mauro Zárate",
  "Q80471":"Miroslav Klose","Q51133356":"Valentín Castellanos","Q311619":"Cristian Brocchi","Q311586":"Lionel Scaloni","Q311813":"Rolando Bianchi","Q312510":"Mark Bresciano","Q313570":"Hernanes","Q314670":"Simone Inzaghi",
  "Q794628":"Felipe Anderson","Q298466":"Kwadwo Asamoah","Q298491":"Rene Krhin","Q28561068":"Alessandro Bastoni","Q310635":"Rodrigo Palacio","Q310671":"Angelo Palombo","Q311108":"Sébastien Frey","Q312494":"Ümit Davala",
  "Q313575":"Marko Arnautović","Q313580":"Kerlon","Q313893":"McDonald Mariga","Q314322":"Andrea Ranocchia","Q317532":"Fredy Guarín","Q975390":"Ishak Belfodil","Q21484126":"Lautaro Martínez","Q204108":"Álvaro Recoba",
  "Q204450":"Felipe Melo de Carvalho","Q367174":"Luc Castaignos","Q129333":"Marco Benassi","Q208050":"Leonardo Bonucci","Q208680":"Walter Gargano","Q115859":"Zdravko Kuzmanović","Q369551":"Jonathan Biabiany","Q17070837":"Mehdi Taremi",
  "Q212756":"David Suazo","Q56223006":"Carlos Augusto Zopolato Neves","Q1925":"Yann M'Vila","Q215527":"Domenico Criscito","Q156822":"Lúcio","Q217215":"Victor Obinna","Q214898":"Álvaro Pereira","Q1989585":"Mauricio Pinilla",
  "Q167698":"Éder","Q219389":"Giampaolo Pazzini","Q20090225":"Nicolò Barella","Q20204829":"Federico Dimarco","Q231348":"Iván Córdoba","Q923884":"Vid Belec","Q15644548":"Robin Gosens","Q13646572":"Gabriel Barbosa",
  "Q234532":"Francesco Toldo","Q933184":"Alen Stevanović","Q18165034":"Ivica Ivušić","Q946447":"Caner Erkin","Q188983":"Yórgos Karagoúnis","Q320513":"Luca Castellazzi","Q326480":"Joel Obi","Q193768":"Sulley Muntari",
  "Q329524":"Gary Medel","Q18637686":"Rey Manaj","Q16301719":"George Pușcaș","Q182459":"Júlio César","Q254521":"Jeison Murillo","Q3702162":"Danilo D'Ambrosio","Q333793":"Ricardo Gabriel Álvarez","Q212229":"Andrea Poli",
  "Q151518":"Alfred Duncan","Q346635":"Antar Yahia","Q361035":"Carl Valeri","Q824938":"Cristiano Biraghi","Q76089":"Diego Milito","Q43926":"Andrea Pirlo","Q3845710":"Marcelo Brozović","Q507368":"Denis Alibec",
  "Q508010":"Hugo Campagnaro","Q510596":"Ezequiel Schelotto","Q6999245":"Diego Laxalt","Q763465":"Hakan Çalhanoğlu","Q513648":"Jonathan Cícero Moreira","Q3998301":"Trent Sainsbury","Q515938":"Alex Teixeira","Q380131":"Robert Acquafresca",
  "Q6298271":"João Mário Eduardo","Q867245":"Saphir Taïder","Q667596":"Yann Sommer","Q430729":"Fabián Carini","Q439278":"Matías Silvestre","Q444318":"Okan Buruk","Q52876":"Javier Zanetti","Q591443":"Marko Livaja",
  "Q7197034":"Piotr Zieliński","Q29047921":"Merih Demiral","Q348407":"Domenico Berardi","Q357285":"Frederik Sørensen","Q195324":"Nicola Leali","Q108491198":"Federico Gatti","Q1087530":"Fabio Pecchia","Q195878":"Emanuele Giaccherini",
  "Q197697":"Alex Manninger","Q282551":"Raffaele Palladino","Q342484":"Paolo Montero","Q152897":"Benedikt Höwedes","Q153387":"Hasan Salihamidžić","Q350988":"Simone Padoin","Q126503":"Filippo Inzaghi","Q353046":"Mark Iuliano",
  "Q201896":"Eljero Elia","Q201910":"Miloš Krasić","Q129816":"Manolo Gabbiadini","Q38693097":"Gleison Bremer Silva Nascimento","Q371652":"Albin Ekdal","Q276544":"Igor Tudor","Q371904":"Moreno Torricelli","Q29998966":"Weston McKennie",
  "Q15039855":"Marko Pjaca","Q311095":"Jorge Andrade","Q15220993":"Federico Bernardeschi","Q107051":"Andrea Barzagli","Q168997":"Zdeněk Grygera","Q171311":"Marco Marchionni","Q3788202":"Hörður Magnússon","Q380059":"Ivan Ergić",
  "Q136959":"Fabrizio Miccoli","Q179995":"Claudio Marchisio","Q15731856":"Stefano Sturaro","Q15830919":"Daniele Rugani","Q311578":"Nicola Legrottaglie","Q312937":"Angelo Ogbonna","Q314168":"Cristian Molinaro","Q316551":"Marcelo Zalayeta",
  "Q18402294":"Rolando Mandragora","Q108200391":"Koni De Winter","Q318559":"Dario Knežević","Q189716":"Mauro Camoranesi","Q191869":"Vincenzo Iaquinta","Q98815671":"Pierre Kalulu","Q603681":"Antonio Mirante","Q980185":"Richmond Boakye",
  "Q551192":"Alex Sandro","Q271882":"Robert Kovač","Q210279":"Tomás Rincón","Q211151":"Stephen Appiah","Q213111":"Sebastian Giovinco","Q213546":"Antonio Nocerino","Q99617367":"Francisco Conceição","Q2468436":"Rômulo Souza Orestes Caldeira",
  "Q23762815":"Dušan Vlahović","Q39498277":"Teun Koopmeiners","Q45900":"Fabio Quagliarella","Q219887":"Mattia Cassani","Q249198":"Filip Kostić","Q704951":"Luca Marrone","Q642934":"Rubinho","Q924381":"Federico Peluso",
  "Q391680":"Douglas Costa","Q62198":"Amauri","Q624":"Alessandro Del Piero","Q93504":"Roberto Pereyra","Q67995":"Alessandro Birindelli","Q240492":"Marco Storari","Q43381082":"Nicolás González","Q86835512":"Radu Drăgușin",
  "Q456893":"Marcelo Estigarribia","Q458683":"Lorenzo Ariaudo","Q23899393":"Manuel Locatelli","Q316959":"Digão","Q190608":"Rui Costa","Q153002":"Riccardo Montolivo","Q348956":"Bakaye Traoré","Q200868":"Marek Jankulovski",
  "Q202054":"Keisuke Honda","Q24007299":"Jens Petter Hauge","Q154478":"Cristian Zaccardo","Q114413":"Alberto Paloschi","Q21523936":"Krzysztof Piątek","Q21622362":"Matteo Pessina","Q213007":"Ignazio Abate","Q116980":"Gennaro Gattuso",
  "Q33296979":"Santiago Giménez","Q12208555":"Hachim Mastour","Q20019273":"Davide Calabria","Q2032119":"Roberto De Zerbi","Q3209607":"Ante Rebić","Q15715173":"José Mauri","Q182451":"Alberto Gilardino","Q314083":"Ivan Strinić",
  "Q314093":"Juraj Kucka","Q314744":"Salvatore Bocchetti","Q315831":"Roque Júnior","Q316467":"Dídac Vilà","Q316479":"Djamel Mesbah","Q316812":"Marco Donadel","Q188544":"Nelson de Jesus Silva","Q188564":"Massimo Ambrosini",
  "Q192031":"Kakhaber Kaladze","Q327205":"Alexander Merkel","Q16235543":"Rade Krunić","Q326159":"Niclas Füllkrug","Q438235":"Luca Antonelli","Q443113":"Kevin Constant","Q961889":"Gabriel Vasconcelos Ferreira","Q2856175":"Riccardo Saponara",
  "Q72904":"Luiz Adriano","Q98816361":"Ardon Jashari","Q68607008":"Charles De Ketelaere","Q726848":"Giacomo Bonaventura","Q371305":"Pablo Armero","Q492506":"Michael Agazzi","Q44663":"Rodney Strasser","Q446994":"Vitali Kutuzov",
  "Q69691627":"Junior Messias","Q2637408":"Bartosz Salamon","Q4202251":"Simone Verdi","Q4241246":"Bryan Cristante","Q7357324":"Rodrigo Ely","Q312176":"Johann Vogel","Q309731":"Márcio Amoroso dos Santos","Q309762":"Luca Antonini",
  "Q310677":"Dominic Adiyiah","Q666506":"Ricardo Rodriguez","Q312140":"Sérgio Cláudio dos Santos","Q422012":"Andrea Petagna","Q560618":"Nnamdi Oduamadi","Q21293144":"Antonín Barák","Q45766":"Mario Gómez","Q456868":"Khouma Babacar",
  "Q39233":"Alexandre Kokorine","Q357650":"Rafał Wolski","Q151025":"Q151025","Q363303":"Anthony Vanden Borre","Q1032597":"Luis Muriel","Q21590318":"Alban Lafont","Q207800":"Artur Boruc","Q129736":"Marvin Compper",
  "Q42336731":"Szymon Żurkowski","Q211048":"Alessandro Diamanti","Q17045723":"Ianis Hagi","Q213102":"Christian Maggio","Q163437":"Zísis Vrýzas","Q445541":"Edmundo","Q1988873":"Jasmin Kurtić","Q21171299":"Albert Guðmundsson",
  "Q510462":"Josip Iličič","Q22342392":"Josip Brekalo","Q2012626":"José Basanta","Q17602824":"Kevin Diks","Q2078886":"Nenad Tomović","Q180794":"Manuel Pasqual","Q1343384":"Reginaldo Ferreira da Silva","Q18423342":"Bartłomiej Drągowski",
  "Q430802":"Facundo Roncaglia","Q193568":"Nuno Gomes","Q444378":"Vlada Avramov","Q540961":"Manuel da Costa","Q2409638":"Ahmed Hegazy","Q283762":"Haris Seferović","Q312516":"Martin Jørgensen","Q923206":"Panayótis Koné",
  "Q299779":"Salvatore Sirigu","Q933158":"Kenneth Zohore","Q311391":"Juan Manuel Vargas","Q312375":"Mario Bolatti","Q312400":"Alessandro Gamberini","Q23887939":"Nikola Milenković","Q440031":"Luca Cigarini","Q16234654":"Armando Izzo",
  "Q441437":"Giandomenico Mesto","Q253348":"Blerim Džemaili","Q577481":"Duván Zapata","Q7599020":"Stanislav Lobotka","Q1756086":"Lorenzo Insigne","Q583274":"Diego Demme","Q28699707":"Kim Min-jae","Q82196":"Josip Radošević",
  "Q11954":"Dries Mertens","Q456797":"Juan Camilo Zúñiga","Q350398":"Carlos Pavón","Q350982":"Miguel Pérez Cuesta","Q201825":"Marek Hamšík","Q29441778":"Noa Lang","Q357984":"Kevin De Bruyne","Q359419":"Germán Denis",
  "Q471403":"Amin Younes","Q2332984":"Mauricio Pineda","Q605539":"Miguel Britos","Q21622039":"Alex Meret","Q14831282":"Giovanni Di Lorenzo","Q615668":"Rafael Cabral","Q44983":"Erwin Hoffer","Q30330390":"Leo Skiri Østigård",
  "Q27801691":"David Neres","Q66467324":"Rasmus Højlund","Q17633812":"Hirving Lozano","Q10555584":"Leonardo Pavoletti","Q2056827":"Omar El Kaddouri","Q25409292":"Elif Elmas","Q298448":"Gökhan Inler","Q179457":"Oréstis Karnézis",
  "Q15707405":"Simone Scuffet","Q180866":"Beto","Q18201931":"Marko Rog","Q4018254":"Antonio Donnarumma","Q311956":"Paolo Cannavaro","Q3531728":"David López Silva","Q713501":"Federico Fernández","Q51389133":"Alessandro Buongiorno",
  "Q321321":"Mariano Andújar","Q363500":"György Garics","Q16147481":"Amir Rrahmani","Q98784065":"Ismael Saibari","Q154512":"Danijel Pranjić","Q14640027":"Jonathan Tah","Q155440":"David Jarolím","Q367474":"Takashi Usami",
  "Q156802":"José Paolo Guerrero","Q157839":"Christian Lell","Q158243":"Zvjezdan Misimović","Q159123":"Nils Petersen","Q159622":"Ali Daei","Q276207":"Vahid Hashemian","Q160106":"Sebastian Deisler","Q4949787":"Bouna Sarr",
  "Q43682":"Philipp Lahm","Q44181":"Anatoly Timochtchouk","Q44673":"Andreas Ottl","Q44742":"Breno Borges","Q110463620":"Paul Wanner","Q110486192":"Nestory Irankunda","Q96391665":"Malik Tillman","Q15241424":"Julian Green",
  "Q13365847":"Niklas Süle","Q217384":"Ali Karimi","Q26708753":"Marc Roca","Q167962":"Jens Jeremies","Q60839691":"Chris Richards","Q107076":"Torsten Frings","Q44834":"Thomas Kraft","Q169993":"Andreas Görlitz",
  "Q170150":"Carsten Jancker","Q107365":"Manuel Neuer","Q4241680":"Raphaël Guerreiro","Q63699748":"Sacha Boey","Q40352866":"Michaël Cuisance","Q43666":"Thomas Müller","Q13865408":"Joshua Kimmich","Q312115":"Tom Starke",
  "Q28692516":"Marco Friedl","Q316203":"Jan Schlaudraff","Q28800473":"Sarpreet Singh","Q431267":"Julio dos Santos","Q431669":"Oscar Lewicki","Q433185":"Alexander Baumjohann","Q23540953":"Alphonso Davies","Q437545":"Owen Hargreaves",
  "Q150484":"Ivica Olić","Q453242":"Alexander Zickler","Q151062":"Michael Rensing","Q151278":"Holger Badstuber","Q152354":"Hans-Jörg Butt","Q104454":"Mario Götze","Q152725":"Roy Makaay","Q152940":"Marcell Jansen",
  "Q16528455":"Alessandro Schöpf","Q154305":"Niko Kovač","Q154303":"Piotr Trochowski","Q76753":"Tim Borowski","Q17505880":"Gianluca Gaudino","Q60315":"Sebastian Rudy","Q60340":"Sven Ulreich","Q642850":"Sebastian Rode",
  "Q520721":"Leon Goretzka","Q60834":"Georg Niedermeier","Q523555":"Sandro Wagner","Q174926":"Márcio Rafael Ferreira de Souza","Q20723878":"Dayot Upamecano","Q63720":"Serdar Taşçı","Q21031698":"Giulia Gwinn","Q573326":"Jan Kirchhoff",
  "Q18670270":"Konrad Laimer","Q694852":"Mitchell Weiser","Q62050484":"Michael Olise","Q201752":"Javi Martínez","Q36184031":"Gregor Kobel","Q370348":"Adrián Ramos","Q371788":"Ji Dong-won","Q279436":"Ömer Toprak",
  "Q3177357":"Jeremy Toljan","Q3189078":"Julian Brandt","Q294467":"Mladen Petrić","Q310328":"Andriy Yarmolenko","Q313725":"Matthew Amoah","Q28717698":"Julian Ryerson","Q315641":"Florian Kringe","Q28239":"Gonzalo Castro",
  "Q245295":"Euzebiusz Smolarek","Q351463":"Tamás Hajnal","Q62015814":"Nico Schlotterbeck","Q152377":"Marco Reus","Q153266":"Łukasz Piszczek","Q66738004":"Fábio Silva","Q14558450":"Adnan Januzaj","Q41896054":"Youssoufa Moukoko",
  "Q39287":"Oliver Kirch","Q154397":"Roman Weidenfeller","Q154623":"Lucas Barrios","Q26965570":"Salih Özcan","Q472293":"Otto Addo","Q207112":"Zlatan Alomerović","Q822789":"Marvin Ducksch","Q823064":"Erik Durm",
  "Q129109":"Matthias Ginter","Q158367":"Kevin Großkreutz","Q211698":"Park Joo-ho","Q745506":"Mustafa Amini","Q193024":"Alexander Frei","Q160795":"David Odonkor","Q6860599":"Miloš Jojić","Q22007007":"Emre Mor",
  "Q110483835":"Jobe Bellingham","Q58762":"Dedê","Q165697":"Sven Bender","Q167294":"Patrick Owomoyela","Q509489":"Pascal Groß","Q17659996":"Mahmoud Dahoud","Q524870":"Roman Bürki","Q61219":"Fredi Bobic",
  "Q61371":"Julian Schieber","Q15524059":"Mitsuru Maruoka","Q531080":"Paulo César Tinga","Q1350685":"Nico Schulz","Q110523":"Manuel Friedrich","Q80314837":"Maximilian Beier","Q141354":"Sebastian Kehl","Q18342471":"Marius Wolf",
  "Q20995048":"Felix Passlack","Q822781":"Jonas Hofmann","Q75019636":"Gio Reyna","Q1740190":"Kevin Kampl","Q687140":"Leonardo Bittencourt","Q691193":"Marwin Hitz","Q16320332":"Maximilian Philipp","Q691911":"Mitchell Langerak",
  "Q961878":"Thomas Delaney","Q1356772":"Robbie Kruse","Q23559699":"Waldemar Anton","Q105955374":"Bilal El Khannouss","Q113245":"Murat Yakin","Q45369082":"Chris Führich","Q152968":"Kevin Kurányi","Q23927885":"Santiago Ascacibar",
  "Q350351":"Mohammed Abdellaoue","Q356566":"Adhemar","Q694924":"Florian Klein","Q2319654":"Toni Šunjić","Q360056":"Jurica Vranješ","Q362296":"Karim Haggui","Q68676722":"Angelo Stiller","Q205778":"Pavel Pogrebniak",
  "Q366108":"Marcelo Bordon","Q1851874":"Marco Rojas","Q982163":"Genki Haraguchi","Q55955918":"Deniz Undav","Q720879":"Ibrahima Traoré","Q1893192":"Alexandru Maxim","Q75993":"Ermin Bičakčić","Q84435":"Martin Stranzl",
  "Q57217":"Andreas Hinkel","Q76322":"Yıldıray Baştürk","Q12156405":"Carlos Gruezo","Q893814":"Boris Živković","Q215469":"Francisco Javier Rodríguez","Q77388":"Daniel Didavi","Q287841":"Hajime Hosogai","Q169005":"Daniel Schwaab",
  "Q60122":"Christian Träsch","Q60191":"Roberto Hilbert","Q512820":"Artem Kravets","Q60360":"Martin Harnik","Q86312":"Rani Khedira","Q20093885":"Borna Sosa","Q159516":"Andreas Beck","Q61230":"Christian Gentner",
  "Q318563":"Ioánnis Amanatídis","Q66301":"Julian Schuster","Q20436216":"Grischa Prömel","Q299525":"Przemysław Tytoń","Q319879":"Marcin Kamiński","Q22998602":"Maximilian Mittelstädt","Q62403":"Thomas Brdarić","Q57148":"Cacau",
  "Q310206":"Fernando Meira","Q310612":"Shinji Okazaki","Q312508":"Arthur Boka","Q558820":"Gōtoku Sakai","Q315665":"Ricardo Osorio","Q316222":"Pável Pardo"
};
const RETIRED = new Set([
  "Q245054","Q312183","Q147589","Q250901","Q250978","Q16239548","Q342497","Q342572","Q26704703","Q17493","Q349125","Q350412","Q350785","Q357977","Q185208","Q155884","Q155903","Q112813857","Q271615","Q10885",
  "Q372046","Q128829","Q161571","Q296589","Q274626","Q163666","Q299228","Q113433814","Q285841","Q110739094","Q10526787","Q104784711","Q294214","Q294501","Q184946","Q295416","Q295627","Q248890","Q175296","Q180581",
  "Q184205","Q184218","Q184612","Q311353","Q311342","Q241321","Q241378","Q312437","Q313054","Q313104","Q313131","Q313137","Q313250","Q314235","Q314625","Q3557182","Q316540","Q215435","Q714067","Q204141",
  "Q204429","Q42100656","Q206548","Q723606","Q208433","Q208430","Q209650","Q988626","Q19518278","Q18881","Q57567","Q18982","Q42731","Q1926","Q215425","Q215533","Q1939","Q216557","Q216910","Q59432",
  "Q45567","Q59719","Q511720","Q220593","Q66385776","Q222231","Q61225","Q5220475","Q6277526","Q4254043","Q5024","Q239914","Q223229","Q1936","Q20932574","Q189449","Q189827","Q190515","Q190651","Q190929",
  "Q191151","Q191162","Q192840","Q192913","Q687198","Q208104","Q75857","Q458302","Q459830","Q703414","Q202312","Q19008392","Q245057","Q247462","Q191139","Q249488","Q1361462","Q326293","Q327227","Q10585",
  "Q334564","Q29566","Q342387","Q261534","Q17507","Q350799","Q355847","Q2339","Q266613","Q163564","Q1862778","Q275169","Q211596","Q29495","Q161041","Q18976","Q130319703","Q200785","Q1916","Q215463",
  "Q165125","Q216917","Q218063","Q167790","Q306351","Q313617","Q13422031","Q221222","Q170235","Q30689579","Q172792","Q294593","Q295506","Q174486","Q10520","Q177343","Q298713","Q309781","Q311035","Q312152",
  "Q206641","Q315305","Q605817","Q464846","Q723565","Q482955","Q483417","Q484968","Q489039","Q72603655","Q44298","Q44788","Q80712","Q45626","Q96755704","Q83756","Q47548","Q442911","Q50600","Q50603",
  "Q63659","Q437322","Q458316","Q46896","Q350547","Q108776426","Q354629","Q29339","Q114859","Q41244","Q41533","Q10905","Q10911","Q1255625","Q363769","Q133556","Q375295","Q296341","Q296391","Q296457",
  "Q299515","Q275710","Q276349","Q459707","Q299768","Q310402","Q312120","Q312354","Q312334","Q312980","Q315330","Q315301","Q109397","Q326181","Q454196","Q11948","Q342214","Q346676","Q187396","Q96755",
  "Q188241","Q16063229","Q191848","Q16200385","Q570109","Q192747","Q181921","Q192971","Q150921","Q210944","Q483137","Q83456","Q17499","Q73360","Q969520","Q200770","Q570811","Q202645","Q204059","Q204230",
  "Q204407","Q155461","Q206677","Q207806","Q65029821","Q213989","Q483846","Q210056","Q158618","Q159057","Q211996","Q160206","Q15063275","Q214204","Q214751","Q1913","Q659634","Q58377","Q215944","Q216142",
  "Q1937","Q19497","Q166984","Q168287","Q184614","Q223176","Q223827","Q919182","Q48892","Q80197171","Q234866","Q138075","Q180462","Q237561","Q57704058","Q184261","Q184362","Q314755","Q316512","Q187450",
  "Q188542","Q188997","Q319164","Q192856","Q10711","Q192923","Q29162","Q2245840","Q113156","Q29497","Q29516","Q342219","Q314102","Q201837","Q2332951","Q204848","Q204895","Q208025","Q208586","Q14824665",
  "Q210928","Q14946538","Q276399","Q213427","Q214124","Q1908","Q1915","Q1920","Q1929","Q215770","Q1938","Q1942","Q1943","Q217760","Q167240","Q19888012","Q219248","Q17482506","Q15199","Q223138",
  "Q173360","Q190142","Q314750","Q3318533","Q180193","Q10560","Q180444","Q20641306","Q18126412","Q20738815","Q20740627","Q184177","Q310043","Q310055","Q311191","Q312002","Q241103","Q185572","Q313140","Q313677",
  "Q356392","Q46347","Q40604","Q55820249","Q83488","Q83638","Q42010","Q369915","Q59490","Q45901","Q46522","Q434354","Q47230","Q7121685","Q377746","Q529425","Q60676459","Q47950","Q381401","Q386876",
  "Q35039261","Q9675","Q70550","Q694014","Q375510","Q599675","Q317317","Q244790","Q191855","Q326502","Q328911","Q194769","Q356038","Q150947","Q335693","Q151260","Q314099","Q456617","Q346735","Q459356",
  "Q460696","Q113916","Q201381","Q202329","Q202404","Q265654","Q357664","Q471641","Q363257","Q205773","Q206306","Q206644","Q209944","Q370339","Q210916","Q211126","Q211451","Q213095","Q44309","Q215812",
  "Q215841","Q223843","Q119562","Q381672","Q296833","Q44297797","Q142283","Q310330","Q310408","Q310660","Q29456","Q241502","Q313035","Q313161","Q313582","Q314865","Q439309","Q316698","Q316695","Q161069",
  "Q59938996","Q70567","Q58441","Q166285","Q187184","Q177686","Q184277","Q185093","Q185650","Q254410","Q29454","Q125538","Q342904","Q350466","Q460512","Q349332","Q113872","Q350976","Q353520","Q342308",
  "Q465623","Q177472","Q1257196","Q454220","Q1910","Q1928","Q282463","Q3852031","Q378005","Q296033","Q296621","Q296635","Q296979","Q299244","Q299455","Q302130","Q308394","Q334628","Q310668","Q311372",
  "Q314643","Q16023869","Q318103","Q318539","Q189686","Q202569","Q203657","Q207464","Q208087","Q2447742","Q5022998","Q83498","Q226125","Q7150395","Q380128","Q2081532","Q239513","Q557329","Q946679","Q247312",
  "Q196069","Q158980","Q321330","Q192491","Q148312","Q16235643","Q331926","Q355807","Q125410","Q342303","Q126279","Q353013","Q356457","Q24050378","Q296410","Q16911979","Q276379","Q212617","Q116602","Q213459",
  "Q208425","Q166263","Q2067092","Q219167","Q219158","Q294749","Q378297","Q135314","Q175989","Q1191188","Q310620","Q240456","Q311163","Q311344","Q311370","Q311377","Q312039","Q192986","Q313207","Q313610",
  "Q211120","Q6734350","Q631125","Q435749","Q439302","Q276358","Q294387","Q296992","Q2715111","Q310733","Q311334","Q311659","Q312091","Q312512","Q313170","Q311335","Q315043","Q315459","Q318520","Q316501",
  "Q331908","Q334619","Q337617","Q342350","Q342406","Q342703","Q444453","Q73082","Q215824","Q350107","Q201860","Q163974","Q168029","Q175303","Q184586","Q185115","Q187891","Q188746","Q193488","Q151034",
  "Q152286","Q470751","Q359392","Q363608","Q128840","Q208557","Q208706","Q84272","Q214117","Q214891","Q373211","Q59194","Q59192","Q218394","Q218401","Q77863","Q60595","Q5134192","Q10553748","Q795451",
  "Q439282","Q467034","Q202237","Q202410","Q201394","Q208700","Q208933","Q276178","Q215358","Q215431","Q297845","Q221233","Q213134","Q182685","Q310700","Q311324","Q311983","Q311968","Q311990","Q185081",
  "Q313148","Q314366","Q314879","Q316917","Q187989","Q276306","Q316619","Q147896","Q192825","Q16239542","Q444814","Q187238","Q461284","Q356404","Q350807","Q53652291","Q529013","Q528983","Q946457","Q70564",
  "Q442472","Q347603","Q346694","Q350802","Q353623","Q1354322","Q191885","Q442457","Q443684","Q445796","Q1378371","Q149933","Q450725","Q150207","Q455611","Q218165","Q342608","Q343965","Q13488","Q201367",
  "Q126640","Q39444","Q266507","Q362848","Q314376","Q155604","Q207399","Q275415","Q276434","Q483309","Q373547","Q1921","Q1923","Q215040","Q433125","Q19367","Q1982869","Q219771","Q220746","Q53798193",
  "Q172720","Q2604671","Q227053","Q2089098","Q298338","Q180968","Q122346","Q27649","Q309778","Q311155","Q312520","Q313164","Q314028","Q318530","Q981355","Q630170","Q68060","Q685385","Q6552885","Q350721",
  "Q150238","Q11966","Q259801","Q342599","Q342694","Q350738","Q355820","Q360315","Q1883","Q1909","Q44689","Q1918","Q1924","Q342707","Q1931","Q438081","Q375800","Q376247","Q382269","Q120156",
  "Q296222","Q244894","Q299383","Q299727","Q183210","Q310548","Q312928","Q313142","Q313155","Q317004","Q317079","Q317322","Q191080","Q436247","Q603051","Q516921","Q664053","Q312534","Q55055451","Q708323",
  "Q440097","Q311925","Q315336","Q195130","Q454261","Q460924","Q296133","Q716166","Q26964668","Q721804","Q614334","Q2978523","Q44815","Q1922","Q1934","Q1935","Q117436","Q1944","Q379805","Q296058",
  "Q230529","Q13055","Q310730","Q438606","Q312772","Q219768","Q429193","Q13308","Q203451","Q146907","Q311554","Q313753","Q147111","Q193717","Q331914","Q311087","Q259247","Q342439","Q60596","Q309662",
  "Q466127","Q358075","Q360753","Q484384","Q370568","Q299435","Q44513","Q504393","Q186330","Q219618","Q17560793","Q46951844","Q290637","Q295880","Q180326","Q552597","Q2724855","Q183967","Q310255","Q312377",
  "Q242193","Q313544","Q186071","Q439185","Q443338","Q136940","Q122354","Q146119","Q147124","Q152340","Q974644","Q818111","Q1917","Q312897","Q314090","Q317083","Q326445","Q329501","Q449434","Q334484",
  "Q257251","Q482602","Q31442","Q31792","Q31803","Q3014830","Q311641","Q372451","Q215474","Q22162696","Q169995","Q1572632","Q225254","Q314541","Q47170176","Q72886","Q27794","Q315291","Q317223","Q343997",
  "Q346402","Q459099","Q465975","Q266282","Q719509","Q273776","Q18765","Q1927","Q154390","Q380365","Q23063190","Q208638","Q147172","Q211547","Q294735","Q312892","Q314736","Q318119","Q431320","Q353258",
  "Q213091","Q161038","Q331938","Q349379","Q361196","Q361439","Q367851","Q370403","Q372879","Q295883","Q294204","Q294852","Q294963","Q295410","Q296180","Q296684","Q296965","Q296975","Q299488","Q366556",
  "Q326476","Q310034","Q313082","Q313308","Q314761","Q316692","Q318226","Q336860","Q295315","Q348199","Q359484","Q212223","Q19364","Q189535","Q18124343","Q2144609","Q186415","Q187159","Q187426","Q2296133",
  "Q201373","Q192565","Q83006","Q130215","Q157584","Q15917247","Q57142","Q164073","Q507190","Q169983","Q3961288","Q3973800","Q519654","Q862120","Q1787955","Q54105","Q476817","Q703661","Q2358664","Q208436",
  "Q214903","Q284359","Q284473","Q234885","Q251767","Q221798","Q358214","Q314113","Q370395","Q188793","Q371806","Q505800","Q512377","Q382193","Q176119","Q1068786","Q314445","Q316762","Q562337","Q321567",
  "Q192965","Q194439","Q358329","Q382074","Q356142","Q1839524","Q365934","Q358688","Q221129","Q2058682","Q295512","Q296215","Q3180002","Q299238","Q299360","Q311938","Q311972","Q279673","Q315471","Q187171",
  "Q316631","Q316772","Q316992","Q318184","Q311368","Q314138","Q342223","Q350270","Q263391","Q354366","Q487459","Q514375","Q47503","Q391628","Q62166","Q62227","Q47487","Q449715","Q456365","Q457527",
  "Q1027459","Q484909","Q16979983","Q131234","Q212925","Q282990","Q216816","Q286511","Q13418257","Q26069","Q38136","Q11576","Q11584","Q180993","Q124086","Q102027","Q192122","Q193702","Q194461","Q215952",
  "Q152984","Q485697","Q358309","Q721600","Q367022","Q531814","Q529207","Q620792","Q372326","Q373064","Q545968","Q54084","Q54094","Q350536","Q350823","Q14623217","Q204640","Q115453","Q28861547","Q1988686",
  "Q110258306","Q18753","Q19560313","Q17508","Q19898898","Q107089","Q17158","Q298140","Q179172","Q182907","Q105681392","Q28842103","Q193221","Q151853","Q125945","Q17500","Q201900","Q332645","Q356399","Q382069",
  "Q464567","Q367872","Q6698219","Q43729","Q56332606","Q359038","Q313201","Q34658","Q375496","Q50315237","Q50375727","Q381809","Q117312887","Q49704","Q312317","Q313687","Q313682","Q431526","Q94850","Q443770",
  "Q203684","Q205188","Q16837911","Q2070423","Q178683","Q186478","Q170452","Q192505","Q201776","Q202429","Q294980","Q342480","Q343950","Q10758","Q347710","Q462779","Q350271","Q355830","Q367368","Q128725",
  "Q210491","Q456164","Q276284","Q161044","Q44097","Q296814","Q3869208","Q221614","Q1573490","Q1573556","Q294293","Q110053","Q298320","Q232789","Q299624","Q2117509","Q312127","Q313158","Q313208","Q313722",
  "Q313927","Q250093","Q438340","Q442821","Q719197","Q80306","Q951342","Q316457","Q316852","Q317298","Q949938","Q433120","Q436230","Q441639","Q336870","Q125438","Q1413611","Q359494","Q366837","Q75580",
  "Q210919","Q213002","Q32556","Q217089","Q217389","Q17399584","Q192640","Q171534","Q36305","Q375758","Q227892","Q295438","Q313050","Q381262","Q72802","Q3323347","Q5367516","Q238163","Q80471","Q311619",
  "Q311586","Q312510","Q313570","Q314670","Q298466","Q310635","Q310671","Q311108","Q312494","Q314322","Q317532","Q204108","Q204450","Q208050","Q17070837","Q212756","Q1925","Q156822","Q217215","Q1989585",
  "Q167698","Q219389","Q231348","Q234532","Q188983","Q326480","Q193768","Q182459","Q212229","Q76089","Q43926","Q3845710","Q508010","Q444318","Q52876","Q348407","Q1087530","Q195878","Q197697","Q342484",
  "Q152897","Q153387","Q350988","Q126503","Q353046","Q201896","Q201910","Q371652","Q276544","Q371904","Q311095","Q107051","Q168997","Q171311","Q380059","Q136959","Q179995","Q311578","Q312937","Q316551",
  "Q318559","Q189716","Q191869","Q980185","Q271882","Q211151","Q213111","Q213546","Q45900","Q62198","Q624","Q67995","Q458683","Q316959","Q190608","Q153002","Q200868","Q202054","Q154478","Q213007",
  "Q116980","Q20019273","Q2032119","Q182451","Q314083","Q314744","Q315831","Q316467","Q188544","Q188564","Q192031","Q327205","Q443113","Q72904","Q726848","Q446994","Q7357324","Q312176","Q309731","Q309762",
  "Q312140","Q45766","Q151025","Q207800","Q211048","Q213102","Q163437","Q445541","Q2012626","Q430802","Q193568","Q444378","Q540961","Q312516","Q299779","Q311391","Q312375","Q253348","Q11954","Q456797",
  "Q350398","Q201825","Q2332984","Q298448","Q180866","Q311956","Q321321","Q154512","Q155440","Q157839","Q158243","Q159622","Q276207","Q160106","Q43682","Q44181","Q44673","Q110486192","Q217384","Q167962",
  "Q107076","Q169993","Q170150","Q4241680","Q316203","Q437545","Q150484","Q453242","Q151062","Q151278","Q152354","Q152725","Q152940","Q154305","Q154303","Q76753","Q60315","Q60340","Q642850","Q60834",
  "Q63720","Q279436","Q294467","Q313725","Q315641","Q245295","Q153266","Q66738004","Q39287","Q154397","Q154623","Q472293","Q823064","Q158367","Q193024","Q160795","Q58762","Q165697","Q167294","Q61219",
  "Q61371","Q531080","Q110523","Q141354","Q75019636","Q691911","Q1356772","Q113245","Q152968","Q356566","Q360056","Q362296","Q366108","Q84435","Q57217","Q76322","Q893814","Q215469","Q60122","Q318563",
  "Q62403","Q57148","Q310206","Q310612","Q312508","Q315665","Q316222"
]);

const arg = k => process.argv.includes(k);
const now = new Date();
const AUJ = now.toISOString().slice(0,10);
const ANNEE = AUJ.slice(0,4);
const JOURNAL = `journal-${ANNEE}.jsonl`;

function enMercato(d){ const m=d.getUTCMonth()+1; return m===1 || (m>=6&&m<=8); }

async function sparql(q){
  const url = SPARQL + "?format=json&query=" + encodeURIComponent(q);
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/sparql-results+json" } });
  if(!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

// Requête : UNIQUEMENT les passages en CLUB de foot (instance de "club de football" Q476028),
// avec début/fin/prêt, + décès + ID Transfermarkt.
function requete(lot){
  const values = lot.map(q => "wd:" + q).join(" ");
  return `
    SELECT ?player ?teamLabel ?start ?end ?loan ?death ?tm WHERE {
      VALUES ?player { ${values} }
      OPTIONAL {
        ?player p:P54 ?st .
        ?st ps:P54 ?team .
        ?team wdt:P31/wdt:P279* wd:Q476028 .
        OPTIONAL { ?st pq:P580 ?start . }
        OPTIONAL { ?st pq:P582 ?end . }
        OPTIONAL { ?st pq:P1642 ?loan . }
      }
      OPTIONAL { ?player wdt:P570 ?death . }
      OPTIONAL { ?player wdt:P2446 ?tm . }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
    }`;
}

const jours = (a,b) => Math.round((new Date(b) - new Date(a)) / 86400000);

function deduire(rows, qid){
  let death=null, tm=null; const spells=[];
  for(const b of rows){
    if(b.death && !death) death = String(b.death.value).slice(0,10);
    if(b.tm && !tm) tm = b.tm.value;
    if(b.teamLabel){
      spells.push({
        club: b.teamLabel.value,
        start: b.start ? String(b.start.value).slice(0,10) : null,
        end:   b.end   ? String(b.end.value).slice(0,10)   : null,
        loan:  b.loan && b.loan.value.endsWith("Q2914547"),
      });
    }
  }
  const ouverts = spells.filter(s => s.start && !s.end);
  ouverts.sort((a,b) => (a.start < b.start ? 1 : -1));
  const fins = spells.filter(s=>s.end).map(s=>s.end).sort();
  const derniereFin = fins.length ? fins[fins.length-1] : null;
  const datesDeb = spells.filter(s=>s.start).map(s=>s.start).sort();
  const dernierDebut = datesDeb.length ? datesDeb[datesDeb.length-1] : null;
  const dernierSpell = spells.filter(s=>s.start).sort((a,b)=> a.start<b.start?-1:1).pop() || null;

  let statut, club_actuel = "", confiance = "ok";
  if(death){
    statut = "retraite";
  } else if(ouverts.length >= 1){
    statut = "en_activite";
    club_actuel = ouverts[0].club;
    if(ouverts.length > 1) confiance = "a_verifier";
  } else {
    const vieux = derniereFin && jours(derniereFin, AUJ) > RETRAITE_MOIS*30;
    statut = (RETIRED.has(qid) || vieux) ? "retraite" : "sans_club";
  }

  const dernier_mouvement = dernierSpell ? {
    type: dernierSpell.loan ? "pret" : "transfert",
    club: dernierSpell.club, date: dernierSpell.start,
  } : null;

  if(!death && dernierDebut && jours(dernierDebut, AUJ) <= FRAIS_JOURS_RECENT) confiance = "a_verifier";

  return { statut, club_actuel, tm_id: tm||null, dernier_mouvement, confiance, _aucune_donnee: spells.length===0 && !death };
}

function eligible(f){
  if(f.confiance !== "ok") return false;
  if(f.statut === "sans_club") return false;
  const dm = f.dernier_mouvement;
  if(dm && dm.date && jours(dm.date, AUJ) < GRACE_JOURS) return false;
  return true;
}

async function main(){
  let reg = {};
  try { const arr = JSON.parse(await fs.readFile(REGISTRE, "utf8")); for(const f of arr) reg[f.id]=f; }
  catch { console.log("registre.json absent → création au premier passage."); }

  const merc = enMercato(now) || arg("--full");
  const jour = now.getUTCDay();
  const tousQID = Object.keys(JOUEURS);
  const cibles = merc ? tousQID : tousQID.filter((_,i) => i % 7 === jour);
  console.log(`${AUJ} — ${merc ? "MERCATO (passe complète)" : "hors mercato (rotation 1/7)"} : ${cibles.length}/${tousQID.length} joueurs.`);

  const changements = [];
  let nbChg = 0, nbConflits = 0;

  for(let k=0; k<cibles.length; k+=BATCH){
    const lot = cibles.slice(k, k+BATCH);
    let data;
    try { data = await sparql(requete(lot)); }
    catch(e){ console.log(`  … lot ${k}: ${e.message} — on réessaie`); await sleep(3000);
      try{ data = await sparql(requete(lot)); }catch(e2){ console.log("  ✗ lot ignoré"); continue; } }

    const parJoueur = {};
    for(const b of data.results.bindings){
      const qid = b.player.value.split("/").pop();
      (parJoueur[qid] ||= []).push(b);
    }

    for(const qid of lot){
      const rows = parJoueur[qid] || [];
      const nouv = deduire(rows, qid);
      const anc = reg[qid] || { id: qid, name: JOUEURS[qid], historique: [] };

      if(nouv._aucune_donnee && anc.club_actuel){ nouv.statut = anc.statut; nouv.club_actuel = anc.club_actuel; nouv.confiance = "a_verifier"; }

      let touche = false;
      for(const c of ["club_actuel","statut","tm_id"]){
        const av = anc[c] ?? null, ap = nouv[c] ?? null;
        if(String(av) !== String(ap)){
          touche = true;
          const ligne = { date: AUJ, id: qid, name: anc.name, champ: c, avant: av, apres: ap, source: "wikidata" };
          (anc.historique ||= []).push(ligne); changements.push(ligne);
        }
      }
      if(JSON.stringify(anc.dernier_mouvement||null) !== JSON.stringify(nouv.dernier_mouvement||null)) touche = true;

      anc.name = anc.name || JOUEURS[qid];
      anc.club_actuel = nouv.club_actuel;
      anc.statut = nouv.statut;
      anc.tm_id = nouv.tm_id;
      anc.dernier_mouvement = nouv.dernier_mouvement;
      anc.confiance = nouv.confiance;
      anc.source = "wikidata:" + qid + (anc.tm_id ? " · TM:"+anc.tm_id : "");
      anc.verifie_le = AUJ;
      anc.eligible_jour = eligible(anc);
      reg[qid] = anc;
      if(touche) nbChg++;
      if(anc.confiance !== "ok") nbConflits++;
    }
    console.log(`  ✓ ${Math.min(k+BATCH,cibles.length)}/${cibles.length} — ${nbChg} modif(s), ${nbConflits} à vérifier`);
    await sleep(PAUSE);
  }

  const sortie = Object.values(reg).sort((a,b)=> (a.name||"").localeCompare(b.name||""));
  await fs.writeFile(REGISTRE, JSON.stringify(sortie, null, 1));
  if(changements.length){
    await fs.appendFile(JOURNAL, changements.map(l=>JSON.stringify(l)).join("\n")+"\n");
  }

  const parStatut = sortie.reduce((a,f)=>(a[f.statut]=(a[f.statut]||0)+1,a),{});
  console.log("\n======================================================");
  console.log(`Fiches : ${sortie.length} | statuts :`, parStatut);
  console.log(`Changements ce passage : ${changements.length} (→ ${JOURNAL})`);
  console.log(`À valider : ${sortie.filter(f=>f.confiance!=="ok").length} · Éligibles au tirage : ${sortie.filter(f=>f.eligible_jour).length}`);
}

main();
