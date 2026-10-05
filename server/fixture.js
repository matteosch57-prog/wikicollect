// Offline catalog used when WIKI_SOURCE=fixture (local dev without network, and tests).
// Metrics are rough illustrative values, not live Wikipedia data.

const RAW = [
  // [title, description, views/day, kB, extract]
  ['Mercury (planet)', 'Smallest and closest planet to the Sun', 4200, 95, 'Mercury is the first planet from the Sun and the smallest in the Solar System. It is a rocky planet with a trace atmosphere and a surface gravity slightly higher than that of Mars.'],
  ['Venus', 'Second planet from the Sun', 5200, 140, 'Venus is the second planet from the Sun. It is a terrestrial planet and is the closest in mass and size to its orbital neighbour Earth. Venus has by far the densest atmosphere of the terrestrial planets.'],
  ['Earth', 'Third planet from the Sun', 9800, 160, 'Earth is the third planet from the Sun and the only astronomical object known to harbor life. Most of its surface is covered by water oceans.'],
  ['Mars', 'Fourth planet from the Sun', 8100, 180, 'Mars is the fourth planet from the Sun. It is also known as the "Red Planet", because of its orange-red appearance. Mars is a desert-like rocky planet with a tenuous atmosphere.'],
  ['Jupiter', 'Fifth planet from the Sun', 7600, 150, 'Jupiter is the fifth planet from the Sun and the largest in the Solar System. It is a gas giant with a mass more than two and a half times that of all the other planets combined.'],
  ['Saturn', 'Sixth planet from the Sun', 6300, 130, 'Saturn is the sixth planet from the Sun and the second largest in the Solar System, after Jupiter. It is a gas giant famous for its prominent ring system.'],
  ['Uranus', 'Seventh planet from the Sun', 4100, 110, 'Uranus is the seventh planet from the Sun. It is a gaseous cyan-coloured ice giant whose axis of rotation is tilted almost onto its orbital plane.'],
  ['Neptune', 'Eighth planet from the Sun', 3900, 105, 'Neptune is the eighth and farthest known planet orbiting the Sun. It is an ice giant and the densest giant planet, and was the first planet found by mathematical prediction.'],
  ['John Lennon', 'English musician (1940–1980)', 11000, 190, 'John Winston Ono Lennon was an English singer, songwriter and musician who gained worldwide fame as the founder, co-songwriter, co-lead vocalist and rhythm guitarist of the Beatles.'],
  ['Paul McCartney', 'English musician (born 1942)', 12500, 200, 'Sir James Paul McCartney is an English singer, songwriter and musician who gained global fame with the Beatles, for whom he played bass guitar and shared primary songwriting duties.'],
  ['George Harrison', 'English musician (1943–2001)', 7200, 170, 'George Harrison was an English musician and singer-songwriter who achieved international fame as the lead guitarist of the Beatles.'],
  ['Ringo Starr', 'English musician (born 1940)', 6100, 120, 'Sir Richard Starkey, known professionally as Ringo Starr, is an English musician and actor who achieved international fame as the drummer for the Beatles.'],
  ['Great Pyramid of Giza', 'Largest Egyptian pyramid', 5400, 120, 'The Great Pyramid of Giza is the largest Egyptian pyramid. It served as the tomb of pharaoh Khufu and is the oldest of the Seven Wonders of the Ancient World.'],
  ['Hanging Gardens of Babylon', 'Legendary terraced gardens', 1700, 45, 'The Hanging Gardens of Babylon were one of the Seven Wonders of the Ancient World, described as a remarkable feat of engineering with an ascending series of tiered gardens.'],
  ['Statue of Zeus at Olympia', 'Giant chryselephantine sculpture', 900, 30, 'The Statue of Zeus at Olympia was a giant seated figure made by the Greek sculptor Phidias around 435 BC at the sanctuary of Olympia.'],
  ['Temple of Artemis', 'Greek temple at Ephesus', 1100, 40, 'The Temple of Artemis or Artemision was a Greek temple dedicated to an ancient, local form of the goddess Artemis, located at Ephesus.'],
  ['Mausoleum at Halicarnassus', 'Tomb of Mausolus', 700, 28, 'The Mausoleum at Halicarnassus was a tomb built between 353 and 350 BC at Halicarnassus for Mausolus, a native Carian who served as satrap.'],
  ['Colossus of Rhodes', 'Statue of the sun god Helios', 1500, 35, 'The Colossus of Rhodes was a statue of the Greek sun god Helios, erected in the city of Rhodes by Chares of Lindos in 280 BC.'],
  ['Lighthouse of Alexandria', 'Ancient Egyptian lighthouse', 1300, 38, 'The Lighthouse of Alexandria, sometimes called the Pharos of Alexandria, was a lighthouse built by the Ptolemaic Kingdom during the reign of Ptolemy II Philadelphus.'],
  ['Zeus', 'Sky god and king of the gods', 6800, 110, 'Zeus is the chief deity of the Greek pantheon. He is a sky and thunder god in ancient Greek religion and mythology, who rules as king of the gods on Mount Olympus.'],
  ['Hera', 'Greek goddess of marriage', 3200, 60, 'In ancient Greek religion, Hera is the goddess of marriage, women, and family, and the protector of women during childbirth.'],
  ['Poseidon', 'Greek god of the sea', 3600, 55, 'Poseidon is one of the Twelve Olympians in ancient Greek religion and mythology, presiding over the sea, storms, earthquakes and horses.'],
  ['Demeter', 'Greek goddess of the harvest', 1900, 50, 'In ancient Greek religion and mythology, Demeter is the Olympian goddess of the harvest and agriculture, presiding over crops, grains, food, and the fertility of the earth.'],
  ['Athena', 'Greek goddess of wisdom', 4800, 95, 'Athena or Athene, often given the epithet Pallas, is an ancient Greek goddess associated with wisdom, warfare, and handicraft.'],
  ['Apollo', 'Greek god of music and the sun', 4100, 115, 'Apollo is one of the Olympian deities in classical Greek and Roman religion and mythology, recognized as a god of archery, music and dance, truth and prophecy.'],
  ['Artemis', 'Greek goddess of the hunt', 3900, 80, 'In ancient Greek religion and mythology, Artemis is the goddess of the hunt, the wilderness, wild animals, nature, vegetation, childbirth, and chastity.'],
  ['Ares', 'Greek god of war', 3000, 60, 'Ares is the Greek god of war and courage. He is one of the Twelve Olympians, and the son of Zeus and Hera.'],
  ['Aphrodite', 'Greek goddess of love', 4400, 85, 'Aphrodite is an ancient Greek goddess associated with love, lust, beauty, pleasure, passion, procreation, and as her syncretized Roman goddess counterpart Venus.'],
  ['Hephaestus', 'Greek god of the forge', 2100, 50, 'In ancient Greek mythology, Hephaestus is the god of fire, metallurgy, and crafts. He is the son of Zeus and Hera.'],
  ['Hermes', 'Messenger of the Greek gods', 3700, 75, 'Hermes is an Olympian deity in ancient Greek religion and mythology considered the herald of the gods and the protector of travelers, thieves and merchants.'],
  ['Dionysus', 'Greek god of wine', 3300, 120, 'In ancient Greek religion and myth, Dionysus is the god of wine-making, orchards and fruit, vegetation, fertility, festivity, insanity, ritual madness and theatre.'],
  ['Leonardo da Vinci', 'Italian Renaissance polymath (1452–1519)', 13000, 210, 'Leonardo di ser Piero da Vinci was an Italian polymath of the High Renaissance who was active as a painter, draughtsman, engineer, scientist, theorist, sculptor, and architect.'],
  ['Michelangelo', 'Italian artist (1475–1564)', 7800, 150, 'Michelangelo di Lodovico Buonarroti Simoni was an Italian sculptor, painter, architect, and poet of the High Renaissance.'],
  ['Raphael', 'Italian painter (1483–1520)', 4200, 90, 'Raffaello Sanzio da Urbino, now generally known in English as Raphael, was an Italian painter and architect of the High Renaissance.'],
  ['Donatello', 'Italian sculptor (c. 1386–1466)', 2300, 55, 'Donato di Niccolò di Betto Bardi, known mononymously as Donatello, was an Italian sculptor of the Renaissance period.'],
  ['Titian', 'Italian painter (c. 1488–1576)', 1900, 70, 'Tiziano Vecelli or Vecellio, known in English as Titian, was an Italian Renaissance painter, the most important artist of the 16th-century Venetian school.'],
  ['Sandro Botticelli', 'Italian painter (c. 1445–1510)', 2600, 75, 'Alessandro di Mariano di Vanni Filipepi, better known as Sandro Botticelli, was an Italian painter of the Early Renaissance.'],
  ['Helium', 'Chemical element with atomic number 2', 2900, 95, 'Helium is a chemical element; it has symbol He and atomic number 2. It is a colorless, odorless, non-toxic, inert, monatomic gas and the first in the noble gas group.'],
  ['Neon', 'Chemical element with atomic number 10', 1500, 55, 'Neon is a chemical element; it has symbol Ne and atomic number 10. It is the second noble gas in the periodic table.'],
  ['Argon', 'Chemical element with atomic number 18', 1300, 50, 'Argon is a chemical element; it has symbol Ar and atomic number 18. It is in group 18 of the periodic table and is a noble gas.'],
  ['Krypton', 'Chemical element with atomic number 36', 900, 40, 'Krypton is a chemical element; it has symbol Kr and atomic number 36. It is a colorless, odorless noble gas that occurs in trace amounts in the atmosphere.'],
  ['Xenon', 'Chemical element with atomic number 54', 1000, 60, 'Xenon is a chemical element; it has symbol Xe and atomic number 54. It is a dense, colorless, odorless noble gas found in Earth\'s atmosphere in trace amounts.'],
  ['Radon', 'Chemical element with atomic number 86', 1100, 70, 'Radon is a chemical element; it has symbol Rn and atomic number 86. It is a radioactive noble gas and is colorless and odorless.'],
  ['Africa', 'Continent', 9200, 190, 'Africa is the world\'s second-largest and second-most populous continent after Asia. At about 30.3 million km² including adjacent islands, it covers 20% of Earth\'s land area.'],
  ['Antarctica', 'Earth\'s southernmost continent', 5100, 140, 'Antarctica is Earth\'s southernmost and least-populated continent. Situated almost entirely south of the Antarctic Circle and surrounded by the Southern Ocean, it contains the geographic South Pole.'],
  ['Asia', 'Continent', 7400, 150, 'Asia is the largest continent in the world by both land area and population. It covers an area of more than 44 million square kilometres, about 30% of Earth\'s total land area.'],
  ['Australia (continent)', 'Continent in the Southern Hemisphere', 1600, 60, 'The continent of Australia, sometimes known in technical contexts as Sahul, is a continent comprising mainland Australia, Tasmania, the island of New Guinea and neighbouring islands.'],
  ['Europe', 'Continent', 8900, 200, 'Europe is a continent located entirely in the Northern Hemisphere and mostly in the Eastern Hemisphere. It is bordered by the Arctic Ocean to the north and the Atlantic Ocean to the west.'],
  ['North America', 'Continent', 6100, 130, 'North America is a continent in the Northern and Western Hemispheres. It is bordered to the north by the Arctic Ocean, to the east by the Atlantic Ocean, and to the west by the Pacific Ocean.'],
  ['South America', 'Continent', 5600, 120, 'South America is a continent entirely in the Western Hemisphere and mostly in the Southern Hemisphere. It can also be described as the southern subregion of a single continent called America.'],
  ['Isaac Newton', 'English physicist and mathematician (1642–1727)', 11500, 200, 'Sir Isaac Newton was an English polymath active as a mathematician, physicist, astronomer, alchemist, theologian, and author who was described as a natural philosopher.'],
  ['Albert Einstein', 'German-born physicist (1879–1955)', 21000, 220, 'Albert Einstein was a German-born theoretical physicist who is best known for developing the theory of relativity. Einstein also made important contributions to quantum mechanics.'],
  ['Marie Curie', 'Polish-French physicist and chemist (1867–1934)', 9800, 150, 'Maria Salomea Skłodowska-Curie, known simply as Marie Curie, was a Polish and naturalised-French physicist and chemist who conducted pioneering research on radioactivity.'],
  ['Niels Bohr', 'Danish physicist (1885–1962)', 3300, 110, 'Niels Henrik David Bohr was a Danish theoretical physicist who made foundational contributions to understanding atomic structure and quantum theory.'],
  ['Galileo Galilei', 'Italian astronomer and physicist (1564–1642)', 7600, 160, 'Galileo di Vincenzo Bonaiuti de\' Galilei, commonly referred to as Galileo Galilei or mononymously as Galileo, was an Italian astronomer, physicist and engineer.'],
  ['Richard Feynman', 'American theoretical physicist (1918–1988)', 5800, 130, 'Richard Phillips Feynman was an American theoretical physicist. He is best known for his work in the path integral formulation of quantum mechanics and quantum electrodynamics.'],
  // Obscure-ish articles that make up most random draws
  ['Bishop\'s Castle Railway', 'Defunct railway in Shropshire, England', 14, 22, 'The Bishop\'s Castle Railway was a railway in Shropshire, England, that ran from Craven Arms to Bishop\'s Castle. It was in receivership for most of its life.'],
  ['Lake Toba', 'Crater lake in North Sumatra, Indonesia', 650, 30, 'Lake Toba is a large natural lake in North Sumatra, Indonesia, occupying the caldera of a supervolcano. It is the largest volcanic lake in the world.'],
  ['Axolotl', 'Species of salamander', 3100, 45, 'The axolotl is a paedomorphic salamander closely related to the tiger salamander. It is unusual among amphibians in that it reaches adulthood without undergoing metamorphosis.'],
  ['Pétanque', 'Boules sport', 520, 18, 'Pétanque is a sport that falls into the category of boules sports, along with raffa, bocce, boule lyonnaise, lawn bowls and crown green bowling.'],
  ['Grevillea robusta', 'Species of tree', 120, 12, 'Grevillea robusta, commonly known as the southern silky oak, is a flowering plant in the family Proteaceae. It is the largest species in its genus.'],
  ['Voynich manuscript', 'Illustrated codex written in an unknown script', 2700, 75, 'The Voynich manuscript is an illustrated codex, hand-written in an unknown script referred to as Voynichese. The vellum has been carbon-dated to the early 15th century.'],
  ['Tardigrade', 'Phylum of eight-legged micro-animals', 2400, 60, 'Tardigrades, known colloquially as water bears or moss piglets, are a phylum of eight-legged segmented micro-animals. They are known for surviving extreme conditions.'],
  ['Kowloon Walled City', 'Former settlement in Hong Kong', 1900, 40, 'Kowloon Walled City was an ungoverned and densely populated de jure Chinese enclave within the boundaries of Kowloon City, British Hong Kong.'],
  ['Emu War', '1932 Australian wildlife management operation', 2200, 25, 'The Emu War was a nuisance wildlife management military operation undertaken in Australia over the later part of 1932 to address public concern over emus destroying crops.'],
  ['Pando (tree)', 'Clonal colony of quaking aspen in Utah', 900, 20, 'Pando is a clonal colony of a single male quaking aspen located in Sevier County, Utah. It is one of the heaviest known organisms on Earth.'],
  ['Codex Gigas', 'Largest extant medieval manuscript', 650, 15, 'The Codex Gigas is the largest extant medieval illuminated manuscript in the world. It is also known as the Devil\'s Bible because of a large illustration of the devil.'],
  ['Carrington Event', 'Geomagnetic storm of 1859', 1200, 28, 'The Carrington Event was the most intense geomagnetic storm in recorded history, peaking on 1–2 September 1859 during solar cycle 10.'],
  ['Saint-Pierre and Miquelon', 'French overseas collectivity', 1300, 70, 'Saint-Pierre and Miquelon is a self-governing territorial overseas collectivity of France in the northwestern Atlantic Ocean, near the Canadian province of Newfoundland and Labrador.'],
  ['Dancing plague of 1518', 'Case of dancing mania in Strasbourg', 1100, 14, 'The dancing plague of 1518 was a case of dancing mania that occurred in Strasbourg, Alsace, in the Holy Roman Empire from 14 July 1518 to September 1518.'],
  ['Mpemba effect', 'Hot water freezing faster than cold water', 700, 32, 'The Mpemba effect is the name given to the observation that a liquid which is initially hot can freeze faster than the same liquid which begins cold, under otherwise similar conditions.'],
  ['Hartlepool monkey', 'Legend from Hartlepool, England', 260, 8, 'The Hartlepool monkey is a legend from the town of Hartlepool, England, in which the townspeople are said to have hanged a monkey believing it to be a French spy.'],
  ['Moho (bird)', 'Extinct genus of Hawaiian birds', 90, 9, 'Moho is a genus of extinct birds that were endemic to Hawaii. They were nectarivorous birds formerly believed to be honeyeaters.'],
  ['Strandbeest', 'Wind-walking kinetic sculptures', 300, 10, 'Strandbeest is a kinetic sculpture created by Dutch artist Theo Jansen. The sculptures walk using the wind on the beaches of the Netherlands.'],
  ['Lake Nyos', 'Crater lake in Cameroon', 600, 22, 'Lake Nyos is a crater lake in the Northwest Region of Cameroon. In 1986 a limnic eruption released a large cloud of carbon dioxide that suffocated about 1,700 people.'],
  ['Bristlecone pine', 'Group of long-lived pine trees', 450, 20, 'The term bristlecone pine covers three species of pine tree. All three species are long-lived and highly resilient to harsh weather and bad soils.'],
  ['Nullarbor Plain', 'Flat, treeless area in southern Australia', 280, 16, 'The Nullarbor Plain is part of the area of flat, almost treeless, arid or semi-arid country of southern Australia, located on the Great Australian Bight coast.'],
  ['Zorbing', 'Recreation of rolling downhill inside an orb', 110, 7, 'Zorbing is the recreational or sport activity of rolling downhill inside an orb, generally made of transparent plastic.'],
  ['Hôtel de Lauzun', 'Hôtel particulier in Paris', 25, 6, 'The Hôtel de Lauzun is a 17th-century hôtel particulier on the Île Saint-Louis in Paris, notable for its richly decorated interiors.'],
  ['Oxford Electric Bell', 'Experimental electric bell ringing since 1840', 380, 9, 'The Oxford Electric Bell is an experimental electric bell set up in 1840 which has run nearly continuously ever since.'],
  ['Aboa (Antarctica)', 'Finnish research station', 18, 4, 'Aboa is a Finnish research station in Antarctica, located in Queen Maud Land on the Basen nunatak.'],
  ['Gravity hill', 'Optical illusion place', 300, 15, 'A gravity hill is a place where the layout of the surrounding land produces an optical illusion, making a slight downhill slope appear to be uphill.'],
  ['Kinabatangan River', 'River in Sabah, Malaysia', 70, 8, 'The Kinabatangan River is a river in Sabah, Malaysia. It is the second longest river in Malaysia.'],
  ['Wollemia', 'Genus of coniferous trees', 160, 14, 'Wollemia is a genus of coniferous tree in the family Araucariaceae. It was known only through fossil records until the Australian species Wollemia nobilis was discovered in 1994.'],
  ['Ceramic tile cutter', 'Hand tool', 6, 3, 'A ceramic tile cutter is used to cut ceramic tiles to a required size or shape. They come in a number of different forms, from basic manual devices to complex attachments for power tools.'],
  ['Little Snoring', 'Village in Norfolk, England', 40, 5, 'Little Snoring is a village and civil parish in the English county of Norfolk. It is close to the town of Fakenham.'],
  ['Halloumi', 'Cypriot cheese', 900, 18, 'Halloumi is a semi-hard, brined cheese made from a mixture of goat\'s and sheep\'s milk, and sometimes also cow\'s milk. It has a high melting point and so can easily be fried or grilled.'],
];

