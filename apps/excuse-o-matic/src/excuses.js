// Excuse-O-Matic configuration: slots, taxonomies, and the fragments that wrap
// an excuse body. The bodies themselves live in library.js.

export { EXCUSES } from "./library.js";

// Slot vocabularies. Keep these WIDE — a narrow list is what makes a generator
// feel repetitive ("everything is a hamster, everything is the county line").
export const SLOTS = {
  kid: ["Gavin", "Ruby", "Paisley"],
  daughter: ["Ruby", "Paisley"],
  son: ["Gavin"],
  wife: ["Lindsey"],
  kids: [
    "the kids", "Gavin and Ruby", "Ruby and Paisley", "Gavin and Paisley",
    "all three kids", "the girls", "both girls", "the little ones",
  ],
  day: ["Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Monday"],
  sport: [
    "baseball", "basketball", "soccer", "volleyball", "wrestling", "flag football",
    "softball", "track", "cross country", "swim", "tennis", "golf", "cheer", "gymnastics",
  ],
  animal: [
    "goat", "rabbit", "barn cat", "beagle", "hamster", "bearded dragon", "rooster",
    "pot-bellied pig", "corn snake", "guinea pig", "duck", "turkey", "llama",
    "miniature donkey", "ferret", "parakeet", "tortoise", "hedgehog", "pony",
    "border collie", "steer", "lamb", "peacock", "chinchilla", "gecko", "cockatiel",
    "basset hound", "milk cow", "emu", "coonhound",
  ],
  town: [
    "two towns over", "clear around the lake", "up in the mountains",
    "an hour up the highway", "clear across the state", "down in the valley",
    "out by the reservoir", "over the pass", "three exits up", "past the grain elevator",
    "clear across the river", "up a gravel road I've never been down",
    "somewhere north of the state line", "out where the pavement ends",
    "way out past the fairgrounds", "out past the last stoplight",
    "forty minutes the wrong direction", "up at the lake house", "out in the sticks",
    "out where there's no cell service", "over by the old mill",
    "clear on the other end of the county",
  ],
  church: [
    "church", "the church", "Wednesday night youth group", "the men's group",
    "small group", "the church council", "our Sunday school class",
  ],
  far: [
    "two towns over", "an hour", "forty minutes", "thirty miles", "a solid hour",
    "twenty-five minutes", "clear across the county", "half an hour",
  ],
  store: [
    "Hobby Lobby", "Tractor Supply", "Walmart", "Academy", "Costco", "Lowe's",
    "the feed store", "the party store", "the hardware store", "the outlet mall",
  ],
  relative: [
    "Lindsey's mom", "Lindsey's aunt", "my mother-in-law", "Lindsey's sister",
    "Lindsey's cousin", "Lindsey's grandma", "my father-in-law", "Lindsey's uncle",
    "Lindsey's brother", "Lindsey's stepdad", "my sister-in-law", "Lindsey's godmother",
  ],
  vehicle: [
    "the truck", "the Suburban", "Lindsey's van", "the old Silverado", "the minivan",
    "the flatbed", "the work truck", "the wagon",
  ],
  hours: [
    "two hours", "three hours", "four hours", "most of the afternoon",
    "the entire morning", "a solid six hours", "all day", "the better part of a day",
  ],
  weather: [
    "a hailstorm", "an ice storm", "four inches of rain", "a wind advisory",
    "a hard freeze", "a heat index of 108", "a tornado watch", "wildfire smoke",
    "flash flooding", "a snow squall", "a derecho", "fog you could not see through",
  ],
  dish: [
    "a brisket", "forty pounds of pulled pork", "six dozen cinnamon rolls",
    "a turkey", "three pans of lasagna", "a whole hog", "eight pies",
    "a batch of jam", "two hundred tamales", "a wedding cake", "a smoked salmon",
  ],
  tool: [
    "the chainsaw", "the pressure washer", "the log splitter", "the welder",
    "the post-hole digger", "the tiller", "the skid steer", "the come-along",
  ],
};

