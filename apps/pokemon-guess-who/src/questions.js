// The question deck.
//
// A question is a predicate over the baked-in data, and both devices hold the
// same deck, so only its id travels: the asker sends "q:type:water", the other
// side runs the same function against the Pokémon it is hiding, and the answer
// is right by construction. Nobody has to trust anybody to score honestly, and
// the secret itself never goes over the wire until the game is over.
//
// Free-text questions exist too (see app.jsx) — those are answered by a human
// tapping Yes or No, which is the part of the tabletop game worth keeping.

const TYPE_NAMES = {
  normal: "Normal", fire: "Fire", water: "Water", electric: "Electric", grass: "Grass",
  ice: "Ice", fighting: "Fighting", poison: "Poison", ground: "Ground", flying: "Flying",
  psychic: "Psychic", bug: "Bug", rock: "Rock", ghost: "Ghost", dragon: "Dragon",
  fairy: "Fairy", steel: "Steel", dark: "Dark",
};

const COLORS = {
  red: "red", blue: "blue", green: "green", yellow: "yellow", purple: "purple",
  brown: "brown", pink: "pink", gray: "grey", black: "black", white: "white",
};

// Habitat reads as a place, so the question should too.
const HABITATS = {
  cave: "in caves", forest: "in forests", grassland: "on grasslands",
  mountain: "in the mountains", sea: "in the sea", "waters-edge": "at the water's edge",
  "rough-terrain": "on rough terrain", urban: "in towns and cities", rare: "somewhere rare",
};

// Only the body shapes that a person would describe the same way the data does.
// "upright" and "blob" are left out on purpose: two players would argue about them.
const BODIES = [
  ["wings", "Does it have wings?", (p) => p.shape === "wings" || p.shape === "bug-wings"],
  ["fourlegs", "Does it walk on four legs?", (p) => p.shape === "quadruped"],
  ["humanoid", "Does it have arms and legs like a person?", (p) => p.shape === "humanoid"],
  ["fish", "Is it shaped like a fish?", (p) => p.shape === "fish"],
  ["round", "Is it basically a ball?", (p) => p.shape === "ball"],
  ["tentacles", "Does it have tentacles?", (p) => p.shape === "tentacles"],
];

/** Every question, in the order the picker shows them. */
export function buildQuestions(pool) {
  const has = (fn) => pool.some(fn);
  const qs = [];
  const add = (id, group, label, test) => qs.push({ id, group, label, test });

  Object.keys(TYPE_NAMES).forEach((t) => {
    if (has((p) => p.types.includes(t)))
      add(`type:${t}`, "Type", `Is it a ${TYPE_NAMES[t]} type?`, (p) => p.types.includes(t));
  });
  add("type:dual", "Type", "Does it have two types?", (p) => p.types.length > 1);

  Object.keys(COLORS).forEach((c) => {
    if (has((p) => p.color === c))
      add(`color:${c}`, "Colour", `Is it mostly ${COLORS[c]}?`, (p) => p.color === c);
  });

  BODIES.forEach(([id, label, test]) => {
    if (has(test)) add(`body:${id}`, "Body", label, test);
  });

  Object.keys(HABITATS).forEach((h) => {
    if (has((p) => p.habitat === h))
      add(`home:${h}`, "Where it lives", `Does it live ${HABITATS[h]}?`, (p) => p.habitat === h);
  });

  add("evo:can", "Evolution", "Can it still evolve?", (p) => p.evolves);
  add("evo:has", "Evolution", "Has it already evolved at least once?", (p) => p.stage > 1);
  add("evo:legend", "Evolution", "Is it Legendary or Mythical?", (p) => p.legendary);

  add("size:tall", "Size", "Is it taller than 1 metre?", (p) => p.height > 1);
  add("size:huge", "Size", "Is it taller than 2 metres?", (p) => p.height > 2);
  add("size:heavy", "Size", "Does it weigh more than 50 kg?", (p) => p.weight > 50);
  add("size:light", "Size", "Does it weigh less than 10 kg?", (p) => p.weight < 10);

  add("name:am", "Name", "Does its name start with A–M?", (p) => p.name[0].toUpperCase() <= "M");
  add("name:long", "Name", "Is its name 8 letters or longer?", (p) => p.name.replace(/[^A-Za-z]/g, "").length >= 8);

  return qs;
}

export const groupsOf = (qs) => [...new Set(qs.map((q) => q.group))];