// Popular titles stand in for the monthly "top viewed" list.
export const FIXTURE_POPULAR = RAW.filter((r) => r[2] >= 5000).map((r) => r[0]);
const SET_ONLY = new Set(RAW.slice(0, 56).map((r) => r[0]));

export const FIXTURE_PAGES = RAW.map(([title, description, views, kb, extract], i) => ({
  pageid: 1000 + i,
  ns: 0,
  title,
  description,
  extract,
  length: kb * 1024,
  fullurl: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`,
  // Spread the average over 60 days so pageToArticle computes it the same way as live data.
  pageviews: Object.fromEntries(Array.from({ length: 60 }, (_, d) => [`d${d}`, views])),
  _randomEligible: !SET_ONLY.has(title),
}));

// A fetch replacement that answers the same URLs the live client calls.
export function fixtureFetch(url) {
  const u = new URL(url);
  const json = (body) => Promise.resolve(new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }));
  const strip = ({ _randomEligible, ...p }) => p;

  if (u.hostname === 'wikimedia.org') {
    return json({ items: [{ articles: FIXTURE_POPULAR.map((t, i) => ({ article: t.replaceAll(' ', '_'), rank: i + 1 })) }] });
  }
  const p = u.searchParams;
  if (p.get('generator') === 'random') {
    const n = Number(p.get('grnlimit') || 1);
    const eligible = FIXTURE_PAGES.filter((pg) => pg._randomEligible);
    const pages = Array.from({ length: n }, () => strip(eligible[Math.floor(Math.random() * eligible.length)]));
    return json({ query: { pages: [...new Map(pages.map((pg) => [pg.pageid, pg])).values()] } });
  }
  if (p.get('titles')) {
    const titles = p.get('titles').split('|');
    const pages = titles.map((t) => {
      const pg = FIXTURE_PAGES.find((x) => x.title === t);
      return pg ? strip(pg) : { ns: 0, title: t, missing: true };
    });
    return json({ query: { pages } });
  }
  return Promise.resolve(new Response('not found', { status: 404 }));
}