export const CATEGORIES = [
  { key: "church", label: "Church & Bible Camp", emoji: "⛪" },
  { key: "kids", label: "Kid Logistics", emoji: "🎒" },
  { key: "lindsey", label: "Lindsey Said So", emoji: "💍" },
  { key: "home", label: "Home Disaster", emoji: "🔧" },
  { key: "animals", label: "Animal Situation", emoji: "🐐" },
  { key: "body", label: "Medical-ish", emoji: "🩹" },
  { key: "logistics", label: "Scheduling Chaos", emoji: "📅" },
  { key: "town", label: "Small Town Duty", emoji: "🚜" },
  { key: "work", label: "Work & Side Hustle", emoji: "💼" },
  { key: "weather", label: "Acts of God", emoji: "🌪️" },
  { key: "food", label: "Food & Potluck", emoji: "🍖" },
  { key: "tech", label: "Tech Trouble", emoji: "📱" },
  { key: "vehicle", label: "Truck & Trailer", emoji: "🛻" },
];

export const TEMPS = [
  { t: 1, label: "Plausible", blurb: "Boring. Airtight. Nobody follows up.", color: "#4ade80" },
  { t: 2, label: "Suspicious", blurb: "Raises exactly one eyebrow.", color: "#ffd166" },
  { t: 3, label: "Unhinged", blurb: "Technically possible. Barely.", color: "#ff8a3d" },
  { t: 4, label: "Legendary", blurb: "Nobody believes it. Everyone repeats it.", color: "#ff4d6d" },
];

export const CIRCUMSTANCES = [
  { key: "work", label: "Work thing", emoji: "💼" },
  { key: "guys", label: "Guys night", emoji: "🍗" },
  { key: "mountain", label: "Mountaineering trip", emoji: "🏔️" },
  { key: "help", label: "Helping you move", emoji: "📦" },
  { key: "dinner", label: "Dinner plans", emoji: "🍽️" },
  { key: "trip", label: "The trip", emoji: "🧳" },
  { key: "gym", label: "Gym / workout", emoji: "🏋️" },
  { key: "early", label: "Anything early", emoji: "🌅" },
  { key: "late", label: "Why he's late", emoji: "⏰" },
  { key: "ghost", label: "Why he ghosted", emoji: "📵" },
  { key: "party", label: "The party", emoji: "🎉" },
  { key: "chores", label: "The favor you asked", emoji: "🙏" },
  { key: "hunt", label: "Hunting / fishing", emoji: "🎣" },
  { key: "game", label: "Watching the game", emoji: "📺" },
];

// Circumstance-specific lead-ins. Temperature-agnostic on purpose — the body
// carries the absurdity, the opener just aims it.
export const OPENERS = {
  work: [
    "Hey, I'm gonna have to work from home today —",
    "I can't make the meeting, and I hate this —",
    "Gonna be off the grid most of the day. Reason being,",
    "Man, I've gotta burn a PTO day. Here's the deal:",
    "I'm not gonna make it in until at least noon.",
    "Tell them I'll dial in if I can, but",
    "Put me down as remote today.",
    "I need somebody to cover my morning.",
  ],
  guys: [
    "I'm out for tonight, brother. Genuinely gutted.",
    "Y'all go ahead without me —",
    "I was 100% coming and then this happened:",
    "Save me a seat next time. Tonight is cooked because",
    "I can't do wings tonight and it's killing me.",
    "Rain check on tonight —",
    "Do not wait on me. Order without me.",
    "I'm a no for tonight, and you're gonna laugh:",
  ],
  mountain: [
    "I've gotta drop off the mountaineering trip —",
    "Take me off the climb.",
    "Somebody else needs my spot on the summit push, because",
    "I can't do the mountain this year and it is genuinely killing me.",
    "I trained all year for this and I still can't go.",
    "Give my permit to somebody on the list —",
    "I'm out for the climb, and it's not the conditioning.",
    "Pull my name off the roster for the trip.",
  ],
  help: [
    "I feel awful about this, but I can't help you move —",
    "I know I said I'd bring the truck. Here's what happened:",
    "I'm not gonna be able to load anything Saturday.",
    "Please tell me you've got other guys, because",
    "I'd be there with the trailer, but",
    "You're gonna need one more body, and it can't be me.",
  ],
  dinner: [
    "We're gonna have to reschedule dinner —",
    "Don't hold the table for us.",
    "So we can't do Friday anymore.",
    "I hate doing this the day of, but",
    "Push it a week? The situation is:",
    "Cancel the reservation, unfortunately.",
  ],
  trip: [
    "I don't think we can make the trip —",
    "Cancel my spot on the trip.",
    "I've been trying to make the dates work and I can't, because",
    "We're gonna have to sit this one out.",
    "So the trip is a no for us, and it's not for lack of trying.",
    "Go without us and send pictures.",
  ],
  gym: [
    "Skipping the gym this morning —",
    "I'm not gonna make the 5 a.m.",
    "Go without me, I'll catch the afternoon session if",
    "No lift today.",
    "Take my spot in the class.",
  ],
  early: [
    "There's no way I'm up that early —",
    "Anything before nine is out for me right now.",
    "I'd have to leave the house at 4:30, and I can't, because",
    "Mornings are shot for me this week.",
    "Make it an afternoon and I'm in. Right now,",
  ],
  late: [
    "I'm running behind — I'll be there, just late.",
    "Start without me, I'm maybe 40 minutes out.",
    "Sorry, sorry, I know. On my way. So",
    "Almost there. The holdup was that",
    "Pulling in soon. Long story short,",
    "Give me twenty minutes.",
  ],
  ghost: [
    "Sorry I went dark on you —",
    "Just now seeing this. My phone's been face-down since Thursday because",
    "I know, I know, three days. In my defense:",
    "Not ignoring you, I promise.",
    "My phone's been in a drawer, and here's why:",
    "Digging out of about ninety texts. Reason being,",
  ],
  party: [
    "We're gonna miss the party —",
    "Put us down as a no, sadly.",
    "We tried everything to make it work.",
    "Tell everybody we said happy birthday, because",
    "We'll drop the gift off another day.",
  ],
  chores: [
    "I'm not gonna get to that favor this week —",
    "I know I owe you. Here's my problem:",
    "It's still on my list, I swear. But",
    "Gonna need one more week on that.",
    "I have not forgotten. What I have is",
  ],
  hunt: [
    "I'm gonna have to give up my spot in the blind —",
    "Can't make it out to the lease this weekend.",
    "Fish without me —",
    "I'm out for opening morning, which tells you how bad it is.",
    "Somebody take my tag, because",
  ],
  game: [
    "I'm gonna miss the game —",
    "Record it for me, don't text me the score.",
    "I won't be watching, and I'm sick about it.",
    "Y'all enjoy it. I'll be busy, because",
  ],
};

