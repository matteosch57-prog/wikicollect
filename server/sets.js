// Themed albums. Unlike the endless random catalog, a set has a fixed list of
// articles, so it can actually be completed. Set cards drop from packs.
// Titles are resolved through the Wikipedia API (redirects are followed).

const SETS = {
  en: [
    {
      id: 'solar-system',
      name: 'Solar System',
      emoji: '🪐',
      titles: ['Mercury (planet)', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'],
    },
    {
      id: 'beatles',
      name: 'The Fab Four',
      emoji: '🎸',
      titles: ['John Lennon', 'Paul McCartney', 'George Harrison', 'Ringo Starr'],
    },
    {
      id: 'ancient-wonders',
      name: 'Seven Wonders of the Ancient World',
      emoji: '🏛️',
      titles: [
        'Great Pyramid of Giza',
        'Hanging Gardens of Babylon',
        'Statue of Zeus at Olympia',
        'Temple of Artemis',
        'Mausoleum at Halicarnassus',
        'Colossus of Rhodes',
        'Lighthouse of Alexandria',
      ],
    },
    {
      id: 'olympians',
      name: 'Twelve Olympians',
      emoji: '⚡',
      titles: [
        'Zeus', 'Hera', 'Poseidon', 'Demeter', 'Athena', 'Apollo',
        'Artemis', 'Ares', 'Aphrodite', 'Hephaestus', 'Hermes', 'Dionysus',
      ],
    },
    {
      id: 'renaissance',
      name: 'Renaissance Masters',
      emoji: '🎨',
      titles: ['Leonardo da Vinci', 'Michelangelo', 'Raphael', 'Donatello', 'Titian', 'Sandro Botticelli'],
    },
    {
      id: 'noble-gases',
      name: 'Noble Gases',
      emoji: '🧪',
      titles: ['Helium', 'Neon', 'Argon', 'Krypton', 'Xenon', 'Radon'],
    },
    {
      id: 'continents',
      name: 'Continents',
      emoji: '🌍',
      titles: ['Africa', 'Antarctica', 'Asia', 'Australia (continent)', 'Europe', 'North America', 'South America'],
    },
    {
      id: 'physicists',
      name: 'Giants of Physics',
      emoji: '⚛️',
      titles: ['Isaac Newton', 'Albert Einstein', 'Marie Curie', 'Niels Bohr', 'Galileo Galilei', 'Richard Feynman'],
    },
  ],
  fr: [
    {
      id: 'solar-system',
      name: 'Système solaire',
      emoji: '🪐',
      titles: [
        'Mercure (planète)', 'Vénus (planète)', 'Terre', 'Mars (planète)',
        'Jupiter (planète)', 'Saturne (planète)', 'Uranus (planète)', 'Neptune (planète)',
      ],
    },
    {
      id: 'beatles',
      name: 'Les Fab Four',
      emoji: '🎸',
      titles: ['John Lennon', 'Paul McCartney', 'George Harrison', 'Ringo Starr'],
    },
    {
      id: 'renaissance',
      name: 'Maîtres de la Renaissance',
      emoji: '🎨',
      titles: ['Léonard de Vinci', 'Michel-Ange', 'Raphaël (peintre)', 'Donatello', 'Titien', 'Sandro Botticelli'],
    },
    {
      id: 'noble-gases',
      name: 'Gaz nobles',
      emoji: '🧪',
      titles: ['Hélium', 'Néon', 'Argon', 'Krypton', 'Xénon', 'Radon'],
    },
    {
      id: 'physicists',
      name: 'Géants de la physique',
      emoji: '⚛️',
      titles: ['Isaac Newton', 'Albert Einstein', 'Marie Curie', 'Niels Bohr', 'Galilée (savant)', 'Richard Feynman'],
    },
  ],
};

export function setsFor(lang) {
  return SETS[lang] || [];
}