// Closing flourishes, keyed by temperature. Sometimes omitted entirely.
export const KICKERS = {
  1: [
    "Nothing dramatic, just bad timing.",
    "Should be back to normal by next week.",
    "I'll make it up to you.",
    "Wish it were more interesting than that.",
    "Boring, I know.",
    "Next one's on me.",
    "That's all it is.",
    "No drama, just the calendar.",
  ],
  2: [
    "I did not volunteer for this, for the record.",
    "Don't ask me how I got roped in.",
    "{wife} says hi, by the way.",
    "I'm as annoyed about it as you are.",
    "This is my life now.",
    "Ask me how much say I had in it.",
    "Anyway. That's where I'm at.",
    "It made more sense when I agreed to it.",
    "I'm told this is a privilege.",
  ],
  3: [
    "I've reread that sentence four times and it's still true.",
    "I know how it sounds. It's worse in person.",
    "{wife} confirmed all of this, so.",
    "I have receipts. I don't want to show you the receipts.",
    "You can't make this up. I would have.",
    "There's a group chat about it now.",
    "I'm typing this from a parking lot, if that helps paint the picture.",
    "Somebody's filming it, so eventually you'll just see it.",
    "I've stopped asking questions.",
    "At some point you just go along with it.",
  ],
  4: [
    "And that's the SHORT version.",
    "I have been informed this is non-negotiable.",
    "{wife} has a laminated schedule. There's a laminated schedule.",
    "Ask {wife}. Actually, don't ask {wife}.",
    "I'd invite you but there's a background check.",
    "If I'm not back by Sunday, tell everybody I went down doing what I loved: whatever this is.",
    "There is a signup sheet with my name on it in three places and I signed none of them.",
    "I want you to know I fought this.",
    "This is a real thing that is really happening to me.",
    "I have read this back to myself out loud. It did not help.",
    "Every word of that is true and I hate all of them.",
  ],
};

// Occasional trailing promise. Adds texture without changing the excuse.
export const PROMISES = [
  "Next week for sure.",
  "Text me a time that works and I'll make it happen.",
  "I'll bring the good stuff to make up for it.",
  "Put me down for the next one, no take-backs.",
  "First round's on me when I resurface.",
  "I'm free literally any other day.",
  "Give me a date and I'll write it in pen.",
  "I owe you one and I know it.",
];
